import { z } from "zod";

/**
 * The examples' environment, validated once. The API URL and key follow the same rules as the
 * demo and agent-connect apps; everything else is an example input with a safe default.
 *
 * `pnpm <script>` loads `examples/.env` (`tsx --env-file-if-exists=.env`); nothing here reads
 * files. Variables already set in your shell win over `.env`.
 */

const flag = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((value) => value === "true" || value === "1");

const optional = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();

export const exampleEnvSchema = z.object({
  NEAR_INTENTS_AGENT_API_URL: z.url(),
  NEAR_INTENTS_AGENT_API_KEY: z.string().min(8),

  AGENT_OWNER_ACCOUNT_ID: optional,
  AGENT_OWNER_PRIVATE_KEY: optional,
  AGENT_OWNER_EVM_PRIVATE_KEY: optional,

  AGENT_ID: optional,
  AGENT_RECIPIENT: optional,
  AGENT_SIGN_RECIPIENT: optional,
  /** Defaults to `<API host>/log`. Pinned by you, never read from a proof. */
  AGENT_LOG_ORIGIN: optional,
  AGENT_TOKEN: z.string().trim().min(1).default("nep141:wrap.near"),
  AGENT_SWAP_TO: z.string().trim().min(1).default("nep141:usdt.tether-token.near"),
  AGENT_TRANSFER_AMOUNT: z
    .string()
    .regex(/^[0-9]+$/, "atomic token units (a decimal integer)")
    .default("1"),

  AGENT_ALLOW_WRITES: flag,
  AGENT_EXECUTE: flag,
  AGENT_REQUIRE_APPROVAL: flag,
  AGENT_COUNT: z.coerce.number().int().positive().max(20).default(2),
  AGENT_NEAR_RPC_URL: z.url().default("https://free.rpc.fastnear.com"),
});

export type ExampleEnv = z.infer<typeof exampleEnvSchema>;

export function parseExampleEnv(environment: Record<string, string | undefined> = process.env) {
  // An empty `KEY=` line in .env means "not set", so the default applies.
  const present = Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const result = exampleEnvSchema.safeParse(present);
  if (!result.success)
    throw new Error(
      `Invalid examples configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}. See .env.example.`,
    );
  const url = new URL(result.data.NEAR_INTENTS_AGENT_API_URL);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("HTTPS API URL required");
  if (url.pathname !== "/") throw new Error("NEAR_INTENTS_AGENT_API_URL must be an origin, without a path");
  return result.data;
}
