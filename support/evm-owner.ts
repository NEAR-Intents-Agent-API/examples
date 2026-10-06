import type { GenerateIntentResponse, OwnerWallet, SignedData } from "@near-intents-agent-api/sdk";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { config, required } from "./config.js";

type EvmOwnerWallet = Extract<OwnerWallet, { type: "evm" }>;

/**
 * The EVM owner wallet.
 *
 * One private key is enough: the API derives a deterministic `0s` NEAR account from the public
 * key, deploys it on first use (sponsored), and verifies EIP-712 signatures against it. The owner
 * never needs a NEAR account or NEAR funds.
 *
 * In production the key lives in the owner's EVM wallet (MetaMask, Rabby, …) and your frontend
 * calls `walletClient.signTypedData`. This module does the same with `viem` for a script.
 */
export function loadEvmOwner(privateKeyHex?: string) {
  const key = privateKeyHex ?? required(config().ownerEvmPrivateKey, "AGENT_OWNER_EVM_PRIVATE_KEY");
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
  return { account, owner: evmOwnerWallet(account) };
}

/**
 * The public owner descriptor sent with `agent_create`.
 *
 * `public_key` is the uncompressed secp256k1 point without the `04` prefix (64 bytes). `address`
 * and `public_key` must match; `chain_id` is the owner's wallet chain (1 = Ethereum mainnet; the
 * API binds the identity, not the chain).
 */
export function evmOwnerWallet(account: PrivateKeyAccount, chainId = 1): EvmOwnerWallet {
  return {
    type: "evm",
    address: account.address.toLowerCase() as `0x${string}`,
    chain_id: chainId,
    public_key: `0x${account.publicKey.slice(4)}` as `0x${string}`,
  };
}

/**
 * Signs a generated EVM intent with EIP-712, exactly as an injected wallet's
 * `eth_signTypedData_v4` would. The payload is signed unchanged.
 */
export async function signEvmIntent(
  account: PrivateKeyAccount,
  generated: GenerateIntentResponse,
): Promise<SignedData> {
  const { intent } = generated;
  if (intent.standard !== "eip712") throw new Error("evm_signing_standard_required");
  const signature = await account.signTypedData(intent.payload as never);
  return { ...intent, signature };
}

export type { PrivateKeyAccount };
