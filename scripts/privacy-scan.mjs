#!/usr/bin/env node
/**
 * FamilyVault privacy scan.
 *
 * Fails when tracked (or staged) files contain likely PII, secrets, or
 * file types that must never be committed. Runs in the pre-commit hook and
 * in `npm run check`.
 *
 *   node scripts/privacy-scan.mjs            # scan tracked + untracked (non-ignored) files
 *   node scripts/privacy-scan.mjs --staged   # scan staged content (pre-commit)
 *
 * Optional local denylist: put real names/terms (one per line) in
 * `.privacy-denylist` (git-ignored). Any occurrence in a tracked file fails.
 * A line containing `privacy-scan:allow` is exempt from content checks.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_PATHS = [
  { re: /(^|\/)\.env(\..*)?$/i, why: "environment file" },
  { re: /\.(pem|key|p12|pfx|kdbx)$/i, why: "key or credential store" },
  { re: /\.(pdf|docx?|xlsx?|jpe?g|png|heic|tiff?|zip)$/i, why: "document/scan/binary (may contain signed or private material)" },
  { re: /^(estate|assets|trust|funding|audit)\/(?!README\.md$|\.gitkeep$)/, why: "real-data folder: only README.md may be committed" },
  { re: /^documents\/(drafts|attorney-reviewed|executed)\/(?!README\.md$|\.gitkeep$)/, why: "document folder: only README.md may be committed" },
  { re: /(^|\/)(vault|household|real-data)[^/]*\.(json|enc)$/i, why: "exported household/vault data" },
];

export const CONTENT_RULES = [
  { id: "ssn", re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/, why: "looks like a Social Security number" },
  { id: "ein", re: /\b\d{2}-\d{7}\b/, why: "looks like an EIN / tax ID" },
  { id: "account", re: /(?<![\w.])\d{9,17}(?![\w.])/, why: "long digit run (possible account/routing number)" },
  { id: "card", re: /\b(?:\d{4}[ -]){3}\d{4}\b/, why: "looks like a card number" },
  { id: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: "private key" },
  { id: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/, why: "AWS access key" },
  { id: "api-token", re: /\b(sk-(ant-)?[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,})\b/, why: "API token" },
  { id: "email", re: /\b[A-Za-z0-9._%+-]+@(?!example\.(com|org|net)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, why: "email address (use @example.com in samples)" },
  { id: "phone", re: /(?:\(\d{3}\)\s?|\b\d{3}[-.])\d{3}[-.]\d{4}\b/, allow: /555/, why: "phone number (use 555-01xx in samples)" },
  { id: "dob", re: /\b(DOB|date of birth|born on)\b\s*[:=]?\s*\d/i, why: "date of birth" },
  { id: "street", re: /\b\d{1,6}\s+(?!Example\b)[A-Z][a-z]+(\s[A-Z][a-z]+)?\s(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Court|Ct|Way)\b\.?/, why: "street address" },
];

/** Files whose content is not scanned (generated or vendored). */
const SKIP_CONTENT = [/^package-lock\.json$/, /^node_modules\//, /^dist\//];

const ALLOW_MARKER = "privacy-scan:allow";

export function checkPath(path) {
  return FORBIDDEN_PATHS.filter((p) => p.re.test(path)).map((p) => ({ path, line: 0, rule: "forbidden-path", why: p.why }));
}

export function scanText(path, text, denylist = []) {
  if (SKIP_CONTENT.some((re) => re.test(path))) return [];
  const findings = [];
  const lines = text.split(/\r?\n/);
  const deny = denylist.map((d) => d.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const r of CONTENT_RULES) {
      const m = line.match(r.re);
      if (m && !(r.allow && r.allow.test(m[0]))) findings.push({ path, line: i + 1, rule: r.id, why: r.why });
    }
    const lower = line.toLowerCase();
    for (const term of deny) {
      if (lower.includes(term.toLowerCase())) findings.push({ path, line: i + 1, rule: "denylist", why: "matches a term in .privacy-denylist" });
    }
  });
  return findings;
}

/** Sample data must declare itself fictional. */
export function checkSampleData(path, text) {
  if (!/^sample-data\/.+\.(ts|json)$/.test(path)) return [];
  return /isFictional"?\s*:\s*true/.test(text)
    ? []
    : [{ path, line: 0, rule: "sample-not-fictional", why: "sample data must set isFictional: true" }];
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function loadDenylist() {
  return existsSync(".privacy-denylist") ? readFileSync(".privacy-denylist", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")) : [];
}

export function scanRepo({ staged = false } = {}) {
  const files = (staged
    ? git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    : git(["ls-files", "--cached", "--others", "--exclude-standard"])) // tracked + new, not ignored
    .split("\n")
    .filter(Boolean);
  const denylist = loadDenylist();
  const findings = [];
  for (const path of files) {
    findings.push(...checkPath(path));
    let text;
    try {
      text = staged ? git(["show", `:${path}`]) : readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue; // binary; path rules already applied
    findings.push(...scanText(path, text, denylist), ...checkSampleData(path, text));
  }
  return { files: files.length, findings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { files, findings } = scanRepo({ staged: process.argv.includes("--staged") });
  if (findings.length) {
    console.error(`Privacy scan FAILED: ${findings.length} finding(s) in ${files} file(s):`);
    for (const f of findings) console.error(`  ${f.path}${f.line ? `:${f.line}` : ""}  [${f.rule}] ${f.why}`);
    console.error("\nRemove the data (and purge it from history if already committed). If a line is a deliberate, fictional example, add `privacy-scan:allow` to it.");
    process.exit(1);
  }
  console.log(`Privacy scan passed (${files} file(s) checked).`);
}
