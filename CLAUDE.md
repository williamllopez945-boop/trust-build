# Instructions for AI coding agents

This is FamilyVault, a privacy-first trust planning app. Read README.md,
ARCHITECTURE.md, and PRIVACY.md before changing anything.

## Hard rules

- **Never commit real family data.** Use only fictional sample data
  ("Example", "Sample", "Placeholder" names, `@example.com`, `555-01xx`).
  Never copy data from a user's vault, packet, or conversation into the repo.
- Never weaken the privacy scan, `.gitignore`, the pre-commit hook, or the
  conclusory-language guard to make a check pass.
- Rules produce **review flags, never legal conclusions**. Phrase them as items
  to review or questions for the attorney or CPA. Cite references only as "to
  verify".
- Never model beneficiary-controlled assets (IRA, 401(k), TSP, life insurance,
  annuities) as retitled into the trust.
- Keep the decision guards in `src/domain/decisions.ts`. The assistant never
  chooses beneficiaries, trustees, guardians, or agents, never answers
  legal/tax questions, and never confirms or finalizes anything.
- Do not add network calls, analytics, or third-party scripts.

## Workflow

```sh
npm install
npm run check        # privacy scan + typecheck + tests; must pass before pushing
npm run dev
```

- Put domain logic in `src/domain` / `rules`, not in React components.
- Add tests for every new rule, decision path, or scanner pattern.
- New jurisdictions go under `rules/jurisdictions/<state>/` and must be
  registered in `rules/index.ts`.
