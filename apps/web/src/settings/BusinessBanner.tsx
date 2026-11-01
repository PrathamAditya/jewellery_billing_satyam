import { useEffect, useState } from "react";
import type { SettingsSnapshot } from "@jewellery/shared";
import { Alert } from "../customers/ui";
import { getSettings } from "./api";

/** Spec 003 section 4: shown while the business details that print on documents are still blank. */
export function missingBusinessDetails(s: SettingsSnapshot): string[] {
  const missing: string[] = [];
  if (!s.business.legalName.trim()) missing.push("legal name");
  if (!s.business.gstin) missing.push("GSTIN");
  if (!s.business.addressLines.some((l) => l.trim())) missing.push("address");
  return missing;
}

export default function BusinessBanner() {
  const [missing, setMissing] = useState<string[] | null>(null);
  useEffect(() => {
    getSettings()
      .then((s) => setMissing(missingBusinessDetails(s)))
      .catch(() => setMissing(null));
  }, []);
  if (!missing || missing.length === 0) return null;
  return (
    <a href="#/settings" className="block">
      <Alert kind="info">
        Business details are not filled in yet ({missing.join(", ")}). Printed documents will be missing them. <span className="underline">Fill them in Settings</span>.
      </Alert>
    </a>
  );
}
