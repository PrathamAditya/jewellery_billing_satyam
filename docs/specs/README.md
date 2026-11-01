# Feature specs

Process for every feature:

1. Claude writes `NNN-name.md` from `_template.md`.
2. The owner reads it, edits it, and sets `Status: Approved`.
3. Claude builds it, tests it, and commits.
4. The owner checks the result, and the status becomes `Done`.

No code is written for a feature before its spec is Approved.

## Index

| Spec | Name | Status |
|------|------|--------|
| 000 | Project scaffold, CI, deploy | Done |
| 001 | Database foundation | Done (owner approved 2026-11-01) |
| 002 | Owner login | Done (owner approved 2026-11-01) |
| 010 | Customers | Built, awaiting deploy and owner check |
| 011 | Daily gold and silver rates | Draft, needs approval (owner answers recorded) |

The full list is in `docs/roadmap.md`.
