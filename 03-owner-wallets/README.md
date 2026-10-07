# 03 · Owner wallets

The API is owner-agnostic: NEAR account, EVM key or passkey, the flow is the same and only the
signing adapter differs. Choose by where the owner's key lives.

| Owner | Signs with | Standards | This folder |
|---|---|---|---|
| NEAR account | ed25519 key in a NEAR wallet | NEP-413 (consent), NEP-366 (on-chain delegate) | `near/` |
| EVM wallet | secp256k1 key in an EVM wallet | EIP-712 | `evm/` |
| Passkey | platform authenticator (P-256) | WebAuthn | `passkey/` (browser template) |

## Which standard will the server ask for?

The API decides, and `intent.standard` tells you. Never assume:

| Action | NEAR | EVM | Passkey |
|---|---|---|---|
| Create agent, provider policy change, freeze/unfreeze | `nep366` | `eip712` | `webauthn` |
| Update of destinations, budget, timelock or schedule only, grant issue/revoke, approval, archive | `nep413` | `eip712` | `webauthn` |

`nep366` and the EVM/passkey wallet requests are **on-chain** and gasless for the owner: the API's
sponsor submits them. `nep413` and its EVM/passkey consent counterparts are pure off-chain
signatures. A policy update that changes only what the API enforces (`destinations`, `budget`,
`timelock_ms`, `schedule`) returns `transaction_hash: null` on success.

## NEAR owner

Two runnable examples need an owner ed25519 key and its NEAR account (FullAccess not required —
the API sponsors dispatch):

- `near/01-policy-local.ts` — change budget and timelock only: NEP-413, no transaction.
- `near/02-policy-provider.ts` — change what the custody provider enforces (actions, limits):
  NEP-366 delegate, submitted by the sponsor.

## EVM owner

`viem` derives everything from one private key. The API derives a `0s` NEAR account from the
public key and deploys it on first use, sponsored — an EVM owner never needs a NEAR account or
NEAR funds.

- `evm/01-create-agent.ts` — create an agent entirely from an EVM key.
- `evm/02-policy-update.ts` — update rules with an EIP-712 signature.

## Passkey owner (browser template)

WebAuthn ceremonies require a browser and a real authenticator, so they cannot run headless. The
`passkey/` folder is an illustrative, copy-paste template for your frontend plus the backend
calls it needs. See [`passkey/README.md`](passkey/README.md).

Next: [04 · Grants](../04-grants/README.md).
