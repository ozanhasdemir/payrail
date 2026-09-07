# contracts

Solidity, Foundry, deployed to Arc testnet.

| Contract | Role |
|---|---|
| `InvoiceRegistry` | Lifecycle: Submitted, Approved, Paid or Financed, Settled. Holds the invoice hash, parties, amount, due date. `pay()` pulls USDC from the buyer and forwards it to whoever currently owns the receivable. |
| `ReceivableToken` | ERC-721 minted to the supplier when the buyer approves. Ownership equals the right to be paid. |
| `EarlyPayPool` | USDC vault. Depositors mint shares. Suppliers sell approved receivables at a discount priced by days to due date. The pool collects face value when the buyer pays. |

## Setup

```bash
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts --no-commit
forge build
forge test -vvv
```

## Deploy

```bash
source ../.env
forge script script/Deploy.s.sol --rpc-url arc --broadcast --private-key $DEPLOYER_PRIVATE_KEY
```

Deployed addresses are recorded in the root README once live.
