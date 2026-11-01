import { useEffect, useState } from "react";
import { healthResponseSchema } from "@jewellery/shared";
import AccountMenu from "./AccountMenu";
import Login from "./Login";
import { AuthProvider, useAuth } from "./auth";

type ApiStatus = "checking" | "ok" | "unreachable";

function isHealthy(body: unknown): boolean {
  const parsed = healthResponseSchema.safeParse(body);
  return parsed.success && parsed.data.status === "ok" && parsed.data.db === "ok";
}

function Shell() {
  const [status, setStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((body) => setStatus(isHealthy(body) ? "ok" : "unreachable"))
      .catch(() => setStatus("unreachable"));
  }, []);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col">
      <header className="flex items-center justify-between gap-2 px-4 py-3 bg-white border-b border-stone-200">
        <span className="font-semibold">Jewellery Billing</span>
        <AccountMenu />
      </header>
      <main className="flex-1 flex flex-col items-center justify-center gap-2 p-4">
        <h1 className="text-3xl font-semibold">Jewellery Billing</h1>
        <p className="text-stone-600">
          API status:{" "}
          <span className={status === "ok" ? "text-green-700" : status === "checking" ? "" : "text-red-700"}>
            {status === "ok" ? "ok" : status === "checking" ? "checking..." : "API unreachable"}
          </span>
        </p>
      </main>
    </div>
  );
}

function Gate() {
  const { user } = useAuth();
  if (user === undefined) {
    return <main className="min-h-screen bg-stone-50 flex items-center justify-center text-stone-500">Loading...</main>;
  }
  return user ? <Shell /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
