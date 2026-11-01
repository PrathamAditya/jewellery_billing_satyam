import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { userResponseSchema, type UserResponse } from "@jewellery/shared";
import { ApiError, api, setUnauthorizedHandler } from "./api";

type AuthState = {
  /** `undefined` while the first check is running, `null` when logged out. */
  user: UserResponse | null | undefined;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserResponse | null | undefined>(undefined);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api<unknown>("/api/auth/me")
      .then((body) => setUser(userResponseSchema.parse(body)))
      .catch((e) => {
        // 401 already set the user to null. A network failure also shows the login page, whose own errors explain it.
        if (!(e instanceof ApiError) || e.status !== 401) setUser(null);
      });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const body = await api<unknown>("/api/auth/login", { method: "POST", body: { username, password } });
    setUser(userResponseSchema.parse(body));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
