/**
 * Human approvals for invoices over the auto-pay cap.
 *
 * The treasury wallet is owned by a 2-of-3 Privy key quorum. Each approver's signature is one
 * key. We collect approvals one at a time, and when two are in, ask Privy to sign the payment
 * with both keys. Privy rejects the request if fewer than two quorum keys sign, so the agent
 * cannot fake an approval.
 *
 * In production each approver signs from their own device. For the demo the approver keys live
 * in env and the dashboard buttons stand in for the two people.
 */
import { createPublicClient, http } from "viem";
import { arcTestnet } from "../chains.js";
import { config } from "../config.js";
import { payFromTreasury } from "../pay/privy.js";
import { findInvoice, upsertInvoice, type ProcessedInvoice } from "../store.js";

export const APPROVERS: Record<string, { name: string; envKey: string }> = {
  "1": { name: "Ozan (Controller)", envKey: "PRIVY_APPROVER1_PRIVATE_KEY" },
  "2": { name: "CFO", envKey: "PRIVY_APPROVER2_PRIVATE_KEY" },
};

export async function recordApproval(invoiceId: string, approver: "1" | "2"): Promise<ProcessedInvoice> {
  const inv = findInvoice((i) => i.id === invoiceId);
  if (!inv) throw new Error(`invoice ${invoiceId} not in store`);
  if (inv.status !== "pending_approval") throw new Error(`invoice ${invoiceId} is ${inv.status}, not pending approval`);
  if (!inv.approvals.some((a) => a.approver === approver)) {
    inv.approvals.push({ approver, at: new Date().toISOString() });
  }
  upsertInvoice(inv);

  if (inv.approvals.length < 2) return inv;

  const keys = inv.approvals.map((a) => process.env[APPROVERS[a.approver].envKey]).filter((k): k is string => !!k);
  const r = await payFromTreasury(BigInt(inv.id!), BigInt(inv.amountOnChain), keys);
  if (!r.ok) {
    inv.notes.push(`treasury payment failed: ${r.reason} ${r.detail}`);
    return upsertInvoice(inv);
  }
  const client = createPublicClient({ chain: arcTestnet, transport: http(config().ARC_RPC_URL) });
  await client.waitForTransactionReceipt({ hash: r.hash });
  inv.txs.pay = r.hash;
  inv.status = "paid";
  inv.paidBy = "treasury";
  return upsertInvoice(inv);
}
