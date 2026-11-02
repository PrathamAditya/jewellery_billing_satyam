import { useState } from "react";
import type { IntegrityResponse } from "@jewellery/shared";
import { useAuth } from "../auth";
import { Alert, btnPrimary, btnSecondary } from "../customers/ui";
import { runIntegrity } from "./api";

/** Spec 052: the data checks. Runs on request, changes nothing, owner only (integrity.view). */
const whenText = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export default function IntegrityPage() {
  const { can } = useAuth();
  const [result, setResult] = useState<IntegrityResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!can("integrity.view")) return <Alert kind="info">Only the owner can see the data checks.</Alert>;

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await runIntegrity());
    } catch (e) {
      setError(e instanceof Error ? e.message : "The checks could not run. Try again.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-semibold">Data checks</h1>
        <button className={result ? btnSecondary : btnPrimary} onClick={run} disabled={running}>
          {running ? "Checking..." : result ? "Run again" : "Run checks"}
        </button>
      </div>
      <p className="text-sm text-stone-600 break-words">
        The checks compare the stored figures with each other: invoice totals, balances, numbers, customer numbers, the ledger, voided records and the audit trail. They change nothing.
      </p>
      {error && <Alert>{error}</Alert>}
      {!result && !running && <p className="text-stone-500">Press "Run checks" to look at the stored data.</p>}
      {result && (
        <>
          <div className={`rounded-xl border p-4 ${result.ok ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`} role="status">
            <p className="font-medium">{result.ok ? `All ${result.checks.length} checks passed.` : `${result.passed} of ${result.checks.length} checks passed. ${result.failed} need attention.`}</p>
            <p className="text-xs text-stone-600">Run at {whenText(result.ranAt)}</p>
          </div>
          <ul className="flex flex-col gap-3">
            {result.checks.map((c) => (
              <li key={c.id} className="bg-white border border-stone-200 rounded-xl p-4 min-w-0">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="font-semibold break-words">{c.title}</h2>
                    <p className="text-sm text-stone-600 break-words">{c.description}</p>
                  </div>
                  <span className={`text-sm font-medium px-2 py-0.5 rounded ${c.status === "ok" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                    {c.status === "ok" ? "OK" : `Problem (${c.count})`}
                  </span>
                </div>
                {c.problems.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-2 border-t border-stone-100 pt-3">
                    {c.problems.map((p, i) => (
                      <li key={`${p.recordId}-${i}`} className="text-sm break-words">
                        {p.link ? (
                          <a href={p.link} className="underline font-medium">{p.label}</a>
                        ) : (
                          <span className="font-medium">{p.label}</span>
                        )}
                        <span className="text-stone-500"> ({p.kind}, id {p.recordId})</span>
                        <div className="text-stone-700">{p.detail}</div>
                      </li>
                    ))}
                    {c.truncated && <li className="text-sm text-stone-500">Showing the first {c.problems.length} of {c.count}.</li>}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
