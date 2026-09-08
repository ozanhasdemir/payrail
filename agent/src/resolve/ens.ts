/**
 * Supplier identity from ENS.
 *
 * Every supplier is a subname under the company name: acme.payrail.eth. Records live on the
 * company's ENSv2 resolver on Sepolia and are found through UniversalResolverV2's wildcard
 * resolution, so a supplier can be onboarded with a handful of setText calls and no registry
 * transaction.
 *
 * Text record keys (see ENS_KEYS in chains.ts):
 *   payrail.addr.arc      USDC address on Arc that gets paid
 *   payrail.terms         "net30", "net60"
 *   payrail.discount.bps  maximum early-pay discount the supplier accepts, basis points
 *   payrail.worldid       World ID nullifier hash from onboarding, empty until verified
 *   payrail.name          display name
 */
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  namehash,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { normalize, packetToBytes } from "viem/ens";
import { toHex } from "viem";
import { ENS_KEYS, sepoliaEnsV2 } from "../chains.js";
import { config } from "../config.js";

const universalResolverAbi = parseAbi([
  "function resolve(bytes name, bytes data) view returns (bytes result, address resolver)",
]);
const textAbi = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);
const resolverWriteAbi = parseAbi(["function setText(bytes32 node, string key, string value)"]);

export interface SupplierRecord {
  name: string; // ens name, e.g. acme.payrail.eth
  displayName?: string;
  arcAddress?: Address;
  terms?: string; // net30
  netDays?: number;
  discountBps?: number;
  worldId?: string;
  resolver: Address;
}

let client: ReturnType<typeof createPublicClient> | undefined;
function sepolia() {
  if (client) return client;
  client = createPublicClient({ chain: sepoliaEnsV2, transport: http(config().SEPOLIA_RPC_URL) });
  return client;
}

/** Read one text record through the universal resolver (wildcard-aware). */
export async function getText(name: string, key: string): Promise<{ value: string; resolver: Address }> {
  const c = config();
  const normalized = normalize(name);
  const data = encodeFunctionData({ abi: textAbi, functionName: "text", args: [namehash(normalized), key] });
  const [result, resolver] = await sepolia().readContract({
    address: c.ENS_UNIVERSAL_RESOLVER_V2 as Address,
    abi: universalResolverAbi,
    functionName: "resolve",
    args: [toHex(packetToBytes(normalized)), data],
  });
  const value = result === "0x" ? "" : (decodeFunctionResult({ abi: textAbi, functionName: "text", data: result as Hex }) as string);
  return { value, resolver };
}

/** Resolve everything PayRail needs to know about a supplier. */
export async function resolveSupplier(name: string): Promise<SupplierRecord> {
  const [addr, terms, discount, worldId, display] = await Promise.all([
    getText(name, ENS_KEYS.arcAddress),
    getText(name, ENS_KEYS.terms),
    getText(name, ENS_KEYS.discountBps),
    getText(name, ENS_KEYS.worldId),
    getText(name, "payrail.name"),
  ]);
  const netDays = /^net(\d+)$/i.exec(terms.value)?.[1];
  return {
    name,
    displayName: display.value || undefined,
    arcAddress: /^0x[0-9a-fA-F]{40}$/.test(addr.value) ? (addr.value as Address) : undefined,
    terms: terms.value || undefined,
    netDays: netDays ? Number(netDays) : undefined,
    discountBps: discount.value ? Number(discount.value) : undefined,
    worldId: worldId.value || undefined,
    resolver: addr.resolver,
  };
}

/**
 * Write text records for a supplier from the company's ENS owner key. Only writes keys whose
 * current value differs, so re-running is cheap.
 */
export async function setSupplierRecords(name: string, records: Record<string, string>): Promise<Hex[]> {
  const c = config();
  if (!c.ENS_OWNER_PRIVATE_KEY || !c.ENS_PAYRAIL_RESOLVER) throw new Error("ENS_OWNER_PRIVATE_KEY and ENS_PAYRAIL_RESOLVER required");
  const account = privateKeyToAccount(c.ENS_OWNER_PRIVATE_KEY as Hex);
  const wallet = createWalletClient({ account, chain: sepoliaEnsV2, transport: http(c.SEPOLIA_RPC_URL) });
  const node = namehash(normalize(name));
  const hashes: Hex[] = [];
  for (const [key, value] of Object.entries(records)) {
    const current = await getText(name, key);
    if (current.value === value) continue;
    const hash = await wallet.writeContract({
      address: c.ENS_PAYRAIL_RESOLVER as Address,
      abi: resolverWriteAbi,
      functionName: "setText",
      args: [node, key, value],
    });
    await sepolia().waitForTransactionReceipt({ hash });
    hashes.push(hash);
  }
  return hashes;
}
