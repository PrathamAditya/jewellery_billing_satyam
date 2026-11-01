import type { ReactNode } from "react";

export const inputClass = "border border-stone-300 rounded-lg px-3 py-2 text-base font-normal w-full bg-white";
/** Edit, New, Void and Restore are hidden on phones: Android is view-only in v1 (decision D5). */
export const pcOnly = "max-md:hidden";

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      {children}
      {hint && !error && <span className="text-xs font-normal text-stone-500">{hint}</span>}
      {error && (
        <span role="alert" className="text-xs font-normal text-red-700">
          {error}
        </span>
      )}
    </label>
  );
}

export function Alert({ kind = "error", children }: { kind?: "error" | "info" | "ok"; children: ReactNode }) {
  const cls =
    kind === "error"
      ? "text-red-700 bg-red-50 border-red-200"
      : kind === "ok"
        ? "text-green-800 bg-green-50 border-green-200"
        : "text-amber-900 bg-amber-50 border-amber-200";
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`text-sm border rounded-lg px-3 py-2 ${cls}`}>
      {children}
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-start sm:items-center justify-center p-4 z-20 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg bg-white rounded-xl shadow-lg p-5 flex flex-col gap-4 my-auto">
        <h2 className="text-xl font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export const btnPrimary = "px-4 py-2 rounded-lg bg-stone-900 text-white font-medium disabled:opacity-60";
export const btnSecondary = "px-4 py-2 rounded-lg border border-stone-300 bg-white";
