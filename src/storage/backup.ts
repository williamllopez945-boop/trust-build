/**
 * Encrypted backup files.
 *
 * A backup is a small JSON envelope whose only plaintext is format metadata
 * (format, versions, creation time). All household data, including names,
 * is inside the AES-GCM ciphertext. Imports are all-or-nothing: the file is
 * size-checked, parsed, authenticated/decrypted, migrated, and validated
 * before anything is returned; any failure throws BackupError and changes
 * nothing.
 *
 * Backups contain real family data: keep them out of Git (`*.fvault` is
 * git-ignored and blocked by the privacy scan).
 */
import { parseHousehold, SchemaError, CURRENT_SCHEMA_VERSION } from "../domain/schema.ts";
import type { Household } from "../domain/types.ts";
import type { IntakeState } from "../intake/intake.ts";
import { decryptJson, encryptJson, type EncryptedBlob } from "./vault.ts";

export const BACKUP_FORMAT = "familyvault-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_EXTENSION = ".fvault";
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  createdAt: string;
  encrypted: EncryptedBlob;
}

export interface BackupContents {
  household: Household;
  intake: IntakeState;
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

export async function exportBackup(contents: BackupContents, passphrase: string, now: Date = new Date()): Promise<string> {
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    encrypted: await encryptJson(contents, passphrase),
  };
  return JSON.stringify(envelope, null, 2);
}

export function backupFileName(now: Date = new Date()): string {
  return `familyvault-backup-${now.toISOString().slice(0, 10)}${BACKUP_EXTENSION}`;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function checkIntake(x: unknown): IntakeState {
  if (!isObj(x) || !Array.isArray(x.answeredIds) || !Array.isArray(x.skippedIds)) return { answeredIds: [], skippedIds: [] };
  return { answeredIds: x.answeredIds.filter((s) => typeof s === "string"), skippedIds: x.skippedIds.filter((s) => typeof s === "string") };
}

export async function importBackup(text: string, passphrase: string): Promise<BackupContents> {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new BackupError("This file is too large to be a FamilyVault backup.");
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new BackupError("This is not a FamilyVault backup file (it is not valid JSON).");
  }
  if (!isObj(envelope) || envelope.format !== BACKUP_FORMAT) throw new BackupError("This is not a FamilyVault backup file.");
  if (typeof envelope.formatVersion !== "number" || envelope.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupError("This backup was made by a newer version of FamilyVault. Update the app, then import it.");
  }
  const blob = envelope.encrypted;
  if (!isObj(blob) || typeof blob.salt !== "string" || typeof blob.iv !== "string" || typeof blob.data !== "string" || typeof blob.iterations !== "number") {
    throw new BackupError("The backup file is damaged (encrypted section missing or malformed).");
  }
  let decrypted: unknown;
  try {
    decrypted = await decryptJson(blob as unknown as EncryptedBlob, passphrase);
  } catch {
    throw new BackupError("Could not decrypt the backup: wrong passphrase, or the file was modified.");
  }
  if (!isObj(decrypted)) throw new BackupError("The backup's contents are not recognized.");
  try {
    return { household: parseHousehold(decrypted.household), intake: checkIntake(decrypted.intake) };
  } catch (e) {
    if (e instanceof SchemaError) throw new BackupError(`The backup decrypted, but its data is not valid, so nothing was imported.\n${e.problems.join("\n")}`);
    throw e;
  }
}
