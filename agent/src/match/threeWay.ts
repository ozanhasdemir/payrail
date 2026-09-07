/**
 * Three-way match: invoice vs purchase order vs goods receipt.
 *
 * The rules an AP clerk applies, written down:
 *   - the PO exists and names the same supplier
 *   - every invoice line maps to a PO line (by SKU, falling back to line number)
 *   - unit price within tolerance of the PO price (default 0.5%)
 *   - quantity billed does not exceed quantity received
 *   - invoice arithmetic holds: lines sum to subtotal, subtotal is the total (no tax/charges yet)
 *   - terms on the invoice are not tighter than the PO terms
 *
 * Output is a list of exceptions with a severity. No exceptions means auto-approve is allowed.
 * "warn" exceptions are surfaced to a human but do not block. "block" exceptions reject.
 */
import { cents, type CanonicalInvoice, type GoodsReceipt, type PurchaseOrder } from "../ingest/types.js";

export type Severity = "block" | "warn";
export interface MatchException {
  code:
    | "PO_NOT_FOUND"
    | "SUPPLIER_MISMATCH"
    | "LINE_NOT_ON_PO"
    | "PRICE_VARIANCE"
    | "QTY_OVER_RECEIVED"
    | "QTY_OVER_ORDERED"
    | "NOT_RECEIVED"
    | "ARITHMETIC"
    | "TERMS_TIGHTER_THAN_PO"
    | "DUPLICATE_INVOICE_NUMBER";
  severity: Severity;
  lineNumber?: number;
  message: string;
  expected?: string | number;
  actual?: string | number;
}

export interface MatchResult {
  ok: boolean; // no "block" exceptions
  autoApprove: boolean; // no exceptions at all
  exceptions: MatchException[];
  matchedAmount: number; // what we would approve, in invoice currency
  po?: PurchaseOrder;
}

export interface MatchOptions {
  priceTolerancePct?: number; // default 0.5
  /** Invoice numbers already seen for this supplier, to catch duplicates. */
  seenInvoiceNumbers?: Set<string>;
}

const normSku = (s: string) => s.trim().toUpperCase();
const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/[.,]/g, "") === b.trim().toLowerCase().replace(/[.,]/g, "");

export function threeWayMatch(
  invoice: CanonicalInvoice,
  po: PurchaseOrder | undefined,
  receipt: GoodsReceipt | undefined,
  opts: MatchOptions = {},
): MatchResult {
  const tol = (opts.priceTolerancePct ?? 0.5) / 100;
  const ex: MatchException[] = [];
  const push = (e: MatchException) => ex.push(e);

  if (opts.seenInvoiceNumbers?.has(`${invoice.supplier.name}|${invoice.invoiceNumber}`)) {
    push({ code: "DUPLICATE_INVOICE_NUMBER", severity: "block", message: `invoice ${invoice.invoiceNumber} already processed for this supplier` });
  }

  if (!po) {
    push({ code: "PO_NOT_FOUND", severity: "block", message: `purchase order ${invoice.poNumber} not found`, actual: invoice.poNumber });
    return { ok: false, autoApprove: false, exceptions: ex, matchedAmount: 0 };
  }

  const supplierOk =
    sameName(po.supplier.name, invoice.supplier.name) || (!!po.supplier.code && !!invoice.supplier.code && po.supplier.code === invoice.supplier.code);
  if (!supplierOk) {
    push({ code: "SUPPLIER_MISMATCH", severity: "block", message: "invoice supplier is not the PO supplier", expected: po.supplier.name, actual: invoice.supplier.name });
  }

  // Arithmetic on the invoice itself.
  const sum = cents(invoice.lines.reduce((a, l) => a + cents(l.quantity * l.unitPrice), 0));
  if (Math.abs(sum - invoice.subtotal) > 0.005) {
    push({ code: "ARITHMETIC", severity: "block", message: "line totals do not sum to subtotal", expected: sum, actual: invoice.subtotal });
  }
  if (Math.abs(invoice.total - invoice.subtotal) > 0.005) {
    push({ code: "ARITHMETIC", severity: "warn", message: "total differs from subtotal (tax or charges present)", expected: invoice.subtotal, actual: invoice.total });
  }

  // Terms: an invoice may not demand faster payment than the PO agreed.
  if (invoice.terms && po.terms && invoice.terms.netDays < po.terms.netDays) {
    push({ code: "TERMS_TIGHTER_THAN_PO", severity: "warn", message: "invoice terms are shorter than PO terms", expected: `net${po.terms.netDays}`, actual: `net${invoice.terms.netDays}` });
  }

  let matched = 0;
  for (const line of invoice.lines) {
    const poLine = po.lines.find((l) => normSku(l.sku) === normSku(line.sku)) ?? po.lines.find((l) => l.lineNumber === line.lineNumber && !invoice.lines.some((o) => o !== line && normSku(o.sku) === normSku(l.sku)));
    if (!poLine) {
      push({ code: "LINE_NOT_ON_PO", severity: "block", lineNumber: line.lineNumber, message: `SKU ${line.sku} is not on PO ${po.poNumber}`, actual: line.sku });
      continue;
    }

    const priceDelta = Math.abs(line.unitPrice - poLine.unitPrice);
    if (priceDelta > poLine.unitPrice * tol + 1e-9) {
      push({ code: "PRICE_VARIANCE", severity: "block", lineNumber: line.lineNumber, message: `unit price differs from PO by ${((priceDelta / poLine.unitPrice) * 100).toFixed(2)}%`, expected: poLine.unitPrice, actual: line.unitPrice });
    }

    if (line.quantity > poLine.quantity + 1e-9) {
      push({ code: "QTY_OVER_ORDERED", severity: "block", lineNumber: line.lineNumber, message: "billed more than ordered", expected: poLine.quantity, actual: line.quantity });
    }

    const rcvLine = receipt?.lines.find((r) => normSku(r.sku) === normSku(poLine.sku));
    if (!receipt || !rcvLine) {
      push({ code: "NOT_RECEIVED", severity: "block", lineNumber: line.lineNumber, message: "no goods receipt for this line", actual: 0 });
    } else if (line.quantity > rcvLine.quantityReceived + 1e-9) {
      push({ code: "QTY_OVER_RECEIVED", severity: "block", lineNumber: line.lineNumber, message: "billed more than received", expected: rcvLine.quantityReceived, actual: line.quantity });
    }

    // Amount we would stand behind for this line: PO price times the lesser of billed and received.
    const qtyOk = Math.min(line.quantity, rcvLine?.quantityReceived ?? 0, poLine.quantity);
    matched += cents(qtyOk * poLine.unitPrice);
  }

  const blocks = ex.filter((e) => e.severity === "block").length;
  return { ok: blocks === 0, autoApprove: ex.length === 0, exceptions: ex, matchedAmount: cents(matched), po };
}
