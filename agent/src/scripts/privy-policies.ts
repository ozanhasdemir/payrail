/**
 * Reconcile the two Privy policies with the current deployment.
 *
 * Each policy must carry, for BOTH eth_sendTransaction and eth_signTransaction:
 *   - to       == InvoiceRegistry (current deployment)
 *   - chain_id == Arc testnet
 *   - value    <= cap            (ops policy only)
 *
 * Why both methods: Privy's hosted broadcast is not enabled for Arc on this app, so the agent
 * asks Privy to sign (eth_signTransaction) and broadcasts through its own Arc RPC. Policies are
 * evaluated per method.
 *
 * Policies are owned by the approvers quorum (2 of 3), so every change here is signed with the
 * two approver keys. The agent alone cannot loosen or extend its own limits.
 *
 * Idempotent: creates missing rules, updates rules whose conditions drifted (e.g. after a
 * redeploy changed the registry address), leaves matching rules alone.
 *
 * Run: pnpm exec tsx src/scripts/privy-policies.ts
 */
import { PrivyClient } from "@privy-io/node";
import { config, USDC } from "../config.js";

const c = config();
const privy = new PrivyClient({ appId: c.PRIVY_APP_ID, appSecret: c.PRIVY_APP_SECRET });
const approvers = [c.PRIVY_APPROVER1_PRIVATE_KEY, c.PRIVY_APPROVER2_PRIVATE_KEY].filter((k): k is string => !!k);
if (approvers.length < 2) throw new Error("need two approver keys in env");
const auth = { authorization_private_keys: approvers };

const registry = c.INVOICE_REGISTRY_ADDRESS.toLowerCase();
const chainId = String(c.ARC_CHAIN_ID);
const cap = USDC("5").toString(); // auto-pay cap for the ops wallet, 5 USDC on testnet

type Field = "to" | "chain_id" | "value";
type Cond = { field_source: "ethereum_transaction"; field: Field; operator: "eq" | "lte"; value: string };
type Method = "eth_sendTransaction" | "eth_signTransaction";

const base: Cond[] = [
  { field_source: "ethereum_transaction", field: "to", operator: "eq", value: registry },
  { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: chainId },
];
const capped: Cond[] = [...base, { field_source: "ethereum_transaction", field: "value", operator: "lte", value: cap }];

const policies: Array<{ id: string; prefix: string; conditions: Cond[] }> = [
  { id: process.env.PRIVY_POLICY_ID!, prefix: "registry-under-cap", conditions: capped },
  { id: process.env.PRIVY_TREASURY_POLICY_ID!, prefix: "registry-any-amount", conditions: base },
];
const methods: Array<{ method: Method; tag: string }> = [
  { method: "eth_sendTransaction", tag: "pay" },
  { method: "eth_signTransaction", tag: "sign" },
];

const norm = (conds: Cond[]) =>
  JSON.stringify(
    [...conds]
      .map((x) => ({ f: x.field, o: x.operator, v: String(x.value).toLowerCase() }))
      .sort((a, b) => a.f.localeCompare(b.f)),
  );

for (const p of policies) {
  const policy = await privy.policies().get(p.id);
  const rules = (policy.rules ?? []) as Array<{ id: string; name: string; method: string; conditions: Cond[] }>;
  for (const m of methods) {
    const name = `${m.tag}-${p.prefix}`;
    const existing = rules.find((r) => r.method === m.method);
    if (!existing) {
      await privy.policies().createRule(p.id, { name, method: m.method, conditions: p.conditions, action: "ALLOW", authorization_context: auth });
      console.log(`${policy.name}: created ${m.method} rule`);
    } else if (norm(existing.conditions) !== norm(p.conditions)) {
      await privy.policies().updateRule(existing.id, {
        policy_id: p.id,
        name,
        method: m.method,
        conditions: p.conditions,
        action: "ALLOW",
        authorization_context: auth,
      });
      console.log(`${policy.name}: updated ${m.method} rule -> to=${registry}`);
    } else {
      console.log(`${policy.name}: ${m.method} rule already current`);
    }
  }
}
