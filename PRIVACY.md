# Privacy boundary

## Allowed in Git

- Source code, rules, schemas, tests, and templates
- **Fictional** sample data (every sample household sets `isFictional: true`)
- Documentation

## Never allowed in Git

- Real names of family members, beneficiaries, trustees, guardians, or agents
- Dates of birth, Social Security numbers, EINs, driver's license or passport numbers
- Addresses, phone numbers, personal email addresses
- Account, routing, policy, or card numbers (the app stores last-4 digits at most)
- Deeds, wills, trust agreements, powers of attorney, whether draft or signed
- Financial statements, tax returns, scans, or photos of documents
- API keys, tokens, passwords, private keys, `.env` files
- Vault exports and attorney packets for real households

## How this is enforced

| Layer | What it does |
| --- | --- |
| `.gitignore` | Ignores real-data folders, documents, images, exports, env/key files |
| `scripts/privacy-scan.mjs` | Detects SSN/EIN/account/card patterns, keys and tokens, emails, phones, DOBs, street addresses, and forbidden paths |
| `.githooks/pre-commit` | Runs the scan on staged content (`npm run setup-hooks`) |
| `.privacy-denylist` (local, ignored) | Your real family names; any match in a tracked file fails the scan |
| Test suite | `privacy-scan.test.ts` runs the scan against the whole repository |

Samples use `@example.com` emails, `555-01xx` phone numbers, and
"Example"/"Sample"/"Placeholder" names.

## Data minimization

- Intake keeps structured decisions, not raw transcripts or model reasoning.
  The text box is cleared once an answer is stored.
- The audit log stores short summaries of each action.
- Documents are tracked by stage and *storage reference* (where the original is
  kept), not by uploading them.

## If something sensitive was committed

Deleting the file in a new commit does **not** remove it from history.

1. Stop and don't push, if it hasn't been pushed yet.
2. Rotate any exposed credential immediately.
3. Rewrite the history to remove it (for example with `git filter-repo`) and
   force-push, or ask GitHub support to purge cached views.
4. For a public repository, assume the data has already been copied.
