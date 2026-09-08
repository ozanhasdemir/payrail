/**
 * Onboard the demo suppliers into ENS: one subname each under payrail.eth, records written from
 * the company owner key, then read back through the universal resolver.
 *
 * Run: pnpm exec tsx src/scripts/ens-suppliers.ts
 */
import { ENS_KEYS } from "../chains.js";
import { resolveSupplier, setSupplierRecords } from "../resolve/ens.js";
import { DEMO_SUPPLIERS, supplierAddress } from "../suppliers.js";

for (const s of DEMO_SUPPLIERS) {
  const addr = supplierAddress(s);
  if (!addr) {
    console.log(`${s.ens}: no key in env (${s.envKey}), skipping`);
    continue;
  }
  const written = await setSupplierRecords(s.ens, {
    [ENS_KEYS.arcAddress]: addr,
    [ENS_KEYS.terms]: `net${s.netDays}`,
    [ENS_KEYS.discountBps]: String(s.discountBps),
    "payrail.name": s.name,
  });
  const r = await resolveSupplier(s.ens);
  console.log(`${s.ens}  ${written.length} record(s) written`);
  console.log(`   name     ${r.displayName}`);
  console.log(`   arc addr ${r.arcAddress}`);
  console.log(`   terms    ${r.terms} (${r.netDays} days)   max discount ${r.discountBps} bps`);
  console.log(`   worldid  ${r.worldId ?? "(not verified)"}`);
}
