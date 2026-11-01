# Kickoff prompt for Codex

Paste this as the first message in Codex, with the repository checked out on an up-to-date `main` (after the hand-off pull request is merged):

---

You are taking over the `jewellery_billing_satyam` repository. Read `AGENTS.md` first and follow it exactly, then read `docs/HANDOFF.md` and `docs/wave1-plan.md`.

Your job: implement all of Wave 1 in one continuous run, in the order given in `docs/wave1-plan.md` (specs 012b, 003, 004, 012c, 015, 016, 018, 017, 019, 014, 050, then the final pass). Every one of those specs in `docs/specs/` is already approved. Do not wait for me and do not ask me questions: where a spec uses a default, use it, and record anything else in `docs/open-questions.md`.

Work on a branch named `wave-1`. Commit after every spec with the message `Spec NNN: <name>` and push. Before each commit run `npm run typecheck`, `npm test`, `npm run build`, and for screens `npm run e2e` (start `npm run dev:e2e` first; seed the local owner with `OWNER_PASSWORD=throwaway-local-pass-1 npm run owner:set -- --local`). Every rule and worked example in a spec needs a test. Never weaken an existing test. Never deploy, never use `--remote`, never commit secrets, GSTIN, phone or bank numbers.

When everything is done, rewrite `docs/HANDOFF.md`, and open one pull request from `wave-1` to `main` with a summary per spec, a test plan, the deploy steps for the owner in order, and the list of defaults you used.

---

Notes for the owner: Codex needs Node 22, npm, and Google Chrome on the machine for the browser tests. It has no access to your Cloudflare account and should not need any. You run the deploy commands yourself after reviewing the pull request.
