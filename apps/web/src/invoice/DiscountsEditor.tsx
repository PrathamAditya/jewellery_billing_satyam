import { DISCOUNT_LABEL, DISCOUNT_TARGETS, parseDiscountTexts, type DiscountTarget, type DiscountTexts } from "@jewellery/shared";
import { inputClass } from "../customers/ui";

type Props = { value: DiscountTexts; onChange: (v: DiscountTexts) => void };

/** Spec 012c section 4: three rows (Gold, Labour, Total), each fixed rupees or a percent. Empty means no discount. */
export default function DiscountsEditor({ value, onChange }: Props) {
  const { errors } = parseDiscountTexts(value);
  const set = (t: DiscountTarget, next: Partial<DiscountTexts[DiscountTarget]>) => onChange({ ...value, [t]: { ...value[t], ...next } });
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Discounts (optional)</h3>
      {DISCOUNT_TARGETS.map((t) => {
        const row = value[t];
        return (
          <div key={t} className="flex flex-wrap items-start gap-2 text-sm">
            <span className="w-20 pt-2">{DISCOUNT_LABEL[t]}</span>
            <div className="flex">
              {(["fixed", "percent"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set(t, { kind: k })}
                  aria-pressed={row.kind === k}
                  aria-label={`${DISCOUNT_LABEL[t]} discount is ${k === "fixed" ? "fixed rupees" : "a percent"}`}
                  className={`px-3 py-2 border first:rounded-l-lg last:rounded-r-lg -ml-px first:ml-0 ${row.kind === k ? "bg-stone-900 text-white border-stone-900" : "bg-white border-stone-300"}`}
                >
                  {k === "fixed" ? "₹ fixed" : "% percent"}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-0.5">
              <input
                className={`${inputClass} w-32 ${errors[t] ? "border-red-400" : ""}`}
                value={row.value}
                onChange={(e) => set(t, { value: e.target.value })}
                aria-label={`${DISCOUNT_LABEL[t]} discount amount`}
                placeholder={row.kind === "percent" ? "e.g. 1" : "e.g. 300"}
                inputMode="decimal"
              />
              {errors[t] && <span role="alert" className="text-xs text-red-700 max-w-48">{errors[t]}</span>}
            </div>
          </div>
        );
      })}
      <p className="text-xs text-stone-500">
        Gold discount is shared across lines by their gold part, labour by their labour part, and the total discount by the amount after those two. GST is worked out after the discount.
      </p>
    </div>
  );
}
