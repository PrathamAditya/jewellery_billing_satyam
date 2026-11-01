# Browser tests

Real-browser checks (Playwright driving Chrome) of the screens, against a local Worker with a local database. They complement the unit and API tests (`npm test`). Every new screen or flow needs a script here.

## Run

```
npm install
npm run db:migrate -w @jewellery/api                   # local D1
OWNER_PASSWORD=throwaway-local-pass-1 npm run owner:set -- --local   # creates or resets the local owner
npm run build                                          # the Worker serves apps/web/dist
npm run dev:e2e                                        # in one terminal: wrangler dev on http://localhost:8799
npm run e2e                                            # in another terminal
```

Environment variables: `BASE_URL` (default `http://localhost:8799`), `OWNER_PASSWORD` (default `throwaway-local-pass-1`), `CHROME_PATH` (default `/usr/bin/google-chrome`). Screenshots go to `e2e/screenshots/` (ignored by git). Read them when something looks wrong.

## Rules for writing scripts
- Log in as `owner`, use `ok(condition, message)` and print `PASS` or `FAIL` lines, exit non-zero on failure.
- Scripts share one local database and run in the order in `run-all.mjs`, so make each script re-runnable: use unique names (a timestamp suffix) and handle "already saved" states (see `rates.mjs`).
- Test the phone too: a 390 px wide context, check the page does not scroll sideways (`scrollWidth > innerWidth`) and that actions the user may not perform are hidden.
- Use visible-only selectors (`text=... >> visible=true`) when a phone-only and a PC-only copy of the same text exist.
- End with a "no browser errors" check on `pageerror` and console errors.
- Never point these at the live site. Never put a real password in a script.
