# 002: Owner login

Status: Draft (needs owner approval)
Depends on: 000, 001
Open questions: closes O7 (login method)

## 1. Goal
Only the owner can use the app. Every API route except the health check requires a login, and every later record knows who made it. The same login works on the PC and on Android.

## 2. Decision: how to log in (closes O7)

| Option | For | Against |
|--------|-----|---------|
| **A. Own login: username + password, session cookie (recommended)** | Same on PC and Android. Works with the installed PWA and offline shell. No extra service. Adds nothing to learn for staff later. | We own the password code, so it needs care (spec below). |
| B. Cloudflare Access in front of the whole site | No password code. Email one-time code login. | Redirects to a Cloudflare login page, which breaks an installed PWA and offline use. Adds another service to configure. |

This spec builds option A. Two-factor login is not in this spec.

## 3. Rules

**Passwords**
- R1. Passwords are hashed with PBKDF2-SHA256 (WebCrypto), 100,000 iterations, a random 16-byte salt per password. The stored value is self-describing: `pbkdf2$sha256$100000$<salt>$<hash>`, so the settings can be raised later. Comparison is constant-time.
- R2. Minimum password length is 10 characters. No other composition rules.
- R3. The initial owner password is set with `npm run owner:set -- --local` or `-- --remote`. The script asks for the password with hidden input, hashes it, and writes only the hash to the database. The password is never in git, in chat, or in a command line.

**Sessions**
- R4. A successful login creates a session: a random 256-bit token goes in the cookie, and only its SHA-256 hash is stored in the database.
- R5. The cookie is named `__Host-session` and is `HttpOnly; Secure; SameSite=Lax; Path=/`.
- R6. A session lasts 30 days from last use. Using it more than 1 day after the last refresh extends it. Expired sessions are rejected and removed.
- R7. Logout deletes the session and clears the cookie. "Log out all other devices" is available after changing the password (R13).

**Access control**
- R8. Every `/api/*` route requires a valid session, except `GET /api/health` and `POST /api/auth/login`. Unauthenticated requests get 401 with `{ "error": "unauthorized" }`, including requests to unknown `/api/*` paths. Authenticated requests to unknown paths still get the JSON 404.
- R9. Authenticated requests carry the user id, which replaces the fixed actor `owner` from spec 001 R8 in `created_by` and `updated_by`.
- R10. Requests that change data (POST, PUT, PATCH, DELETE) must have an `Origin` header matching the site's own host, otherwise 403. This blocks cross-site request forgery.

**Login protection**
- R11. Wrong username and wrong password give the same 401 message (`Invalid username or password`). A disabled user cannot log in.
- R12. Failed logins are counted. After 5 failures from one IP in 15 minutes, further logins from that IP get 429, even with the right password. After 30 failures from all IPs together in 15 minutes, all logins get 429 until the window passes.

**Password change**
- R13. `POST /api/auth/change-password` takes the current and new password. A wrong current password gives 403, a short new password gives 400. On success, all other sessions of that user are deleted and the current one stays.

**Audit**
- R14. Login success, login failure, logout and password change each write an `audit_log` row (spec 001 R11). The raw password and token are never logged.

## 4. Data
New tables (migrations follow spec 001 conventions):
- `users`: standard columns, `username` (unique), `password_hash`, `role` (`owner` for now), `disabled_at`. No-delete trigger (R9 of spec 001).
- `sessions`: `token_hash` (primary key), `user_id`, `created_at`, `last_seen_at`, `expires_at`, `user_agent`.
- `login_attempts`: `id`, `at`, `ip`, `username`. Old rows (over 1 day) are cleaned up on login.
- Seed: none in git. The owner row is created by the script in R3 (username `owner`).

## 5. Screens
- **Login page:** username, password, a clear error message, and a "too many attempts, try later" message for 429.
- **After login:** the existing shell with the user name and a Log out button. Any 401 from the API sends the user back to the login page.
- **Change password** (inside a small account menu): current, new, confirm.
- Works on PC and Android widths. Nothing prints.

## 6. Edge cases
- Cookie lost or cleared: back to the login page, no crash.
- Two devices logged in at once: both work, until a password change ends the other one.
- Login while offline: not possible. Staying logged in while offline is covered in spec 041.
- Clock skew: expiry is judged by the server only.
- **Risk to check at deploy:** PBKDF2 at 100,000 iterations may exceed the free Workers CPU limit (10 ms). If login fails for that reason, the options are the Workers Paid plan ($5/month) or fewer iterations. I will measure it on the live Worker and report before choosing.

## 7. Test cases
- Hash then verify: right password passes, wrong fails, the stored string has the R1 format, and two hashes of the same password differ.
- Login success: 200, cookie has the R5 name and attributes, body has `id`, `username`, `role` and no hash.
- Wrong password and unknown username return identical 401 responses.
- `/api/auth/me`: 401 without a cookie, 200 with one.
- `GET /api/health` is public. `/api/nope` is 401 without a session and 404 with one.
- The database holds only the token hash, never the cookie value.
- Logout: cookie cleared, session row gone, the old cookie then gets 401.
- Session idle for 31 days: 401 and the row is removed. Session idle for 2 days: still valid and `last_seen_at` is refreshed. Session idle for 12 hours: valid and not refreshed.
- A POST with a foreign `Origin` is 403. A POST with the matching `Origin` works.
- Rate limit: 5 failures from one IP, then the 6th attempt with the correct password is 429. After 16 minutes it works again. 30 failures across IPs give 429 for a new IP.
- Disabled user: login fails and an existing session stops working.
- Change password: wrong current 403, new password of 9 characters 400, success keeps the current session, deletes the others, old password stops working and the new one works.
- Audit rows exist for each event in R14 and contain no password or token.
- The `users` table rejects DELETE.

## 8. Out of scope
Staff accounts and roles (the `role` column and user ids are there so they can be added without a migration), two-factor login, password reset by email (recovery is the script in R3), "remember this device" options, login while offline.

## 9. Acceptance checklist
- [ ] R1 to R14 implemented and tested
- [ ] Owner password set on the remote database using the script
- [ ] Login, logout and change password work on the live site, on PC and on Android
- [ ] CPU limit risk checked on the live Worker
- [ ] Nothing in specs 000 and 001 broke
- [ ] Owner approved the result
