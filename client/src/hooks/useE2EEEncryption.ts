import { useCallback, useEffect, useRef, useState } from 'react';
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedSecret,
  deriveEncryptionKey,
  encryptMessage,
  decryptMessage,
  generateSessionId,
} from '../utils/crypto';

interface KeyExchangeState {
  localPublicKeyJwk: JsonWebKey | null;
  remotePublicKeysJwk: Map<string, JsonWebKey>; // sessionId -> publicKeyJwk
  encryptionKey: CryptoKey | null;
  isReady: boolean;
  sessionId: string;
}

/**
 * Hook to manage end-to-end encryption for a chat room
 * Handles key exchange and message encryption/decryption
 */
export function useE2EEEncryption(room: string) {
  const [state, setState] = useState<KeyExchangeState>({
    localPublicKeyJwk: null,
    remotePublicKeysJwk: new Map(),
    encryptionKey: null,
    isReady: false,
    sessionId: '',
  });

  const privateKeyRef = useRef<CryptoKey | null>(null);
  const derivedSecretsRef = useRef<Map<string, ArrayBuffer>>(new Map());

  // Initialize local key pair
  useEffect(() => {
    let isMounted = true;

    const initializeKeys = async () => {
      try {
        // Generate ephemeral key pair
        const { publicKey, privateKey } = await generateKeyPair();
        privateKeyRef.current = privateKey;

        // Export public key for sharing
        const publicKeyJwk = await exportPublicKey(publicKey);
        const sessionId = generateSessionId();

        if (isMounted) {
          setState((prev) => ({
            ...prev,
            localPublicKeyJwk: publicKeyJwk,
            sessionId,
            isReady: true, // Ready to exchange keys
          }));
        }
      } catch (error) {
        console.error('[E2EE] Failed to initialize keys:', error);
      }
    };

    initializeKeys();

    return () => {
      isMounted = false;
    };
  }, [room]);

  /**
   * Add a peer's public key (received from another client)
   * Derive shared secret with this peer and update encryption key
   */
  const addPeerPublicKey = useCallback(
    async (sessionId: string, publicKeyJwk: JsonWebKey) => {
      try {
        if (!privateKeyRef.current) {
          console.warn('[E2EE] Private key not ready');
          return;
        }

        // Import peer's public key
        const peerPublicKey = await importPublicKey(publicKeyJwk);

        // Derive shared secret with this peer
        const sharedSecret = await deriveSharedSecret(
          privateKeyRef.current,
          peerPublicKey
        );
        derivedSecretsRef.current.set(sessionId, sharedSecret);

        // For simplicity, derive encryption key from first peer's secret
        // In production, you might want room-wide consensus on the key
        const encryptionKey = await deriveEncryptionKey(sharedSecret);

        setState((prev) => ({
          ...prev,
          remotePublicKeysJwk: new Map(prev.remotePublicKeysJwk).set(
            sessionId,
            publicKeyJwk
          ),
          encryptionKey, // Update the encryption key
        }));
      } catch (error) {
        console.error('[E2EE] Failed to add peer public key:', error);
      }
    },
    []
  );

  /**
   * Encrypt a message before sending
   */
  const encryptForSending = useCallback(
    async (message: string): Promise<string | null> => {
      try {
        if (!state.encryptionKey) {
          console.warn('[E2EE] Encryption key not ready');
          return null;
        }

        return await encryptMessage(message, state.encryptionKey);
      } catch (error) {
        console.error('[E2EE] Encryption failed:', error);
        return null;
      }
    },
    [state.encryptionKey]
  );

  /**
   * Decrypt a received message
   */
  const decryptForDisplay = useCallback(
    async (encryptedData: string): Promise<string | null> => {
      try {
        if (!state.encryptionKey) {
          console.warn('[E2EE] Encryption key not ready');
          return null;
        }

        return await decryptMessage(encryptedData, state.encryptionKey);
      } catch (error) {
        console.error('[E2EE] Decryption failed:', error);
        return null;
      }
    },
    [state.encryptionKey]
  );

  return {
    // State
    isReady: state.isReady && state.encryptionKey !== null,
    sessionId: state.sessionId,
    localPublicKeyJwk: state.localPublicKeyJwk,
    keysExchanged: state.remotePublicKeysJwk.size,

    // Methods
    addPeerPublicKey,
    encryptForSending,
    decryptForDisplay,
  };
}
