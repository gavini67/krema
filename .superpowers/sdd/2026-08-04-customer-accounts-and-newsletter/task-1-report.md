# Task 1 — customer-account SQL contract and migration report

## Status

Completed on branch `feature/customer-accounts`. The full source of truth and
the pasteable migration now add customer-to-Auth links, account card RPCs,
secured-card lookup hardening, audit events, and explicit function grants.

## Commit

`HEAD` on `feature/customer-accounts` (the final task commit). The commit hash
is reported in the task handoff response because a Git commit cannot contain
its own final object hash.

## Tests

Test file: `tests/customer-accounts-sql.test.js`

Red run, before production SQL changes:

```text
$ node --test tests/customer-accounts-sql.test.js
ℹ tests 5
ℹ pass 0
ℹ fail 5
```

The failures correctly identified the missing `customers.user_id` contract,
the absent account RPCs, the missing secured-card protections, the missing
grant surface, and the missing migration.

Green run after implementation:

```text
$ node --test tests/customer-accounts-sql.test.js
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

`git diff --check` also completed without whitespace errors.

## Files changed

- `supabase-setup.sql`
  - Adds nullable `customers.user_id` with `auth.users(id) on delete set null`
    and a non-unique index.
  - Adds `claim_card`, `get_my_card`, `unlink_card`, and the two-argument
    `customer_lookup` overload.
  - Hardens the existing lookup and signup RPCs for secured cards.
  - Makes anonymous and authenticated function grants explicit.
- `docs/migrations/2026-09-13-customer-accounts.sql`
  - Provides the matching additive, transaction-wrapped migration for the
    current live Phase 1 schema.
- `tests/customer-accounts-sql.test.js`
  - Covers the SQL contract for schema safety, locking, identity scope,
    idempotency, audit writes, lookup privacy, standard result shapes, and
    grants.
- `.superpowers/sdd/2026-08-04-customer-accounts-and-newsletter/task-1-report.md`
  - This report.

## Review notes

- `claim_card` normalizes the supplied phone, locks the matching customer row,
  returns a generic mismatch error, treats an existing link to the same Auth
  user as success, and records only new claims.
- `unlink_card` starts with the established `is_staff()` authorization check,
  locks the row, retains the prior user id in `card_claim_events`, and clears
  the card link.
- Both `customer_lookup` signatures return no rows for secured cards. Signup
  preserves its existing name-match guard and tells a matching secured customer
  to sign in.
- `card_claim_events` remains RLS-enabled and has no public policy. No
  `customers.email` column or unique constraint on `customers.user_id` was
  introduced.

## Concerns

The workspace does not include the `psql` client, so this task could not run a
local PostgreSQL parse or execute the migration against a Supabase database.
The Node contract tests and final SQL/permission diff review passed; applying
the migration to the live database remains an owner deployment step.

## Fix round 1 — concurrent secured-card reads

### Status

Completed. `signup_customer` and both `customer_lookup` overloads now lock an
eligible existing customer row with `FOR SHARE` before returning its card.
`claim_card` updates `customers.user_id`; that update conflicts with the share
lock, so it cannot secure the card between the eligibility check and the
returned card shape.

The same locks are present in both `supabase-setup.sql` and
`docs/migrations/2026-09-13-customer-accounts.sql`.

### Covering tests

- `tests/customer-accounts-sql.test.js`
  - Requires the one-argument and named lookup functions to lock their
    `user_id is null` result with `FOR SHARE`.
  - Requires `signup_customer` to lock the existing row before reading its
    `user_id`.
  - Applies these assertions to both the source-of-truth SQL and migration,
    and checks the relevant anonymous/authenticated grants in both artifacts.

Red run after amending the tests and before production SQL changes:

```text
$ node --test tests/customer-accounts-sql.test.js
ℹ tests 5
ℹ pass 4
ℹ fail 1
✖ secured-card readers lock the eligible row through their return in setup and migration SQL
  AssertionError [ERR_ASSERTION]: setup one-argument lookup must lock its unsecured result
```

Green run after adding the locks:

```text
$ node --test tests/customer-accounts-sql.test.js
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

### Concerns

The no-local-Postgres limitation remains. The Node tests verify the required
locking contract and source/migration parity, but live execution still needs a
Supabase SQL Editor deployment check.
