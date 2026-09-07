/**
 * Day 1 gate: policy-gated payment on Arc through Privy.
 *
 *  1. Submit a 4.2 USDC invoice with the ops wallet as buyer (from the burner, any address can submit).
 *  2. Ops wallet approves it through Privy (value 0).
 *  3. Ops wallet pays it through Privy. 4.2 <= 5 cap, so the policy allows it.
 *  4. Submit an 8 USDC invoice, approve it, try to pay from ops. Policy must DENY.
 *  5. Pay the same invoice from the treasury wallet with two approver keys. Must succeed.
 *
 * Run: pnpm tsx src/scripts/day1-privy-smoke.ts
 */
import { createPublicClient, createWalletClient, http, keccak256, toHex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "../chains.js";
import { config, USDC, fmtUSDC } from "../config.js";
import { invoiceRegistryAbi, receivableTokenAbi } from "../contracts.js";
import { approveInvoice, payFromOps, payFromTreasury, opsWalletAddress, treasuryWalletAddress } from "../pay/privy.js";

const c = config();
const pub = createPublicClient({ chain: arcTestnet, transport: http(c.ARC_RPC_URL) });
const burner = privateKeyToAccount(c.DEPLOYER_PRIVATE_KEY as `0x${string}`);
const burnerClient = createWalletClient({ account: burner, chain: arcTestnet, transport: http(c.ARC_RPC_URL) });
const registry = c.INVOICE_REGISTRY_ADDRESS as Address;
const explorer = (h: string) => `${c.ARC_EXPLORER_URL}/tx/${h}`;

async function submit(buyer: Address, supplier: Address, amount: bigint, invoiceNumber: string): Promise<bigint> {
  const docHash = keccak256(toHex(`${invoiceNumber}:${Date.now()}`));
  const dueDate = BigInt(Math.floor(Date.now() / 1000) + 30 * 86400);
  const hash = await burnerClient.writeContract({
    address: registry,
    abi: invoiceRegistryAbi,
    functionName: "submit",
    args: [docHash, buyer, supplier, amount, dueDate, invoiceNumber],
    maxFeePerGas: 25_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  });
  await pub.waitForTransactionReceipt({ hash });
  return pub.readContract({ address: registry, abi: invoiceRegistryAbi, functionName: "idByDocHash", args: [docHash] });
}

async function balance(a: Address) {
  return fmtUSDC(await pub.getBalance({ address: a }));
}

async function main() {
  const ops = opsWalletAddress();
  const treasury = treasuryWalletAddress();
  if (!treasury) throw new Error("treasury wallet not configured");
  const supplier = "0x63fba012f11ad2b9cFfe9EDDFf7ab10BF64D9483" as Address; // receive-only test address

  console.log(`ops wallet      ${ops}  ${await balance(ops)}`);
  console.log(`treasury wallet ${treasury}  ${await balance(treasury)}`);
  console.log(`supplier        ${supplier}  ${await balance(supplier)}\n`);

  // Fail early on funds, otherwise a gas-estimation error masquerades as a policy result.
  const need = { ops: USDC("4.2") + USDC("6") + USDC("0.5"), treasury: USDC("6") + USDC("0.5") };
  const have = { ops: await pub.getBalance({ address: ops }), treasury: await pub.getBalance({ address: treasury }) };
  if (have.ops < need.ops || have.treasury < need.treasury) {
    console.error(`insufficient test funds: ops needs ${fmtUSDC(need.ops)}, treasury needs ${fmtUSDC(need.treasury)}`);
    process.exit(2);
  }

  // --- 1..3: small invoice, auto-pay path ---
  const small = await submit(ops, supplier, USDC("4.2"), "INV-2026-0143");
  console.log(`[1] submitted invoice #${small} for 4.2 USDC, buyer = ops wallet`);

  const a1 = await approveInvoice(small);
  console.log(`[2] approve via Privy (ops): ${a1.ok ? "OK " + explorer(a1.hash) : "FAIL " + a1.reason + " " + a1.detail}`);
  if (!a1.ok) process.exit(1);
  await pub.waitForTransactionReceipt({ hash: a1.hash });

  const p1 = await payFromOps(small, USDC("4.2"));
  console.log(`[3] pay 4.2 via Privy (ops, under cap): ${p1.ok ? "OK " + explorer(p1.hash) : "FAIL " + p1.reason + " " + p1.detail}`);
  if (!p1.ok) process.exit(1);
  await pub.waitForTransactionReceipt({ hash: p1.hash });
  console.log(`    supplier now ${await balance(supplier)}\n`);

  // --- 4..5: large invoice, approval path ---
  // Same buyer of record (ops wallet approves), but 6 > 5 cap: Privy must refuse to sign for
  // the ops wallet. The contract would accept the call, so the only thing stopping it is policy.
  const large = await submit(ops, supplier, USDC("6"), "INV-2026-0144");
  console.log(`[4] submitted invoice #${large} for 6 USDC, buyer = ops wallet`);

  const a2 = await approveInvoice(large);
  console.log(`    approve via Privy (ops): ${a2.ok ? "OK " + explorer(a2.hash) : "FAIL " + a2.reason + " " + a2.detail}`);
  if (!a2.ok) process.exit(1);
  await pub.waitForTransactionReceipt({ hash: a2.hash });

  const p2 = await payFromOps(large, USDC("6"));
  console.log(`    pay 6 via Privy (ops, over cap): ${p2.ok ? "UNEXPECTED OK " + explorer(p2.hash) : "DENIED -> " + p2.reason + " :: " + p2.detail.slice(0, 160)}`);
  if (p2.ok || p2.reason !== "policy_denied") {
    console.log("    expected a policy denial from Privy");
    process.exit(1);
  }

  const p3 = await payFromTreasury(large, USDC("6"));
  console.log(`[5] pay 6 via Privy (treasury, 2 approver keys): ${p3.ok ? "OK " + explorer(p3.hash) : "FAIL " + p3.reason + " " + p3.detail}`);
  if (!p3.ok) process.exit(1);
  await pub.waitForTransactionReceipt({ hash: p3.hash });

  const owner = await pub
    .readContract({ address: c.RECEIVABLE_TOKEN_ADDRESS as Address, abi: receivableTokenAbi, functionName: "ownerOf", args: [large] })
    .catch(() => "burned (settled)");
  console.log(`    receivable #${large}: ${owner}`);
  console.log(`    supplier now ${await balance(supplier)}`);
  console.log("\nDay 1 gate: PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
