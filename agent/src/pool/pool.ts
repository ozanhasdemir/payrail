/**
 * Early-pay pool interactions.
 *
 *   deposit   liquidity provider puts native USDC in, gets shares
 *   quote     what the pool pays for a receivable right now
 *   sell      supplier hands over the receivable token, gets USDC today
 *   stats     NAV, cash, outstanding face value, rate
 */
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "../chains.js";
import { config } from "../config.js";
import { earlyPayPoolAbi, invoiceRegistryAbi, receivableTokenAbi } from "../contracts.js";
import { DEMO_SUPPLIERS, supplierKey } from "../suppliers.js";
import { findInvoice, upsertInvoice } from "../store.js";

const pub = () => createPublicClient({ chain: arcTestnet, transport: http(config().ARC_RPC_URL) });
const pool = () => config().EARLY_PAY_POOL_ADDRESS as Address;
const fees = { maxFeePerGas: 25_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };

export async function poolStats() {
  const c = pub();
  const [totalAssets, outstandingFace, rateBps] = await Promise.all([
    c.readContract({ address: pool(), abi: earlyPayPoolAbi, functionName: "totalAssets" }),
    c.readContract({ address: pool(), abi: earlyPayPoolAbi, functionName: "outstandingFace" }),
    c.readContract({ address: pool(), abi: earlyPayPoolAbi, functionName: "annualRateBps" }),
  ]);
  const cash = await c.getBalance({ address: pool() });
  return { totalAssets, cash, outstandingFace, rateBps };
}

export async function quote(invoiceId: bigint) {
  const [payout, discount] = await pub().readContract({ address: pool(), abi: earlyPayPoolAbi, functionName: "quote", args: [invoiceId] });
  return { payout, discount };
}

/** Liquidity provider deposit from a private key (the burner plays LP in the demo). */
export async function deposit(amount: bigint, privateKey: Hex): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(config().ARC_RPC_URL) });
  const hash = await wallet.writeContract({ address: pool(), abi: earlyPayPoolAbi, functionName: "deposit", value: amount, ...fees });
  await pub().waitForTransactionReceipt({ hash });
  return hash;
}

/** Supplier sells receivable `invoiceId`. The supplier is whoever holds the token. */
export async function sellReceivable(invoiceId: bigint): Promise<{ payout: bigint; discount: bigint; approveTx: Hex; sellTx: Hex }> {
  const c = pub();
  const cfg = config();
  const owner = await c.readContract({ address: cfg.RECEIVABLE_TOKEN_ADDRESS as Address, abi: receivableTokenAbi, functionName: "ownerOf", args: [invoiceId] });
  const supplier = DEMO_SUPPLIERS.find((s) => {
    const k = supplierKey(s);
    return k && privateKeyToAccount(k).address.toLowerCase() === owner.toLowerCase();
  });
  if (!supplier) throw new Error(`receivable #${invoiceId} is held by ${owner}, not a demo supplier we hold a key for`);

  const account = privateKeyToAccount(supplierKey(supplier)!);
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(cfg.ARC_RPC_URL) });
  const q = await quote(invoiceId);

  const approveTx = await wallet.writeContract({ address: cfg.RECEIVABLE_TOKEN_ADDRESS as Address, abi: receivableTokenAbi, functionName: "approve", args: [pool(), invoiceId], ...fees });
  await c.waitForTransactionReceipt({ hash: approveTx });
  const sellTx = await wallet.writeContract({ address: pool(), abi: earlyPayPoolAbi, functionName: "sell", args: [invoiceId], ...fees });
  await c.waitForTransactionReceipt({ hash: sellTx });

  const inv = findInvoice((i) => i.id === invoiceId.toString());
  if (inv) {
    inv.txs.sell = sellTx;
    inv.notes.push(`receivable sold to pool for ${q.payout.toString()} wei (discount ${q.discount.toString()})`);
    upsertInvoice(inv);
  }
  return { ...q, approveTx, sellTx };
}

export async function receivableOwner(invoiceId: bigint): Promise<Address | undefined> {
  try {
    return await pub().readContract({ address: config().RECEIVABLE_TOKEN_ADDRESS as Address, abi: receivableTokenAbi, functionName: "ownerOf", args: [invoiceId] });
  } catch {
    return undefined; // burned = settled
  }
}

export async function onChainInvoice(invoiceId: bigint) {
  return pub().readContract({ address: config().INVOICE_REGISTRY_ADDRESS as Address, abi: invoiceRegistryAbi, functionName: "getInvoice", args: [invoiceId] });
}
