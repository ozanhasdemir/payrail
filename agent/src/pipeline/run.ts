/**
 * The AP agent's pipeline for one invoice file:
 *
 *   ingest -> match -> resolve supplier -> record on-chain -> approve or reject -> pay or queue
 *
 * Every decision is written to the store with its reason, and every on-chain step through the
 * buyer's Privy ops wallet, so the policy engine sees each transaction.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createPublicClient, http, keccak256, toHex, type Address, type Hex } from "viem";
import { arcTestnet } from "../chains.js";
import { config } from "../config.js";
import { invoiceRegistryAbi } from "../contracts.js";
import { parseEdi810 } from "../ingest/edi810.js";
import { GoodsReceipt, PurchaseOrder, type CanonicalInvoice } from "../ingest/types.js";
import { threeWayMatch, type MatchResult } from "../match/threeWay.js";
import { approveInvoice, opsWalletAddress, payFromOps, rejectInvoice, submitInvoice } from "../pay/privy.js";
import { resolveSupplier } from "../resolve/ens.js";
import { loadState, upsertInvoice, type ProcessedInvoice } from "../store.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Testnet faucets do not hand out $12,600. Invoice money is scaled down on-chain. */
export const DEMO_SCALE = Number(process.env.DEMO_SCALE ?? 1000);
/** Auto-pay cap in on-chain USDC. Mirrors the Privy ops policy (5 USDC on testnet). */
export const AUTO_PAY_CAP = BigInt(Math.round(Number(process.env.AUTO_PAY_CAP_USDC ?? 5) * 1e6)) * 10n ** 12n;

export function toOnChainAmount(amountMajor: number): bigint {
  const cents = BigInt(Math.round(amountMajor * 100));
  return (cents * 10n ** 16n) / BigInt(DEMO_SCALE);
}

const arc = () => createPublicClient({ chain: arcTestnet, transport: http(config().ARC_RPC_URL) });

function loadFixture<T>(dir: string, kind: "po" | "receipts", poNumber: string, schema: { parse: (v: unknown) => T }): T | undefined {
  const p = join(dir, kind, `${poNumber}.json`);
  return existsSync(p) ? schema.parse(JSON.parse(readFileSync(p, "utf8"))) : undefined;
}

export interface RunOptions {
  fixturesDir: string;
  log?: (line: string) => void;
}

