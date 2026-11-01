import type { ReactNode } from "react";
import { formatMoney, type SettingsSnapshot } from "@jewellery/shared";

/** A header snapshot: what was saved with the document (spec 003 R5). Older documents fall back to current settings. */
export type Header = SettingsSnapshot;

/** The business monogram: initials in a diamond, used when no logo is uploaded (spec 014 R9). */
export function Monogram({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "BJ";
  return (
    <svg className="monogram" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="10" y="10" width="44" height="44" transform="rotate(45 32 32)" fill="none" stroke="#b08a3e" strokeWidth="2" />
      <text x="32" y="40" textAnchor="middle" fontSize="20" fontFamily="Cormorant Garamond, Georgia, serif" fill="#b08a3e">{initials}</text>
    </svg>
  );
}

export function Brand({ header }: { header: Header }) {
  const b = header.business;
  return (
    <div className="flex items-center gap-3">
      {header.logo ? <img src={header.logo.dataUrl} alt="" className="h-14 object-contain" /> : <Monogram name={b.legalName} />}
      <div>
        <div className="serif text-[20pt] leading-none tracking-wide" style={{ color: "var(--print-ink)" }}>{b.legalName.toUpperCase()}</div>
        <div className="text-[7pt] tracking-[0.2em] mt-1" style={{ color: "var(--print-gold)" }}>{b.tagline}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="value">{children || "-"}</div>
    </div>
  );
}

export const money = (paise: number) => formatMoney(paise);
