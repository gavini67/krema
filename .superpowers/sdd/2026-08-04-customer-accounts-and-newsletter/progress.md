# SDD ledger — plan: docs/superpowers/plans/2026-08-04-customer-accounts-and-newsletter.md

## Preflight interaction scan

| Tasks | Producer / consumer | Finding |
|---|---|---|
| Phase 0 / Phase 2+3 | Supabase CAPTCHA setting / staff and customer Auth calls | Conflict: enabling CAPTCHA before the pages submit a token would break the existing staff login. |
| Phase 0 / Phase 3 | Auth email template / OTP verification form | Conflict: the plan says a 6-digit OTP, while the live project has issued an 8-character token and the saved templates correctly say “YOUR CODE”. |
| Phase 1 / Phase 3 SQL | Existing anonymous card retrieval / secured-account ownership | Gap: leaving the one-argument phone lookup and `signup_customer` behavior unchanged would still expose a secured card by phone/name. |
| Phase 3 SQL / Phase 3 page | `claim_card`, `get_my_card`, `unlink_card`, lookup overload / new account screens | Interfaces agree on the existing eight-column `krema_card` result. |
| Phase 3 page / staff page | Global CAPTCHA protection / separate Supabase clients | Gap: the plan adds customer CAPTCHA but does not add CAPTCHA to staff password login. |
| Phase 3 / Phase 4 | Auth accounts / newsletter consent | Independent data sets; no shared email column. No conflict. |
| Phase 1 | SQL and listed verification | Already completed and verified live per HANDOFF.md. |
| Phase 2 | Page changes and listed verification | Already completed and shipped per HANDOFF.md. |
| Phase 3 | SQL/page requirements and verification | Internally consistent after the rulings below. |
| Phase 4 | SQL/page/privacy requirements and verification | Deferred until customer accounts are complete. |

## Rulings

- Ruling: deploy CAPTCHA-capable staff and customer pages before enabling CAPTCHA in Supabase — prevents staff lockout — if wrong, protection remains off briefly until the deployment is verified.
- Ruling: keep the customer PIN exactly six digits, but accept the Supabase email verification token as a variable 6–8 digit code — matches observed live behavior and the saved generic email copy — if wrong, the verify form may need its maximum length adjusted.
- Ruling: preserve the one-argument `customer_lookup` signature for stale pages but change its body to return no secured cards; also prevent `signup_customer` from returning a secured existing card — closes anonymous bypasses while retaining compatibility — if wrong, an old tab will show the signup view and ask the customer to sign in.
- Ruling: add Turnstile to staff password login as well as customer signup, sign-in, and recovery — Supabase CAPTCHA applies to these Auth endpoints — if wrong, staff sees one extra lightweight managed challenge.
- Ruling: use the repository’s existing `docs/migrations/` convention because this static repo has no Supabase CLI project configuration — if wrong, the SQL remains reviewable and pasteable but is not in Supabase CLI migration history.

## Tasks

- Task 1: customer-account SQL contract and migration — complete
- Task 2: customer email + PIN UI, recovery, and Turnstile — complete
- Task 3: staff Turnstile integration and handoff/runbook update — complete
- Task 4: whole-feature verification and review — complete

Task 1: fix round 1/5 (2 Important findings addressed, 0 Important open; commits beca3fd..b47e1bf)
Task 1: minor (deferred): no behavioral concurrent-transaction test because this repo has no local PostgreSQL client; source/migration locking parity is contract-tested and the live SQL verification remains required.
Task 1: complete (commits 8e3b70e..b47e1bf, review clean for Critical/Important)
Task 2: fix round 1/5 (6 original Important findings addressed, 1 new Important finding open; commits 6263255..507036d)
Task 2: fix round 2/5 (1 Important finding addressed, 0 open; commits 507036d..612f740)
Task 2: minor (deferred): successful recovery renders the linked card immediately instead of a separate success screen.
Task 2: minor (deferred): account sections use click handlers rather than native form submit, so Enter-key submission is not implemented.
Task 2: minor (deferred): normal Turnstile width may overflow at 320px; final review must decide whether compact widget mode is required.
Task 2: complete (commits b47e1bf..612f740, review clean for Critical/Important)
Task 3: fix round 1/5 (staff logout CAPTCHA, unlink accuracy, mobile widget sizing, render failure addressed; commits 9bf5255..79fbe80)
Task 3: complete (commits 612f740..79fbe80, scoped re-review clean for Critical/Important)
Task 4: final review found 1 High, 3 Medium and 4 Low issues; all eight addressed in 63e0d2c.
Task 4: security ruling — anonymous phone/name recovery is retired; both lookup signatures are zero-row compatibility shims and duplicate signup returns no card data.
Task 4: complete (50 tests pass; final scoped re-review reports no remaining Critical/High/Medium/Important defects; live activation remains pending).
