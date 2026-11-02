# Downloadable desktop version: a separate project

Decided by the owner on 2026-11-02.

- **This repository** (`jewellery_billing_satyam`) is the final web-based product: the cloud version that the showroom uses.
- **The desktop version** is a separate project in its own repository, forked from this one. It runs the same billing software on Windows, macOS and Linux, on the user's own PC.
- **The base the desktop project starts from** is this repository's `main` after the Wave 3 merge. It already has the local database adapter (spec 080), the local server (081) and the migration runner (082).
- **The plan** for the desktop project is `docs/wave4-plan.md` in this repository; it is copied into the desktop repository when that project starts.
- **Changes in this repository** stay web-only. Fixes to shared billing logic are made here first and then brought into the desktop project.
