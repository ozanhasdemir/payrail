/**
 * PayRail agent CLI.
 *
 *   pnpm cli parse <file.edi>                 parse an X12 810 to canonical JSON
 *   pnpm cli match <file.edi> [fixturesDir]   parse, load PO + receipt by PO number, run the three-way match
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseEdi810 } from "./ingest/edi810.js";
import { GoodsReceipt, PurchaseOrder } from "./ingest/types.js";
import { threeWayMatch } from "./match/threeWay.js";

const [, , cmd, file, fixturesArg] = process.argv;

function fixturesDir(): string {
  if (fixturesArg) return resolve(fixturesArg);
  for (let dir = process.cwd(); ; dir = resolve(dir, "..")) {
    const candidate = join(dir, "fixtures");
    if (existsSync(candidate)) return candidate;
    if (resolve(dir, "..") === dir) throw new Error("fixtures directory not found");
  }
}

function loadJson<T>(path: string, schema: { parse: (v: unknown) => T }): T | undefined {
  return existsSync(path) ? schema.parse(JSON.parse(readFileSync(path, "utf8"))) : undefined;
}

if (!cmd || !file || !["parse", "match"].includes(cmd)) {
  console.error("usage: cli parse <file.edi> | cli match <file.edi> [fixturesDir]");
  process.exit(2);
}

const invoice = parseEdi810(readFileSync(resolve(file), "utf8"));

if (cmd === "parse") {
  console.log(JSON.stringify(invoice, null, 2));
} else {
  const dir = fixturesDir();
  const po = loadJson(join(dir, "po", `${invoice.poNumber}.json`), PurchaseOrder);
  const receipt = loadJson(join(dir, "receipts", `${invoice.poNumber}.json`), GoodsReceipt);
  const result = threeWayMatch(invoice, po, receipt);

  console.log(`${invoice.supplier.name}  ${invoice.invoiceNumber}  PO ${invoice.poNumber}  total ${invoice.total.toFixed(2)} ${invoice.currency}`);
  console.log(`lines: ${invoice.lines.length}   terms: ${invoice.terms ? `net${invoice.terms.netDays}` : "n/a"}   PO supplier ENS: ${po?.supplier.ens ?? "n/a"}`);
  console.log("");
  if (result.exceptions.length === 0) {
    console.log("MATCH: clean, eligible for auto-approve");
  } else {
    for (const e of result.exceptions) {
      const where = e.lineNumber ? ` line ${e.lineNumber}` : "";
      const cmp = e.expected !== undefined ? `  (expected ${e.expected}, got ${e.actual})` : "";
      console.log(`${e.severity.toUpperCase().padEnd(5)} ${e.code}${where}: ${e.message}${cmp}`);
    }
    console.log("");
    console.log(result.ok ? "MATCH: passes with warnings, needs a human glance" : "MATCH: BLOCKED");
  }
  console.log(`matched amount: ${result.matchedAmount.toFixed(2)} of ${invoice.total.toFixed(2)}`);
  process.exit(result.ok ? 0 : 1);
}
