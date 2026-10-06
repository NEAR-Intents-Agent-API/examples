import type { Destination, OwnerWallet, Policy } from "@near-intents-agent-api/sdk";
import { intentsAccount } from "./destinations.js";

/**
 * Policy builders.
 *
 * A policy is the owner's rulebook for one agent account. Every connection to the account (your
 * backend, a dashboard session, an AI assistant) holds its own grant, which says only who may
 * act; the policy says what any of them may do, where funds may go and how much. Turning on an
 * action or adding a destination is one signature and every grant can use it at once, without a
 * new grant.
 *
 * The policy is always sent complete; every field is required:
 * - `frozen`: a frozen account refuses every action until the owner unfreezes it.
 * - `actions`: any of `swap`, `transfer`, `withdraw`. Deposits are always allowed and deletion is
 *   owner-only.
 * - `confidential`: also allows shielding, unshielding and the confidential form of each action.
 * - `owner_approval`: outgoing money actions (not deposits) wait for the owner's approval vote (NEAR owners only).
 * - `assets`: `"any"`, or the exact asset ids the agent may touch.
 * - `limits`: optional per-asset caps (`per_transaction`, `hourly`, `daily`, `monthly`) in atomic
 *   units.
 * - `max_actions_per_hour`: a cap on money actions per hour, or `null` for none.
 * - `destinations`: `{ mode: "any" | "only" | "except", list }`.
 * - `budget`: USD caps over rolling day, week and month windows across every asset, or `null`.
 * - `timelock_ms`: how long every delegated action waits before it runs (0 to 30 days).
 */

const noBudget = { daily_usd: null, weekly_usd: null, monthly_usd: null };

/**
 * A tight starter policy: one token, one destination, transfers only. The owner can still delete
 * the account later. Use it for the first onboarding example.
 */
export function transferPolicy(input: {
  owner: OwnerWallet;
  /** The only NEAR Intents account this agent may send to. */
  recipient: string;
  token?: string;
  /** Every transfer waits for the owner's approval (NEAR owners only). */
  requireApproval?: boolean;
}): Policy {
  const token = input.token ?? "nep141:wrap.near";
  const requireApproval = input.requireApproval ?? false;
  if (requireApproval && input.owner.type !== "near")
    throw new Error("Owner approval requires a NEAR owner");
  return {
    frozen: false,
    actions: ["transfer"],
    confidential: false,
    owner_approval: requireApproval,
    assets: [token],
    limits: { per_transaction: { [token]: "1000000000000000000000000" } },
    max_actions_per_hour: null,
    destinations: { mode: "only", list: [intentsAccount(input.recipient)] },
    budget: noBudget,
    timelock_ms: 0,
  };
}

/**
 * A broad policy that allows every flow NEAR Intents offers, capped per token and in USD. This is
 * the shape an owner picks when the agent should be genuinely useful, with a hard ceiling.
 *
 * `budget` windows are rolling and enforced by the API in one ledger shared by every grant.
 * `null` leaves a window uncapped. `budget` and `timelock_ms` are enforced by the API itself, so
 * changing only them needs one signature but no blockchain transaction.
 */
export function fullAccessPolicy(input: {
  /** Per-transaction cap, atomic units, applied to each listed asset. */
  perTransaction?: string;
  /** Asset ids, or `"any"` for every token. */
  assets?: "any" | string[];
  /** Where funds may go; `"any"` allows every destination. Empty keeps funds inside the account. */
  destinations?: Destination[] | "any";
  budget?: { daily_usd: string | null; weekly_usd: string | null; monthly_usd: string | null };
  /** Milliseconds every money action waits before dispatch (0 to 2 592 000 000). */
  timelockMs?: number;
  frozen?: boolean;
  /** Every money action waits for the owner's approval (NEAR owners only). */
  ownerApproval?: boolean;
}): Policy {
  const assets = input.assets ?? "any";
  const perTransaction = input.perTransaction ?? "1000000000000000000000000";
  const destinations = input.destinations ?? [];
  return {
    frozen: input.frozen ?? false,
    actions: ["swap", "transfer", "withdraw"],
    confidential: true,
    owner_approval: input.ownerApproval ?? false,
    assets,
    // Per-asset caps need named assets; with `"any"` rely on the USD budget instead.
    limits:
      assets === "any"
        ? {}
        : { per_transaction: Object.fromEntries(assets.map((asset) => [asset, perTransaction])) },
    max_actions_per_hour: null,
    destinations:
      destinations === "any" ? { mode: "any", list: [] } : { mode: "only", list: destinations },
    budget: input.budget ?? noBudget,
    timelock_ms: input.timelockMs ?? 0,
  };
}
