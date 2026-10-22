# 07 · Native accounts

Every agent wallet also has its own keys outside NEAR Intents: its NEAR account
(`wallet.near_account_id`), one EVM address for every EVM chain (`wallet.evm_account_id`) and a
Solana address (`wallet.solana_account_id`). The owner switches them on one method at a time in the
policy's `native` block. These examples cover the two most common uses: signing NEP-413 messages (site logins) with the
agent's NEAR key, and signing EIP-712 typed data for an app under one listed domain.

| Example | Run | What it shows |
|---|---|---|
| `01-enable-native.ts` | `pnpm 07:enable-native [evm]` | Owner lists a service in `near.sign_message` (and with `evm` a typed-data domain), with the warning to show |
| `02-sign-and-verify.ts` | `pnpm 07:sign-and-verify` | Both sides: issue a login request, sign it under a grant, verify it |
| `03-evm-typed-data.ts` | `pnpm 07:evm-typed-data` | Sign typed data under the listed domain, recover the signer; another domain is refused |
| `04-refusals.ts` | `pnpm 07:refusals` | Every refusal code, including `intents.near`/`intents.far` |
| `05-disable-native.ts` | `pnpm 07:disable-native [all]` | Remove one service, or omit `native` to turn everything off |

Set `AGENT_SIGN_RECIPIENT` in `.env` to the NEAR account or domain of the service the agent logs in to.

## Off until the owner turns it on

`native` is optional and new policies leave it out. When present, every key is required:

```ts
native: {
  near: { sign_message: ["login.example.near"], transfer: false, call: [] },
  evm: { sign_typed_data: [{ name: "Example", version: "1", chain_id: 42161 }], sign_message: false, sign_transaction: false },
  solana: { sign_message: false, sign_transaction: false },
}
```

| Switch | Route (`POST /v1/agents/{agent_id}/native/…`) | SDK |
|---|---|---|
| `near.sign_message` (services) | `near/sign-message` | `nativeNearSignMessage` |
| `near.transfer` | `near/transfer` (Idempotency-Key) | `nativeNearTransfer` |
| `near.call` (contracts) | `near/call` (Idempotency-Key) | `nativeNearCall` |
| `evm.sign_typed_data` (domains) | `evm/sign-typed-data` | `nativeEvmSignTypedData` |
| `evm.sign_message` | `evm/sign-message` | `nativeEvmSignMessage` |
| `evm.sign_transaction` | `evm/sign-transaction` | `nativeEvmSignTransaction` |
| `solana.sign_message` | `solana/sign-message` | `nativeSolanaSignMessage` |
| `solana.sign_transaction` | `solana/sign-transaction` | `nativeSolanaSignTransaction` |

- **Omitted** means every method is off. A policy update replaces the whole policy, so leaving
  `native` out of an update turns it off (`05-disable-native.ts`).
- **The wallet provider enforces it**, so changing `native` is an on-chain policy change (`nep366`
  for NEAR owners, sponsored by the API) and the 10-minute policy cooldown applies.
- **Any live grant** may use a switched-on method. Revoke the grant to stop one caller.
- **The switch is the whole fence.** `destinations`, `budget`, `timelock_ms`, `schedule` and
  `owner_approval` do not apply. A native NEAR transfer can go to any account, and signed typed
  data (a permit, a `TransferWithAuthorization`) or a signed transaction can move everything at
  that EVM or Solana address.
- **Signing never broadcasts.** The signing routes return the signature; the caller hands it to
  the app or sends the transaction. Every request is recorded in history as type `native`.
- **Only transactions are signed as transactions.** `evm/sign-transaction` takes one serialized
  unsigned EIP-2718 typed or EIP-155 legacy transaction whose chain id is `chain`'s;
  `solana/sign-transaction` takes one legacy or v0 transaction message. Anything else is
  `validation_failed`, so neither route signs an arbitrary message.

Show the owner a warning before they sign a policy that turns on native methods; `01` exports
`nativeWarning` as an example. The signed policy preview also lists every switch that is on.

## Typed-data domains

A request's EIP-712 `domain` must equal one entry of `evm.sign_typed_data` field for field: a
missing or extra field, another `chainId` or another `verifyingContract` is a different domain and
is refused with `native_method_denied`. `chainId` may be a number, a decimal or a hex string.
`types.EIP712Domain` may be omitted, and the API derives it; when sent it must declare exactly the
domain's fields in EIP-712 order. List domains as narrowly as the app allows: Hyperliquid's
`Exchange` domain (trading) never signs a `HyperliquidSignTransaction` withdrawal.

## Never the NEAR Intents contracts

`intents.near` and `intents.far` can never be listed. A policy listing them is refused with
`validation_failed`, a sign request naming them with `403 signing_recipient_forbidden`, and a
native transfer or call to them with `403 native_contract_forbidden`, before the policy is read.
The NEP-413 payload cannot parse as an intent either: it is a message, a recipient and a nonce
under a fixed tag, with no `signer_id`, `deadline` or `intents`.

## The login request

The relying party (the service the agent logs in to) issues three things; the agent's backend sends
them unchanged:

| Field | Meaning |
|---|---|
| `message` | What the service asks the agent to sign (UTF-8, or `encoding: "hex"` for raw bytes) |
| `recipient` | The service's NEAR account or domain; must be listed in `native.near.sign_message` |
| `nonce` | 32 random bytes, base64 (44 characters); the service accepts each once |

The response carries `near_account_id`, `public_key`, the base64 `signature` and the echoed
`nonce` and `recipient`. `callbackUrl` is not supported. The API verifies the signature against the
NEP-413 payload before returning it.

`support/identity.ts` builds login requests (`loginRequest`) and verifies signatures (`verifyLogin`):
the NEP-413 digest, the ed25519 signature, the nonce, and that the key is a full-access key of the
account on chain (or the key an implicit account is derived from).

## Refusals

| Code | Status | Meaning |
|---|---|---|
| `signing_recipient_forbidden` | 403 | `intents.near`/`intents.far` as recipient, whatever the policy says |
| `native_contract_forbidden` | 403 | A native transfer to or call of `intents.near`/`intents.far` |
| `validation_failed` | 400 | Malformed body, e.g. a nonce that is not 32 bytes of base64 |
| `policy_not_ready` | 409 | The latest policy revision is not applied and synced yet |
| `wallet_frozen` | 409 | The owner froze the account |
| `agent_grant_required` | 403 | No live `X-Grant-Token` |
| `signing_policy_denied` | 403 | The recipient is not in `native.near.sign_message` |
| `native_method_denied` | 403 | Any other method whose switch is off, or a contract or domain not listed |

The checks run in that order, so a request with several problems gets the first code.

Next: [08 · Errors and recovery](../08-errors-and-recovery/README.md).
