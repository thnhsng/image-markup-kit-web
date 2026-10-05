import type { UUIDString } from './types';

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** A new random (version 4) UUID in uppercase, the form the Swift package writes. */
export function createUUID(): UUIDString {
  const cryptoObject = typeof crypto === 'undefined' ? undefined : crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
    return cryptoObject.randomUUID().toUpperCase();
  }
  const bytes = new Uint8Array(16);
  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    cryptoObject.getRandomValues(bytes);
  } else {
    // Insecure contexts without Web Crypto (e.g. plain http on a LAN address in old browsers): identifiers only
    // need to be unique within a document.
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)]
    .join('-')
    .toUpperCase();
}

/** The canonical (uppercase) form of a UUID string like `UUID(uuidString:)` accepts, or null. */
export function parseUUID(text: string): UUIDString | null {
  return UUID_PATTERN.test(text) ? text.toUpperCase() : null;
}
