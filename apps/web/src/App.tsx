import { useEffect, useState } from "react";
import { healthResponseSchema } from "@jewellery/shared";

type ApiStatus = "checking" | "ok" | "unreachable";

function isHealthy(body: unknown): boolean {
  const parsed = healthResponseSchema.safeParse(body);
  return parsed.success && parsed.data.status === "ok" && parsed.data.db === "ok";
}

export default function App() {
  const [status, setStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((body) => setStatus(isHealthy(body) ? "ok" : "unreachable"))
      .catch(() => setStatus("unreachable"));
  }, []);

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900 flex flex-col items-center justify-center gap-2 p-4">
      <h1 className="text-3xl font-semibold">Jewellery Billing</h1>
      <p className="text-stone-600">
        API status:{" "}
        <span className={status === "ok" ? "text-green-700" : status === "checking" ? "" : "text-red-700"}>
          {status === "ok" ? "ok" : status === "checking" ? "checking..." : "API unreachable"}
        </span>
      </p>
    </main>
  );
}
