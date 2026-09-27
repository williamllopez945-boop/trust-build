# Architecture

FamilyVault is a local-first React + TypeScript app. All logic is plain,
framework-free TypeScript under `src/` and `rules/`, so it can be tested
without a browser and reused later (for example in a CLI or desktop shell).

```
app/                       Vite entry (index.html, main.tsx)
src/
  domain/
    types.ts               Household aggregate, statuses, assets, fiduciaries, plan
    estateGraph.ts         Typed node/edge graph + queries
    decisions.ts           Sensitivity gates, read-back confirmation, professional review
    funding.ts             Funding methods/states, dashboard badges, progress
    rules.ts               Rule engine + non-conclusory wording guard
    audit.ts               Append-only audit entries
  intake/                  One-question-at-a-time intake + guardrails
  packet/                  Attorney review packet (Markdown)
  storage/vault.ts         AES-GCM + PBKDF2 encrypted local storage
  ui/                      React views
rules/
  index.ts                 Jurisdiction registry
  jurisdictions/common/    Checks that apply in every state
  jurisdictions/texas/     Texas review modules
sample-data/               Fictional demo household only
schemas/                   JSON Schema for the exchange format
scripts/                   Privacy scan, packet generator
tests/                     Vitest suites
estate/ assets/ trust/ funding/ audit/ documents/   Git-ignored real-data folders
```

## Data model

The **Household** is the root aggregate. People, the trust, and assets are
nodes. Relationships, fiduciary appointments, ownership, funding,
beneficiary designations, and trust distributions are typed edges
(`buildEstateGraph`). This replaces a flat intake form: every rule and view
queries the same graph.

Every uncertain field is `Tracked<T>`: `{ value, status }`, where the status is
one of `known | confirmed | unknown | needs_review | attorney_required`.

### Asset treatment

`controlFor(category)` splits assets into:

- **ownership-controlled** (real estate, bank, brokerage, business interests,
  vehicles, personal property, digital): funded by deed, retitling, or
  assignment, or deliberately left outside;
- **beneficiary-controlled** (IRA, 401(k), TSP, life insurance, annuities,
  HSA): coordinated by beneficiary designation.

`allowedMethods` never offers "retitle" for beneficiary-controlled assets.
If data says otherwise, the funding tracker shows a review badge and the
`tx.ret.not_retitled` rule raises an attorney-required flag.

## Decisions

| Sensitivity | Gate | Result |
| --- | --- | --- |
| factual | record | `recorded` → status `known` |
| important_fact | confirm | `proposed` → `confirmed` |
| dispositive | explicit read-back | `proposed` → `confirmed` only with the exact read-back |
| fiduciary | explicit read-back | same as dispositive |
| legal_tax | professional review | `awaiting_professional_review` → `professionally_reviewed` (attorney/CPA note required) |

The guardrails live in `decisions.ts`, not only in the UI:

- The assistant can never supply dispositive, fiduciary, or legal/tax answers.
- Only the user can confirm.
- Blank answers are rejected, so the app never invents one.
- Superseded decisions are kept.

## Rule engine

A `Rule` returns zero or more flags. `runRules` stamps each flag with its
jurisdiction and module, **rejects conclusory wording** (for example "is valid",
"complies with", "guarantees"), and sorts the flags by severity. Adding a state
means:

1. Create `rules/jurisdictions/<state>/` with modules exporting `Rule[]`.
2. Export a `JurisdictionRuleSet` from its `index.ts`.
3. Register it in `rules/index.ts`.
4. Add tests alongside `tests/rules.test.ts`.

Texas modules: trust-creation, homestead, community-property, real-property
(deed review), pour-over-will, powers-of-attorney, execution, and retirement
(beneficiary-designation coordination).

## Privacy and storage

- Real data lives only in the browser's local storage, encrypted with AES-GCM
  under a key derived by PBKDF2-SHA-256 (310,000 iterations).
- The intake discards the raw text box once an answer is stored as a structured
  decision.
- The audit log stores short summaries only.
- `scripts/privacy-scan.mjs` runs in the pre-commit hook and in the test suite.
