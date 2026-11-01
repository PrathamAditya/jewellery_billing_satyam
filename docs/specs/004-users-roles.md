# 004: Users, roles and permissions

Status: Approved (Wave 1, owner approved in advance 2026-11-01), not built
Depends on: 002 and every route written so far
Open questions used with defaults: Q67 (roles and what each may do), Q83 (outside access)

## 1. Goal
Owner, family and staff each log in with their own account. What a person can see and do depends on a role, the same on PC and phone. Every record already says who created or changed it, and the owner can see each person's activity. Supersedes decisions D5 and D6.

## 2. Rules
- R1. **Permissions** are fixed strings in `packages/shared/src/permissions.ts`, as `module.action`:
  `customers.view|create|edit|void`, `rates.view|edit`, `invoices.view|create|edit|void|print`, `payments.view|create|void|refund`, `advances.view|create|cancel`, `oldgold.view|create|void`, `ledger.view|opening`, `settings.view|manage`, `users.manage`, `backups.view|manage`, `reports.view`, `audit.view`. Later specs add their own.
- R2. **Roles** live in a table `roles(name, label, permissions_json, system)`; `users.role` holds the role name. Default roles (seeded by migration, editable by the owner except `owner`):
  - `owner`: all permissions, cannot be edited or removed (system role).
  - `manager`: everything except `users.manage`, `settings.manage`, `backups.manage`.
  - `staff`: `customers.view|create|edit`, `rates.view`, `invoices.view|create|print`, `payments.view|create`, `advances.view|create`, `oldgold.view|create`, `ledger.view`, `settings.view`. No edit, void, refund, reports or rate editing.
  - `viewer`: only the `.view` permissions plus `invoices.print` (no create, no edit).
  Until the owner answers Q67 these are the roles. The owner can create other roles from the Users screen by ticking permissions.
- R3. **Enforcement.** A middleware `requirePermission("module.action")` guards every route: no session is 401, a missing permission is 403 `{ error: "forbidden", message }`. All existing routes (customers, rates, invoices, calculator access, settings) get a permission. The session lookup loads the role's permissions once per request. A disabled user or a deleted-role user has none.
- R4. `GET /api/auth/me` returns `{ id, username, displayName, role, permissions }`. The web app keeps the permission list and hides buttons, links and tabs the user may not use (never as the only protection, R3 is).
- R5. **User management** (owner, `users.manage`): list users (username, name, role, status, last login), create a user (username unique, display name, role, a temporary password of at least 10 characters that must be changed at first login), change role, disable and enable, reset password (owner types a new temporary one, all that user's sessions end). Users are never deleted. The last active owner cannot be disabled or have their role changed.
- R6. `users` gets `display_name`, `last_login_at`, `must_change_password`. While `must_change_password` is set, every API call except `me`, `change-password` and `logout` returns 403 `password_change_required`, and the web app shows the change-password screen.
- R7. **Activity history.** `GET /api/users/:id/activity` lists the audit rows whose actor is that user (action, entity, time, never values), newest first, 50 per page. The Users screen shows it per person. Each record's "created by" and "last changed by" show the display name on invoice, payment and customer pages.
- R8. **Phone and create/edit.** Buttons depend on permissions, not on screen width. Screens that are PC-only layouts (invoice form, calculator, settings) show "Use a PC for this screen" on a phone until spec 040. Everything read-only works on a phone.
- R9. The owner can see which sessions are open for a user and end them ("Log out everywhere").
- R10. **Outside access (default for Q83):** no extra restriction beyond the login and rate limit. A setting `security.requireStrongPassword` is not added now.

## 3. Data
- New table `roles`. New columns on `users`: `display_name` (backfilled to the username), `last_login_at`, `must_change_password` (default 0). Migration seeds the four roles. The existing `owner` user keeps role `owner`.
- API: `GET/POST /api/users`, `PATCH /api/users/:id` (role, displayName, disabled), `POST /api/users/:id/reset-password`, `POST /api/users/:id/end-sessions`, `GET /api/users/:id/activity`, `GET/POST/PATCH /api/roles` (owner).
- `owner:set` keeps working (creates or resets the user named `owner`).

## 4. Screens
**Users** (top bar, `users.manage`): table of users with role and status, "New user" dialog, row actions (change role, disable, reset password, end sessions, activity). **Roles** tab: roles with a grid of permission tick boxes (owner row locked). **First login with a temporary password:** change-password screen. Top-bar account menu shows display name and role.

## 5. Edge cases
- A role is edited while its users are logged in: the next request uses the new permissions.
- A role that still has users cannot be deleted.
- Disabling a user ends their sessions at once (existing behaviour of the session lookup).
- Two owners are allowed. The "last owner" rule counts active owners.
- Username comparison is case-insensitive and trimmed (existing).

## 6. Test cases
- Permission matrix test: for every route and every default role, call it with each role's session and assert 200/201 or 403 exactly as the role table says (a table-driven test over a list of `[method, path, permission]` entries, so adding a route without an entry fails the test: assert that every registered `/api` route appears in the list).
- A user with no session gets 401 everywhere, a disabled user gets 401 even with a cookie.
- `me` returns the permissions of the role. Editing the role changes the next response.
- Create user: duplicate username 409, password under 10 characters 400, new user logs in only after `must_change_password` is cleared by changing it (all other calls return 403 `password_change_required` first).
- Reset password ends the user's sessions. Disable ends them. "End sessions" leaves other users alone.
- Last active owner: disabling, role change and deleting-role attempts are refused (409), with two owners the first can be disabled.
- Activity: a staff user creates a customer and an invoice, the activity list shows both actions, no field values, and 403 for a user without `users.manage`.
- Staff cannot edit or void an invoice (403), viewer cannot create one, manager cannot open settings changes.
- Created-by names: invoice page returns `createdByName` from the user's display name.
- Browser (`e2e/users.mjs`): owner creates a staff user with a temporary password, logs in as that user, is forced to change the password, sees no Edit or Void buttons and no Users or Settings links, and the owner then sees that user's activity. Phone context: read-only screens work, PC-only screens show the note.

## 7. Out of scope
Per-record permissions, approval workflows, two-factor login, login by phone or OTP, IP restrictions.

## 8. Defaults used
Q67: the four default roles above. Q83: no extra restriction for outside access.

## 9. Acceptance checklist
- [ ] R1 to R10 implemented and tested, including the "every route is in the permission table" test
- [ ] Migration applied locally and by CI
- [ ] Old tests updated to log in with a role that has the permission they need and still green
- [ ] Browser test passes, existing browser scripts still pass as owner
