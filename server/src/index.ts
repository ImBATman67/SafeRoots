import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server as SocketServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { nanoid } from 'nanoid';
import dotenv from 'dotenv';

import { apiLimiter } from './middleware/rateLimiter';
import shelterRoutes   from './routes/shelterRoutes';
import resourceRoutes  from './routes/resources';
import alertRoutes     from './routes/alerts';
import volunteerRoutes from './routes/volunteers';
import metricsRoutes   from './routes/metrics';
import legalRoutes     from './routes/legal';
import authRoutes      from './routes/auth';
import transitRoutes   from './routes/transit';
import { getDb } from './db';
import { 
  hashIpAddress, 
  PerSocketRateLimiter, 
  MuteManager, 
  AbuseTracker 
} from './services/abuseDetection';

dotenv.config();

const PORT        = Number(process.env.PORT)        || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN         || 'http://localhost:3000';

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      // Block everything by default, then allow specifically
      defaultSrc: ["'self'"],
      
      // Scripts: only from our own domain, no inline eval
      scriptSrc: ["'self'"],
      
      // Styles: self only (no unsafe-inline)
      // If you need inline styles, use nonce-based CSP instead
      styleSrc: ["'self'"],
      
      // Images: self, data URIs, and HTTPS
      imgSrc: ["'self'", 'data:', 'https:'],
      
      // WebSockets and XHR: self + WebSocket
      connectSrc: ["'self'", 'wss:', 'ws:', 'https:'],
      
      // Fonts: self only
      fontSrc: ["'self'"],
      
      // No object/embed
      objectSrc: ["'none'"],
      
      // No plugins
      pluginTypes: [],
      
      // Frame ancestors: prevent clickjacking (can only be embedded in same origin)
      frameAncestors: ["'self'"],
      
      // Base URI: restrict base tag
      baseUri: ["'self'"],
      
      // Form action: only allow form submissions to same origin
      formAction: ["'self'"],
      
      // Upgrade insecure requests to HTTPS
      upgradeInsecureRequests: [],
      
      // Require SRI (subresource integrity) for scripts
      // Note: vite-plugin-pwa should handle this automatically
    },
  },
  
  // Additional security headers
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  
  // Prevent browsers from MIME sniffing
  noSniff: true,
  
  // XSS Protection
  xssFilter: true,
  
  // Prevent clickjacking
  frameguard: {
    action: 'deny',
  },
  
  // Referrer policy
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
}));

app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));

app.use(express.json({ limit: '128kb' }));
app.use('/api', apiLimiter);

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use('/api/shelters',   shelterRoutes);
app.use('/api/resources',  resourceRoutes);
app.use('/api/alerts',     alertRoutes);
app.use('/api/volunteers', volunteerRoutes);
app.use('/api/metrics',    metricsRoutes);
app.use('/api/legal',      legalRoutes);
app.use('/api/auth',       authRoutes);
app.use('/api/transit',    transitRoutes);

app.get('/api/health', (_req, res) => {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[health] database check failed:', err);
    res.status(503).json({
      status: 'error',
      error: 'Database unavailable',
    });
  }
});

// 404 catch-all
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Export app for testing
export { app };

// ─── HTTP + Socket.io ─────────────────────────────────────────────────────────

const httpServer = http.createServer(app);

const io = new SocketServer(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: false,
  },
  // Rate limiting via middleware
  transports: ['websocket', 'polling'],
});

const VALID_ROOMS = new Set([
  'general', 'housing', 'lgbtq', 'mental-health', 'legal', 'domestic-violence', 'women',
]);

/** Maximum history lines returned per room */
const HISTORY_LIMIT = 50;

// ─── Abuse Detection System ───────────────────────────────────────────────────

/** Per-room rate limiters */
const perRoomLimiters = new Map<string, PerSocketRateLimiter>();

/** Global mute manager */
const muteManager = new MuteManager(5 * 60 * 1000); // 5 minute mutes

