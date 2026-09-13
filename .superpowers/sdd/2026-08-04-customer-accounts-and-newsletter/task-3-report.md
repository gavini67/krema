# Task 3 report — staff Turnstile, customer unlink, and handoff

## Status

Completed on `feature/customer-accounts`.

## Commit

- `9bf5255` — initial Task 3 delivery.
- `5f0b0c8` — review fixes for logout CAPTCHA, SQL unlink validation, mobile sizing, and synchronous Turnstile failures.

## Test-first record

The first staff contract test was added before the page changes and run alone:

```text
node --test --test-name-pattern='staff login has an explicit Turnstile widget' tests/staff-customer-accounts.test.js

fail 1
AssertionError: missing staff Turnstile container
```

After the initial green pass, the narrow-screen test was added before the responsive widget option:

```text
node --test --test-name-pattern='staff login uses local and production keys' tests/staff-customer-accounts.test.js

fail 1
Expected values to be strictly equal:
+ actual - expected
+ undefined
- 'compact'
```

After implementation, the focused suite was green:

```text
node --test tests/staff-customer-accounts.test.js

tests 6
pass 6
fail 0
```

Final verification used the complete Node suite:

```text
node --test tests/*.test.js

tests 28
pass 28
fail 0
```

## Delivered behavior

- Added the official explicit Turnstile script and one managed login-card widget in `staff.html`. It uses the supplied production Site Key outside `localhost` and `127.0.0.1`, and Cloudflare's visible always-pass local key only on those hosts.
- Fresh staff password login now requires a Turnstile token, passes it as `options: { captchaToken }`, and resets the widget after each Auth attempt. A restored staff session still goes directly through the existing `is_staff()` gate without rendering CAPTCHA.
- A missing, expired, or failed Turnstile widget produces clear inline feedback and cannot make an unprotected password-login call. The page contains no secret key. On very narrow screens the managed widget uses Turnstile's compact presentation.
- Added a deliberately secondary, mobile-safe customer-login unlink action to the loaded-card result view. Its native confirmation says it is for a wrong or lost email and does not change stamps or rewards. It calls authenticated `unlink_card(p_code)`, re-renders the returned standard card shape, and gives a clear success toast. Known server outcomes such as an unlinked card, missing card, or non-staff access are shown without technical wording.
- Kept the established staff storage key and `is_staff()` gate. Existing scan, lookup, stamp, reward, redemption, reporting, and CDN-pinned integrations remain in place.
- Updated `HANDOFF.md` with the prepared branch and migration, correct Turnstile secret handling, required activation order, the warning about enabling CAPTCHA before deployment, frozen password settings, and the remaining live verification work. The closed Brevo tracking issue remains closed.

## Files changed

- `staff.html`
- `HANDOFF.md`
- `tests/staff-customer-accounts.test.js`
- `.superpowers/sdd/2026-08-04-customer-accounts-and-newsletter/task-3-report.md`

## Concerns

- The live SQL migration, Supabase CAPTCHA setting, public email signup, and end-to-end throwaway-account checks remain intentionally incomplete and are listed in `HANDOFF.md` in their required activation order.
- Node tests execute the staff page's browser script in a controlled VM, including request contracts, storage isolation, Turnstile behavior, and unlink flows. A live browser/Supabase/Cloudflare integration run was not performed from this workspace.

## Review fixes

The review found that a restored staff session did not create Turnstile after logout; `unlink_card` could audit an already-unlinked card; the normal widget was selected at a 375px viewport even though its actual container was narrower than 300px; and a synchronous `turnstile.render()` exception left the rendered guard set without inline feedback.

Regression tests were written before the fixes. The focused staff test run produced the expected red result:

```text
node --test tests/staff-customer-accounts.test.js

tests 8
pass 5
fail 3
```

The failures were the 375px widget choice (`normal` instead of `compact`), the missing widget after restored-session logout, and missing inline feedback after a synchronous render error. The focused SQL contract also produced the expected red result:

```text
node --test --test-name-pattern='account RPCs scope cards' tests/customer-accounts-sql.test.js

tests 1
pass 0
fail 1
```

It failed because both `unlink_card` copies lacked `if v_user_id is null then raise exception 'card is not linked'; end if;` before mutation and audit.

The fixes render or reset Turnstile whenever staff logout reaches the login view; choose compact from the actual Turnstile container width below 300px; catch synchronous render failures without setting the rendered guard and retry when the next login attempt needs a widget; and add the clear unlink guard identically to `supabase-setup.sql` and `docs/migrations/2026-09-13-customer-accounts.sql`.

Final verification was:

```text
node --test tests/*.test.js

tests 30
pass 30
fail 0
```
