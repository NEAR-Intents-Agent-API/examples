# 07 · Native accounts

Every agent wallet also has its own keys outside NEAR Intents: its NEAR account
(`wallet.near_account_id`), one EVM address for every EVM chain (`wallet.evm_account_id`) and a
Solana address (`wallet.solana_account_id`). The owner switches them on one method at a time in the
policy's `native` block. These examples cover the common uses: signing NEP-413 messages (site logins) with the
agent's NEAR key, signing EIP-712 typed data for an app under one listed domain, paying a 1Click
deposit from the EVM key's Intents account, and Solana sign-in and transfers.

| Example | Run | What it shows |
|---|---|---|
| `01-enable-native.ts` | `pnpm 07:enable-native [evm]` | Owner lists a service in `near.sign_message` (and with `evm` a typed-data domain), with the warning to show |
| `02-sign-and-verify.ts` | `pnpm 07:sign-and-verify` | Both sides: issue a login request, sign it under a grant, verify it |
| `03-evm-typed-data.ts` | `pnpm 07:evm-typed-data` | Sign typed data under the listed domain, recover the signer; another domain is refused |
| `04-refusals.ts` | `pnpm 07:refusals` | Every refusal code, including `intents.near`/`intents.far` |
| `05-disable-native.ts` | `pnpm 07:disable-native [all]` | Remove one service, or omit `native` to turn everything off |
| `06-enable-sign-intent.ts` | `pnpm 07:enable-sign-intent` | Owner sets `evm.sign_intent`: 1Click deposits and one payout address |
| `07-sign-intent-deposit.ts` | `pnpm 07:sign-intent-deposit [withdraw]` | Quote at 1Click, sign the payload with the EVM key, publish `signed_data` (dry unless `AGENT_EXECUTE=true`) |
| `08-enable-solana.ts` | `pnpm 07:enable-solana` | Owner lists a sign-in domain and turns on `sign_transfer` for one recipient |
| `09-solana-sign-in-and-transfer.ts` | `pnpm 07:solana` | Sign-In-With-Solana and one signed SOL transfer; nothing is broadcast |

Set `AGENT_SIGN_RECIPIENT` in `.env` to the NEAR account or domain of the service the agent logs in to
(for Solana, a lowercase domain). `06`–`09` also read `AGENT_WITHDRAW_ADDRESS` (an address on
Base), `AGENT_SOLANA_RECIPIENT`, `AGENT_SOLANA_RPC_URL` and the optional `ONE_CLICK_API_KEY`.

## Off until the owner turns it on

`native` is optional and new policies leave it out. When present, every key is required except the Solana and EVM switches added later
(`evm.sign_intent`, `solana.sign_in`, `solana.sign_intent`, `solana.sign_transfer`), which are off
when left out:

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
| `evm.sign_intent` (rules) | `evm/sign-intent` | `nativeEvmSignIntent` |
| `evm.sign_transaction` | `evm/sign-transaction` | `nativeEvmSignTransaction` |
| `solana.sign_in` (domains) | `solana/sign-in` | `nativeSolanaSignIn` |
| `solana.sign_message` | `solana/sign-message` | `nativeSolanaSignMessage` |
| `solana.sign_intent` (rules) | `solana/sign-intent` | `nativeSolanaSignIntent` |
| `solana.sign_transfer` | `solana/sign-transfer` | `nativeSolanaSignTransfer` |
| `solana.sign_transaction` | `solana/sign-transaction` | `nativeSolanaSignTransaction` |

- **Omitted** means every method is off. A policy update replaces the whole policy, so leaving
  `native` out of an update turns it off (`05-disable-native.ts`).
- **The wallet provider enforces it**, so changing `native` is an on-chain policy change (`nep366`
  for NEAR owners, sponsored by the API) and the 10-minute policy cooldown applies.
