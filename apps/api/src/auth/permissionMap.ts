import type { Permission } from "@jewellery/shared";

/**
 * Spec 004 R3: every /api route and the permission it needs. A route that is not listed is denied
 * (default deny). `test/permissions.test.ts` fails if a registered route is missing here.
 * "public" = no login needed. "any" = logged in, no permission needed.
 */
export type Rule = { method: string; path: string; permission: Permission | "any" | "public" };

export const PERMISSION_MAP: Rule[] = [
  { method: "GET", path: "/api/health", permission: "public" },
  { method: "POST", path: "/api/auth/login", permission: "public" },
  { method: "GET", path: "/api/auth/me", permission: "any" },
  { method: "POST", path: "/api/auth/logout", permission: "any" },
  { method: "POST", path: "/api/auth/change-password", permission: "any" },

  { method: "GET", path: "/api/customers", permission: "customers.view" },
  { method: "POST", path: "/api/customers", permission: "customers.create" },
  { method: "GET", path: "/api/customers/:id", permission: "customers.view" },
  { method: "PATCH", path: "/api/customers/:id", permission: "customers.edit" },
  { method: "GET", path: "/api/customers/:id/history", permission: "customers.view" },
  { method: "POST", path: "/api/customers/:id/void", permission: "customers.void" },
  { method: "POST", path: "/api/customers/:id/restore", permission: "customers.void" },
  { method: "POST", path: "/api/customers/:id/aadhaar/reveal", permission: "customers.edit" },

  { method: "GET", path: "/api/rates/applicable", permission: "rates.view" },
  { method: "GET", path: "/api/rates", permission: "rates.view" },
  { method: "PUT", path: "/api/rates/:date/:kind", permission: "rates.edit" },
  { method: "GET", path: "/api/rates/:date/:kind/history", permission: "rates.view" },

  { method: "GET", path: "/api/invoices", permission: "invoices.view" },
  { method: "POST", path: "/api/invoices", permission: "invoices.create" },
  { method: "GET", path: "/api/invoices/:id", permission: "invoices.view" },
  { method: "PUT", path: "/api/invoices/:id", permission: "invoices.edit" },
  { method: "GET", path: "/api/invoices/:id/history", permission: "invoices.view" },
  { method: "POST", path: "/api/invoices/:id/void", permission: "invoices.void" },
  { method: "POST", path: "/api/invoices/:id/print-event", permission: "invoices.print" },

  { method: "GET", path: "/api/settings", permission: "settings.view" },
  { method: "GET", path: "/api/settings/snapshot", permission: "settings.view" },
  { method: "GET", path: "/api/settings/numbering", permission: "settings.view" },
  { method: "PUT", path: "/api/settings/:key", permission: "settings.manage" },
  { method: "POST", path: "/api/settings/next-number", permission: "settings.manage" },

  { method: "GET", path: "/api/payments", permission: "payments.view" },
  { method: "POST", path: "/api/payments", permission: "payments.create" },
  { method: "GET", path: "/api/payments/:id", permission: "payments.view" },
  { method: "PATCH", path: "/api/payments/:id", permission: "payments.create" },
  { method: "POST", path: "/api/payments/:id/void", permission: "payments.void" },
  { method: "GET", path: "/api/payments/cheques/pending", permission: "payments.view" },
  // Spec 019b: the handler itself asks for payments.void when the move is 'bounced'.
  { method: "POST", path: "/api/payments/:id/cheque", permission: "payments.create" },
  { method: "POST", path: "/api/allocations/:id/reverse", permission: "payments.void" },

  { method: "GET", path: "/api/orders", permission: "advances.view" },
  { method: "POST", path: "/api/orders", permission: "advances.create" },
  { method: "GET", path: "/api/orders/:id", permission: "advances.view" },
  { method: "POST", path: "/api/orders/:id/close", permission: "advances.create" },
  { method: "POST", path: "/api/orders/:id/cancel", permission: "advances.cancel" },
  { method: "POST", path: "/api/payments/:id/refunds", permission: "payments.refund" },
  { method: "POST", path: "/api/refunds/:id/reverse", permission: "payments.refund" },
  { method: "GET", path: "/api/customers/:id/advances", permission: "advances.view" },

  { method: "GET", path: "/api/old-gold", permission: "oldgold.view" },
  { method: "POST", path: "/api/old-gold", permission: "oldgold.create" },
  { method: "GET", path: "/api/old-gold/:id", permission: "oldgold.view" },
  { method: "POST", path: "/api/old-gold/:id/void", permission: "oldgold.void" },

  { method: "GET", path: "/api/invoices/:id/settlement", permission: "invoices.view" },
  { method: "PUT", path: "/api/invoices/:id/settlement", permission: "invoices.edit" },
  { method: "POST", path: "/api/invoices/:id/advance-allocations", permission: "payments.create" },
  // Spec 019d (credit notes), one permission per route (Q94).
  { method: "GET", path: "/api/credit-notes", permission: "invoices.view" },
  { method: "POST", path: "/api/credit-notes", permission: "invoices.edit" },
  { method: "GET", path: "/api/credit-notes/:id", permission: "invoices.view" },
  { method: "POST", path: "/api/credit-notes/:id/apply", permission: "payments.create" },
  { method: "POST", path: "/api/credit-notes/:id/payouts", permission: "payments.refund" },
  { method: "POST", path: "/api/credit-notes/:id/void", permission: "payments.void" },
  { method: "POST", path: "/api/credit-notes/applications/:id/reverse", permission: "payments.void" },
  { method: "POST", path: "/api/credit-notes/payouts/:id/reverse", permission: "payments.refund" },
  // Spec 019c: a sale whose rate is fixed later; fixing it applies the money already paid on it.
  { method: "POST", path: "/api/invoices/pending", permission: "invoices.create" },
  { method: "POST", path: "/api/invoices/:id/fix-rate", permission: "invoices.edit" },

  { method: "GET", path: "/api/opening-balances", permission: "ledger.view" },
  { method: "POST", path: "/api/opening-balances", permission: "ledger.opening" },
  { method: "POST", path: "/api/opening-balances/:id/void", permission: "ledger.opening" },
  { method: "GET", path: "/api/customers/:id/ledger", permission: "ledger.view" },
  { method: "GET", path: "/api/ledger/summary", permission: "ledger.view" },
  { method: "GET", path: "/api/ledger/outstanding", permission: "ledger.view" },

  // Spec 030: the dashboard (read-only). Tiles are hidden per section by invoices.view and payments.view in the handler.
  { method: "GET", path: "/api/dashboard", permission: "dashboard.view" },
  // Spec 031: the four CA reports, Excel or PDF. Read-only.
  { method: "GET", path: "/api/reports/:kind", permission: "reports.view" },
  // Spec 051: read-only audit history (owner only by default).
  { method: "GET", path: "/api/audit", permission: "audit.view" },
  { method: "GET", path: "/api/audit/options", permission: "audit.view" },

  // Spec 032: daily cash closing. Anyone who sees payments sees the day's cash; closing and correction notes need cash.close.
  { method: "GET", path: "/api/cash-closing", permission: "payments.view" },
  { method: "GET", path: "/api/cash-closing/list", permission: "payments.view" },
  { method: "POST", path: "/api/cash-closing", permission: "cash.close" },
  { method: "POST", path: "/api/cash-closing/:date/notes", permission: "cash.close" },
  // Spec 052: read-only data checks (owner only by default, Q180).
  { method: "GET", path: "/api/integrity", permission: "integrity.view" },
  // Spec 020: inventory items (U No.), item types and status history.
  { method: "GET", path: "/api/inventory/types", permission: "inventory.view" },
  { method: "POST", path: "/api/inventory/types", permission: "inventory.edit" },
  { method: "PATCH", path: "/api/inventory/types/:id", permission: "inventory.edit" },
  { method: "GET", path: "/api/inventory/items", permission: "inventory.view" },
  { method: "POST", path: "/api/inventory/items", permission: "inventory.edit" },
  { method: "GET", path: "/api/inventory/items/:id", permission: "inventory.view" },
  { method: "GET", path: "/api/inventory/items/:id/history", permission: "inventory.view" },
  { method: "POST", path: "/api/inventory/items/:id/status", permission: "inventory.edit" },
  { method: "POST", path: "/api/inventory/items/:id/void", permission: "inventory.edit" },

  // Spec 020b: bulk quantity items and their movements.
  { method: "GET", path: "/api/inventory/bulk", permission: "inventory.view" },
  { method: "POST", path: "/api/inventory/bulk", permission: "inventory.edit" },
  { method: "GET", path: "/api/inventory/bulk/:id", permission: "inventory.view" },
  { method: "GET", path: "/api/inventory/bulk/:id/history", permission: "inventory.view" },
  { method: "POST", path: "/api/inventory/bulk/:id/movements", permission: "inventory.edit" },

  // Spec 021b: stock locations, the stock at each place, and transfers between places.
  { method: "GET", path: "/api/inventory/locations", permission: "inventory.view" },
  { method: "POST", path: "/api/inventory/locations", permission: "inventory.edit" },
  { method: "PATCH", path: "/api/inventory/locations/:id", permission: "inventory.edit" },
  { method: "GET", path: "/api/inventory/locations/:id/stock", permission: "inventory.view" },
  { method: "GET", path: "/api/inventory/transfers", permission: "inventory.view" },
  { method: "POST", path: "/api/inventory/transfers", permission: "inventory.edit" },

  // Spec 025: monthly stock reconciliation. The report is read-only; counts, lines and close need reconciliation.edit.
  { method: "GET", path: "/api/inventory/reconciliations", permission: "reconciliation.view" },
  { method: "POST", path: "/api/inventory/reconciliations", permission: "reconciliation.edit" },
  { method: "GET", path: "/api/inventory/reconciliations/:id", permission: "reconciliation.view" },
  { method: "GET", path: "/api/inventory/reconciliations/:id/report", permission: "reconciliation.view" },
  { method: "PUT", path: "/api/inventory/reconciliations/:id/counts", permission: "reconciliation.edit" },
  { method: "POST", path: "/api/inventory/reconciliations/:id/lines", permission: "reconciliation.edit" },
  { method: "POST", path: "/api/inventory/reconciliations/:id/close", permission: "reconciliation.edit" },

  // Spec 022: purchases of three types, and the raw gold and silver stock. raw-stock is listed before :id.
  { method: "GET", path: "/api/inventory/purchases", permission: "purchases.view" },
  { method: "POST", path: "/api/inventory/purchases", permission: "purchases.edit" },
  { method: "GET", path: "/api/inventory/purchases/raw-stock", permission: "purchases.view" },
  { method: "GET", path: "/api/inventory/purchases/:id", permission: "purchases.view" },
  { method: "POST", path: "/api/inventory/purchases/:id/void", permission: "purchases.edit" },

  // Spec 023: karigar job work. Reads need karigar.view; every change needs karigar.edit (owner and manager).
  { method: "GET", path: "/api/karigar/karigars", permission: "karigar.view" },
  { method: "POST", path: "/api/karigar/karigars", permission: "karigar.edit" },
  { method: "GET", path: "/api/karigar/karigars/:id", permission: "karigar.view" },
  { method: "GET", path: "/api/karigar/karigars/:id/statement", permission: "karigar.view" },
  { method: "POST", path: "/api/karigar/karigars/:id/payouts", permission: "karigar.edit" },
  { method: "GET", path: "/api/karigar/jobs", permission: "karigar.view" },
  { method: "POST", path: "/api/karigar/jobs", permission: "karigar.edit" },
  { method: "GET", path: "/api/karigar/jobs/:id", permission: "karigar.view" },
  { method: "POST", path: "/api/karigar/jobs/:id/issues", permission: "karigar.edit" },
  { method: "POST", path: "/api/karigar/jobs/:id/returns", permission: "karigar.edit" },
  { method: "POST", path: "/api/karigar/jobs/:id/close", permission: "karigar.edit" },

  { method: "GET", path: "/api/users", permission: "users.manage" },
  { method: "POST", path: "/api/users", permission: "users.manage" },
  { method: "PATCH", path: "/api/users/:id", permission: "users.manage" },
  { method: "POST", path: "/api/users/:id/reset-password", permission: "users.manage" },
  { method: "POST", path: "/api/users/:id/end-sessions", permission: "users.manage" },
  { method: "GET", path: "/api/users/:id/activity", permission: "users.manage" },
  { method: "GET", path: "/api/roles", permission: "users.manage" },
  { method: "POST", path: "/api/roles", permission: "users.manage" },
  { method: "PATCH", path: "/api/roles/:name", permission: "users.manage" },
];

const toRegex = (template: string) => new RegExp("^" + template.replace(/:[a-zA-Z]+/g, "[^/]+") + "$");
const compiled = PERMISSION_MAP.map((r) => ({ ...r, re: toRegex(r.path) }));

/** Finds the rule for a request. Method and path must both match a template. */
export function ruleFor(method: string, path: string): Rule | undefined {
  return compiled.find((r) => r.method === method && r.re.test(path));
}
