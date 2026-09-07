# agent

Node 22 + TypeScript. The buyer's accounts-payable agent, plus the MCP server that exposes the rail.

```
src/
  ingest/    EDI 810 + PDF -> canonical invoice JSON (Claude structured output)
  match/     three-way match against PO and receipt
  resolve/   supplier ENSv2 subname -> USDC address, terms, discount, World ID
  verify/    World ID proof check, refuse unverified suppliers
  pay/       Privy server wallet: policy check, auto-pay or queue for approval
  mcp/       MCP server: submit_invoice, get_invoice_status, approve_invoice,
             pay_invoice, sell_receivable, pool_stats
```

Run: `pnpm dev` (HTTP API for the dashboard) or `pnpm mcp` (stdio MCP server).
