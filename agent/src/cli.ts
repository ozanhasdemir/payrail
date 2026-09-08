/**
 * PayRail agent CLI.
 *
 *   pnpm cli parse <file.edi>              parse an X12 810 to canonical JSON
 *   pnpm cli match <file.edi>              parse + three-way match, no chain
 *   pnpm cli run <file.edi>                full pipeline: match, resolve, record, approve/reject, pay/queue
 *   pnpm cli run-all                       run every fixture in fixtures/edi810
 *   pnpm cli list                          agent state
 *   pnpm cli approve <invoiceId> <1|2>     record a human approval; pays from treasury when two are in
 *   pnpm cli sell <invoiceId>              supplier sells the receivable to the pool
 *   pnpm cli pool [seed <usdc>]            pool stats, optionally deposit from the burner first
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { formatEther, type Hex } from "viem";
import { config, fmtUSDC } from "./config.js";
import { parseEdi810 } from "./ingest/edi810.js";
import { GoodsReceipt, PurchaseOrder } from "./ingest/types.js";
import { threeWayMatch } from "./match/threeWay.js";
import { recordApproval } from "./pipeline/approvals.js";
import { processInvoiceFile } from "./pipeline/run.js";
import { deposit, poolStats, sellReceivable } from "./pool/pool.js";
import { listInvoices } from "./store.js";

const [, , cmd, arg1, arg2] = process.argv;

function fixturesDir(): string {
  for (let dir = process.cwd(); ; dir = resolve(dir, "..")) {
    const candidate = join(dir, "fixtures");
    if (existsSync(candidate)) return candidate;
    if (resolve(dir, "..") === dir) throw new Error("fixtures directory not found");
  }
}
const loadJson = <T>(p: string, s: { parse: (v: unknown) => T }) => (existsSync(p) ? s.parse(JSON.parse(readFileSync(p, "utf8"))) : undefined);
const log = (l: string) => console.log(`  ${l}`);
const explorer = (h?: Hex) => (h ? `${config().ARC_EXPLORER_URL}/tx/${h}` : "");

async function main() {
  switch (cmd) {
    case "parse": {
      console.log(JSON.stringify(parseEdi810(readFileSync(resolve(arg1), "utf8")), null, 2));
      return;
    }
    case "match": {
      const invoice = parseEdi810(readFileSync(resolve(arg1), "utf8"));
      const dir = fixturesDir();
      const r = threeWayMatch(invoice, loadJson(join(dir, "po", `${invoice.poNumber}.json`), PurchaseOrder), loadJson(join(dir, "receipts", `${invoice.poNumber}.json`), GoodsReceipt));
      console.log(`${invoice.supplier.name}  ${invoice.invoiceNumber}  PO ${invoice.poNumber}  total ${invoice.total.toFixed(2)} ${invoice.currency}`);
      for (const e of r.exceptions) console.log(`${e.severity.toUpperCase().padEnd(5)} ${e.code}${e.lineNumber ? ` line ${e.lineNumber}` : ""}: ${e.message}${e.expected !== undefined ? ` (expected ${e.expected}, got ${e.actual})` : ""}`);
      console.log(r.autoApprove ? "MATCH: clean" : r.ok ? "MATCH: warnings" : "MATCH: BLOCKED");
      process.exitCode = r.ok ? 0 : 1;
      return;
    }
    case "run":
    case "run-all": {
      const dir = fixturesDir();
      const files = cmd === "run" ? [resolve(arg1)] : readdirSync(join(dir, "edi810")).filter((f) => f.endsWith(".edi")).map((f) => join(dir, "edi810", f));
      for (const f of files) {
        console.log(`\n${f.split(/[\\/]/).pop()}`);
        const r = await processInvoiceFile(f, { fixturesDir: dir, log });
        console.log(`  => #${r.id ?? "-"} ${r.status.toUpperCase()}  ${fmtUSDC(BigInt(r.amountOnChain))} on-chain for ${r.amount.toFixed(2)} ${r.currency}`);
        if (r.txs.pay) console.log(`     ${explorer(r.txs.pay)}`);
      }
      return;
    }
    case "list": {
      for (const i of listInvoices()) {
        console.log(`#${(i.id ?? "-").padEnd(3)} ${i.status.padEnd(16)} ${i.invoiceNumber.padEnd(14)} ${i.supplierName.padEnd(24)} ${i.amount.toFixed(2).padStart(10)} ${i.currency}  ${i.supplierEns ?? ""}  approvals=${i.approvals.length}`);
        for (const n of i.notes) console.log(`      note: ${n}`);
      }
      return;
    }
    case "approve": {
      const inv = await recordApproval(arg1, arg2 as "1" | "2");
      console.log(`#${inv.id} ${inv.status}, approvals: ${inv.approvals.map((a) => a.approver).join("+") || "none"}${inv.txs.pay ? `\n${explorer(inv.txs.pay)}` : ""}`);
      return;
    }
    case "sell": {
      const r = await sellReceivable(BigInt(arg1));
      console.log(`sold receivable #${arg1}: payout ${fmtUSDC(r.payout)}, discount ${fmtUSDC(r.discount)}\n${explorer(r.sellTx)}`);
      return;
    }
    case "pool": {
      if (arg1 === "seed") {
        const h = await deposit(BigInt(Math.round(Number(arg2) * 1e6)) * 10n ** 12n, config().DEPLOYER_PRIVATE_KEY as Hex);
        console.log(`deposited ${arg2} USDC from burner ${explorer(h)}`);
      }
      const s = await poolStats();
      console.log(`pool NAV ${formatEther(s.totalAssets)} USDC  cash ${formatEther(s.cash)}  receivables held ${formatEther(s.outstandingFace)}  rate ${Number(s.rateBps) / 100}% APR`);
      return;
    }
    default:
      console.error("usage: cli parse|match|run <file> | run-all | list | approve <id> <1|2> | sell <id> | pool [seed <usdc>]");
      process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
