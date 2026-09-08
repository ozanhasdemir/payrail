/**
 * PayRail agent HTTP API. The dashboard talks to this; the MCP server wraps the same functions.
 *
 *   GET  /api/health
 *   GET  /api/invoices                 agent state, newest last
 *   GET  /api/invoices/:id             one invoice with live on-chain status and receivable holder
 *   POST /api/run                      { file?: string }  process one fixture, or all
 *   POST /api/invoices/:id/approve     { approver: "1" | "2" }
 *   POST /api/invoices/:id/sell        supplier sells the receivable to the pool
 *   GET  /api/invoices/:id/quote       pool quote for the receivable
 *   GET  /api/pool                     stats
 *   POST /api/pool/deposit             { usdc: number }  burner deposits (demo LP)
 *   GET  /api/suppliers                demo suppliers resolved live from ENS
 *   GET  /api/wallets                  balances of ops, treasury, suppliers, pool
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createPublicClient, formatEther, http, type Address, type Hex } from "viem";
import { arcTestnet } from "./chains.js";
import { config } from "./config.js";
import { recordApproval } from "./pipeline/approvals.js";
import { AUTO_PAY_CAP, DEMO_SCALE, processInvoiceFile } from "./pipeline/run.js";
import { deposit, onChainInvoice, poolStats, quote, receivableOwner, sellReceivable } from "./pool/pool.js";
import { opsWalletAddress, treasuryWalletAddress } from "./pay/privy.js";
import { resolveSupplier } from "./resolve/ens.js";
import { findInvoice, listInvoices, resetState } from "./store.js";
import { DEMO_SUPPLIERS, supplierAddress } from "./suppliers.js";
import { requestContext, verifyAndBind } from "./verify/world.js";

const c = config();
const app = new Hono();
app.use("/api/*", cors({ origin: (o) => o ?? "*" }));

const fixturesDir = (() => {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const p = join(dir, "fixtures");
    if (existsSync(p)) return p;
    if (dirname(dir) === dir) throw new Error("fixtures directory not found");
  }
})();
const pub = createPublicClient({ chain: arcTestnet, transport: http(c.ARC_RPC_URL) });
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

app.get("/api/health", (ctx) =>
  ctx.json({
    ok: true,
    chainId: c.ARC_CHAIN_ID,
    registry: c.INVOICE_REGISTRY_ADDRESS,
    pool: c.EARLY_PAY_POOL_ADDRESS,
    demoScale: DEMO_SCALE,
    autoPayCapUsdc: formatEther(AUTO_PAY_CAP),
    explorer: c.ARC_EXPLORER_URL,
  }),
);

/** The inbox: EDI 810 files waiting to be processed. In production this is an SFTP drop, a VAN, or a mailbox. */
app.get("/api/inbox", (ctx) => {
  const dir = join(fixturesDir, "edi810");
  const processed = new Set(listInvoices().map((i) => i.file));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".edi"))
    .map((f) => {
      const raw = readFileSync(join(dir, f), "utf8");
      const big = raw.split("~").find((s) => s.trim().startsWith("BIG"))?.split("*") ?? [];
      const su = raw.split("~").find((s) => s.trim().startsWith("N1*SU"))?.split("*") ?? [];
      return { file: f, bytes: raw.length, invoiceNumber: big[2] ?? "", poNumber: big[4] ?? "", supplier: su[2] ?? "", processed: processed.has(f) };
    });
  return ctx.json(files);
});

app.get("/api/inbox/:file", (ctx) => {
  const f = ctx.req.param("file");
  if (!/^[\w.-]+\.edi$/.test(f)) return ctx.json({ error: "bad file name" }, 400);
  const p = join(fixturesDir, "edi810", f);
  if (!existsSync(p)) return ctx.json({ error: "not found" }, 404);
  return ctx.text(readFileSync(p, "utf8"));
});

app.get("/api/invoices", (ctx) => ctx.json(json(listInvoices())));

/** Start a fresh demo: clears agent memory and salts document hashes so fixtures replay as new invoices. */
app.post("/api/demo/reset", (ctx) => ctx.json(resetState()));

app.get("/api/invoices/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const inv = findInvoice((i) => i.id === id);
  if (!inv) return ctx.json({ error: "not found" }, 404);
  const [chain, holder] = await Promise.all([onChainInvoice(BigInt(id)), receivableOwner(BigInt(id))]);
  return ctx.json(json({ ...inv, chain, receivableHolder: holder ?? null, heldByPool: holder?.toLowerCase() === c.EARLY_PAY_POOL_ADDRESS.toLowerCase() }));
});

