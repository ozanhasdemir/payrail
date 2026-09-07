# PayRail

An agentic accounts-payable rail for wholesale B2B, built for ETHOnline 2026.

An invoice arrives the way it does today, as an EDI 810 or a PDF. The buyer's agent parses it, matches it to the purchase order, resolves the supplier from an ENS name, checks the supplier's agent is backed by a verified human, and pays USDC on Arc from a wallet whose policies decide what pays automatically and what needs a human signature. On the other side, the supplier's approved invoice becomes a receivable it can sell into a USDC early-pay pool and get paid today.

## Status

Day 1 of 6. Scaffold only. Roadmap and daily gates are tracked in `docs/`.

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
corepack enable && corepack prepare pnpm@9 --activate
pnpm install
cp .env.example .env   # fill in keys
pnpm agent
pnpm web
```

Contracts: see `contracts/README.md`.

## Deployed addresses (Arc testnet, chain id 5042002)

| Contract | Address |
|---|---|
| InvoiceRegistry | [`0x6883e1465a1d1017392ccad68b1d137aec911db7`](https://testnet.arcscan.app/address/0x6883e1465a1d1017392ccad68b1d137aec911db7) |
| ReceivableToken | [`0x75498b299A16A21355b40437f819726aF79Cc1dc`](https://testnet.arcscan.app/address/0x75498b299A16A21355b40437f819726aF79Cc1dc) |
| EarlyPayPool | [`0x45029f750496fad8a103bdfd1258f493b8f368b6`](https://testnet.arcscan.app/address/0x45029f750496fad8a103bdfd1258f493b8f368b6) |

Amounts are native USDC with 18 decimals, so 1 USDC = `1e18`. Pool rate: 12% APR (`annualRateBps = 1200`).

ENS: `payrail.eth` on the ENSv2 Sepolia beta, resolver `0x65044F7DFb2183bB4Ce5cb022c7CF80431d8C252`. Supplier records live under wildcard subnames such as `acme.payrail.eth`.

## License

MIT
