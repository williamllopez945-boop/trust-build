# Roadmap

## MVP (this release)
- [x] Estate graph, statuses, asset control model
- [x] Decision gates with read-back confirmation and professional review
- [x] Texas review-rule modules and jurisdiction registry
- [x] Funding tracker, attorney packet, audit log
- [x] Encrypted local vault
- [x] Privacy scan, pre-commit hook, tests

## Phase 2 (done)
- [x] CI (privacy scan, typecheck, tests, build, audit) and Dependabot
- [x] Rule metadata: references, dates, attorney-verification state
- [x] Schema versioning with migrations and validation
- [x] Change pipeline: create/edit/archive forms for people, relationships, fiduciaries, assets, designations, distributions, household, plan
- [x] Intake answers mapped to proposed graph changes, with a review screen, provenance, and conflict detection
- [x] Field-level audit detail (old/new, source, confirmation, review requirement, versions)

## Next
- [x] "Start a new household" flow for entering real data from scratch
- [x] Encrypted backup export/import (`.fvault`) with validation and safe failure
- [x] Funding engine: treatment, blockers, next action, not-applicable vs incomplete, last reviewed
- [x] Attorney packet: confirmed facts, conflicts, designation issues, funding gaps, field-level history, rule sources, "software did not determine this" wording
- [x] Annual review workflow: dated checklist, life events, completion rules, history (schema v3)
- [x] Legal documents screen: stage, signing date, and storage location for each document, a household-specific checklist, and privacy checks on what is typed
- [ ] Incapacity-planning view (agents, directives, definition of incapacity)
- [ ] PDF export with page breaks and table of contents
- [ ] Attorney review of every Texas rule (set `attorneyVerified` + `verifiedBy`)

## Later
- [ ] Additional jurisdictions under `rules/jurisdictions/`
- [ ] Optional AI-assisted intake using the same domain guards (no chain-of-thought retention)
- [ ] Desktop packaging for fully offline use
- [ ] Attorney/CPA read-only share of a packet
