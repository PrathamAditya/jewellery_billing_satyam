import type { AuthUser } from "./auth/session";

export type Bindings = { DB: D1Database };
export type Variables = { user: AuthUser; now: Date };
export type AppEnv = { Bindings: Bindings; Variables: Variables };
