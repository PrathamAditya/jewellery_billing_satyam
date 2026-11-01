import { formatPerGram, formatPerKg, paisePerKgToInput, parseRateInput, type RateUnit } from "@jewellery/shared";
import { inputClass } from "../customers/ui";

type Props = {
  label: string;
  value: string;
  unit: RateUnit;
  onChange: (value: string, unit: RateUnit) => void;
  error?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
};

/**
 * A rate box with a per gram / per kg switch. Both figures show as the owner types (spec 011 R5),
 * and switching the unit converts what was typed exactly instead of clearing it.
 */
export default function RateInput({ label, value, unit, onChange, error, placeholder, autoFocus }: Props) {
  const parsed = value.trim() ? parseRateInput(value, unit) : null;

  function switchTo(next: RateUnit) {
    if (next === unit) return;
    const converted = parsed?.ok ? paisePerKgToInput(parsed.paisePerKg, next) : value;
    onChange(converted, next);
  }

  const seg = (u: RateUnit, text: string) => (
    <button
      type="button"
      onClick={() => switchTo(u)}
      aria-pressed={unit === u}
      className={`px-3 py-2 text-sm border first:rounded-l-lg last:rounded-r-lg -ml-px first:ml-0 ${
        unit === u ? "bg-stone-900 text-white border-stone-900" : "bg-white border-stone-300"
      }`}
    >
      {text}
    </button>
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-sm font-medium w-28">{label}</span>
        <div className="flex">
          {seg("gram", "per gram")}
          {seg("kg", "per kg")}
        </div>
        <input
          className={`${inputClass} flex-1 min-w-36 max-w-56`}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value, unit)}
          placeholder={placeholder ?? (unit === "gram" ? "e.g. 12,000" : "e.g. 1,20,00,000")}
          aria-label={`${label} rate ${unit === "gram" ? "per gram" : "per kg"}`}
          autoFocus={autoFocus}
        />
      </div>
      <div className="text-xs pl-0 sm:pl-[7.5rem] min-h-4">
        {error ? (
          <span role="alert" className="text-red-700">
            {error}
          </span>
        ) : parsed?.ok ? (
          <span className="text-stone-600">
            {formatPerKg(parsed.paisePerKg)} per kg · {formatPerGram(parsed.paisePerKg)} per gram
          </span>
        ) : parsed ? (
          <span className="text-amber-800">{parsed.message}</span>
        ) : null}
      </div>
    </div>
  );
}
