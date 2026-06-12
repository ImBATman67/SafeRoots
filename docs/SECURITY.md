# SafeRoots Security & Privacy Guide

## 🔒 End-to-End Encryption (E2EE) for Chat

### Overview
SafeRoots implements client-side end-to-end encryption for all chat messages using the Web Crypto API. Messages are encrypted before leaving the client and the server never has access to plaintext data.

### Technical Implementation

#### Key Exchange Process (ECDH - Elliptic Curve Diffie-Hellman)

```
User A                          Server                          User B
|                                |                               |
|-- Generate ephemeral ECDH key pair (P-256)                    |
|                                |                               |
|-- Exchange public key via Socket.io -------->                 |
|                                |-- relay public key ---------->|
|                                |                               |
|                                |                    Generate ECDH pair
|                                |                    Derive shared secret
|<-- Receive User B's public key |<-- Exchange public key        |
|                                |                               |
| Derive shared secret (ECDH)    |                               |
| (User A secret == User B secret)|                              |
|                                |                               |
| Encrypt message with AES-256-GCM               Decrypt message
| Send encrypted data ---------->|-- Store only ciphertext ------>|
```

#### Encryption Specifications

- **Key Exchange**: ECDH with P-256 curve
- **Shared Secret Derivation**: HKDF (HMAC-based Key Derivation Function) with SHA-256
- **Encryption Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **IV (Initialization Vector)**: 96-bit random nonce per message
- **Authentication**: GCM mode provides authenticated encryption with associated data

#### Message Format

Each encrypted message is transmitted as base64-encoded `{iv || ciphertext}`:

```
[12 bytes IV] || [encrypted plaintext] || [16 bytes authentication tag]
```

### Security Properties

1. **Confidentiality**: Messages are encrypted with AES-256, making them unreadable to the server
2. **Authentication**: GCM mode ensures messages cannot be tampered with or forged
3. **Ephemeral Keys**: Keys are generated per-session and not persisted
4. **Forward Secrecy**: Even if a key pair is compromised, past messages remain secure (one-time keys)
5. **Zero-Knowledge Server**: Server stores only encrypted messages, never plaintext

### Client-Side Implementation

#### `client/src/utils/crypto.ts`
Core cryptographic utilities:
- `generateKeyPair()` - Generate ephemeral ECDH key pair
- `exportPublicKey()` - Export public key as JWK
- `importPublicKey()` - Import peer's public key
- `deriveSharedSecret()` - Derive ECDH shared secret
- `deriveEncryptionKey()` - Derive AES key from shared secret
- `encryptMessage()` - Encrypt plaintext to ciphertext
- `decryptMessage()` - Decrypt ciphertext to plaintext

#### `client/src/hooks/useE2EEEncryption.ts`
React hook managing E2EE state:
- Handles key generation and exchange
- Manages encryption/decryption of messages
- Tracks peer public keys
- Provides encryption readiness state

#### Chat Integration
The `ChatWindow` component:
1. Calls `useE2EEEncryption(room)` on mount
2. Exchanges public key with other room participants via Socket.io `exchange-public-key` event
3. Derives shared secret when receiving peer's public key
4. Encrypts messages before sending via Socket.io
5. Decrypts received messages before display
6. Shows E2EE status in UI (✓ Encrypted, setup in progress, etc.)

### Limitations & Considerations

1. **Room-Wide Key**: Current implementation derives a shared secret from the first peer. For multi-user rooms, consider implementing room-wide consensus on key derivation.
2. **User Authentication**: E2EE doesn't authenticate users (you see "BraveSparrow123" but don't know if it's the same person). For sensitive contexts, consider additional authentication layers.
3. **Metadata**: While content is encrypted, timing, message size, and frequency are still visible to the server.
4. **Key Compromise**: If a user's device is compromised, an attacker can derive keys and decrypt messages received while compromised.

### Usage Example

