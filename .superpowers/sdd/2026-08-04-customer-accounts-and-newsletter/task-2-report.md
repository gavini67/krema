# Task 2 report — customer accounts

## Status

Completed on `feature/customer-accounts`.

## Commit

`feature/customer-accounts` `HEAD` (this task commit).

## Test-first record

The first new UI test was added before production changes and run alone:

```text
node --test --test-name-pattern='customer account forms' tests/customer-accounts-ui.test.js

fail 1
AssertionError: missing view-signin
```

That was the expected red result for the absent account experience. After implementation, the complete suite was run with `node --test`:

```text
tests 13
pass 13
fail 0
```

The UI tests execute the page’s inline browser script in a Node `vm` with browser globals, so the syntax check does not attempt to parse the HTML document itself as JavaScript.

## Delivered behavior

- Added explicit Turnstile rendering for the three Auth endpoints that require CAPTCHA. The local visible test key is selected only for `localhost` and `127.0.0.1`; production uses the supplied site key.
- Added sign-in, card securing, signup-email verification, forgot-PIN, and PIN-reset views. PIN, email, confirmation, CAPTCHA, and 6–8 digit verification-code validation happen before the corresponding network call.
- Added customer-only Auth sign-out, signed-in email display, and the anonymous-card secure action. No PIN or verification token is stored in browser storage.
- Added two-field existing-card lookup using `customer_lookup(p_phone, p_name)`, with a non-enumerating no-match path for secured cards.
- Preserved the existing 20-stamp rendering, QR display, anonymous `get_card` polling, external CDN pins, mobile/desktop shell, and visual tokens.
- Initial resolution now keeps the page hidden until it evaluates URL code, saved member code, then signed-in `get_my_card()`, before falling back to ordinary signup.

## Files changed

- `rewards.html`
- `tests/customer-accounts-ui.test.js`
- `.superpowers/sdd/2026-08-04-customer-accounts-and-newsletter/task-2-report.md`

## Concerns

- Email verification resend intentionally provides a clear restart path instead of a resend control, because a new CAPTCHA token cannot be safely acquired from the verification view without rendering another required widget.
- Browser-level integration against the live Supabase project and Cloudflare Turnstile was not run from this workspace; the Node suite verifies the browser-side request contracts and local/production key selection.