- **Any live grant** may use a switched-on method. Revoke the grant to stop one caller.
- **The switch is nearly the whole fence.** NEAR a native transfer sends, or a call attaches as its
  deposit, goes only where `destinations` allows (`policy_destination_denied`). `budget`,
  `timelock_ms`, `schedule` and `owner_approval` do not apply. A NEAR call can move anything the
  listed contract holds for the agent, and signed typed data (a permit, a
  `TransferWithAuthorization`) or a signed transaction can move everything at that EVM or Solana
  address.
- **Signing never broadcasts.** The signing routes return the signature once; the caller hands it
  to the app or sends the transaction. Every request is recorded in history as type `native`, with
  `signature: null`.
- **A NEAR transfer or call settles on chain.** It reads `SUCCESS` only once NEAR finalizes the
  transaction the request asked for; a failed one reads `FAILED` (`native_transaction_failed`), and
  one that does not match the request, or is still unknown 30 minutes after dispatch, reads
  `NEEDS_REVIEW`. It spends NEAR on the agent's own account: when the account holds less than the
  call costs, it is refused with `custody_native_balance_required` (`balance` layer), and the
  error's `availableAmount` and `minAmount` state what the account holds and what the call costs,
  in yoctoNEAR.
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

## Signing NEAR Intents payloads

The EVM and Solana keys sign a NEAR Intents payload (canonical JSON text, `transfer` intents only,
`signer_id` = that key's Intents account) only through `sign-intent`; `sign-message` refuses one
with `intents_payload_use_sign_intent`. The owner's rules are the key's own, and `destinations`,
`assets`, `limits`, `budget`, `timelock_ms`, `schedule` and `owner_approval` do not apply:

```ts
sign_intent: {
  receivers: [],                     // accounts a transfer may pay directly
  one_click_deposits: true,          // 1Click deposits that pay the key or a receiver and refund the key
  withdrawals: [{ chain: "base", address: "0x…" }], // 1Click deposits that pay out here (optional)
  max_slippage_bps: 100,             // slippage plus 1Click's own fee, 0 to 300 (default 100)
}
```

A transfer to a 1Click deposit address is checked against 1Click's live status for it: the quote
must be `PENDING_DEPOSIT`, refund the key, pay the key, a receiver or a listed withdrawal address,
carry no other app fee, rebate or custom message, and be paid with exactly its `amountIn`. A
payload paying only such deposits may be due up to 96 hours ahead (1Click's `generate-intent`
writes the quote's deadline); any other payload within 300 seconds. `07` shows the whole flow:
quote with `dry: false`, `generate-intent`, `nativeEvmSignIntent`, then publish `signed_data` as is
(1Click `submit-intent`, `intents.near` or a solver relay).

A signed payload can be published by anyone who holds it until its deadline. **Freezing the account
refuses new payloads but cannot recall one already signed.** List only the owner's own addresses in
`withdrawals`, and sign payloads that are due soon.

## Solana sign-in and transfers

`solana.sign_in` lists domains. `solana/sign-in` takes the fields of the wallet standard's `signIn`
input for a listed domain; the API writes the Sign-In-With-Solana message itself and returns it as
`signed_message` next to the signature. `solana.sign_transfer` signs one SOL or SPL transfer
(`{ unsigned_tx, recipient }`) when `destinations` allows `recipient` as a `withdraw` on chain
`sol`; anything but that one transfer is refused with `solana_transaction_forbidden`. Neither
needs `solana.sign_message` or `solana.sign_transaction`, which give full control of the address.
Amounts are not checked yet: `sign_transfer` fences where funds go, not how much.

## Never the NEAR Intents contracts

`intents.near` and `intents.far` can never be listed for the NEAR key. A policy listing them is
refused with `validation_failed`, a sign request naming them with `403 signing_recipient_forbidden`,
and a native transfer or call to them with `403 native_contract_forbidden`, before the policy is
read. The EVM and Solana keys reach them only through `sign-intent`.
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
