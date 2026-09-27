# Security

## Threat model (MVP)

| Threat | Mitigation |
| --- | --- |
| Accidental commit of family data | `.gitignore`, pre-commit privacy scan, local denylist, CI-style test |
| Someone reads the browser storage | AES-GCM-256 encryption; key derived with PBKDF2-SHA-256 (310k iterations); passphrase never stored |
| Network exfiltration | No backend. The dev server binds to 127.0.0.1. The app makes no network calls. |
| Tampering with history | Append-only audit log in the app; Git history for code |
| Stolen or tampered backup file | `.fvault` backups are AES-GCM encrypted (authenticated) with only format metadata in plaintext; import rejects wrong passphrases, modified files, hostile KDF parameters, oversized files, and invalid data, all-or-nothing |
| AI overreach | Domain-level guards: the assistant cannot answer dispositive, fiduciary, or legal/tax decisions or confirm anything |

## Not yet addressed

- Protection against malware or someone with access to the unlocked device
- Brute force of weak passphrases (use a long passphrase)
- Signed or verified builds
- Recovery if both the passphrase and every backup are lost (by design, there is none)

## Guidance

- Use a unique passphrase of 4+ random words.
- Keep the repository **private** once you start real planning, even though
  real data should never be in it.
- Do not add analytics, remote fonts, or third-party scripts to the app.
- Do not add a backend or sync service without a documented security review.

## Reporting

Open a private security advisory on the GitHub repository. Do not include
real family data in the report.
