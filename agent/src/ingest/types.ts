import { z } from "zod";

/**
 * Canonical invoice: the one shape every ingest path (EDI 810, PDF, API) produces and the
 * matcher consumes. Money is in major units of the invoice currency (4200.00), as decimals.
 * Conversion to on-chain USDC happens at submission time, not here.
 */
export const InvoiceLine = z.object({
  lineNumber: z.number().int().positive(),
  sku: z.string().min(1), // supplier part number (VN) when present, else buyer part (BP) or UPC
  buyerSku: z.string().optional(),
  upc: z.string().optional(),
  description: z.string().optional(),
  quantity: z.number().positive(),
  uom: z.string().min(1),
  unitPrice: z.number().nonnegative(),
  lineTotal: z.number().nonnegative(),
});
export type InvoiceLine = z.infer<typeof InvoiceLine>;

export const Party = z.object({
  name: z.string().min(1),
  code: z.string().optional(), // trading-partner id (N104)
  address: z.string().optional(),
});
export type Party = z.infer<typeof Party>;

export const PaymentTerms = z.object({
  netDays: z.number().int().nonnegative(),
  discountPercent: z.number().nonnegative().optional(),
  discountDays: z.number().int().nonnegative().optional(),
  description: z.string().optional(),
});
export type PaymentTerms = z.infer<typeof PaymentTerms>;

export const CanonicalInvoice = z.object({
  source: z.enum(["edi810", "pdf", "api"]),
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  poNumber: z.string().min(1),
  poDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  shipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.string().default("USD"),
  supplier: Party,
  buyer: Party.optional(),
  shipTo: Party.optional(),
  terms: PaymentTerms.optional(),
  lines: z.array(InvoiceLine).min(1),
  subtotal: z.number().nonnegative(),
  total: z.number().nonnegative(),
  /** Raw document hash (keccak256 of the original bytes), set by the caller that has the bytes. */
  docHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  /** Where the fields came from, so a reviewer can trace each value to a segment or page. */
  provenance: z.record(z.string()).default({}),
});
export type CanonicalInvoice = z.infer<typeof CanonicalInvoice>;

/** Purchase order as the buyer's system knows it. */
export const PurchaseOrder = z.object({
  poNumber: z.string(),
  issuedAt: z.string(),
  buyer: z.object({ name: z.string(), shipTo: z.string().optional() }),
  supplier: z.object({ name: z.string(), code: z.string().optional(), ens: z.string().optional() }),
  currency: z.string().default("USD"),
  terms: PaymentTerms.optional(),
  lines: z.array(
    z.object({
      lineNumber: z.number().int(),
      sku: z.string(),
      description: z.string().optional(),
      quantity: z.number(),
      uom: z.string(),
      unitPrice: z.number(),
    }),
  ),
  total: z.number(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrder>;

/** Goods receipt from the warehouse. */
export const GoodsReceipt = z.object({
  poNumber: z.string(),
  receivedAt: z.string(),
  receivingLocation: z.string().optional(),
  lines: z.array(z.object({ lineNumber: z.number().int(), sku: z.string(), quantityReceived: z.number() })),
});
export type GoodsReceipt = z.infer<typeof GoodsReceipt>;

/** Round to cents. Invoices are money; floating point is not. */
export const cents = (n: number): number => Math.round(n * 100) / 100;
