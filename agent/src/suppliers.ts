/**
 * Demo suppliers. In production a supplier is whoever holds the private key behind the Arc
 * address in their ENS record. For the demo the three fixture suppliers have keys in .env so
 * they can act (approve a receivable, sell it to the pool) on camera.
 */
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

export interface DemoSupplier {
  label: string; // ENS label under payrail.eth
  ens: string;
  name: string;
  netDays: number;
  discountBps: number; // max early-pay discount the supplier accepts
  envKey: string;
}

export const DEMO_SUPPLIERS: DemoSupplier[] = [
  { label: "acme", ens: "acme.payrail.eth", name: "Acme Foods LLC", netDays: 30, discountBps: 150, envKey: "SUPPLIER_ACME_PRIVATE_KEY" },
  { label: "blueridge", ens: "blueridge.payrail.eth", name: "Blue Ridge Packaging Co", netDays: 60, discountBps: 250, envKey: "SUPPLIER_BLUERIDGE_PRIVATE_KEY" },
  { label: "northwind", ens: "northwind.payrail.eth", name: "Northwind Beverages Inc", netDays: 30, discountBps: 100, envKey: "SUPPLIER_NORTHWIND_PRIVATE_KEY" },
];

export function supplierKey(s: DemoSupplier): Hex | undefined {
  const k = process.env[s.envKey];
  return k && /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : undefined;
}

export function supplierAddress(s: DemoSupplier): Address | undefined {
  const k = supplierKey(s);
  return k ? privateKeyToAccount(k).address : undefined;
}

export function supplierByEns(ens: string): DemoSupplier | undefined {
  return DEMO_SUPPLIERS.find((s) => s.ens.toLowerCase() === ens.toLowerCase());
}
