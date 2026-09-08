/**
 * Tiny JSON file store for agent state: processed invoices, pending approvals, notes.
 * The chain is the source of truth for status and money; this is the agent's working memory
 * (match results, reasons, who approved) that the dashboard reads.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Address, Hex } from "viem";
import type { MatchException } from "./match/threeWay.js";

export type InvoiceState =
  | "blocked" // match failed before anything went on-chain
  | "rejected" // recorded on-chain, then rejected with a reason
  | "submitted"
  | "approved"
  | "pending_approval" // approved, over the auto-pay cap, waiting for humans
  | "paid"
  | "error";

export interface ProcessedInvoice {
  id?: string; // on-chain invoice id
  file: string;
  docHash: Hex;
  invoiceNumber: string;
  invoiceDate: string;
  poNumber: string;
  supplierName: string;
  supplierEns?: string;
  supplierArc?: Address;
  worldVerified: boolean;
  amount: number; // invoice currency
  currency: string;
  amountOnChain: string; // wei of native USDC, as decimal string
  netDays: number;
  dueDate: number; // unix seconds
  status: InvoiceState;
  match: { ok: boolean; autoApprove: boolean; matchedAmount: number; exceptions: MatchException[] };
  txs: { submit?: Hex; approve?: Hex; reject?: Hex; pay?: Hex; sell?: Hex };
  paidBy?: "ops" | "treasury";
  approvals: Array<{ approver: string; at: string }>;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentState {
  invoices: Record<string, ProcessedInvoice>; // keyed by docHash
  /** Demo salt mixed into document hashes so the same fixtures can be re-run as new documents. */
  salt?: string;
}

/** Wipe working memory and start a new demo run. On-chain history is untouched. */
export function resetState(): AgentState {
  const state: AgentState = { invoices: {}, salt: Date.now().toString(36) };
  saveState(state);
  return state;
}

const dataDir = () => {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return join(dir, "agent", "data");
    if (dirname(dir) === dir) return join(process.cwd(), "data");
  }
};
const file = () => join(dataDir(), "state.json");

export function loadState(): AgentState {
  if (!existsSync(file())) return { invoices: {} };
  return JSON.parse(readFileSync(file(), "utf8")) as AgentState;
}

export function saveState(state: AgentState): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(file(), JSON.stringify(state, null, 2));
}

export function upsertInvoice(inv: ProcessedInvoice): ProcessedInvoice {
  const state = loadState();
  inv.updatedAt = new Date().toISOString();
  state.invoices[inv.docHash] = inv;
  saveState(state);
  return inv;
}

export function findInvoice(pred: (i: ProcessedInvoice) => boolean): ProcessedInvoice | undefined {
  return Object.values(loadState().invoices).find(pred);
}

export function listInvoices(): ProcessedInvoice[] {
  return Object.values(loadState().invoices).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