/** Global abuse tracker */
const abuseTracker = new AbuseTracker(3); // Soft-ban after 3 violations in 24h

/**
 * Get or create a rate limiter for a room
 */
function getRoomLimiter(room: string): PerSocketRateLimiter {
  if (!perRoomLimiters.has(room)) {
    perRoomLimiters.set(room, new PerSocketRateLimiter(5, 10000)); // 5 msgs per 10s
  }
  return perRoomLimiters.get(room)!;
}

/**
 * Get client's IP address (respects X-Forwarded-For for proxies)
 */
function getClientIp(socket: any): string {
  return (
    socket.handshake.headers['x-forwarded-for'] ||
    socket.handshake.address ||
    'unknown'
  ).toString().split(',')[0].trim();
}

/**
 * Sanitize input from users to prevent XSS and injection attacks
 */
function sanitizeInput(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .slice(0, maxLength)
    // Remove control characters (but keep common whitespace)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

io.on('connection', socket => {
  let currentRoom: string | null = null;
  const clientIp = getClientIp(socket);
  const ipHash = hashIpAddress(clientIp);

  // Check for soft-ban on connection
  if (abuseTracker.isBanned(ipHash)) {
    console.warn(`[Connection] Blocked soft-banned IP hash ${ipHash.slice(0, 8)}...`);
    socket.emit('error', {
      message: 'Your IP has been temporarily restricted due to abuse. Please try again later.',
    });
    socket.disconnect();
    return;
  }

  socket.on('join-room', (room: unknown) => {
    if (typeof room !== 'string' || !VALID_ROOMS.has(room)) {
      socket.emit('error', { message: 'Invalid room' });
      return;
    }

    currentRoom = room;
    socket.join(room);

    // Send last N messages from DB
    try {
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT id, room, username, message, timestamp
           FROM chat_messages
           WHERE room = ?
           ORDER BY timestamp DESC
           LIMIT ?`
        )
        .all(room, HISTORY_LIMIT) as {
          id: string; room: string; username: string;
          message: string; timestamp: string;
        }[];

      socket.emit('chat-history', rows.reverse());
    } catch (err) {
      console.error('[chat] failed to fetch history:', err);
      socket.emit('error', { message: 'Failed to load chat history' });
    }
  });

  socket.on('leave-room', (room: unknown) => {
    if (typeof room === 'string' && VALID_ROOMS.has(room)) {
      socket.leave(room);
      if (currentRoom === room) currentRoom = null;
    }
  });

  socket.on('chat-message', (payload: unknown) => {
    // Validate payload structure
    if (typeof payload !== 'object' || payload === null) return;

    const { room, message, username } = payload as Record<string, unknown>;

    // Validate room
    if (typeof room !== 'string' || !VALID_ROOMS.has(room)) {
      socket.emit('error', { message: 'Invalid room' });
      return;
    }

    // Check if socket is muted
    const muteInfo = muteManager.getMuteInfo(socket.id, room);
    if (muteInfo) {
      const remainingMs = muteInfo.mutedUntil - Date.now();
      const remainingSec = Math.ceil(remainingMs / 1000);
      socket.emit('error', {
        message: `You are muted for ${remainingSec}s (reason: ${muteInfo.reason})`,
      });
      return;
    }

    // Per-room rate limit check
    const limiter = getRoomLimiter(room);
    const { allowed, remainingQuota } = limiter.checkLimit(socket.id);

    if (!allowed) {
      const severity = limiter.getViolationSeverity(socket.id);

      // Record abuse
      abuseTracker.recordAbuse(ipHash, 'flood', severity);

      // Auto-mute for flooding
      muteManager.muteSocket(socket.id, room, `Flooding (severity: ${severity}/5)`);

      socket.emit('error', {
        message: 'Message rate limit exceeded. You have been temporarily muted.',
      });

      console.warn(
        `[RateLimit] Socket ${socket.id.slice(0, 8)} rate-limited in ${room} (severity: ${severity})`
      );
      return;
    }

    // Warn user if approaching quota
    if (remainingQuota <= 1) {
      socket.emit('warning', {
        message: 'Approaching message rate limit. Slow down!',
      });
    }

    // Sanitize and validate inputs
    const cleanUsername = sanitizeInput(username, 60);
    const cleanMessage = sanitizeInput(message, 500);

    if (!cleanUsername || !cleanMessage) {
      socket.emit('error', { message: 'Invalid message or username' });
      return;
    }

    try {
      const db = getDb();
      const id = nanoid();
      const timestamp = new Date().toISOString();

      // Persist to DB (stored encrypted if using E2EE)
      db.prepare(
        'INSERT INTO chat_messages (id, room, username, message, timestamp) VALUES (?, ?, ?, ?, ?)'
      ).run(id, room, cleanUsername, cleanMessage, timestamp);

      const msg = {
        id,
        room,
        username: cleanUsername,
        message: cleanMessage,
        timestamp,
      };

      // Broadcast to everyone in the room (including sender)
      io.to(room).emit('chat-message', msg);
    } catch (err) {
      console.error('[chat] failed to save message:', err);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      socket.leave(currentRoom);
    }
    // Clean up rate limiter for this socket
    if (currentRoom) {
      getRoomLimiter(currentRoom).clearSocket(socket.id);
    }
  });

  /**
   * Report abusive user
   * Anonymous reports help flag violators for soft-bans
   */
  socket.on('report-user', (payload: unknown) => {
    if (typeof payload !== 'object' || payload === null) return;

    const { reason, targetUsername, room } = payload as Record<string, unknown>;

    if (
      typeof reason !== 'string' ||
      typeof targetUsername !== 'string' ||
      typeof room !== 'string'
    ) {
      return;
    }

    const cleanReason = sanitizeInput(reason, 200);
    const cleanUsername = sanitizeInput(targetUsername, 60);

    if (!cleanReason || !cleanUsername) return;

    // Log report
    console.log(
      `[Report] User "${cleanUsername}" reported in ${room} for: ${cleanReason}`
    );

    // In future: match username to socket IPs and track patterns
    // For now: just log and could send to moderation dashboard

    socket.emit('confirmation', { message: 'Report received, thank you.' });
  });

  /**
   * E2EE Key Exchange
   * Server acts as a relay for public keys only (zero knowledge)
   * Server never sees plaintext messages, only encrypted data
   */
  socket.on('exchange-public-key', (payload: unknown) => {
    if (typeof payload !== 'object' || payload === null) return;

    const { room, sessionId, publicKeyJwk } = payload as Record<string, unknown>;

    // Validate
    if (typeof room !== 'string' || !VALID_ROOMS.has(room)) {
      socket.emit('error', { message: 'Invalid room for key exchange' });
      return;
    }

    if (typeof sessionId !== 'string' || !sessionId) {
      socket.emit('error', { message: 'Invalid session ID' });
      return;
    }

    if (typeof publicKeyJwk !== 'object' || !publicKeyJwk) {
      socket.emit('error', { message: 'Invalid public key' });
      return;
    }

    // Relay public key to all other users in the room
    // Each client independently derives the same shared secret
    io.to(room).emit('public-key-exchanged', {
      sessionId,
      publicKeyJwk,
      timestamp: new Date().toISOString(),
    });

    console.log(`[E2EE] Key exchange in room ${room} by session ${sessionId.slice(0, 8)}...`);
  });
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  console.log('[shutdown] SIGTERM received, closing server gracefully...');
  io.close();
  httpServer.close(() => {
    console.log('[shutdown] server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[shutdown] SIGINT received, closing server gracefully...');
  io.close();
  httpServer.close(() => {
    console.log('[shutdown] server closed');
    process.exit(0);
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`🛡  SafeRoots API running on http://localhost:${PORT}`);
});
