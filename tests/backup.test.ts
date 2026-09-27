import { describe, expect, it } from "vitest";
import { BackupError, backupFileName, exportBackup, importBackup } from "../src/storage/backup.ts";
import { demo } from "./fixtures.ts";

const pass = "correct horse battery staple";
const contents = () => ({ household: demo(), intake: { answeredIds: ["q.marital"], skippedIds: [] } });

describe("encrypted backups", () => {
  it("round-trips household and intake state", async () => {
    const file = await exportBackup(contents(), pass);
    const r = await importBackup(file, pass);
    expect(r.household).toEqual(demo());
    expect(r.intake.answeredIds).toEqual(["q.marital"]);
  });

  it("exposes no household data in plaintext", async () => {
    const file = await exportBackup(contents(), pass);
    for (const secret of ["Alex Example", "Brokerage", "p-alex", "texas", "Example Family"]) expect(file).not.toContain(secret);
    const env = JSON.parse(file);
    expect(Object.keys(env).sort()).toEqual(["createdAt", "encrypted", "format", "formatVersion", "schemaVersion"]);
  });

  it("names files with the git-ignored .fvault extension", () => {
    expect(backupFileName(new Date("2026-02-03T00:00:00Z"))).toBe("familyvault-backup-2026-02-03.fvault");
  });

  it("fails safely on a wrong passphrase", async () => {
    const file = await exportBackup(contents(), pass);
    await expect(importBackup(file, "not the passphrase")).rejects.toThrow(/wrong passphrase/);
  });

  it("detects tampering", async () => {
    const env = JSON.parse(await exportBackup(contents(), pass));
    const bytes = Uint8Array.from(atob(env.encrypted.data), (c) => c.charCodeAt(0));
    bytes[10] ^= 0xff;
    env.encrypted.data = btoa(String.fromCharCode(...bytes));
    await expect(importBackup(JSON.stringify(env), pass)).rejects.toThrow(BackupError);
  });

  it.each([
    ["not JSON", "hello"],
    ["wrong format", JSON.stringify({ format: "other" })],
    ["newer format", JSON.stringify({ format: "familyvault-backup", formatVersion: 99, encrypted: {} })],
    ["missing ciphertext", JSON.stringify({ format: "familyvault-backup", formatVersion: 1 })],
    ["hostile iteration count", JSON.stringify({ format: "familyvault-backup", formatVersion: 1, encrypted: { salt: "AA==", iv: "AA==", data: "AA==", iterations: 1e12 } })],
  ])("rejects %s", async (_n, text) => {
    await expect(importBackup(text, pass)).rejects.toThrow(BackupError);
  });

  it("rejects decrypted data that fails schema validation, importing nothing", async () => {
    const bad = { household: { ...demo(), people: "nope" }, intake: {} };
    const file = await exportBackup(bad as never, pass);
    await expect(importBackup(file, pass)).rejects.toThrow(/not valid, so nothing was imported/);
  });

  it("migrates older household data inside a backup", async () => {
    const { schemaVersion: _v, pendingChanges: _p, archived: _a, ...legacy } = demo();
    const r = await importBackup(await exportBackup({ household: legacy as never, intake: { answeredIds: [], skippedIds: [] } }, pass), pass);
    expect(r.household.schemaVersion).toBe(2);
    expect(r.household.pendingChanges).toEqual([]);
  });

  it("rejects oversized files", async () => {
    await expect(importBackup("x".repeat(11 * 1024 * 1024), pass)).rejects.toThrow(/too large/);
  });
});
