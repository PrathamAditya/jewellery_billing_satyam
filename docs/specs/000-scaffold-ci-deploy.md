# 000: Project scaffold, CI, deploy

Status: Approved (owner said "let's build v1" on 2026-11-01, after the stack and roadmap were shared)
Depends on: none
Open questions: none

## 1. Goal
An empty but real app is live on Cloudflare, the checks run on every push, and the test pipeline is proven with the one money rule that is already fully specified (round-off).

## 2. Rules
- R1. npm workspaces monorepo: `apps/web` (React + Vite + Tailwind), `apps/api` (Hono on a Cloudflare Worker), `packages/shared` (Zod schemas), `packages/calc` (pure calculation code).
- R2. One Worker serves both the API (`/api/*`) and the built web app (static assets, SPA fallback).
- R3. `GET /api/health` returns `{ status: "ok", service: "jewlray-billing", time: <ISO string> }`, validated by a schema in `packages/shared`. Unknown `/api/*` paths return JSON 404.
- R4. `roundOffPaise(paise)` in `packages/calc` is the only function that rounds money to a rupee. Input: non-negative integer paise. Below 50 paise rounds down, 50 paise or more rounds up. It returns integer paise (a multiple of 100). Negative or non-integer input throws `RangeError`.
- R5. `npm run typecheck`, `npm test` and `npm run build` pass locally and in GitHub Actions.
- R6. `npm run deploy` builds the web app and deploys the Worker to workers.dev.
- R7. No secrets or `.env` files are committed.

## 3. Data
None. The D1 database and the migration framework arrive in spec 001.

## 4. Screens and printing
One page: the app name and an "API status" line that calls `/api/health`. Nothing prints.

## 5. Edge cases
- API unreachable: the page shows "API unreachable" and does not crash.
- `roundOffPaise` with `49.5`, `-1`, `NaN`: throws.

## 6. Test cases
`roundOffPaise` (R4):

| Input paise | Output paise |
|-------------|--------------|
| 0 | 0 |
| 49 | 0 |
| 50 | 100 |
| 99 | 100 |
| 100 | 100 |
| 12349 | 12300 |
| 12350 | 12400 |
| 12399 | 12400 |

Throws: `-1`, `49.5`, `NaN`.
`/api/health` (R3): status 200, body passes the shared schema. `/api/nope`: status 404, JSON body.

## 7. Out of scope
Database, login, PWA install, offline, any billing screen.

## 8. Acceptance checklist
- [ ] R1 to R7 implemented
- [ ] Tests above pass locally and in CI
- [ ] App live on workers.dev and the status line shows ok
- [ ] Nothing committed that should not be
