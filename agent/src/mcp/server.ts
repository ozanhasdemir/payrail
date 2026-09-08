/**
 * PayRail as an MCP server: any agent (Claude Desktop, Cursor, a Bazantic recipe) can process,
 * approve, pay and finance invoices through tool calls. Same functions the HTTP API uses.
 *
 * Run: pnpm mcp        (stdio transport)
 *
 * Claude Desktop config example:
 *   { "mcpServers": { "payrail": { "command": "pnpm", "args": ["--dir", "<repo>/agent", "mcp"] } } }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { formatEther } from "viem";
import { z } from "zod";
import { config } from "../config.js";
import { recordApproval } from "../pipeline/approvals.js";
import { processInvoiceFile } from "../pipeline/run.js";
import { onChainInvoice, poolStats, quote, receivableOwner, sellReceivable } from "../pool/pool.js";
import { resolveSupplier } from "../resolve/ens.js";
import { findInvoice, listInvoices } from "../store.js";

const c = config();
const fixturesDir = (() => {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const p = join(dir, "fixtures");
    if (existsSync(p)) return p;
    if (dirname(dir) === dir) throw new Error("fixtures directory not found");
  }
})();
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2) }] });
const explorer = (h?: string) => (h ? `${c.ARC_EXPLORER_URL}/tx/${h}` : undefined);

const server = new McpServer({ name: "payrail", version: "0.1.0" });

server.registerTool(
  "list_inbox",
  { description: "List invoice documents (EDI 810 files) waiting in the inbox.", inputSchema: {} },
  async () => text(readdirSync(join(fixturesDir, "edi810")).filter((f) => f.endsWith(".edi"))),
);

server.registerTool(
  "process_invoice",
  {
    description:
      "Run the accounts-payable pipeline on one inbox file: parse the EDI 810, three-way match against PO and goods receipt, resolve the supplier from ENS, record it on Arc, approve or reject, then pay from the policy-capped ops wallet or queue it for human approval.",
    inputSchema: { file: z.string().describe("file name from list_inbox") },
  },
  async ({ file }) => {
    const logs: string[] = [];
    const r = await processInvoiceFile(join(fixturesDir, "edi810", file), { fixturesDir, log: (l) => logs.push(l) });
    return text({ ...r, explorer: { pay: explorer(r.txs.pay), approve: explorer(r.txs.approve), reject: explorer(r.txs.reject) }, logs });
  },
);

server.registerTool(
  "list_invoices",
  { description: "All invoices the agent has processed, with status, match result, approvals and transactions.", inputSchema: {} },
  async () => text(listInvoices()),
);

server.registerTool(
  "get_invoice",
  { description: "One invoice with its live on-chain state and who currently holds the receivable.", inputSchema: { id: z.string() } },
  async ({ id }) => {
    const inv = findInvoice((i) => i.id === id);
    if (!inv) return text({ error: `invoice ${id} not found` });
    const [chain, holder] = await Promise.all([onChainInvoice(BigInt(id)), receivableOwner(BigInt(id))]);
    return text({ ...inv, chain, receivableHolder: holder ?? "settled" });
  },
);

server.registerTool(
  "approve_invoice",
  {
    description:
      "Record one human approval for an invoice over the auto-pay cap. Approver 1 is the Controller, 2 is the CFO. When two approvals are in, Privy signs the treasury payment with both quorum keys and the invoice is paid.",
    inputSchema: { id: z.string(), approver: z.enum(["1", "2"]) },
  },
  async ({ id, approver }) => {
    const r = await recordApproval(id, approver);
    return text({ id: r.id, status: r.status, approvals: r.approvals, payTx: explorer(r.txs.pay) });
  },
);

server.registerTool(
  "quote_receivable",
  { description: "What the early-pay pool would pay right now for an approved invoice's receivable.", inputSchema: { id: z.string() } },
  async ({ id }) => {
    const q = await quote(BigInt(id));
    return text({ payoutUsdc: formatEther(q.payout), discountUsdc: formatEther(q.discount) });
  },
);

server.registerTool(
  "sell_receivable",
  { description: "Supplier sells the receivable for an approved invoice to the pool and is paid USDC today.", inputSchema: { id: z.string() } },
  async ({ id }) => {
    const r = await sellReceivable(BigInt(id));
    return text({ payoutUsdc: formatEther(r.payout), discountUsdc: formatEther(r.discount), tx: explorer(r.sellTx) });
  },
);

server.registerTool(
  "pool_stats",
  { description: "Early-pay pool: net asset value, cash, receivables held, rate.", inputSchema: {} },
  async () => {
    const s = await poolStats();
    return text({ navUsdc: formatEther(s.totalAssets), cashUsdc: formatEther(s.cash), receivablesHeldUsdc: formatEther(s.outstandingFace), aprPercent: Number(s.rateBps) / 100 });
  },
);

server.registerTool(
  "resolve_supplier",
  { description: "Resolve a supplier's PayRail identity from its ENS name: Arc address, terms, discount cap, World ID status.", inputSchema: { ens: z.string().describe("e.g. acme.payrail.eth") } },
  async ({ ens }) => text(await resolveSupplier(ens)),
);

await server.connect(new StdioServerTransport());
