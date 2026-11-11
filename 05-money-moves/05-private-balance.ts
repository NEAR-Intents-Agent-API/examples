/**
 * Read both balances and move legacy public funds into the confidential balance.
 *
 * What: shows the confidential balance (the account) and the legacy public balance, shields
 *       `AGENT_TRANSFER_AMOUNT` of `AGENT_TOKEN` from public to confidential when the public balance
 *       holds it, and previews the other way out: a withdrawal with `confidential: false`.
 * When: an agent still holds funds on the public NEAR Intents balance.
 * Needs: `AGENT_ALLOW_WRITES=true`, `AGENT_ID`, `AGENT_RECIPIENT`, a stored grant, and a policy with
 *        `confidential: true` (the withdrawal preview also needs `withdraw` and its destination).
 * Run: `pnpm 05:private-balance`
 *
 * The confidential balance is the account: swaps, limit orders, transfers and deposit addresses use
 * it, and `getBalances` reads it unless you pass `source: "public"`. The public balance is a legacy
 * balance with only two ways out. `shield` moves it into the confidential balance, and a withdrawal
 * with `confidential: false` pays it to a chain address. `unshield` (confidential to public) is
 * always refused, and so is `confidential: false` on a swap, limit order, transfer or deposit
 * address (`public_balance_exit_only`).
 *
 * `available_raw` is what each balance can spend now (the balance minus queued or timelocked work
 * not yet dispatched); it is the API's figure, so do not subtract pending work yourself. Shield
 * moves value between the agent's own balances and names no recipient, so the policy's
 * `destinations` rule does not apply to it; `confidential: true` is what allows it.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { settleExecution } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";

async function balances(api: ReturnType<typeof agentApi>, agentId: string) {
  const [confidentialBalances, publicBalances] = await Promise.all([
    api.getBalances(agentId),
    api.getBalances(agentId, { source: "public" }),
  ]);
  const view = (list: typeof publicBalances.balances) =>
    list.map((entry) => ({
      asset_id: entry.asset_id,
      balance_raw: entry.balance_raw,
      available_raw: entry.available_raw,
    }));
  return {
    confidential: view(confidentialBalances.balances),
    legacy_public: view(publicBalances.balances),
  };
}

export async function movePrivate(agentId: string) {
  const settings = config();
  const api = agentApi();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");
  const stored = await loadGrant(agentId);
  const bot = api.forGrant(stored.token);

  const before = await balances(api, agentId);
  const legacy = before.legacy_public.find((entry) => entry.asset_id === settings.token);
  const shieldable =
    legacy !== undefined && BigInt(legacy.available_raw) >= BigInt(settings.transferAmount);

  const shielded = shieldable
    ? await settleExecution(
        api,
        bot.shield(
          agentId,
          { asset: settings.token, amount: settings.transferAmount },
          { idempotencyKey: `${crypto.randomUUID()}-shield` },
        ),
      )
    : undefined;

  // The other way out: pay the legacy public balance to a chain address. A dry preview moves
  // nothing; drop `dry` (and keep the same destination in the policy) to withdraw for real.
  const publicExit = await bot.withdraw(agentId, {
    asset: settings.token,
    amount: settings.transferAmount,
    chain: "near",
    recipient,
    confidential: false,
    dry: true,
  });

  return {
    shield: shielded
      ? { status: shielded.status, failure_code: shielded.failure_code }
      : "skipped: the public balance holds less than AGENT_TRANSFER_AMOUNT of AGENT_TOKEN",
    public_withdrawal_preview: { quote: publicExit.quote, warnings: publicExit.warnings },
    balances: await balances(api, agentId),
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("shielding legacy public funds");
  banner(["Reading both balances and shielding legacy public funds…"]);
  void movePrivate(required(config().agentId, "AGENT_ID")).then(print);
}
