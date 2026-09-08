# Demo video script

Target 3:30. Hard limits from ETHGlobal: 2 to 4 minutes, 720p or better, clear narration, no music, no speed-ups. Record in one take at normal speed; trim only the start and end.

## Before you press record

- Both servers running: agent API on :8790, dashboard on :3000. Browser at 100% zoom, window maximised, only these tabs open: dashboard, Arcscan, ENS app (optional).
- Buyer page: click **Reset demo** so the inbox is empty and the three fixtures replay as new invoices.
- Wallet balances: ops >= 12 USDC, treasury >= 15 USDC, pool cash >= 15 USDC, burner >= 5. Check on the Buyer and Pool pages.
- Phone unlocked with World App open, if you are doing the World beat live. Otherwise skip beat 6 and use the pre-verified supplier.
- Do one full dry run without recording. Note where you hesitate.
- Microphone test: 10 seconds, play it back.

## The take

### Beat 1, 0:00 to 0:30, the problem

Screen: Buyer page, empty queue.

Say: "This is PayRail, an accounts-payable agent for wholesale B2B, built on Arc. A wholesaler gets hundreds of invoices as EDI files. Someone has to match each one against the purchase order and what the warehouse received, find the supplier's payment details, and pay it, under limits the finance team sets. PayRail does that job, with USDC on Arc, and with the limits enforced by Privy before any transaction exists."

### Beat 2, 0:30 to 1:15, the agent works the inbox

Click: **Process inbox**. Let the log fill.

Say while it runs: "Three EDI 810 invoices just arrived. The agent parses them, no AI needed, it's a fixed format. It three-way matches each against the PO and the goods receipt. Then it resolves each supplier from ENS: `acme.payrail.eth` holds the supplier's Arc address, payment terms and discount cap as text records on ENSv2. Onboarding a supplier is a name, not a config change."

Point at the three rows as they land: "Acme, $4,200, clean match, paid automatically. Blue Ridge, $12,600, clean, but over the cap, waiting for approval. Northwind, $6,850, rejected on-chain: a 5% price variance and 400 cases billed against 380 received. The rejection reason is in the event log."

Click one **pay** link to show Arcscan for two seconds, come back.

### Beat 3, 1:15 to 1:50, why the big one waited

Screen: amber approvals panel.

Say: "The ops wallet is a Privy server wallet. Its policy says: only our registry contract, only on Arc, and at most 5,000 dollars. On testnet that's 5 USDC. Blue Ridge is 12,600, so Privy refused to sign. Not our code, Privy. The agent can't change that policy, because the approvers own it."

### Beat 4, 1:50 to 2:25, the supplier gets paid early

Click: Supplier page, **Blue**. Show the identity card. Click **Sell to pool**.

Say: "Blue Ridge is on net 60 and doesn't want to wait. Its approved invoice is a receivable token on Arc. It sells the token to the early-pay pool and gets 12.37 USDC today instead of 12.60 in two months. Twelve percent annualised, priced by days to due date. Depositors in the pool earn that discount."

### Beat 5, 2:25 to 3:00, two humans approve, the pool collects

Click: Buyer page, **Approve as Controller**, then **Approve as CFO**. Then Pool page.

Say: "The treasury wallet is owned by a two-of-three Privy key quorum. Controller approves, CFO approves, Privy signs with both keys and pays. And because the pool holds the receivable, the money goes to the pool. Pool cash is back to where it started, plus the discount."

### Beat 6, 3:00 to 3:20, a human behind the supplier

Option A, live: Supplier page, **Verify with World ID**, scan with phone. Say: "Before a supplier gets paid the first time, a human has to stand behind the name. World ID proof, verified by the agent, written into the supplier's ENS record."

Option B, pre-verified: point at "verified human" on a supplier card and say the same sentence.

### Beat 7, 3:20 to 3:30, close

Screen: Buyer page.

Say: "Everything you saw is also an MCP server, so any agent can run accounts payable through it. PayRail: EDI in, USDC out, humans where it matters. Thanks."

## After the take

- Trim dead air at the start and end only. No speed changes, no music.
- Export 1080p, upload to YouTube as Unlisted, or Loom. Copy the link into the ETHGlobal submission's demo field.
- Keep the raw file.

## If something breaks on camera

- Stop, run **Reset demo**, re-fund if a balance is low, start over. A clean second take beats a rescued first one.
- If World App fails to verify, use Option B and move on.
