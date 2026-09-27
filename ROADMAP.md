# Roadmap

## MVP (this release)
- [x] Estate graph, statuses, asset control model
- [x] Decision gates with read-back confirmation and professional review
- [x] Texas review-rule modules and jurisdiction registry
- [x] Funding tracker, attorney packet, audit log
- [x] Encrypted local vault
- [x] Privacy scan, pre-commit hook, tests

## Next
- [ ] Editing forms for people, assets, fiduciaries, and distributions (today only funding status and decisions are editable in the UI)
- [ ] Map confirmed intake decisions into structured graph fields
- [ ] "Start a new household" flow for entering real data from scratch
- [ ] Encrypted vault export/import file for backups
- [ ] Annual review workflow with dated checklist and `lastAnnualReview`
- [ ] Incapacity-planning view (agents, directives, definition of incapacity)
- [ ] PDF export with page breaks and table of contents
- [ ] CI workflow running `npm run check`

## Later
- [ ] Additional jurisdictions under `rules/jurisdictions/`
- [ ] Optional AI-assisted intake using the same domain guards (no chain-of-thought retention)
- [ ] Desktop packaging for fully offline use
- [ ] Attorney/CPA read-only share of a packet
