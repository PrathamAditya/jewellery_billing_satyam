# Wave 4 plan: downloadable cross-platform version

Status: PLAN ONLY. Nothing in this wave is built. Each spec below needs its own draft and the owner's approval before work starts (the same way Wave 2 was done).

## Goal
Anyone can download and install the billing software on Windows, macOS or Linux, run it on their own PC, and use it without the cloud. The same code keeps running in the cloud for showrooms that want it.

## What already helps
- The business logic, the calculations, the numbering, the money rules and the web screens are shared code and carry over unchanged.
- The database is SQLite-compatible (D1 is SQLite). The 20 migration files run on a local SQLite file as they are.
- The API is a standard Hono app. Only its entry point is Cloudflare-specific.
- Fonts and print styles already ship with the app, so printing works offline.
- The browser test suite already drives the real screens, so it can test the packaged app too.

## What changes
| Area | Today | Wave 4 |
|------|-------|--------|
| Database | Cloudflare D1 (`c.env.DB`) | A D1-compatible adapter over a local SQLite file. `batch` becomes one transaction. |
| Server | Cloudflare Worker export | A Node server started by the desktop app, listening on localhost only. |
| Migrations | Wrangler applies them | A runner that records what has been applied and backs up the database before upgrading it. |
| Owner setup | `owner:set` through Wrangler | The first-run wizard, plus a command-line fallback that does not need Wrangler. |
| Backups | Cloud copies planned (spec 050) | Local copies to a folder of the owner's choice, with restore. Cloud backups stay for the cloud version. |
| Updates | Cloudflare deploy | Signed installers and an update check the owner approves. |

## Order of work
Each step can be tested on its own. Steps 1 to 3 make the same code run on a local database; steps 4 onward package it.

1. **080 Database adapter.** A D1-compatible wrapper over SQLite, with `batch` as a transaction. The whole API test suite runs against it before anything else changes. This is the riskiest step; if it passes, the rest is packaging.
2. **081 Local server entry.** Starts the API and serves the built web app on `127.0.0.1`. Data folder per OS, with a settings file.
3. **082 Local migration runner.** Applies the migration files in order, records them, and copies the database file before any upgrade.
4. **083 Desktop shell (Electron).** Opens the app in its own window, starts and stops the local server, provides the menus, and sends no data anywhere.
5. **084 Installers and code signing.** Windows installer first, then macOS (signed and notarised) and Linux packages.
6. **085 First-run setup.** Business details, bank details, the owner login, number settings, logo. Blocks nothing that a returning user needs.
7. **086 Local backup and restore.** A scheduled copy into the chosen folder, a restore that keeps the current database as a copy, and a check that the copy opens.
8. **087 Updates.** Signed update packages, checked at start-up, installed only when the owner agrees.
9. **088 Recovery.** A recovery code, shown at setup, that resets the owner password without a command line.
10. **089 Packaged-app tests.** The browser suite run against the installed app on each platform, plus install, upgrade and uninstall tests.
11. **090 Local network access (optional).** Phones and other PCs on the shop network, over HTTPS. Only if the owner chooses it (Q112). Needs its own login and security review.

## Relation to the other waves
- **Spec 041 (offline-first, Wave 3)** matters for several PCs that must share data. A single desktop install is offline by design, so 041 is only needed for the network case (090). Decide 041 and 090 together.
- **Spec 050 (cloud backups, Wave 3)** is for the cloud version. The desktop version uses 086.
- **Q81 (backups to the PC)** is answered by 086 once the owner approves the default.

## Definition of done
- A clean Windows PC can install the app from the downloaded file, run the setup, make an invoice, print it, take a payment, close the app, reopen it, and find the data.
- The full browser suite passes against the installed app.
- An upgrade from the previous installed version keeps the data and creates a backup first.
- Restoring a backup brings back the data exactly.
- The cloud version still deploys and passes its own tests.

## Risks
- **Packaging and signing take time and money** (certificates, notarisation). They can run late even when the code is done.
- **Two copies of the same data** (cloud and desktop) must not be mixed up. A showroom uses one of them.
- **A user's own PC can fail.** The backup and restore steps (086) are part of the product, not an extra.
- **Support.** Once people install it, questions arrive. Q119 decides how support is given.

## Open questions
All decisions for this wave are in `docs/open-questions.md`, section T (Q110 to Q119). Each has a default that the plan uses until the owner answers.
