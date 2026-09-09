# PayRail, explained from the start

## One sentence

PayRail is an accounts-payable agent for wholesale businesses: invoices come in, the agent checks them, pays the right supplier in USDC on Arc under limits the finance team set, and lets suppliers get paid early by selling the invoice to a pool.

## The world before PayRail

A wholesaler, say Harbor Wholesale, buys goods from many suppliers. Every purchase follows the same paper trail:

1. **Purchase order (PO).** Harbor tells Acme Foods: send us 120 cases of tomato sauce at $18.50 and 80 cases of olive oil at $24.75. PO number 4500012345.
2. **Goods receipt.** The truck arrives, the warehouse counts what came in and records it against the PO.
3. **Invoice.** Acme sends a bill: 120 cases at $18.50, 80 at $24.75, total $4,200, pay within 30 days.

In wholesale these invoices arrive as **EDI 810** files. EDI is a fifty-year-old machine format that every ERP speaks. An 810 is an invoice. It looks like `BIG*20260901*INV-2026-0142*20260820*4500012345` and `IT1*1*120*CA*18.50`. Ugly, but fully structured, which matters later.

Someone in accounts payable then does the **three-way match**: does the invoice agree with the PO and with what was actually received? Right quantity, right price, right supplier, nothing billed that never arrived. If yes, schedule the payment for the due date. If not, hold it and argue.

Two problems with this world:

- **For the buyer**, it is slow, manual work, and the person doing it also holds the power to pay anyone. Controls are policies on paper, enforced by hoping people follow them.
- **For the supplier**, "net 60" means shipping goods today and seeing cash in two months. Small suppliers borrow against those invoices from factoring companies at painful rates, with paperwork and delay.

## What PayRail changes

- **The agent does the match.** Deterministically, from the EDI file, against the PO and the receipt. Every decision has a written reason.
- **Money moves in USDC on Arc.** Arc is a blockchain built by Circle where USDC, a dollar stablecoin, is the native currency. A payment is a transaction anyone can verify on the block explorer.
- **The limits are enforced by the wallet, not by the app.** The agent's wallet is a Privy server wallet with a policy: it may only pay our invoice contract, only on Arc, and only up to a cap. Privy refuses to sign anything else. Above the cap, a different wallet is used that only signs when two of three named people approve. The agent cannot change these rules, because the approvers own them.
- **Suppliers are names.** Each supplier has an ENS name under the company's name, like `acme.payrail.eth`, and the name holds their payment address, terms and verification status. Onboarding a supplier is registering a name.
- **An approved invoice is a token.** The moment Harbor approves, the supplier receives a receivable token: proof that Harbor owes them. They can hold it to due date, or sell it to a pool today for a small discount. When Harbor pays, the money goes to whoever holds the token.
- **A human stands behind each supplier.** World ID proves a real person is behind the supplier name, without revealing who.

## The cast

| Who | Role in the demo |
|---|---|
| Harbor Wholesale | The buyer. Runs the agent. Has an ops wallet and a treasury wallet. |
| Controller and CFO | Two humans at Harbor whose approval is needed above the cap. |
| Acme Foods | Supplier. Clean $4,200 invoice, net 30. Gets paid automatically. |
| Blue Ridge Packaging | Supplier. Clean $12,600 invoice, net 60. Over the cap, waits for approval, sells the receivable early. |
| Northwind Beverages | Supplier. $6,850 invoice with a 5% price increase and 400 cases billed against 380 received. Rejected. |
| Pool depositors | Anyone who puts USDC in the early-pay pool and earns the discount. |

Testnet faucets do not give out $12,600, so on-chain amounts are scaled 1:1000. $12,600 becomes 12.60 USDC. The cap of 5 USDC stands for $5,000.

## The flow, step by step

### 1. Invoices arrive

Three EDI 810 files sit in the inbox. On the buyer page you can open one and see the raw segments. Point out `BIG` (invoice header), `N1*SU` (the supplier), `IT1` (a line item), `TDS` (total in cents).

Under the hood: nothing yet. In production the inbox is an SFTP folder or an EDI network.

### 2. The agent parses and matches

Click Process inbox. For each file the log shows: parsed, matched, resolved, recorded, decided.

Under the hood: our parser reads the X12 grammar. No AI is involved, because EDI is a fixed format and a parser you can test beats a model you have to trust. Then the three-way match runs: PO found, supplier matches, each line on the PO, price within 0.5%, billed no more than received or ordered, arithmetic correct. Northwind fails on two lines.

### 3. The supplier is resolved from ENS

The log shows `resolved acme.payrail.eth -> 0xC1Ce…, net30`.

Under the hood: the agent reads text records from the ENS name on Ethereum Sepolia through ENSv2's universal resolver. The records were written by the company's key when the supplier was onboarded. Wildcard resolution means the subname never had to be registered separately, the parent name's resolver answers for it.

### 4. The invoice is recorded on Arc

Under the hood: the ops wallet calls `submit` on the InvoiceRegistry contract with the document hash, buyer, supplier, amount and due date. The document hash makes double submission impossible.

### 5. Approve or reject, on-chain

Acme and Blue Ridge are approved: the ops wallet calls `approve`, which mints the receivable token to the supplier. Northwind is rejected: the ops wallet calls `reject` with the reasons, which land in the event log for anyone to audit.

### 6. Pay, or wait for humans

Acme, 4.2 USDC, is under the cap: the ops wallet pays, and Acme's balance goes up. Blue Ridge, 12.6 USDC, is over the cap: Privy refuses to sign for the ops wallet with a policy violation, and the invoice appears in the approvals panel.

