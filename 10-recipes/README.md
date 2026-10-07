# 10 · Recipes

Composite patterns that assemble the pieces into real integrations.

| Recipe | Run | What it assembles |
|---|---|---|
| `01-bff-pattern.ts` | `pnpm 10:bff-pattern` | Backend-for-frontend: key stays server-side, browser signs only |
| `02-timelocked-payout.ts` | `pnpm 10:timelocked-payout` | Execution delay, scheduled executions, cancellation (leaves the delay set; policy edits are 10 min apart) |
| `03-ai-assistant.ts` | `pnpm 10:ai-assistant` | One grant per assistant session; mapping tools to actions |
| `04-full-journey.ts` | `pnpm 10:full-journey` | Create → fund → grant → swap → withdraw → audit, end to end |

## The one architectural rule

```
Browser                          Your backend                      Agent API
  │  "create agent"                   │                                │
  ├──────────────────────────────────▶│ POST /v1/generate-intent       │
  │                                   ├───────────────────────────────▶│
  │  { correlation_id, preview,        │◀───────────────────────────────┤
  │    intent: {standard, payload} }  │                                │
  │◀──────────────────────────────────┤                                │
  │  wallet signs payload             │                                │
  ├──────────────────────────────────▶│ POST /v1/submit-intent         │
  │                                   ├───────────────────────────────▶│
```

The API key (`naa_…`) and grant tokens (`ngt_…`) live only on the backend. The browser receives
the prepared payload and returns the wallet's signature. The API alone authorizes actions.

Next: [11 · Verify operations](../11-verify-operations/README.md).
