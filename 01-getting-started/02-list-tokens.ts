/**
 * List the assets agents can hold and trade.
 *
 * What: reads the public token catalog and shows how to find a token's decimals and USD price.
 * When: before any swap, transfer or withdraw — every execution takes an `asset_id` from here.
 * Needs: nothing: `GET /v1/tokens` is public, so this example uses plain fetch, no API key.
 * Run: `pnpm 01:list-tokens`
 *
 * Amounts on the wire are atomic integer strings in the token's smallest unit. Use `decimals` to
 * convert for display; never send a whole-token decimal to the API.
 */

import type { TokenView } from "@near-intents-agent-api/sdk";
import { banner, config, isMainModule, print } from "../support/config.js";
import { toDecimal } from "../support/format.js";
import { rawRequest } from "../support/raw-http.js";

export async function listTokens(assetId?: string) {
  const { data: tokens } = await rawRequest<{ data: TokenView[] }>({
    path: "/v1/tokens",
    allowMissingKey: true,
  });
  const wanted = tokens.find((token) => token.asset_id === assetId);
  return {
    count: tokens.length,
    sample: tokens.slice(0, 8).map((token) => ({
      asset_id: token.asset_id,
      symbol: token.symbol,
      blockchain: token.blockchain,
      decimals: token.decimals,
      price: token.price,
      price_expires_at: token.price_expires_at,
    })),
    ...(wanted
      ? {
          selected: {
            ...wanted,
            one_token_atomic: `1${"0".repeat(wanted.decimals)}`,
            example_display: toDecimal(
              `1234567${"0".repeat(Math.max(0, wanted.decimals - 6))}`,
              wanted.decimals,
            ),
          },
        }
      : {}),
  };
}

if (isMainModule(import.meta.url)) {
  banner([`Reading the public token catalog (looking up ${config().token})…`]);
  void listTokens(config().token).then(print);
}
