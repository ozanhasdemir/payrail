/**
 * Deterministic X12 810 (Invoice) parser. No model involved: EDI is a fixed grammar, and a
 * parser you can unit-test is worth more to an AP team than a clever one.
 *
 * Supports the segments that carry money and identity in a 004010 810:
 *   ISA/GS envelopes, ST, BIG, REF, N1/N3/N4 loops, ITD, DTM, IT1 + PID, TDS, TXI, SAC, CTT, SE.
 * Delimiters are read from the ISA segment, so files with non-default separators parse too.
 */
import { CanonicalInvoice, cents, type InvoiceLine, type Party, type PaymentTerms } from "./types.js";

export class Edi810ParseError extends Error {
  constructor(message: string, public readonly segment?: string) {
    super(message);
    this.name = "Edi810ParseError";
  }
}

type Segment = { tag: string; el: string[]; raw: string; index: number };

/** Split raw X12 into segments using the delimiters declared in ISA. */
export function tokenize(raw: string): { segments: Segment[]; elementSep: string; segmentTerm: string; subSep: string } {
  const text = raw.replace(/^﻿/, "");
  if (!text.startsWith("ISA")) throw new Edi810ParseError("document does not start with ISA");
  // ISA is fixed width: element separator at index 3, sub-element separator at 104, terminator at 105.
  const elementSep = text[3];
  const subSep = text[104];
  const segmentTerm = text[105];
  if (!elementSep || !segmentTerm) throw new Edi810ParseError("cannot read delimiters from ISA");

  const segments: Segment[] = [];
  let index = 0;
  for (const part of text.split(segmentTerm)) {
    const s = part.replace(/^[\r\n\s]+/, "");
    if (!s) continue;
    const el = s.split(elementSep);
    segments.push({ tag: el[0], el, raw: s, index: index++ });
  }
  return { segments, elementSep, segmentTerm, subSep };
}

const isoDate = (yyyymmdd: string | undefined): string | undefined => {
  if (!yyyymmdd) return undefined;
  const d = yyyymmdd.length === 6 ? `20${yyyymmdd}` : yyyymmdd; // ISA uses YYMMDD
  if (!/^\d{8}$/.test(d)) return undefined;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
};

const num = (s: string | undefined, what: string, seg: string): number => {
  if (s === undefined || s === "") throw new Edi810ParseError(`${what} is empty`, seg);
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Edi810ParseError(`${what} is not a number: ${s}`, seg);
  return n;
};

/** Product/Service ID qualifiers we recognise in IT1. */
const ID_QUALIFIERS: Record<string, keyof Pick<InvoiceLine, "sku" | "buyerSku" | "upc">> = {
  VN: "sku", // vendor's (seller's) item number
  VP: "sku", // vendor part number
  SK: "sku", // stock keeping unit
  BP: "buyerSku", // buyer's part number
  IN: "buyerSku", // buyer's item number
  UP: "upc", // UPC consumer package code
  UK: "upc", // GTIN-14
  EN: "upc", // EAN
};

