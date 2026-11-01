export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error?: string; message?: string },
  ) {
    super(body.message ?? body.error ?? `HTTP ${status}`);
  }
}

let onUnauthorized: () => void = () => {};
/** Spec 002 screens: any 401 from the API sends the user back to the login page. */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, { error: "network", message: "Could not reach the server. Check the internet and try again." });
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) {
    if (res.status === 401 && path !== "/api/auth/login") onUnauthorized();
    throw new ApiError(res.status, body);
  }
  return body;
}
