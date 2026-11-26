/**
 * The `max_amount_in` for an exact-output request: a dry run's `quote.amount_in` plus 1%.
 *
 * The provider checks the ceiling against a fresh quote at dispatch, and that quote may need a
 * little more input than the dry run's. Input the request does not spend returns to the balance,
 * but limits, the USD budget and the balance check count the whole ceiling.
 */
export function maxAmountIn(quote: { amount_in?: string }): string {
  if (quote.amount_in === undefined) throw new Error("The dry run's quote has no amount_in");
  return ((BigInt(quote.amount_in) * 101n) / 100n).toString();
}