export function parseEdi810(raw: string): CanonicalInvoice {
  const { segments } = tokenize(raw);
  const st = segments.find((s) => s.tag === "ST");
  if (!st) throw new Edi810ParseError("missing ST");
  if (st.el[1] !== "810") throw new Edi810ParseError(`transaction set is ${st.el[1]}, expected 810`, st.raw);

  const provenance: Record<string, string> = {};
  let invoiceNumber = "";
  let invoiceDate: string | undefined;
  let poNumber = "";
  let poDate: string | undefined;
  let shipDate: string | undefined;
  let supplier: Party | undefined;
  let buyer: Party | undefined;
  let shipTo: Party | undefined;
  let terms: PaymentTerms | undefined;
  let tdsTotal: number | undefined;
  let cttCount: number | undefined;
  let tax = 0;
  let charges = 0;
  const lines: InvoiceLine[] = [];

  // N1 loop state: N3/N4 attach to the most recent N1.
  let currentParty: { role: string; party: Party; addr: string[] } | undefined;
  const flushParty = () => {
    if (!currentParty) return;
    if (currentParty.addr.length) currentParty.party.address = currentParty.addr.join(", ");
    const { role, party } = currentParty;
    if (role === "SU" || role === "SE" || role === "VN" || role === "RI") supplier = supplier ?? party;
    else if (role === "BT" || role === "BY") buyer = buyer ?? party;
    else if (role === "ST") shipTo = shipTo ?? party;
    currentParty = undefined;
  };

  for (const s of segments) {
    const e = s.el;
    switch (s.tag) {
      case "BIG": {
        invoiceDate = isoDate(e[1]);
        invoiceNumber = e[2] ?? "";
        poDate = isoDate(e[3]);
        poNumber = e[4] ?? "";
        provenance.invoiceNumber = `BIG02 (#${s.index})`;
        provenance.poNumber = `BIG04 (#${s.index})`;
        provenance.invoiceDate = `BIG01 (#${s.index})`;
        break;
      }
      case "N1": {
        flushParty();
        currentParty = { role: e[1], party: { name: e[2] ?? "", code: e[4] || undefined }, addr: [] };
        break;
      }
      case "N3":
        currentParty?.addr.push([e[1], e[2]].filter(Boolean).join(" "));
        break;
      case "N4":
        currentParty?.addr.push([e[1], e[2], e[3], e[4]].filter(Boolean).join(" "));
        break;
      case "ITD": {
        flushParty();
        // ITD03 discount %, ITD05 discount days due, ITD07 net days, ITD12 description
        const netDays = e[7] ? num(e[7], "ITD07 net days", s.raw) : 0;
        terms = {
          netDays,
          discountPercent: e[3] ? num(e[3], "ITD03 discount %", s.raw) : undefined,
          discountDays: e[5] ? num(e[5], "ITD05 discount days", s.raw) : undefined,
          description: e[12] || undefined,
        };
        provenance.terms = `ITD (#${s.index})`;
        break;
      }
      case "DTM": {
        flushParty();
        if (e[1] === "011") shipDate = isoDate(e[2]); // 011 = shipped
        break;
      }
      case "IT1": {
        flushParty();
        const quantity = num(e[2], "IT1 quantity", s.raw);
        const unitPrice = num(e[4], "IT1 unit price", s.raw);
        const line: InvoiceLine = {
          lineNumber: e[1] ? Number(e[1]) : lines.length + 1,
          sku: "",
          quantity,
          uom: e[3] || "EA",
          unitPrice,
          lineTotal: cents(quantity * unitPrice),
        };
        // Qualifier/value pairs start at IT106.
        for (let i = 6; i + 1 < e.length; i += 2) {
          const field = ID_QUALIFIERS[e[i]];
          if (field && e[i + 1]) (line as Record<string, unknown>)[field] = e[i + 1];
        }
        if (!line.sku) line.sku = line.buyerSku ?? line.upc ?? `LINE-${line.lineNumber}`;
        lines.push(line);
        provenance[`line${line.lineNumber}`] = `IT1 (#${s.index})`;
        break;
      }
      case "PID": {
        const last = lines[lines.length - 1];
        if (last && e[5]) last.description = e[5];
        break;
      }
      case "TXI":
        tax += num(e[2] ?? "0", "TXI amount", s.raw);
        break;
      case "SAC": {
        // SAC01 A = allowance (reduces), C = charge (adds). SAC05 amount in cents.
        const amt = e[5] ? num(e[5], "SAC05 amount", s.raw) / 100 : 0;
        charges += e[1] === "A" ? -amt : amt;
        break;
      }
      case "TDS":
        flushParty();
        tdsTotal = num(e[1], "TDS01 total", s.raw) / 100; // TDS is in cents
        provenance.total = `TDS01 (#${s.index})`;
        break;
      case "CTT":
        cttCount = num(e[1], "CTT01 line count", s.raw);
        break;
      default:
        break;
    }
  }
  flushParty();

  if (!invoiceNumber) throw new Edi810ParseError("BIG02 invoice number missing");
  if (!poNumber) throw new Edi810ParseError("BIG04 purchase order number missing");
  if (!invoiceDate) throw new Edi810ParseError("BIG01 invoice date missing or malformed");
  if (!supplier) throw new Edi810ParseError("no supplier N1 loop (SU/SE/VN/RI)");
  if (lines.length === 0) throw new Edi810ParseError("no IT1 lines");
  if (cttCount !== undefined && cttCount !== lines.length)
    throw new Edi810ParseError(`CTT says ${cttCount} lines, found ${lines.length}`);

  const subtotal = cents(lines.reduce((a, l) => a + l.lineTotal, 0));
  const computed = cents(subtotal + tax + charges);
  const total = tdsTotal ?? computed;
  if (tdsTotal !== undefined && Math.abs(tdsTotal - computed) > 0.005) {
    throw new Edi810ParseError(`TDS total ${tdsTotal.toFixed(2)} does not equal lines+tax+charges ${computed.toFixed(2)}`);
  }

  return CanonicalInvoice.parse({
    source: "edi810",
    invoiceNumber,
    invoiceDate,
    poNumber,
    poDate,
    shipDate,
    currency: "USD",
    supplier,
    buyer,
    shipTo,
    terms,
    lines,
    subtotal,
    total,
    provenance,
  });
}
