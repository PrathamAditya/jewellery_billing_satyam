import { useEffect, useState } from "react";
import { RATE_KINDS, RATE_LABELS, formatPerGram, formatPerKg, type ApplicableRatesResponse } from "@jewellery/shared";
import { getApplicable, niceDate } from "./api";

/** Home card: today's applicable rates, with an amber warning when today's rate has not been typed (spec 011 R8). */
export default function TodayRates() {
  const [data, setData] = useState<ApplicableRatesResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getApplicable()
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;
  const rates = data?.rates;
  const none = rates && RATE_KINDS.every((k) => !rates[k]);
  const stale = rates && !none && RATE_KINDS.some((k) => !rates[k] || rates[k]!.carriedForward);

  return (
    <a href="#/rates" className="block bg-white border border-stone-200 rounded-xl p-4 hover:border-stone-400">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Today's rates</h2>
        <span className="text-xs text-stone-500">{data ? niceDate(data.date) : ""}</span>
      </div>
      {none && <p className="text-sm text-amber-800 mb-2">No rates saved yet.</p>}
      {stale && <p className="text-sm text-amber-800 mb-2">Today's rate is not set for everything. Tap to enter it.</p>}
      <ul className="flex flex-col gap-1.5 text-sm">
        {RATE_KINDS.map((k) => {
          const r = rates?.[k];
          return (
            <li key={k} className="flex justify-between gap-2">
              <span>{RATE_LABELS[k]}</span>
              {!rates ? (
                <span className="text-stone-400">...</span>
              ) : r ? (
                <span className={r.carriedForward ? "text-amber-800" : ""}>
                  <span className="font-medium">{formatPerGram(r.pricePaisePerKg)}</span>/g
                  <span className="text-stone-500"> · {formatPerKg(r.pricePaisePerKg)}/kg</span>
                  {r.carriedForward && <span className="text-xs"> (from {niceDate(r.rateDate)})</span>}
                </span>
              ) : (
                <span className="text-stone-400">not saved</span>
              )}
            </li>
          );
        })}
      </ul>
    </a>
  );
}
