/**
 * Local-first encrypted storage for REAL household data.
 *
 * Data is encrypted with AES-GCM using a key derived from a passphrase
 * (PBKDF2-SHA-256). The passphrase is never stored. Real data lives only
 * in the browser's local storage on the user's device, never in Git.
 */
export interface EncryptedBlob {
  v: 1;
  salt: string; // base64
  iv: string; // base64
  data: string; // base64 ciphertext
  iterations: number;
}

const ITERATIONS = 310_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptJson(value: unknown, passphrase: string): Promise<EncryptedBlob> {
  if (passphrase.length < 12) throw new Error("Use a passphrase of at least 12 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value))));
  return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(ct), iterations: ITERATIONS };
}

export async function decryptJson<T>(blob: EncryptedBlob, passphrase: string): Promise<T> {
  const key = await deriveKey(passphrase, unb64(blob.salt), blob.iterations);
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.data));
  } catch {
    throw new Error("Could not unlock the vault: wrong passphrase or corrupted data.");
  }
  return JSON.parse(dec.decode(pt)) as T;
}

const STORAGE_KEY = "familyvault.household.v1";

export function hasSavedVault(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try {
    return storage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export async function saveVault(value: unknown, passphrase: string, storage: Pick<Storage, "setItem"> = localStorage): Promise<void> {
  storage.setItem(STORAGE_KEY, JSON.stringify(await encryptJson(value, passphrase)));
}

export async function loadVault<T>(passphrase: string, storage: Pick<Storage, "getItem"> = localStorage): Promise<T | null> {
  const raw = storage.getItem(STORAGE_KEY);
  return raw ? decryptJson<T>(JSON.parse(raw) as EncryptedBlob, passphrase) : null;
}
