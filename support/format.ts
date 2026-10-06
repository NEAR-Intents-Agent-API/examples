/**
 * Display helpers. Amounts are always atomic integer strings on the wire; convert only for
 * humans, and only for display. Use `balance_raw` (atomic) for arithmetic and request bodies.
 */

/** Converts atomic units to a whole-token decimal string, exactly, without floating point. */
export function toDecimal(amountRaw: string, decimals: number): string {
  if (!/^[0-9]+$/.test(amountRaw)) throw new Error("amount must be a decimal integer string");
  const padded = amountRaw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const fraction = padded.slice(-decimals);
  return decimals === 0 ? whole : `${whole}.${fraction}`.replace(/\.?0+$/, "");
}

/** Converts a whole-token decimal string to atomic units. */
export function toAtomic(amount: string, decimals: number): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  if (fraction.length > decimals) throw new Error(`amount has more than ${decimals} decimals`);
  return `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
}

/** A short, copy-safe label for ids and hashes. */
export function short(value: string, length = 10): string {
  return value.length <= length * 2 ? value : `${value.slice(0, length)}…${value.slice(-length)}`;
}
