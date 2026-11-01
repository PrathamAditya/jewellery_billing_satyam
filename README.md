# jewellery_billing_satyam

Billing, inventory and business management for a gold and silver jewellery showroom. Runs in the browser on a Windows PC (full billing and printing) and on Android (view-only dashboard), backed by one shared database.

Status: specs 000 (scaffold) and 001 (database foundation) built. Live: https://jewellery-billing-satyam.prathamadityasalhotra.workers.dev

## Docs

- [Decisions and open questions](docs/decisions.md)
- [Tech stack](docs/tech-stack.md)
- [Roadmap](docs/roadmap.md)
- [Requirements](docs/requirements.md)
- [Feature specs](docs/specs/README.md)

## How it is built

One feature at a time: spec, approval, build, test, commit.

## Develop

```
npm install
npm run dev        # API on :8787 and web on :5173 (web proxies /api)
npm run typecheck
npm test
npm run deploy     # build web, deploy Worker to Cloudflare
```

Database: `npm run db:migrate` (local D1), `npm run db:migrate:remote` (Cloudflare), `npm run db:generate` (new migration from `apps/api/src/db/schema.ts`).
