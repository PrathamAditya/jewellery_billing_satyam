import { z } from "zod";

/** Spec 004 R1: every permission is `module.action`. Later specs add their own. */
export const PERMISSIONS = [
  "customers.view", "customers.create", "customers.edit", "customers.void",
  "rates.view", "rates.edit",
  "invoices.view", "invoices.create", "invoices.edit", "invoices.void", "invoices.print",
  "payments.view", "payments.create", "payments.void", "payments.refund",
  "advances.view", "advances.create", "advances.cancel",
  "oldgold.view", "oldgold.create", "oldgold.void",
  "ledger.view", "ledger.opening",
  "settings.view", "settings.manage",
  "users.manage",
  "backups.view", "backups.manage",
  "reports.view",
  "dashboard.view",
  "audit.view",
  "cash.close",
  "inventory.view", "inventory.edit",
  "purchases.view", "purchases.edit",
  // Spec 052: the data integrity checks (owner only by default, Q180).
  "integrity.view",
  "reconciliation.view", "reconciliation.edit",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const isPermission = (value: string): value is Permission => (PERMISSIONS as readonly string[]).includes(value);

/** Spec 004 R2: the four default roles. The owner role is locked. */
export const DEFAULT_ROLES: { name: string; label: string; permissions: Permission[]; system: boolean }[] = [
  { name: "owner", label: "Owner", system: true, permissions: [...PERMISSIONS] },
  {
    name: "manager",
    label: "Manager",
    system: false,
    permissions: PERMISSIONS.filter((p) => !["users.manage", "settings.manage", "backups.manage", "audit.view", "integrity.view"].includes(p)),
  },
  {
    name: "staff",
    label: "Shop staff",
    system: false,
    permissions: [
      "customers.view", "customers.create", "customers.edit",
      "rates.view",
      "invoices.view", "invoices.create", "invoices.print",
      "payments.view", "payments.create",
      "advances.view", "advances.create",
      "oldgold.view", "oldgold.create",
      "ledger.view",
      "settings.view",
      "dashboard.view",
      "inventory.view",
      "purchases.view",
      "reconciliation.view",
    ],
  },
  {
    name: "viewer",
    label: "View only",
    system: false,
    permissions: PERMISSIONS.filter((p) => p.endsWith(".view") && p !== "audit.view" && p !== "integrity.view").concat(["invoices.print"]) as Permission[],
  },
];

export const roleNameSchema = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{1,29}$/, "Role name: 2 to 30 letters, digits, - or _");
export const rolePermissionsSchema = z.array(z.string()).transform((list, ctx) => {
  const bad = list.filter((p) => !isPermission(p));
  if (bad.length) {
    ctx.addIssue({ code: "custom", message: `Unknown permission: ${bad[0]}` });
    return z.NEVER;
  }
  return [...new Set(list)] as Permission[];
});
