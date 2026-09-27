# FamilyVault: Lopez Family Trust workspace

A **local-first, privacy-first** workspace for organizing a family trust and
estate plan. It keeps a structured estate graph, runs conservative Texas
review rules, tracks trust funding, and produces an organized packet for your
attorney.

> **Not legal or tax advice.** FamilyVault organizes information and raises
> questions. It never drafts, finalizes, or signs legal documents and never
> reaches legal conclusions. A licensed Texas estate-planning attorney (and a
> CPA for tax questions) must review and prepare the actual plan.

> [!WARNING]
> **DEMO DATA ONLY — DO NOT ENTER REAL PERSONAL OR ESTATE INFORMATION IN A PUBLIC BUILD.**
> This repository is currently **public**. It contains code, rules, templates,
> and *fictional* sample data only. Real family information must never be
> committed, and real planning should happen only in a local copy of a
> **private** repository. See [PRIVACY.md](PRIVACY.md).

## Quick start

Requires Node.js 22+.

```sh
npm install
npm run setup-hooks   # enable the pre-commit privacy scan (once per clone)
npm run dev           # http://127.0.0.1:5173 (local only)
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (decision confirmation, rule flags, privacy scan, funding, packet, intake, vault) |
| `npm run typecheck` | TypeScript check |
| `npm run privacy-scan` | Scan all tracked files for PII, secrets, and forbidden files |
| `npm run check` | Privacy scan + typecheck + tests (run before every push) |
| `npm run packet` | Print the attorney packet for the fictional demo household |
| `npm run build` | Production build into `dist/` |

## What's in the app

| View | Purpose |
| --- | --- |
| Dashboard | Funding progress, flag counts, unresolved decisions |
| Estate map | Typed graph of people, the trust, assets, and their relationships |
| People & fiduciaries | Add, edit, or archive people, relationships, trustees, guardians, and agents, plus household and plan details |
| Assets | Add, edit, or archive assets, split into **ownership-controlled** and **beneficiary-controlled** |
| Beneficiaries | Trust beneficiaries and shares; retirement and insurance designations with related flags |
| Decision intake | One structured question at a time; answers become *proposed* changes |
| Review changes | Every proposed change with its source, field diff, conflicts, and the confirmation it needs |
| Review flags | Texas and general rules, as items for an attorney or CPA to review |
| Funding tracker | Status of each asset: funded, review, outside, designation, missing |
| Attorney packet | Markdown export; print to PDF |
| Audit log | Append-only record of decisions and changes |

The app opens on a **fictional demo household** ("The Example Family").

## Entering real data

1. Run the app locally (`npm run dev`). Nothing is sent to a server.
2. Enter information and **Save** with a passphrase of 12+ characters. Data is
   encrypted with AES-GCM in this browser's storage.
3. Use **Unlock** with the same passphrase to reload it. The passphrase is not
   stored. If you lose it, the data cannot be recovered.
4. Export the attorney packet only when you need it, and keep exports out of
   this repository (`attorney-packet-*.md` is git-ignored).

To stop real names from being committed by accident, list them (one per line)
in a local `.privacy-denylist` file. It is git-ignored, and the privacy scan
fails if any listed term appears in a tracked file.

## Attorney-review workflow

1. **Intake.** Answer questions one at a time. Factual answers are recorded.
   Important facts need a confirmation. Beneficiary and fiduciary choices
   need an explicit read-back confirmation. Legal and tax questions go to the
   attorney/CPA list and are never answered by the app.
2. **Review flags.** Resolve the family-side flags (missing designations,
   alternates, instructions). Leave the attorney-required ones for the meeting.
3. **Packet.** Export the packet and send it to the attorney before the meeting.
4. **Meeting.** Record the attorney's or CPA's outcome on each legal/tax
   decision. Only a professional review settles those.
5. **Execution.** The attorney drafts and supervises signing. Record each
   document's stage and where the original is kept, never the document itself.
6. **Funding.** Work through the funding tracker: deeds, retitling, and
   assignments for ownership-controlled assets, and designation reviews for
   beneficiary-controlled ones.
7. **Annual review.** Revisit assets, designations, fiduciaries, and life events.

## Limitations

- Rules are review prompts, not legal analysis. They cover common Texas
  planning issues, not every situation, and statutes change. The references on
  each flag are for the attorney to verify.
- Browser storage can be cleared by the browser or the user. Keep an encrypted
  backup of your vault.
- There is no multi-user sync, no document drafting, and no e-signing, by design.

## Repository protections

CI (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`:
privacy scan → typecheck → tests → build → `npm audit`. The privacy scan
runs **before** dependencies are installed and fails the build on likely PII,
secrets, or forbidden files. Dependabot opens weekly dependency updates.

The pre-commit hook is defense in depth; CI is the gate. Recommended GitHub
settings for `main` (Settings → Branches → Add branch ruleset):

- Require a pull request before merging, with at least 1 approval
- Require the **CI / check** status to pass, with branches up to date
- Block force pushes and deletions
- Enable secret scanning and push protection (Settings → Code security)
- Make the repository **private** before any real planning starts

Branch rules and secret scanning on private repositories may require a paid
GitHub plan; the CI privacy scan works either way.

## Rules and attorney verification

Every rule carries metadata: references, an effective date, a last-reviewed
date, and `attorneyVerified`. **All rules are currently unverified drafts.**
Each flag shows its rule's verification state, and the packet lists it. A rule
becomes verified only after a licensed Texas attorney reviews its trigger and
wording, recorded in `verifiedBy`.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): data model, rule engine, modules
- [PRIVACY.md](PRIVACY.md): the privacy boundary and what never goes in Git
- [SECURITY.md](SECURITY.md): threat model, encryption, reporting
- [ROADMAP.md](ROADMAP.md): what's next
- [CLAUDE.md](CLAUDE.md): instructions for AI coding agents