This is the most important moment of the demo. The refusal comes from Privy's policy engine, before any transaction exists. Our code did not check the amount; the wallet infrastructure did.

### 7. Blue Ridge sells its receivable

On the supplier page, Blue Ridge sees its approved invoice, a quote of about 12.37 USDC, and clicks Sell to pool.

Under the hood: the receivable token moves to the EarlyPayPool contract, the pool pays face value minus a discount computed as face × 12% × days remaining ÷ 365. The pool's net asset value rises by the discount at that moment, because it now holds a claim worth 12.60 that it bought for 12.37.

### 8. Two approvals, the treasury pays, the pool collects

Back on the buyer page: Approve as Controller, then Approve as CFO.

Under the hood: each approval is one key of a 2-of-3 Privy key quorum that owns the treasury wallet. At two, the agent asks Privy to sign the payment with both keys. The registry sends the money to whoever holds the receivable, which is now the pool. Pool cash goes back to where it started, plus the discount. Depositors earned it.

### 9. A human behind the supplier

On the supplier page, Verify with World ID opens a QR code. Scanning it with World App produces a proof that a real person, one person, vouches for this supplier. The agent verifies it with World and writes the nullifier into the supplier's ENS record. From then on the supplier card says "verified human", and the agent sees that flag when it resolves the name.

### 10. Any agent can use it

Everything above is also exposed as an MCP server with nine tools. Claude Desktop or any other agent can process an invoice, approve it, quote and sell a receivable. That is what the Bazantic prize track is about.

## The technologies, in plain terms

- **Arc.** Circle's blockchain for stablecoin finance. USDC is the gas token, so fees are cents and every balance is in dollars. We deployed three Solidity contracts to its testnet: InvoiceRegistry, ReceivableToken, EarlyPayPool.
- **USDC.** A dollar stablecoin issued by Circle. On Arc it is the native coin, which is why our contracts move it like ether.
- **Privy.** Wallet infrastructure. A server wallet is a wallet whose key lives in Privy's secure enclave, controlled by authorization keys we hold. Policies restrict what a wallet may sign. Key quorums require m-of-n signatures. We created all of it through their API: three keys, two quorums, two policies, two wallets.
- **ENS and ENSv2.** The Ethereum Name Service, names like `payrail.eth` that resolve to addresses and text records. ENSv2 is the new version in beta on Sepolia with hierarchical registries. We use `payrail.eth` as the company and subnames for suppliers, with records for address, terms, discount cap and verification.
- **World ID.** Proof of personhood. World App verifies humans; apps get a proof and a nullifier, a stable anonymous identifier per app action. We bind the nullifier to the supplier's ENS name.
- **MCP.** Model Context Protocol, the standard way to expose tools to AI agents. Our server wraps the same functions the dashboard uses.
- **Foundry and viem.** Foundry compiles, tests and deploys the Solidity contracts. viem is the TypeScript library the agent uses to talk to Arc and Sepolia.
- **EDI X12 810.** The invoice document standard in North American wholesale. Our parser handles the segments that carry money and identity.

## Why put any of this on a blockchain

Expect this question. The honest answer:

- **The policy lives with the key.** In a normal system the limit is a line of code in the payments service, and whoever deploys the service can change it. Here the wallet cannot sign outside its policy, and the people who can change the policy are named in a quorum.
- **A receivable you can sell in one transaction.** The invoice token is the asset. Selling it to the pool takes two transactions and no factoring company, no assignment paperwork, no bank. Anyone can supply liquidity to the pool.
- **Identity and payment details in a public name.** Suppliers manage their own record. The buyer never stores bank details, and a changed record is visible history, not a phishing email asking to "update our account".
- **Auditable disagreement.** A rejection with reasons is on-chain. Both sides see the same record.

## What is demo-grade, said plainly

- Amounts are scaled 1:1000 for testnet.
- The two approver keys live on the agent's server for the demo. In production each approver holds their key on their own device. Privy's quorum works the same way either way.
- World ID uses the standard proof-of-human flow. Selfie Check, the sponsor's beta feature, needs a flag from World that was not confirmed when we built.
- Only EDI invoices are supported. PDF invoices would need a model to read them; the switch exists in the config but the path is not built.
- The pool has a fixed 12% rate set by its owner and does not price supplier risk. A real pool would.

## Questions your teammate may ask

**What if the invoice is a PDF?** Not supported today. The design has a slot for it: a model extracts fields into the same schema, then the same match runs. We chose not to depend on a model for the demo.

**What if a supplier has no ENS name?** The agent stops with "no on-chain supplier address" and nothing is recorded. Onboarding comes first.

**Who puts money in the pool?** Anyone. In the demo, our burner wallet deposited 60 USDC. Depositors hold shares that appreciate as discounts are earned.

**What if the buyer never pays?** The pool holds a receivable that does not settle. That is credit risk, the same risk a factoring company takes. Pricing it is future work.

**What does the agent decide, exactly?** Whether the match passed, which supplier address to pay, whether to pay now or queue. It never decides to pay outside the policy, because it cannot.

**Where is the AI?** In the word "agent" as a role: software that reads documents, checks them and acts. The current pipeline uses no language model. The MCP server is where language-model agents plug in.

## Running the demo

Both servers must be running: the agent API on port 8790 and the dashboard on port 3000. On the buyer page click Reset demo, then follow the script in `DEMO_SCRIPT.md`. Everything in this document is visible on screen within four minutes.
