export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8790";

export type InvoiceStatus = "blocked" | "rejected" | "submitted" | "approved" | "pending_approval" | "paid" | "error";

export interface MatchException {
  code: string;
  severity: "block" | "warn";
  lineNumber?: number;
  message: string;
  expected?: string | number;
  actual?: string | number;
}

export interface Invoice {
  id?: string;
  file: string;
  docHash: string;
  invoiceNumber: string;
  invoiceDate: string;
  poNumber: string;
  supplierName: string;
  supplierEns?: string;
  supplierArc?: string;
  worldVerified: boolean;
  amount: number;
  currency: string;
  amountOnChain: string;
  netDays: number;
  dueDate: number;
  status: InvoiceStatus;
  match: { ok: boolean; autoApprove: boolean; matchedAmount: number; exceptions: MatchException[] };
  txs: { submit?: string; approve?: string; reject?: string; pay?: string; sell?: string };
  paidBy?: "ops" | "treasury";
  approvals: Array<{ approver: string; at: string }>;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceDetail extends Invoice {
  receivableHolder: string | null;
  heldByPool: boolean;
}

export interface Health {
  ok: boolean;
  chainId: number;
  registry: string;
  pool: string;
  demoScale: number;
  autoPayCapUsdc: string;
  explorer: string;
}

export interface PoolStats {
  totalAssets: string;
  cash: string;
  outstandingFace: string;
  rateBps: string;
}

export interface Supplier {
  label: string;
  ens: string;
  name: string;
  netDays: number;
  discountBps: number;
  resolved: {
    displayName?: string;
    arcAddress?: string;
    terms?: string;
    netDays?: number;
    discountBps?: number;
    worldId?: string;
    resolver: string;
  };
  balance: string | null;
}

export type Wallets = Record<string, { address: string; usdc: string } | null>;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `${r.status} ${r.statusText}`);
  return body as T;
}

export const api = {
  health: () => req<Health>("/api/health"),
  invoices: () => req<Invoice[]>("/api/invoices"),
  invoice: (id: string) => req<InvoiceDetail>(`/api/invoices/${id}`),
  run: (file?: string) => req<{ results: Invoice[]; logs: string[] }>("/api/run", { method: "POST", body: JSON.stringify({ file }) }),
  approve: (id: string, approver: "1" | "2") => req<Invoice>(`/api/invoices/${id}/approve`, { method: "POST", body: JSON.stringify({ approver }) }),
  quote: (id: string) => req<{ payout: string; discount: string }>(`/api/invoices/${id}/quote`),
  sell: (id: string) => req<{ payout: string; discount: string; sellTx: string }>(`/api/invoices/${id}/sell`, { method: "POST" }),
  pool: () => req<PoolStats>("/api/pool"),
  deposit: (usdc: number) => req<{ hash: string; stats: PoolStats }>("/api/pool/deposit", { method: "POST", body: JSON.stringify({ usdc }) }),
  suppliers: () => req<Supplier[]>("/api/suppliers"),
  wallets: () => req<Wallets>("/api/wallets"),
};

/** wei (18 decimals) -> "12.60" */
export function usdc(wei: string | bigint, digits = 2): string {
  const n = BigInt(wei);
  const whole = n / 10n ** 18n;
  const frac = (n % 10n ** 18n).toString().padStart(18, "0").slice(0, digits);
  return `${whole.toLocaleString()}${digits ? "." + frac : ""}`;
}

export const money = (n: number, currency = "USD") => n.toLocaleString("en-US", { style: "currency", currency });
export const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const daysUntil = (unix: number) => Math.ceil((unix * 1000 - Date.now()) / 86400000);
