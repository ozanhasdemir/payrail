import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEdi810, Edi810ParseError } from "./edi810.js";
import { GoodsReceipt, PurchaseOrder } from "./types.js";
import { threeWayMatch } from "../match/threeWay.js";

const fx = (p: string) => resolve(import.meta.dirname, "../../../fixtures", p);
const read = (p: string) => readFileSync(fx(p), "utf8");
const json = <T>(p: string, s: { parse: (v: unknown) => T }) => s.parse(JSON.parse(read(p)));

test("parses the Acme 810 into a canonical invoice", () => {
  const inv = parseEdi810(read("edi810/acme-foods-INV-2026-0142.edi"));
  assert.equal(inv.invoiceNumber, "INV-2026-0142");
  assert.equal(inv.poNumber, "4500012345");
  assert.equal(inv.invoiceDate, "2026-09-01");
  assert.equal(inv.supplier.name, "Acme Foods LLC");
  assert.equal(inv.supplier.code, "ACME");
  assert.equal(inv.shipTo?.name, "Harbor Wholesale Central DC");
  assert.equal(inv.terms?.netDays, 30);
  assert.equal(inv.terms?.discountPercent, 2);
  assert.equal(inv.lines.length, 2);
  assert.equal(inv.lines[0].sku, "AF-1001");
  assert.equal(inv.lines[0].upc, "012345678905");
  assert.equal(inv.lines[0].description, "Organic Tomato Sauce 24x680g");
  assert.equal(inv.lines[0].lineTotal, 2220);
  assert.equal(inv.total, 4200);
  assert.match(inv.provenance.total, /^TDS01/);
});

test("rejects a document whose TDS disagrees with its lines", () => {
  const raw = read("edi810/acme-foods-INV-2026-0142.edi").replace("TDS*420000~", "TDS*420100~");
  assert.throws(() => parseEdi810(raw), (e: unknown) => e instanceof Edi810ParseError && /TDS total/.test(e.message));
});

test("rejects a CTT line count that does not match", () => {
  const raw = read("edi810/acme-foods-INV-2026-0142.edi").replace("CTT*2~", "CTT*3~");
  assert.throws(() => parseEdi810(raw), /CTT says 3/);
});

test("clean invoice three-way matches with no exceptions", () => {
  const inv = parseEdi810(read("edi810/acme-foods-INV-2026-0142.edi"));
  const r = threeWayMatch(inv, json("po/4500012345.json", PurchaseOrder), json("receipts/4500012345.json", GoodsReceipt));
  assert.equal(r.autoApprove, true);
  assert.deepEqual(r.exceptions, []);
  assert.equal(r.matchedAmount, 4200);
});

test("net-60 packaging invoice matches clean", () => {
  const inv = parseEdi810(read("edi810/blueridge-packaging-INV-BR-88112.edi"));
  const r = threeWayMatch(inv, json("po/4500012402.json", PurchaseOrder), json("receipts/4500012402.json", GoodsReceipt));
  assert.equal(r.autoApprove, true);
  assert.equal(inv.terms?.netDays, 60);
  assert.equal(r.matchedAmount, 12600);
});

test("Northwind invoice is blocked for price variance and short receipt", () => {
  const inv = parseEdi810(read("edi810/northwind-beverages-INV-NW-5531.edi"));
  const r = threeWayMatch(inv, json("po/4500012388.json", PurchaseOrder), json("receipts/4500012388.json", GoodsReceipt));
  assert.equal(r.ok, false);
  const codes = r.exceptions.map((e) => e.code).sort();
  assert.deepEqual(codes, ["PRICE_VARIANCE", "QTY_OVER_RECEIVED"]);
  // We would stand behind PO price x received qty: 200*9.25 + 380*11.90 = 1850 + 4522
  assert.equal(r.matchedAmount, 6372);
});

test("missing PO blocks", () => {
  const inv = parseEdi810(read("edi810/acme-foods-INV-2026-0142.edi"));
  const r = threeWayMatch(inv, undefined, undefined);
  assert.equal(r.ok, false);
  assert.equal(r.exceptions[0].code, "PO_NOT_FOUND");
});
