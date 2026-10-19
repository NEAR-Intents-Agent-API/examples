/**
 * Sign EIP-712 typed data with the agent's EVM address, and verify it.
 *
 * What: asks the API to sign typed data under the example domain listed in
 *       `native.evm.sign_typed_data`, recovers the signer with viem, and checks it is
 *       `wallet.evm_account_id`. Then tries the same data under an unlisted domain.
 * When: an app the agent uses (an exchange, a prediction market) authenticates orders or actions
 *       with EIP-712 signatures.
 * Needs: `AGENT_ID`, the example domain listed (`07:enable-native evm`), stored grant
 *        (`04:issue-grant`).
 * Run: `pnpm 07:evm-typed-data`
 *
 * The API returns the signature and never broadcasts anything: the caller hands it to the app.
 * The domain must equal a listed entry field for field, so list domains narrowly. Typed data can
 * authorize transfers (EIP-3009) and approvals (EIP-2612 permits) of anything the address holds,
 * and no money rule applies to it. The address is the same on every EVM chain.
 */
import { AgentApiError } from "@near-intents-agent-api/sdk";
import { recoverTypedDataAddress } from "viem";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";
import { exampleTypedData } from "../support/native.js";

export async function signTypedData(agentId: string) {
  const api = agentApi();
  const delegate = api.forGrant((await loadGrant(agentId)).token);
  const { evm_account_id } = await api.getWallet(agentId);
  if (!evm_account_id) throw new Error("The wallet provider has not reported an EVM address yet");

  const typedData = exampleTypedData(`signed at ${new Date().toISOString()}`);
  const signed = await delegate.nativeEvmSignTypedData(agentId, {
    chain: "arbitrum",
    typed_data: typedData,
  });
  const recovered = await recoverTypedDataAddress({
    ...typedData,
    signature: signed.signature as `0x${string}`,
  });

  // The same data under another chain id is another domain: refused unless that one is listed too.
  let otherDomain: unknown;
  try {
    await delegate.nativeEvmSignTypedData(agentId, {
      chain: "base",
      typed_data: { ...typedData, domain: { ...typedData.domain, chainId: 8453 } },
    });
    otherDomain = { refused: false };
  } catch (error) {
    if (!(error instanceof AgentApiError)) throw error;
    otherDomain = { refused: true, status: error.status, code: error.code };
  }

  return {
    signature: signed,
    verified: recovered.toLowerCase() === evm_account_id.toLowerCase(),
    other_domain: otherDomain,
  };
}

if (isMainModule(import.meta.url)) {
  banner(["Signing EIP-712 typed data with the agent's EVM address…"]);
  void signTypedData(required(config().agentId, "AGENT_ID")).then(print);
}
