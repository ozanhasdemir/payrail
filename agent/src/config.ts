import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

// Load the nearest .env walking up from cwd, so `pnpm --filter @payrail/agent ...` and running
// from the repo root both find the single root .env.
for (let dir = process.cwd(); ; dir = dirname(dir)) {
  const candidate = join(dir, ".env");
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
  if (dirname(dir) === dir) break;
}

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const schema = z.object({
  // Arc
  ARC_RPC_URL: z.string().url().default("https://rpc.testnet.arc.io"),
  ARC_CHAIN_ID: z.coerce.number().default(5042002),
  ARC_EXPLORER_URL: z.string().url().default("https://testnet.arcscan.app"),
  DEPLOYER_PRIVATE_KEY: hex.optional(),

  // Contracts
  INVOICE_REGISTRY_ADDRESS: address,
  RECEIVABLE_TOKEN_ADDRESS: address,
  EARLY_PAY_POOL_ADDRESS: address,

  // Privy
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),
  PRIVY_AUTHORIZATION_PRIVATE_KEY: z.string().min(1),
  PRIVY_BUYER_WALLET_ID: z.string().min(1),
  PRIVY_BUYER_WALLET_ADDRESS: address,
  PRIVY_TREASURY_WALLET_ID: z.string().optional(),
  PRIVY_TREASURY_WALLET_ADDRESS: address.optional(),
  PRIVY_APPROVER1_PRIVATE_KEY: z.string().optional(),
  PRIVY_APPROVER2_PRIVATE_KEY: z.string().optional(),

  // ENS
  SEPOLIA_RPC_URL: z.string().url().default("https://ethereum-sepolia-rpc.publicnode.com"),
  ENS_COMPANY_NAME: z.string().default("payrail.eth"),
  ENS_OWNER_PRIVATE_KEY: hex.optional(),
  ENS_PAYRAIL_RESOLVER: address.optional(),

  // World
  WORLD_APP_ID: z.string().optional(),
  WORLD_RP_ID: z.string().optional(),
  WORLD_RP_SIGNING_KEY: z.string().optional(),
  WORLD_ACTION_ID: z.string().default("supplier-onboarding"),

  // LLM (optional: only the PDF path uses it)
  ANTHROPIC_API_KEY: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

/** Parse and validate environment once. Throws a readable error listing missing keys. */
export function config(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Native USDC on Arc has 18 decimals. */
export const USDC = (amount: number | string): bigint => {
  const [whole, frac = ""] = String(amount).split(".");
  return BigInt(whole) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
};

export const fmtUSDC = (wei: bigint): string => {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 2);
  return `${whole}.${frac} USDC`;
};
