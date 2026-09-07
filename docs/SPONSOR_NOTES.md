# Sponsor facts we verified, and what they change

Checked against live docs on 2026-09-07. Each line either confirms a roadmap assumption or changes the design.

## Arc testnet

- Chain id 5042002, RPC `https://rpc.testnet.arc.io`, explorer `https://testnet.arcscan.app` (Blockscout, so `forge verify-contract --verifier blockscout --verifier-url https://testnet.arcscan.app/api/` works).
- EVM compatible, Osaka baseline. Foundry is the documented tool. EIP-1559, minimum `maxFeePerGas` 20 gwei or the tx fails.
- **USDC is the native gas token.** `msg.value` is USDC with 18 decimals. The same balance is also exposed as an ERC-20 at `0x3600000000000000000000000000000000000000` with 6 decimals.
- Faucet: `https://faucet.circle.com`, pick Arc Testnet.

**Design change:** payments and the pool use native USDC (`msg.value`), not ERC-20 `transferFrom`. No approve step, and a Privy policy can cap the payment with a plain `value lte` rule because value literally is dollars. 1 USDC = 1e18 in contracts.

## Privy

- Policy JSON: `version 1.0`, `chain_type ethereum`, rules on `eth_sendTransaction` with conditions on `ethereum_transaction.to` (`in` allowlist) and `ethereum_transaction.value` (`lte` cap). Chain-type scoped, so one policy covers Arc.
- Key quorums: authorization keys with an m-of-n threshold. Owner of a wallet can be a key quorum, which is our 2-of-3 approval for large invoices.
- Docs: `docs.privy.io/controls/policies/overview`, `docs.privy.io/controls/authorization-keys/keys/create/key-quorum`, `docs.privy.io/transaction-management/setups/quorum-approval`.

**Plan:** buyer wallet policy = `to in [InvoiceRegistry]` and `value lte 5000e18`. Invoices above the cap are routed to a second wallet owned by a 2-of-3 key quorum.

## ENSv2 on Sepolia

- Beta is live. App at `https://app.ens.dev`. Addresses in `.env.example`.
- Resolution: viem `getEnsAddress` / `getEnsText` route through UniversalResolverV2 with no manual work, provided viem is a version on the ENSv2 readiness list.
- Records live on a per-account resolver instance (PublicResolverV2). Subname owners without resolver roles revert with `EACUnauthorizedAccountRoles`, so the company name owner sets records on behalf of suppliers, or grants roles.
- Subname creation goes through the name's registry (UserRegistryImpl). Exact call sequence is Day 1 homework, from the contract developers tutorial.

**Plan:** register the company name on Sepolia at app.ens.dev. Supplier subnames carry text records `payrail.addr.arc`, `payrail.terms`, `payrail.discount.bps`, `payrail.worldid`.

**Day 1 result (2026-09-07):** `payrail.eth` registered on ENSv2 Sepolia, owned by the burner wallet. Registration was gasless (burner nonce stayed 0). The app deployed a per-account resolver at `0x65044F7DFb2183bB4Ce5cb022c7CF80431d8C252`. `setText` from the burner key succeeded on the parent node and on `acme.payrail.eth` without any subname having been created in a registry: UniversalResolverV2 falls back to the parent resolver (wildcard resolution, ENSIP-10) and returns the record. So supplier onboarding is one `setText` per key, no registry calls, no roles. Tokenized subnames through a UserRegistry stay a stretch for the "subname tokenization" part of the bounty; records-first is what ships.

## World ID Selfie Check

- World is the sponsor. Tools for Humanity is the company that builds World and World ID, which is why the generic docs point at a toolsforhumanity.com email. Hackers do not use that email.
- **Access for ETHOnline:** World's prize page links a Sandbox Access Form. Fill it with the app id from developer.world.org. Sandbox mode has test users, so no real selfie is needed during development. Testing guide: `docs.world.org/world-id/sandbox/testing-selfie-check`.
- Once enabled: IDKit preset `selfieCheckLegacy({ signal })`, works on web through `@worldcoin/idkit`, proof verified server-side via the verification endpoint.
- **Prize requires a feedback document** covering the Selfie Check docs and integration flow, Developer Portal navigation and debugging, sandbox states, proof flows, test users, errors and edge cases, and what was confusing, missing, or broken. Ozan keeps notes from the first portal login onward; Claude compiles them into `docs/WORLD_FEEDBACK.md` on Day 5.
- Prize is split, up to 3 teams at $1,166 each, so the feedback document is what separates us from other entries.
- Fallback if sandbox access does not arrive in time: `proofOfHuman` preset. Same flow, weaker claim on the bounty.

**Action today:** create the app on developer.world.org, then submit the Sandbox Access Form from the World prize page.

## Circle Agent Wallets

- `ARC-TESTNET` is a supported network. Agent Wallets are driven through the Circle CLI, with per-wallet policies (transfer limits, allowlists, time-bound caps) and 2-of-2 MPC custody.
- Setup is a CLI bootstrap from `https://agents.circle.com`.

**Plan:** supplier agent wallet on Circle, buyer agent wallet on Privy. Two companies, two stacks, one rail. Stays a stretch item.

## Still open

- Exact ENSv2 subname creation calls (Day 1, me).
- Whether Privy's dashboard lets us add Arc as a custom chain for the server wallet, or whether the SDK just needs the chain id in the request (Day 1 smoke test).