app.post("/api/run", async (ctx) => {
  const body = (await ctx.req.json().catch(() => ({}))) as { file?: string };
  const dir = join(fixturesDir, "edi810");
  const files = body.file ? [join(dir, body.file)] : readdirSync(dir).filter((f) => f.endsWith(".edi")).map((f) => join(dir, f));
  const logs: string[] = [];
  const results = [];
  for (const f of files) {
    try {
      results.push(await processInvoiceFile(f, { fixturesDir, log: (l) => logs.push(`${f.split(/[\\/]/).pop()}: ${l}`) }));
    } catch (e) {
      logs.push(`${f}: ${(e as Error).message}`);
    }
  }
  return ctx.json(json({ results, logs }));
});

app.post("/api/invoices/:id/approve", async (ctx) => {
  const { approver } = (await ctx.req.json()) as { approver: "1" | "2" };
  if (approver !== "1" && approver !== "2") return ctx.json({ error: "approver must be 1 or 2" }, 400);
  try {
    return ctx.json(json(await recordApproval(ctx.req.param("id"), approver)));
  } catch (e) {
    return ctx.json({ error: (e as Error).message }, 400);
  }
});

app.get("/api/invoices/:id/quote", async (ctx) => {
  try {
    return ctx.json(json(await quote(BigInt(ctx.req.param("id")))));
  } catch (e) {
    return ctx.json({ error: (e as Error).message }, 400);
  }
});

app.post("/api/invoices/:id/sell", async (ctx) => {
  try {
    return ctx.json(json(await sellReceivable(BigInt(ctx.req.param("id")))));
  } catch (e) {
    return ctx.json({ error: (e as Error).message }, 400);
  }
});

// ---- World ID: supplier onboarding ----
app.get("/api/world/request", (ctx) => {
  try {
    return ctx.json(requestContext());
  } catch (e) {
    return ctx.json({ error: (e as Error).message }, 400);
  }
});

app.post("/api/world/verify", async (ctx) => {
  const { supplier, idkitResponse } = (await ctx.req.json()) as { supplier: string; idkitResponse: unknown };
  if (!supplier || !idkitResponse) return ctx.json({ error: "supplier and idkitResponse required" }, 400);
  const out = await verifyAndBind(supplier, idkitResponse);
  return ctx.json(out, out.ok ? 200 : 400);
});

app.get("/api/pool", async (ctx) => ctx.json(json(await poolStats())));

app.post("/api/pool/deposit", async (ctx) => {
  const { usdc } = (await ctx.req.json()) as { usdc: number };
  if (!c.DEPLOYER_PRIVATE_KEY) return ctx.json({ error: "no LP key configured" }, 400);
  const hash = await deposit(BigInt(Math.round(usdc * 1e6)) * 10n ** 12n, c.DEPLOYER_PRIVATE_KEY as Hex);
  return ctx.json(json({ hash, stats: await poolStats() }));
});

app.get("/api/suppliers", async (ctx) => {
  const out = await Promise.all(
    DEMO_SUPPLIERS.map(async (s) => {
      const r = await resolveSupplier(s.ens);
      const addr = r.arcAddress ?? supplierAddress(s);
      return { ...s, resolved: r, balance: addr ? formatEther(await pub.getBalance({ address: addr })) : null };
    }),
  );
  return ctx.json(json(out));
});

app.get("/api/wallets", async (ctx) => {
  const entries: Array<[string, Address | undefined]> = [
    ["ops", opsWalletAddress()],
    ["treasury", treasuryWalletAddress()],
    ["pool", c.EARLY_PAY_POOL_ADDRESS as Address],
    ...DEMO_SUPPLIERS.map((s) => [s.label, supplierAddress(s)] as [string, Address | undefined]),
  ];
  const out: Record<string, { address: string; usdc: string } | null> = {};
  for (const [name, address] of entries) {
    out[name] = address ? { address, usdc: formatEther(await pub.getBalance({ address })) } : null;
  }
  return ctx.json(out);
});

const port = Number(process.env.PORT ?? 8790);
serve({ fetch: app.fetch, port }, () => console.log(`payrail agent api on http://localhost:${port}`));
