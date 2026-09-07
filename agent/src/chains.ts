import { defineChain } from "viem";
import { sepolia as viemSepolia } from "viem/chains";

/**
 * Arc Testnet. USDC is the native gas token: `value` in a transaction is USDC with 18 decimals.
 * The same balance is also exposed as an ERC-20 (6 decimals) at ARC_USDC_ERC20.
 * Source: docs.arc.io/arc/references/connect-to-arc (verified 2026-09-07).
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io"],
      webSocket: [process.env.ARC_WS_URL ?? "wss://rpc.testnet.arc.io"],
    },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

export const ARC_USDC_ERC20 = "0x3600000000000000000000000000000000000000" as const;

/** Arc's fee market rejects anything under 20 gwei. */
export const ARC_MIN_MAX_FEE_PER_GAS = 20_000_000_000n;

/**
 * Sepolia with the ENSv2 UniversalResolverV2 so viem's getEnsAddress / getEnsText walk the
 * new hierarchical registries. Source: docs.ens.domains/learn/deployments.
 */
export const sepoliaEnsV2 = defineChain({
  ...viemSepolia,
  contracts: {
    ...viemSepolia.contracts,
    ensUniversalResolver: {
      address: "0x4a1817d13e9cf196f471725176355c1234b63c70",
    },
  },
});

/** Text record keys we store on each supplier subname. */
export const ENS_KEYS = {
  arcAddress: "payrail.addr.arc",
  terms: "payrail.terms", // e.g. "net30"
  discountBps: "payrail.discount.bps", // early-pay discount ceiling the supplier accepts
  worldId: "payrail.worldid", // nullifier hash from World ID onboarding
} as const;
