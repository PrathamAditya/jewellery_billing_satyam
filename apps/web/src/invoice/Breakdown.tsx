import type { InvoiceResult } from "@jewellery/calc";
import { formatMoney, formatWeightGrams } from "@jewellery/shared";

const pct = (bps: number) => `${bps / 100}%`.replace(/(\.\d)0%$/, "$1%");

/**
 * Per-line figures and the totals block in the paper bill's order (spec 012, 013, 012c R8).
 * `Total value`, `Less: discount` and `Taxable value` come first; GST is worked out on the taxable value.
 */
export default function Breakdown({ r, descriptions }: { r: InvoiceResult; descriptions: string[] }) {
  const cell = "px-3 py-2 text-right whitespace-nowrap";
  // Invoices saved before spec 012c have no discount or stone figures: they read as no discount and taxable = amount.
  const totals = {
    totalValue: r.totalValuePaise ?? r.taxablePaise,
    discount: r.discountPaise ?? 0,
    gold: r.discountGoldPaise ?? 0,
    labour: r.discountLabourPaise ?? 0,
    total: r.discountTotalPaise ?? 0,
  };
  const lines = r.lines.map((l) => ({
    ...l,
    stoneAmountPaise: l.stoneAmountPaise ?? 0,
    discountPaise: l.discountPaise ?? 0,
    taxablePaise: l.taxablePaise ?? l.amountPaise,
  }));
  const anyDiscount = totals.discount > 0;
  const anyStone = lines.some((l) => l.stoneAmountPaise > 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-stone-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Line</th>
              <th className={`${cell} font-medium`}>Weight (net + polish)</th>
              <th className={`${cell} font-medium`}>Gold part</th>
              <th className={`${cell} font-medium`}>Labour part</th>
              {anyStone && <th className={`${cell} font-medium`}>Stone</th>}
              <th className={`${cell} font-medium`}>Amount</th>
              {anyDiscount && <th className={`${cell} font-medium`}>Discount</th>}
              <th className={`${cell} font-medium`}>Taxable</th>
              <th className={`${cell} font-medium`}>Display rate / g</th>
              <th className={`${cell} font-medium`}>GST</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-stone-100">
                <td className="px-3 py-2">{descriptions[i] || `Line ${i + 1}`}</td>
                <td className={cell}>{formatWeightGrams(l.chargeableWeightMg)} g</td>
                <td className={cell}>{formatMoney(l.goldAmountPaise)}</td>
                <td className={cell}>{formatMoney(l.labourAmountPaise)}</td>
                {anyStone && <td className={cell}>{formatMoney(l.stoneAmountPaise)}</td>}
                <td className={`${cell} font-medium`}>{formatMoney(l.amountPaise)}</td>
                {anyDiscount && <td className={cell}>{l.discountPaise ? `− ${formatMoney(l.discountPaise)}` : "–"}</td>}
                <td className={cell}>{formatMoney(l.taxablePaise)}</td>
                <td className={cell}>{l.pricingMode === "combined" ? "–" : formatMoney(l.displayRatePaisePerGram)}</td>
                <td className={cell}>{pct(l.gstRateBps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl p-4 max-w-md self-end w-full" aria-label="Totals">
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt>Total value</dt>
            <dd>{formatMoney(totals.totalValue)}</dd>
          </div>
          {anyDiscount && (
            <>
              {totals.gold > 0 && (
                <div className="flex justify-between text-stone-600">
                  <dt>Less: gold discount</dt>
                  <dd>− {formatMoney(totals.gold)}</dd>
                </div>
              )}
              {totals.labour > 0 && (
                <div className="flex justify-between text-stone-600">
                  <dt>Less: labour discount</dt>
                  <dd>− {formatMoney(totals.labour)}</dd>
                </div>
              )}
              {totals.total > 0 && (
                <div className="flex justify-between text-stone-600">
                  <dt>Less: total discount</dt>
                  <dd>− {formatMoney(totals.total)}</dd>
                </div>
              )}
            </>
          )}
          <div className="flex justify-between border-t border-stone-200 pt-1.5">
            <dt>Taxable value</dt>
            <dd>{formatMoney(r.taxablePaise)}</dd>
          </div>
          {r.groups.map((g) =>
            r.taxMode === "intra" ? (
              <div key={g.gstRateBps} className="flex flex-col gap-1.5">
                <div className="flex justify-between">
                  <dt>(+) SGST @ {pct(g.gstRateBps / 2)}</dt>
                  <dd>{formatMoney(g.sgstPaise)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>(+) CGST @ {pct(g.gstRateBps / 2)}</dt>
                  <dd>{formatMoney(g.cgstPaise)}</dd>
                </div>
              </div>
            ) : (
              <div key={g.gstRateBps} className="flex justify-between">
                <dt>(+) IGST @ {pct(g.gstRateBps)}</dt>
                <dd>{formatMoney(g.igstPaise)}</dd>
              </div>
            ),
          )}
          <div className="flex justify-between border-t border-stone-200 pt-1.5 font-medium">
            <dt>Total Amount after Tax</dt>
            <dd>{formatMoney(r.totalBeforeRoundOffPaise)}</dd>
          </div>
          <div className="flex justify-between text-stone-600">
            <dt>Round-off</dt>
            <dd>{formatMoney(r.roundOffPaise)}</dd>
          </div>
          <div className="flex justify-between border-t border-stone-300 pt-1.5 text-base font-semibold">
            <dt>Payable</dt>
            <dd>{formatMoney(r.payablePaise)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
