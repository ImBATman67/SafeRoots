/**
 * End-to-End Encryption Utilities for SafeRoots Chat
 * Uses Web Crypto API with ECDH key exchange and AES-256-GCM encryption
 *
 * Security Model:
 * - Each chat room has a per-session ephemeral key pair
 * - Public keys exchanged via Socket.io (which is still encrypted via TLS)
 * - Messages encrypted with shared secret derived from ECDH
 * - Server sees only encrypted ciphertext (zero-knowledge chat)
 * - No logs of plaintext messages stored
 */

/**
 * Generate an ephemeral key pair for a chat session
 * Uses ECDH with P-256 curve (widely supported)
 */
export async function generateKeyPair(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}> {
  return await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    false, // not extractable
    ['deriveKey', 'deriveBits']
  );
}

/**
 * Export public key to JWK for sharing with other clients
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<JsonWebKey> {
  return await window.crypto.subtle.exportKey('jwk', publicKey);
}

/**
 * Import a public key from JWK (from another client)
 */
export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    []
  );
}

/**
 * Derive a shared secret using ECDH
 * This is done independently by each client using their private key
 * and the other client's public key
 */
export async function deriveSharedSecret(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<ArrayBuffer> {
  return await window.crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: publicKey,
    },
    privateKey,
    256 // 256 bits for AES-256
  );
}

/**
 * Derive an encryption key from a shared secret
 */
export async function deriveEncryptionKey(
  sharedSecret: ArrayBuffer
): Promise<CryptoKey> {
  // Use HKDF to derive a proper encryption key from the shared secret
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );

  return await window.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(16), // empty salt for simplicity
      info: new TextEncoder().encode('saferoots-chat'), // application-specific info
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a message using AES-256-GCM
 * Returns base64-encoded {iv, ciphertext} for transmission
 */
export async function encryptMessage(
  message: string,
  encryptionKey: CryptoKey
): Promise<string> {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(message);

  // Generate random 96-bit IV (nonce)
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // Encrypt
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    encryptionKey,
    plaintext
  );

  // Package {iv, ciphertext} as base64 for transmission
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a message using AES-256-GCM
 * Expects base64-encoded {iv, ciphertext}
 */
export async function decryptMessage(
  encryptedData: string,
  encryptionKey: CryptoKey
): Promise<string> {
  try {
    // Decode base64
    const combined = new Uint8Array(
      atob(encryptedData)
        .split('')
        .map((c) => c.charCodeAt(0))
    );

    // Extract IV and ciphertext
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    // Decrypt
    const plaintext = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      encryptionKey,
      ciphertext
    );

    return new TextDecoder().decode(plaintext);
  } catch (error) {
    console.error('[E2EE] Decryption failed:', error);
    throw new Error('Failed to decrypt message');
  }
}

/**
 * Hash a room name to create a deterministic but anonymous room identifier
 * Prevents users from knowing which rooms others are in
 */
export async function hashRoomName(roomName: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(roomName);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a random session ID for key exchange tracking
 * Each user gets a unique session ID per room to organize key exchanges
 */
export function generateSessionId(): string {
  const array = new Uint8Array(16);
  window.crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