export async function processInvoiceFile(path: string, opts: RunOptions): Promise<ProcessedInvoice> {
  const log = opts.log ?? (() => {});
  const raw = readFileSync(path);
  const state = loadState();
  // Same bytes = same document = same on-chain record. The demo salt lets us replay fixtures.
  const docHash = keccak256(toHex(state.salt ? Buffer.concat([raw, Buffer.from(state.salt)]) : raw));

  // Resume if we have seen this document before.
  const existing = state.invoices[docHash];
  if (existing && ["paid", "rejected", "pending_approval", "blocked"].includes(existing.status)) {
    log(`already processed: ${existing.invoiceNumber} is ${existing.status}`);
    return existing;
  }

  // 1. ingest
  let invoice: CanonicalInvoice;
  try {
    invoice = parseEdi810(raw.toString("utf8"));
  } catch (e) {
    throw new Error(`cannot parse ${basename(path)}: ${(e as Error).message}`);
  }
  log(`parsed ${invoice.invoiceNumber} from ${invoice.supplier.name}: ${invoice.total.toFixed(2)} ${invoice.currency}, PO ${invoice.poNumber}`);

  // 2. match
  const po = loadFixture(opts.fixturesDir, "po", invoice.poNumber, PurchaseOrder);
  const receipt = loadFixture(opts.fixturesDir, "receipts", invoice.poNumber, GoodsReceipt);
  const match: MatchResult = threeWayMatch(invoice, po, receipt);
  log(match.autoApprove ? "three-way match: clean" : `three-way match: ${match.exceptions.map((e) => e.code).join(", ")}`);

  // 3. resolve supplier from ENS
  const ens = po?.supplier.ens;
  const resolved = ens ? await resolveSupplier(ens) : undefined;
  const notes: string[] = [];
  if (!ens) notes.push("PO has no ENS name for the supplier");
  else if (!resolved?.arcAddress) notes.push(`${ens} has no payrail.addr.arc record`);
  else log(`resolved ${ens} -> ${resolved.arcAddress}, ${resolved.terms ?? "no terms"}, world id ${resolved.worldId ? "verified" : "not verified"}`);

  const netDays = resolved?.netDays ?? invoice.terms?.netDays ?? po?.terms?.netDays ?? 30;
  if (invoice.terms && resolved?.netDays && invoice.terms.netDays !== resolved.netDays)
    notes.push(`invoice says net${invoice.terms.netDays}, ENS record says net${resolved.netDays}; using ENS`);
  const dueDate = Math.floor(new Date(invoice.invoiceDate).getTime() / 1000) + netDays * 86400;
  const amountOnChain = toOnChainAmount(invoice.total);

  const record: ProcessedInvoice = existing ?? {
    file: basename(path),
    docHash,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    poNumber: invoice.poNumber,
    supplierName: invoice.supplier.name,
    supplierEns: ens,
    supplierArc: resolved?.arcAddress,
    worldVerified: !!resolved?.worldId,
    amount: invoice.total,
    currency: invoice.currency,
    amountOnChain: amountOnChain.toString(),
    netDays,
    dueDate,
    status: "submitted",
    match: { ok: match.ok, autoApprove: match.autoApprove, matchedAmount: match.matchedAmount, exceptions: match.exceptions },
    txs: {},
    approvals: [],
    notes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Cannot go on-chain without a supplier address.
  if (!resolved?.arcAddress) {
    record.status = "blocked";
    record.notes.push("no on-chain supplier address, nothing recorded");
    return upsertInvoice(record);
  }

  // 4. record on-chain (idempotent through docHash)
  const client = arc();
  const registry = config().INVOICE_REGISTRY_ADDRESS as Address;
  let id = await client.readContract({ address: registry, abi: invoiceRegistryAbi, functionName: "idByDocHash", args: [docHash] });
  if (id === 0n) {
    const dueDateOnChain = BigInt(Math.max(dueDate, Math.floor(Date.now() / 1000) + 86400)); // registry needs a future due date
    const r = await submitInvoice({ docHash, supplier: resolved.arcAddress, amount: amountOnChain, dueDate: dueDateOnChain, invoiceNumber: invoice.invoiceNumber });
    if (!r.ok) {
      record.status = "error";
      record.notes.push(`submit failed: ${r.reason} ${r.detail}`);
      return upsertInvoice(record);
    }
    record.txs.submit = r.hash;
    await client.waitForTransactionReceipt({ hash: r.hash });
    id = await client.readContract({ address: registry, abi: invoiceRegistryAbi, functionName: "idByDocHash", args: [docHash] });
    log(`recorded on Arc as invoice #${id} (${r.hash})`);
  }
  record.id = id.toString();
  upsertInvoice(record);

  // 5. approve or reject
  if (!match.ok) {
    const reason = match.exceptions
      .filter((e) => e.severity === "block")
      .map((e) => `${e.code}${e.lineNumber ? ` L${e.lineNumber}` : ""}: ${e.message}`)
      .join("; ")
      .slice(0, 200);
    const r = await rejectInvoice(id, reason);
    if (r.ok) {
      record.txs.reject = r.hash;
      record.status = "rejected";
      await client.waitForTransactionReceipt({ hash: r.hash });
      log(`rejected on-chain: ${reason}`);
    } else {
      record.status = "error";
      record.notes.push(`reject failed: ${r.reason} ${r.detail}`);
    }
    return upsertInvoice(record);
  }

  const a = await approveInvoice(id);
  if (!a.ok) {
    record.status = "error";
    record.notes.push(`approve failed: ${a.reason} ${a.detail}`);
    return upsertInvoice(record);
  }
  record.txs.approve = a.hash;
  record.status = "approved";
  await client.waitForTransactionReceipt({ hash: a.hash });
  log(`approved by buyer (${a.hash}); receivable minted to ${resolved.arcAddress}`);
  upsertInvoice(record);

  // 6. pay now or queue for humans
  if (amountOnChain <= AUTO_PAY_CAP) {
    const p = await payFromOps(id, amountOnChain);
    if (p.ok) {
      record.txs.pay = p.hash;
      record.status = "paid";
      record.paidBy = "ops";
      await client.waitForTransactionReceipt({ hash: p.hash });
      log(`paid from ops wallet under policy cap (${p.hash})`);
    } else if (p.reason === "policy_denied") {
      record.status = "pending_approval";
      record.notes.push("Privy policy refused the ops wallet; queued for approval");
      log("policy refused ops wallet, queued for approval");
    } else {
      record.status = "error";
      record.notes.push(`pay failed: ${p.reason} ${p.detail}`);
    }
  } else {
    record.status = "pending_approval";
    log(`over auto-pay cap, queued for 2-of-3 approval`);
  }
  return upsertInvoice(record);
}

export { opsWalletAddress };
