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
  { method: "POST", path: "/api/allocations/:id/reverse", permission: "payments.void" },

  { method: "GET", path: "/api/orders", permission: "advances.view" },
  { method: "POST", path: "/api/orders", permission: "advances.create" },
  { method: "GET", path: "/api/orders/:id", permission: "advances.view" },
  { method: "POST", path: "/api/orders/:id/close", permission: "advances.create" },
  { method: "POST", path: "/api/orders/:id/cancel", permission: "advances.cancel" },
  { method: "POST", path: "/api/payments/:id/refunds", permission: "payments.refund" },
  { method: "POST", path: "/api/refunds/:id/reverse", permission: "payments.refund" },
  { method: "GET", path: "/api/customers/:id/advances", permission: "advances.view" },

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
