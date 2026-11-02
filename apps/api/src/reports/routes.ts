import { Hono } from "hono";
import { REPORT_KINDS, reportQuerySchema, type ReportKind } from "@jewellery/shared";
import { indiaDate } from "@jewellery/shared";
import type { AppEnv } from "../env";
import { validationBody } from "../http";
import { buildReport } from "./data";
import { buildPdf } from "./pdf";
import { buildXlsx } from "./xlsx";

/** Spec 031: `GET /api/reports/:kind?from=&to=&fy=&format=xlsx|pdf`. Read-only; writes nothing. */
export const reportRoutes = new Hono<AppEnv>();

reportRoutes.get("/:kind", async (c) => {
  const kind = c.req.param("kind");
  if (!(REPORT_KINDS as readonly string[]).includes(kind)) return c.json({ error: "not_found", message: "There is no such report" }, 404);
  const parsed = reportQuerySchema.safeParse({
    from: c.req.query("from"),
    to: c.req.query("to"),
    fy: c.req.query("fy"),
    format: c.req.query("format") ?? undefined,
  });
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const today = indiaDate(c.get("now"));
  const table = await buildReport(c.env.DB, kind as ReportKind, parsed.data, today);
  const isPdf = parsed.data.format === "pdf";
  const bytes = isPdf ? buildPdf(table, today) : buildXlsx(table);
  const name = `${table.fileName}.${isPdf ? "pdf" : "xlsx"}`;
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": isPdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
});
