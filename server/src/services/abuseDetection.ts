import crypto from 'crypto';

/**
 * Rate Limiting & Anti-Abuse System
 * Tracks abuse patterns and implements soft-bans
 */

export interface AbuseRecord {
  ipHash: string;
  violationType: 'flood' | 'inappropriate' | 'spam';
  timestamp: number;
  severity: number; // 1-5, cumulative
}

export interface MutedUser {
  socketId: string;
  room: string;
  mutedUntil: number;
  reason: string;
}

/**
 * Hash IP address for privacy-preserving tracking
 * Uses SHA-256 so original IP is not stored
 */
export function hashIpAddress(ipAddress: string): string {
  return crypto
    .createHash('sha256')
    .update(ipAddress + (process.env.ABUSE_SALT || 'saferoots'))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Manage rate limiting per-socket per-room
 */
export class PerSocketRateLimiter {
  private messageTimestamps: Map<string, number[]> = new Map();
  private readonly maxMessages: number;
  private readonly windowMs: number;

  constructor(maxMessages: number = 5, windowMs: number = 10000) {
    this.maxMessages = maxMessages;
    this.windowMs = windowMs;
  }

  /**
   * Check if a message should be rate limited
   * Returns { allowed: boolean, remainingQuota: number }
   */
  checkLimit(socketId: string): { allowed: boolean; remainingQuota: number } {
    const now = Date.now();
    let timestamps = this.messageTimestamps.get(socketId) || [];

    // Remove old timestamps outside the window
    timestamps = timestamps.filter((ts) => now - ts < this.windowMs);

    const allowed = timestamps.length < this.maxMessages;
    const remainingQuota = Math.max(0, this.maxMessages - timestamps.length - 1);

    if (allowed) {
      timestamps.push(now);
    }

    this.messageTimestamps.set(socketId, timestamps);
    return { allowed, remainingQuota };
  }

  /**
   * Clear rate limit data for a socket (e.g., on disconnect)
   */
  clearSocket(socketId: string): void {
    this.messageTimestamps.delete(socketId);
  }

  /**
   * Get violation severity if rate-limited
   * Rapid-fire messages = higher severity
   */
  getViolationSeverity(socketId: string): number {
    const timestamps = this.messageTimestamps.get(socketId) || [];
    if (timestamps.length < 3) return 1;
    if (timestamps.length < 5) return 2;
    if (timestamps.length < 8) return 3;
    if (timestamps.length < 12) return 4;
    return 5; // Severe flooding
  }
}

/**
 * Manage muted users (auto-mute for flooding/abuse)
 */
export class MuteManager {
  private mutedUsers: Map<string, MutedUser> = new Map();
  private readonly muteDurationMs: number;

  constructor(muteDurationMs: number = 5 * 60 * 1000) {
    // 5 minutes default
    this.muteDurationMs = muteDurationMs;
  }

  /**
   * Mute a user for a specific duration
   */
  muteSocket(socketId: string, room: string, reason: string): void {
    const mutedUntil = Date.now() + this.muteDurationMs;
    this.mutedUsers.set(socketId, {
      socketId,
      room,
      mutedUntil,
      reason,
    });

    console.log(`[Mute] Socket ${socketId.slice(0, 8)} muted in ${room} for: ${reason}`);
  }

  /**
   * Check if a socket is currently muted
   */
  isMuted(socketId: string, room: string): boolean {
    const muted = this.mutedUsers.get(socketId);
    if (!muted || muted.room !== room) return false;

    const now = Date.now();
    if (now > muted.mutedUntil) {
      this.mutedUsers.delete(socketId);
      return false;
    }

    return true;
  }

  /**
   * Get mute info (for displaying to user)
   */
  getMuteInfo(socketId: string, room: string): { mutedUntil: number; reason: string } | null {
    const muted = this.mutedUsers.get(socketId);
    if (!muted || muted.room !== room) return null;

    const now = Date.now();
    if (now > muted.mutedUntil) {
      this.mutedUsers.delete(socketId);
      return null;
    }

    return {
      mutedUntil: muted.mutedUntil,
      reason: muted.reason,
    };
  }

  /**
   * Unmute a socket (early unmute, e.g., by moderator)
   */
  unmuteSocket(socketId: string): void {
    this.mutedUsers.delete(socketId);
  }
}

/**
 * Track abuse reports and implement soft-bans
 */
export class AbuseTracker {
  private abuseRecords: AbuseRecord[] = [];
  private bannedIpHashes: Set<string> = new Set();
  private readonly maxViolationsBeforeBan: number = 3;
  private readonly recordRetentionMs: number = 24 * 60 * 60 * 1000; // 24 hours

  constructor(maxViolationsBeforeBan: number = 3) {
    this.maxViolationsBeforeBan = maxViolationsBeforeBan;

    // Clean up old records periodically
    setInterval(() => this.cleanupOldRecords(), 60 * 60 * 1000); // Every hour
  }

  /**
   * Record an abuse incident
   */
  recordAbuse(ipHash: string, violationType: 'flood' | 'inappropriate' | 'spam', severity: number = 1): void {
    this.abuseRecords.push({
      ipHash,
      violationType,
      timestamp: Date.now(),
      severity,
    });

    // Check if this IP should be soft-banned
    const violationCount = this.abuseRecords.filter(
      (r) => r.ipHash === ipHash && Date.now() - r.timestamp < 24 * 60 * 60 * 1000
    ).length;

    if (violationCount >= this.maxViolationsBeforeBan) {
      this.bannedIpHashes.add(ipHash);
      console.warn(
        `[AbuseTracker] Soft-banned IP hash ${ipHash.slice(0, 8)}... after ${violationCount} violations`
      );
    }
  }

  /**
   * Check if an IP hash is soft-banned
   */
  isBanned(ipHash: string): boolean {
    return this.bannedIpHashes.has(ipHash);
  }

  /**
   * Get violation history for an IP hash
   */
  getViolationHistory(ipHash: string): AbuseRecord[] {
    return this.abuseRecords.filter((r) => r.ipHash === ipHash);
  }

  /**
   * Get violation count in last N hours
   */
  getRecentViolationCount(ipHash: string, hoursBack: number = 24): number {
    const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
    return this.abuseRecords.filter((r) => r.ipHash === ipHash && r.timestamp > cutoff).length;
  }

  /**
   * Lift a soft-ban (e.g., manual review)
   */
  unbanIpHash(ipHash: string): void {
    this.bannedIpHashes.delete(ipHash);
    console.log(`[AbuseTracker] Unbanned IP hash ${ipHash.slice(0, 8)}...`);
  }

  /**
   * Clean up old abuse records
   */
  private cleanupOldRecords(): void {
    const cutoff = Date.now() - this.recordRetentionMs;
    const before = this.abuseRecords.length;
    this.abuseRecords = this.abuseRecords.filter((r) => r.timestamp > cutoff);
    const after = this.abuseRecords.length;

    if (before - after > 0) {
      console.log(`[AbuseTracker] Cleaned up ${before - after} old records`);
    }
  }
}
