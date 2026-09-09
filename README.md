# PayRail

An agentic accounts-payable rail for wholesale B2B, built for ETHOnline 2026.

An invoice arrives the way it does today, as an EDI 810 or a PDF. The buyer's agent parses it, matches it to the purchase order, resolves the supplier from an ENS name, checks the supplier's agent is backed by a verified human, and pays USDC on Arc from a wallet whose policies decide what pays automatically and what needs a human signature. On the other side, the supplier's approved invoice becomes a receivable it can sell into a USDC early-pay pool and get paid today.

## Status

Working end to end on Arc testnet: three fixture invoices produce three outcomes (auto-paid, approved and queued for 2-of-3 approval, rejected on-chain with match reasons), a supplier sells a receivable to the pool, and the approvers' payment settles into the pool. Dashboard covers buyer, supplier and pool. 

## Demo flow

1. Buyer page, **Process inbox**: the agent parses three EDI 810s, three-way matches them against POs and receipts, resolves each supplier from `*.payrail.eth`, and records them on Arc from the Privy ops wallet.
   - Acme Foods, $4,200 clean: approved and paid automatically (4.2 USDC, under the 5 USDC policy cap).
   - Blue Ridge Packaging, $12,600 clean: approved, then Privy refuses the ops wallet and the invoice waits for humans.
   - Northwind Beverages, $6,850: price variance and short receipt, recorded then rejected on-chain with the reasons.
2. Supplier page, Blue Ridge, **Sell to pool**: the receivable token moves to the pool, Blue Ridge gets face value minus a 12% APR discount today.
3. Buyer page, **Approve as Controller** then **Approve as CFO**: two quorum keys sign, the treasury wallet pays, and the money lands in the pool because the pool holds the receivable.
4. Pool page: NAV rose by the discount at purchase; cash is back after settlement.
5. Supplier page, **Verify with World ID**: prove a human backs the supplier; the nullifier is written into the supplier's ENS record.

**Reset demo** clears the agent's memory and salts document hashes so the same three files replay as new invoices.

## Layout

| Folder | What | Stack |
|---|---|---|
| `contracts/` | InvoiceRegistry, ReceivableToken, EarlyPayPool | Solidity, Foundry, Arc testnet |
| `agent/` | Buyer AP agent and MCP server | Node 22, TypeScript, viem, Privy, Claude |
| `web/` | Buyer, supplier and pool dashboards | Next.js 15, Privy React, World IDKit |
| `subgraph/` | Event indexing | The Graph |
| `fixtures/` | Sample 810s, PDFs, POs, receipts | |

## Where each sponsor integration lives

| Sponsor | Where to look |
|---|---|
| Arc | `contracts/` deployed to Arc testnet, all payments in USDC |
| Privy | `agent/src/pay/` server wallet, policies, approval quorum |
| ENS | `agent/src/resolve/` ENSv2 subnames and text records on Sepolia |
| World | `agent/src/verify/` and `web/` supplier onboarding with Selfie Check |
| Circle Agent Stack | supplier agent wallet, `agent/src/pay/supplier.ts` |
| Bazantic | `agent/src/mcp/` MCP server and published recipe |
| The Graph | `subgraph/` |

## Run locally

```bash
npm install -g pnpm@9
pnpm install
cp .env.example .env   # fill in keys, see comments in the file
pnpm --filter @payrail/agent dev     # agent API on :8790
pnpm --filter @payrail/web dev       # dashboard on :3000
```

Agent CLI without the dashboard:

```bash
cd agent
pnpm cli run-all                 # process the three fixtures
pnpm cli list                    # agent state
pnpm cli approve <id> 1          # first approver
pnpm cli approve <id> 2          # second approver, pays from treasury
pnpm cli sell <id>               # supplier sells receivable to the pool
pnpm cli pool [seed <usdc>]      # pool stats, optional LP deposit
pnpm test                        # parser and matcher unit tests
```

One-time setup scripts, all idempotent: `agent/src/scripts/privy-policies.ts` (Privy policy rules), `agent/src/scripts/ens-suppliers.ts` (supplier ENS records).

Contracts: see `contracts/README.md`.

## Deployed addresses (Arc testnet, chain id 5042002)

| Contract | Address |
|---|---|
| InvoiceRegistry | [`0x9be7b5ab46d311eda6c4be4f61c981fe8afbbc90`](https://testnet.arcscan.app/address/0x9be7b5ab46d311eda6c4be4f61c981fe8afbbc90) |
| ReceivableToken | [`0x4ADeF613F08c79D65685b7fED7de51c2d401CAec`](https://testnet.arcscan.app/address/0x4ADeF613F08c79D65685b7fED7de51c2d401CAec) |
| EarlyPayPool | [`0x58bb089d20938e3e161792b9e5d75fec22910ea5`](https://testnet.arcscan.app/address/0x58bb089d20938e3e161792b9e5d75fec22910ea5) |

Amounts are native USDC with 18 decimals, so 1 USDC = `1e18`. Pool rate: 12% APR (`annualRateBps = 1200`).

ENS: `payrail.eth` on the ENSv2 Sepolia beta, resolver `0x65044F7DFb2183bB4Ce5cb022c7CF80431d8C252`. Supplier records live under wildcard subnames such as `acme.payrail.eth`.

## License

MIT
