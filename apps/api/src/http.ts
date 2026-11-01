import type { ZodError } from "zod";

/** Reads a JSON body; returns undefined if it is missing or not valid JSON. */
export async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/** `{ error: "validation", issues: [{ field, message }] }` so screens can show a message under each field. */
export function validationBody(error: ZodError) {
  return {
    error: "validation" as const,
    issues: error.issues.map((i) => ({ field: String(i.path[0] ?? ""), message: i.message })),
  };
}
