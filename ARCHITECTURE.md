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
    changes.ts             Change pipeline: propose → review → apply, conflicts, provenance
    entities.ts            Uniform entity access; archive instead of delete
    schema.ts              Schema versioning, migrations, validation
    newHousehold.ts        New real household; grantors added through the change pipeline
    annualReview.ts        Annual review checklist, life events, completion
    funding.ts             Funding methods/states, dashboard badges, progress
    rules.ts               Rule engine + non-conclusory wording guard
    audit.ts               Append-only audit entries
  intake/                  One-question-at-a-time intake; mapping.ts turns answers into graph changes
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

### Funding engine

`fundingRow` gives each asset:

- a **treatment**: ownership transfer, beneficiary designation, intentionally outside the trust, or review needed;
- a **completion**: complete, incomplete, or not applicable. Assets deliberately left outside the trust are not applicable and are excluded from progress, so they never count as done or as missing;
- **blocking reasons**, for example an unverified deed recording, a designation that isn't on file or doesn't total 100%, an invalid method, mixed community/separate character, or missing instructions;
- a concrete **next action**;
- a **last reviewed** date, flagged as stale after a year.

An asset with open blockers never shows a check mark.

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

## Change pipeline

Every edit goes through `src/domain/changes.ts`, whether it comes from a form,
guided intake, the funding tracker, or an attorney's outcome. A form never
writes to the household directly.

1. **Propose.** `proposeChange` diffs the entity field by field, classifies
   sensitivity (for example, a fiduciary is `fiduciary`, a distribution or a
   designation is `dispositive`, trust structure is `legal_tax`, and title or
   homestead is `important_fact`), and validates the change: references
   exist, and `refLast4` holds at most 4 digits. Forms and intake cannot mark
   anything `confirmed`.
2. **Conflicts.** If a changed field was `confirmed`, the change is flagged
   rather than overwritten. The user either keeps the confirmed value
   (rejects the change) or explicitly replaces it with a read-back. Pending
   conflicts also raise a review flag.
3. **Review.** Factual changes with no conflicts are recorded immediately
   (`submitChange`). Everything else waits in `pendingChanges` and appears
   on the Review screen with provenance (source, intake question, actor,
   confidence, time), the field diff, conflicts, and problems.
4. **Apply.** `applyChange` requires the user; the assistant can neither
   propose sensitive changes nor apply anything. It re-validates against
   current data, enforces the gate (confirm, exact read-back, or
   professional review), upgrades the statuses of changed fields
   (`confirmed`, or `attorney_required` for legal/tax), links a Decision for
   sensitive changes, and writes an audit entry.
5. **Archive, never delete.** Archived entities move to `h.archived`.
   Archiving a person who is still referenced is blocked.

Each applied or rejected change records a `ChangeAuditDetail`: entity and ID,
operation, field-level old and new values, source, how it was confirmed, the
review requirement, the rules version, and the schema version.

Intake answers are structured (choices, people pickers, shares, per-asset
selects). `src/intake/mapping.ts` turns an answer into a batch of proposed
changes. It updates existing entities in place, such as fiduciary slots and
beneficiary shares, so conflicts are detected rather than duplicated. It never
fills in values the user didn't give.

## Annual review

`startAnnualReview` builds a dated checklist from the household as it is when
the review starts: each asset's title/funding or designation, each named
fiduciary, each signed document, open flags, and pending changes. It adds
fixed life-event questions. The review can only be completed when every item
is done or marked "needs attention" with a note, and every life event is
answered. Completion sets `lastAnnualReview` through the change pipeline, so
it is audited. Life events answered "yes" become attorney-required flags, and
needs-attention items become family follow-up flags. Review history is kept
in `h.annualReviews` (schema v3) and appears in the attorney packet.

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
