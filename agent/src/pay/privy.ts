/**
 * Buyer-side payments through Privy server wallets.
 *
 * Two wallets, two owners:
 *  - ops wallet: owned by the agent's authorization key. Its policy allows calls to the
 *    InvoiceRegistry on Arc only, with value <= the auto-pay cap. Anything else is denied
 *    by Privy before a signature exists.
 *  - treasury wallet: owned by a 2-of-3 key quorum (agent + two human approvers). Its policy
 *    allows registry calls of any size, but a request only signs when two quorum keys sign it.
 *
 * The agent never holds an Ethereum private key. It holds a P-256 authorization key that
 * Privy checks against the wallet's owner before signing.
 */
import { PrivyClient } from "@privy-io/node";
import { createPublicClient, encodeFunctionData, http, type Hex, type Address } from "viem";
import { arcTestnet, ARC_MIN_MAX_FEE_PER_GAS } from "../chains.js";
import { config } from "../config.js";
import { invoiceRegistryAbi } from "../contracts.js";

export type PayResult =
  | { ok: true; hash: Hex; wallet: "ops" | "treasury" }
  | { ok: false; reason: "policy_denied" | "quorum_required" | "error"; detail: string; wallet: "ops" | "treasury" };

let client: PrivyClient | undefined;
function privy(): PrivyClient {
  if (client) return client;
  const c = config();
  client = new PrivyClient({ appId: c.PRIVY_APP_ID, appSecret: c.PRIVY_APP_SECRET });
  return client;
}

let pubClient: ReturnType<typeof createPublicClient> | undefined;
function arc() {
  if (pubClient) return pubClient;
  pubClient = createPublicClient({ chain: arcTestnet, transport: http(config().ARC_RPC_URL) });
  return pubClient;
}

const hex = (n: bigint): Hex => `0x${n.toString(16)}`;

/**
 * Privy signs, we broadcast.
 *
 * Privy's hosted broadcast (eth_sendTransaction) is not enabled for Arc on this app, but
 * eth_signTransaction works for any chain id and goes through the same policy engine. So the
 * agent builds the transaction with Arc's fee floor, asks Privy for a signature, and submits the
 * raw transaction to Arc itself. The wallet key never leaves Privy.
 */
async function send(
  wallet: "ops" | "treasury",
  tx: { to: Address; data?: Hex; value?: bigint },
  keys: string[],
): Promise<PayResult> {
  const c = config();
  const walletId = wallet === "ops" ? c.PRIVY_BUYER_WALLET_ID : c.PRIVY_TREASURY_WALLET_ID;
  const from = (wallet === "ops" ? c.PRIVY_BUYER_WALLET_ADDRESS : c.PRIVY_TREASURY_WALLET_ADDRESS) as Address | undefined;
  if (!walletId || !from) return { ok: false, reason: "error", detail: `${wallet} wallet not configured`, wallet };

  try {
    const client = arc();
    const value = tx.value ?? 0n;
    const data = tx.data ?? "0x";
    const [nonce, gas, fees] = await Promise.all([
      client.getTransactionCount({ address: from, blockTag: "pending" }),
      client.estimateGas({ account: from, to: tx.to, data, value }),
      client.estimateFeesPerGas(),
    ]);
    const maxFeePerGas = fees.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? fees.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS;
    const maxPriorityFeePerGas = fees.maxPriorityFeePerGas > 0n ? fees.maxPriorityFeePerGas : 1_000_000_000n;

    const signed = await privy()
      .wallets()
      .ethereum()
      .signTransaction(walletId, {
        params: {
          transaction: {
            to: tx.to,
            data,
            value: hex(value),
            chain_id: c.ARC_CHAIN_ID,
            nonce,
            gas_limit: hex((gas * 12n) / 10n),
            max_fee_per_gas: hex(maxFeePerGas),
            max_priority_fee_per_gas: hex(maxPriorityFeePerGas),
            type: 2,
          },
        },
        authorization_context: { authorization_private_keys: keys },
      });

    const hash = await client.sendRawTransaction({ serializedTransaction: signed.signed_transaction as Hex });
    return { ok: true, hash, wallet };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    const lower = detail.toLowerCase();
    if (lower.includes("policy")) return { ok: false, reason: "policy_denied", detail, wallet };
    if (lower.includes("quorum") || lower.includes("threshold") || lower.includes("authorization"))
      return { ok: false, reason: "quorum_required", detail, wallet };
    return { ok: false, reason: "error", detail, wallet };
  }
}

