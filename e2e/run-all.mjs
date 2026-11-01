// Runs every browser test in order against a running local Worker (see e2e/README.md).
import { spawnSync } from "node:child_process";

// The order matters: later files reuse data the earlier ones create (a customer, today's rates).
const files = ["customers", "rates", "calculator", "invoices", "settings", "users", "payments", "orders", "oldgold", "settlement", "ledger", "print", "discounts"];
let failed = 0;
for (const f of files) {
  console.log(`\n=== e2e/${f}.mjs ===`);
  const r = spawnSync("node", [`e2e/${f}.mjs`], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} browser test file(s) FAILED` : "\nAll browser tests passed");
process.exit(failed ? 1 : 0);
