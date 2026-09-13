# Final-review fixes

Branch: `feature/customer-accounts`. All eight findings addressed locally; no push or production activation.

- **Takeover:** both lookup overloads always return zero rows. Signup returns only a newly inserted card; the unique phone constraint rejects duplicate/concurrent signup with the same generic sign-in/staff message, without reading existing identity or link state. Customer phone/name recovery UI is removed. Plan, HANDOFF, SQL comments, and historical-document supersession notes reflect saved QR/member-code access or staff assistance in person.
- **Logout:** resolved Auth errors retain the account/card and show retryable inline feedback.
- **Recovery:** verified state survives failed PIN updates, so retry calls `updateUser` directly. Restart, cancellation, success, and logout clear it; late verification cannot revive a cancelled flow.
- **Polling:** a view epoch invalidates late card/session-reconciliation responses after transitions.
- **Turnstile:** customer rendering is guarded and retryable, with compact sizing below 300px container width.
- **Linked cards:** URL/saved display precedence remains; `get_my_card` establishes ownership before claim prompts. Failed reconciliation stays unknown and retries.
- **Enter:** semantic forms use one submit handler per account action with busy guards and explicit non-submit navigation buttons.

## Verification

Regression tests failed before their fixes: two security tests, 16 UI cases, then the in-flight recovery cancellation case. The database behavior check also fails against the original HEAD because lookup returns an existing card.

- `node --test tests/*.test.js` — **50 passed, 0 failed/skipped**.
- `NODE_PATH=/tmp/krema-final-check/node_modules node tests/verify-customer-accounts-db.cjs` — **passed** for full setup and migration applied twice: lookup privacy, duplicate signup, card mechanics, anonymous code access, authenticated claims, idempotency/audit, ownership, staff-only lookup.
- `NODE_PATH=/tmp/krema-final-check/node_modules node tests/verify-customer-accounts-browser.cjs` — **passed** in Chrome at 320px: Enter on sign-in, secure, verify, forgot/reset; compact widget fit; no page errors. Supabase and Turnstile boundaries were mocked.
- `git diff --check` — **passed**.

Test-only PGlite 0.3.14 and Playwright 1.55.0 were installed outside the repository; reproduction commands are in the verification scripts. No site dependencies changed.

Preserved: exact production/local CAPTCHA keys, pinned CDNs, separate auth storage, anonymous `get_card`, authenticated code+phone claims, staff authorization, and 20-slot mechanics. Staff/QR/stamp/reward/reporting implementation is unchanged. Live email, Supabase migration deployment, CAPTCHA configuration, and physical QR scanning remain activation checks; no secrets were added.