/** Keys held by the agent process. */
function agentKeys(): string[] {
  return [config().PRIVY_AUTHORIZATION_PRIVATE_KEY];
}

/**
 * Keys for a treasury action. In production the two approver signatures come from the humans'
 * devices; for the hackathon both approver keys live in env so the approval flow can be
 * demonstrated end to end.
 */
function approverKeys(): string[] {
  const c = config();
  return [c.PRIVY_APPROVER1_PRIVATE_KEY, c.PRIVY_APPROVER2_PRIVATE_KEY].filter((k): k is string => !!k);
}

export const opsWalletAddress = (): Address => config().PRIVY_BUYER_WALLET_ADDRESS as Address;
export const treasuryWalletAddress = (): Address | undefined =>
  config().PRIVY_TREASURY_WALLET_ADDRESS as Address | undefined;

/** Record a parsed invoice on-chain from the ops wallet. Zero value, within the ops policy. */
export function submitInvoice(args: {
  docHash: Hex;
  supplier: Address;
  amount: bigint;
  dueDate: bigint;
  invoiceNumber: string;
}): Promise<PayResult> {
  const data = encodeFunctionData({
    abi: invoiceRegistryAbi,
    functionName: "submit",
    args: [args.docHash, opsWalletAddress(), args.supplier, args.amount, args.dueDate, args.invoiceNumber],
  });
  return send("ops", { to: config().INVOICE_REGISTRY_ADDRESS as Address, data }, agentKeys());
}

/** Buyer approves an invoice. Zero value, so always within the ops policy. */
export function approveInvoice(id: bigint, wallet: "ops" | "treasury" = "ops"): Promise<PayResult> {
  const data = encodeFunctionData({ abi: invoiceRegistryAbi, functionName: "approve", args: [id] });
  const keys = wallet === "ops" ? agentKeys() : approverKeys();
  return send(wallet, { to: config().INVOICE_REGISTRY_ADDRESS as Address, data }, keys);
}

/** Buyer rejects an invoice with a reason string that lands in the event log. */
export function rejectInvoice(id: bigint, reason: string): Promise<PayResult> {
  const data = encodeFunctionData({ abi: invoiceRegistryAbi, functionName: "reject", args: [id, reason] });
  return send("ops", { to: config().INVOICE_REGISTRY_ADDRESS as Address, data }, agentKeys());
}

/**
 * Pay an approved invoice from the ops wallet. Privy's policy decides: under the cap it signs,
 * over the cap it refuses and we return policy_denied so the caller can route to approvals.
 */
export function payFromOps(id: bigint, amount: bigint): Promise<PayResult> {
  const data = encodeFunctionData({ abi: invoiceRegistryAbi, functionName: "pay", args: [id] });
  return send("ops", { to: config().INVOICE_REGISTRY_ADDRESS as Address, data, value: amount }, agentKeys());
}

/** Pay an approved invoice from the treasury wallet. Needs two of three quorum keys. */
export function payFromTreasury(id: bigint, amount: bigint, keys: string[] = approverKeys()): Promise<PayResult> {
  const data = encodeFunctionData({ abi: invoiceRegistryAbi, functionName: "pay", args: [id] });
  return send("treasury", { to: config().INVOICE_REGISTRY_ADDRESS as Address, data, value: amount }, keys);
}