```typescript
// In ChatWindow component
const e2ee = useE2EEEncryption(room);

// Encrypt before sending
const encrypted = await e2ee.encryptForSending(message);
socket.emit('chat-message', { message: encrypted });

// Decrypt when receiving
socket.on('chat-message', async (msg) => {
  const decrypted = await e2ee.decryptForDisplay(msg.message);
  displayMessage(decrypted);
});
```

---

## 🛡️ Content Security Policy (CSP) Hardening

### CSP Audit Results

SafeRoots has been hardened with a strict Content Security Policy to prevent common web attacks:

### Current CSP Configuration

```javascript
{
  defaultSrc: ["'self'"],              // Default: self-origin only
  scriptSrc: ["'self'"],               // Scripts: self only (NO eval, NO inline)
  styleSrc: ["'self'"],                // Styles: self only (no unsafe-inline)
  imgSrc: ["'self'", 'data:', 'https:'], // Images: self, data URIs, HTTPS
  connectSrc: ["'self'", 'wss:', 'ws:', 'https:'],  // API calls via HTTPS/WSS
  fontSrc: ["'self'"],                 // Fonts: self only
  objectSrc: ["'none'"],               // No plugins/embeds
  frameAncestors: ["'self'"],          // Prevent clickjacking
  baseUri: ["'self'"],                 // Restrict <base> tag
  formAction: ["'self'"],              // Form submissions to self only
}
```

### Additional Security Headers

```javascript
// HSTS: Enforce HTTPS for 1 year (365 days)
HSTS: {
  maxAge: 31536000,
  includeSubDomains: true,
  preload: true  // Include in HSTS preload list
}

// X-Content-Type-Options: Prevent MIME sniffing
noSniff: true

// X-XSS-Protection: Enable XSS filters
xssFilter: true

// X-Frame-Options: Prevent clickjacking
frameguard: { action: 'deny' }

// Referrer-Policy: Strict referrer disclosure
referrerPolicy: 'strict-origin-when-cross-origin'
```

### Security Improvements

| Issue | Previous | Current | Impact |
|-------|----------|---------|--------|
| **Inline Styles** | `'unsafe-inline'` allowed | ✅ Removed | Prevents style injection attacks |
| **Eval** | Implicitly allowed | ✅ Blocked | Prevents dynamic code execution |
| **External Scripts** | Allowed from any HTTPS | ✅ Restricted to `'self'` | Prevents CDN compromise |
| **Object/Embed** | Allowed | ✅ Blocked as `'none'` | Prevents plugin-based attacks |
| **Form Submissions** | Any destination | ✅ Restricted to `'self'` | Prevents credential theft via form hijacking |
| **MIME Sniffing** | Allowed | ✅ Blocked | Prevents content-type attacks |

### CSP Violation Reporting

To monitor CSP violations in production, add a report-uri or report-to endpoint:

```javascript
// In server/src/index.ts helmet configuration:
contentSecurityPolicy: {
  directives: {
    // ... other directives
    reportUri: 'https://yourserver.com/api/csp-report',
  },
}
```

Then log violations:
```typescript
app.post('/api/csp-report', (req, res) => {
  console.warn('[CSP Violation]', req.body);
  res.status(204).send();
});
```

### Testing CSP

To verify CSP is working correctly:

1. **Browser DevTools**:
   - Open Network tab
   - Look for `Content-Security-Policy` header
   - Check Console for CSP violation warnings

2. **Test inline script blocking**:
   ```html
   <script>console.log('This should be blocked')</script>
   <!-- Should see CSP violation in console -->
   ```

3. **Test style injection blocking**:
   ```html
   <div style="color: red;">This should not be red</div>
   <!-- Style should not apply due to CSP -->
   ```

### Breaking Changes

If you were relying on unsafe directives, you'll need to update:

- ❌ `<script>` tags with inline code → ✅ Move to external .js files
- ❌ `style="..."` inline attributes → ✅ Move to <style> tags or .css files
- ❌ `onclick=""` handlers → ✅ Use `addEventListener()` in JavaScript
- ❌ `eval()` or `Function()` → ✅ Use alternative patterns

### Production Deployment

For production, ensure:

1. ✅ HTTPS is enforced (CSP headers only transmitted over secure connections)
2. ✅ HSTS is enabled (forces HTTPS for subsequent visits)
3. ✅ Monitoring is in place for CSP violations
4. ✅ Third-party integrations are validated against CSP
5. ✅ Regular security audits are performed

---

## 🔑 Key Management Best Practices

### E2EE Key Management

1. **Never Persist Keys**: Encryption keys are generated per-session and discarded when the connection closes
2. **Device-Level Security**: Keys are stored in browser memory only, not in localStorage or cookies
3. **Use WebCrypto API**: Keys use the `non-extractable` flag, preventing export to JavaScript
4. **Secure Random**: Uses `crypto.getRandomValues()` for all random values

### Password Security (for Auth)

- ✅ Never transmit passwords in plaintext
- ✅ Always use HTTPS/TLS
- ✅ Hash passwords with bcrypt or Argon2 (not MD5 or SHA1)
- ✅ Use `scrypt` or `PBKDF2` for key derivation

---

## 🚨 Security Incident Response

### If You Suspect a Compromise

1. **Stop using the affected chat room** - Don't send sensitive information
2. **Clear session storage** - `sessionStorage.clear()` in DevTools Console
3. **Refresh the page** - Gets new ephemeral keys
4. **Report to administrators** - Provide timestamp and room name

### Server-Side Logs

Be aware that the server logs:
- ✅ Encrypted messages (ciphertext only)
- ✅ Usernames (anonymous, no personal info)
- ✅ Timestamps
- ❌ NOT plaintext message content

Even with full server access, an attacker cannot read encrypted messages without the private key.

---

## 📋 Compliance & Privacy Standards

### GDPR Compliance

- ✅ Messages are encrypted (even from administrators)
- ✅ No personal data is collected (anonymous usernames)
- ✅ Sessions don't require login
- ✅ Users can stop chatting at any time (no data retention)

### Recommended Practices

1. ✅ Display privacy policy in UI
2. ✅ Inform users about E2EE limitations
3. ✅ Regular security audits
4. ✅ Penetration testing
5. ✅ Incident response plan

---

## 🔍 Monitoring & Auditing

### Server-Side Monitoring

```typescript
// Log E2EE key exchanges (for anomaly detection)
socket.on('exchange-public-key', (payload) => {
  console.log(`[E2EE] Key exchange in ${room} by ${sessionId.slice(0, 8)}...`);
  // Could add rate limiting or anomaly detection here
});

// Monitor rate limits
if (isRateLimited()) {
  console.warn(`[RateLimit] User exceeded message limit in ${room}`);
}
```

### Client-Side Monitoring

```typescript
// Log encryption errors
if (encryptionFailed) {
  console.error('[E2EE] Encryption failed, retrying...');
  // Could emit telemetry or prompt user
}
```

---

## 🎓 Security Assumptions

SafeRoots E2EE assumes:

1. **User Device is Trusted**: If the user's device is compromised, encryption is moot
2. **HTTPS/TLS is Secure**: Key exchange relies on transport security
3. **Browser WebCrypto is Implemented Correctly**: We rely on the browser's crypto implementation
4. **Users Don't Share Devices**: Each session gets new keys
5. **Server is Not Actively Malicious**: Server could theoretically log encrypted data and crack it later if keys are compromised

### What E2EE Does NOT Protect Against

- ❌ Server-side key logging (if someone has root access)
- ❌ Device malware (can keylog before encryption)
- ❌ Network analysis (timing, packet size)
- ❌ User impersonation (no auth required for chat)
- ❌ Future cryptanalysis (algorithm could be broken in future)

---

## 🔗 Additional Resources

- [Web Crypto API Spec](https://www.w3.org/TR/WebCryptoAPI/)
- [OWASP Content Security Policy](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- [Helmet.js Documentation](https://helmetjs.github.io/)
- [ECDH Key Exchange](https://en.wikipedia.org/wiki/Elliptic_curve_Diffie%E2%80%93Hellman)
- [AES-GCM Encryption](https://en.wikipedia.org/wiki/Galois/Counter_Mode)

