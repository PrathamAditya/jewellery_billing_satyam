/** Spec 020: how a purity from the invoice list is written on the screens. */
export function purityLabel(purity: string): string {
  if (purity === "silver") return "Silver";
  if (purity === "other") return "Other";
  return purity;
}
