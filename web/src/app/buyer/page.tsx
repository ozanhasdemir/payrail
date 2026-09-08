"use client";

import { useCallback, useEffect, useState } from "react";
import { api, money, usdc, daysUntil, type Health, type Invoice, type Wallets } from "@/lib/api";
import { AddrLink, Button, Card, Empty, Stat, StatusPill, TxLink } from "@/components/ui";

export default function BuyerPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [wallets, setWallets] = useState<Wallets>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, i, w] = await Promise.all([api.health(), api.invoices(), api.wallets()]);
      setHealth(h);
      setInvoices([...i].reverse());
      setWallets(w);
      setError(null);
    } catch (e) {
      setError(`Agent API unreachable at ${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8790"}: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const run = async () => {
    setBusy("run");
    setLogs([]);
    try {
      const r = await api.run();
      setLogs(r.logs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const approve = async (id: string, approver: "1" | "2") => {
    setBusy(`${id}:${approver}`);
    try {
      await api.approve(id, approver);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const explorer = health?.explorer ?? "https://testnet.arcscan.app";
  const pending = invoices.filter((i) => i.status === "pending_approval");
  const totals = {
    paid: invoices.filter((i) => i.status === "paid").reduce((a, i) => a + i.amount, 0),
    pending: pending.reduce((a, i) => a + i.amount, 0),
    rejected: invoices.filter((i) => i.status === "rejected" || i.status === "blocked").length,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Accounts payable</h1>
          <p className="text-sm text-slate-500">Invoices arrive as EDI 810. The agent matches, resolves the supplier from ENS, and pays under policy.</p>
        </div>
        <Button onClick={run} busy={busy === "run"}>
          Process inbox
        </Button>
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Paid" value={money(totals.paid)} sub={`${invoices.filter((i) => i.status === "paid").length} invoices`} />
        <Stat label="Awaiting approval" value={money(totals.pending)} sub={`${pending.length} over the ${health?.autoPayCapUsdc ?? "5"} USDC cap`} />
        <Stat label="Ops wallet" value={`${Number(wallets.ops?.usdc ?? 0).toFixed(2)} USDC`} sub="Privy · agent key · policy capped" />
        <Stat label="Treasury wallet" value={`${Number(wallets.treasury?.usdc ?? 0).toFixed(2)} USDC`} sub="Privy · 2-of-3 approvers" />
      </div>

      {pending.length > 0 && (
        <Card title={`Approvals needed (${pending.length})`}>
          <div className="flex flex-col gap-3">
            {pending.map((i) => {
              const has1 = i.approvals.some((a) => a.approver === "1");
              const has2 = i.approvals.some((a) => a.approver === "2");
              return (
                <div key={i.docHash} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
                  <div>
                    <div className="font-medium">
                      {i.supplierName} · {i.invoiceNumber} · {money(i.amount, i.currency)}
                    </div>
                    <div className="text-xs text-slate-600">
                      Privy refused the ops wallet at {usdc(i.amountOnChain)} USDC. Two of three approvers must sign the treasury payment.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant={has1 ? "ghost" : "primary"} disabled={has1} busy={busy === `${i.id}:1`} onClick={() => approve(i.id!, "1")}>
                      {has1 ? "✓ Controller" : "Approve as Controller"}
                    </Button>
                    <Button variant={has2 ? "ghost" : "primary"} disabled={has2} busy={busy === `${i.id}:2`} onClick={() => approve(i.id!, "2")}>
                      {has2 ? "✓ CFO" : "Approve as CFO"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Invoice queue" right={<span className="text-xs text-slate-500">{invoices.length} documents</span>}>
        {invoices.length === 0 ? (
          <Empty>No invoices yet. Click Process inbox to run the three fixture 810s.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-3">#</th>
                  <th className="pb-2 pr-3">Supplier</th>
                  <th className="pb-2 pr-3">Invoice</th>
                  <th className="pb-2 pr-3 text-right">Amount</th>
                  <th className="pb-2 pr-3 text-right">On Arc</th>
                  <th className="pb-2 pr-3">Terms</th>
                  <th className="pb-2 pr-3">Match</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2">Transactions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((i) => (
                  <tr key={i.docHash} className="align-top">
                    <td className="py-2 pr-3 font-mono text-xs text-slate-500">{i.id ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{i.supplierName}</div>
                      <div className="text-xs text-slate-500">
                        <span className="font-mono">{i.supplierEns}</span> → <AddrLink address={i.supplierArc} explorer={explorer} />
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="font-mono text-xs">{i.invoiceNumber}</div>
                      <div className="text-xs text-slate-500">PO {i.poNumber}</div>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{money(i.amount, i.currency)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs text-slate-600">{usdc(i.amountOnChain)} USDC</td>
                    <td className="py-2 pr-3 text-xs">
                      net{i.netDays}
                      <div className="text-slate-500">{i.status === "paid" ? "settled" : `due in ${daysUntil(i.dueDate)}d`}</div>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {i.match.exceptions.length === 0 ? (
                        <span className="text-emerald-700">3-way clean</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {i.match.exceptions.map((e, k) => (
                            <li key={k} className={e.severity === "block" ? "text-rose-700" : "text-amber-700"}>
                              {e.code}
                              {e.lineNumber ? ` L${e.lineNumber}` : ""}
                              {e.expected !== undefined && <span className="text-slate-500"> ({e.expected} → {e.actual})</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <StatusPill status={i.status} />
                      {i.paidBy && <div className="mt-1 text-[11px] text-slate-500">via {i.paidBy === "ops" ? "ops wallet (auto)" : "treasury (2-of-3)"}</div>}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-col gap-0.5">
                        <TxLink hash={i.txs.submit} explorer={explorer} label="record" />
                        <TxLink hash={i.txs.approve} explorer={explorer} label="approve" />
                        <TxLink hash={i.txs.reject} explorer={explorer} label="reject" />
                        <TxLink hash={i.txs.sell} explorer={explorer} label="sold to pool" />
                        <TxLink hash={i.txs.pay} explorer={explorer} label="pay" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {logs.length > 0 && (
        <Card title="Agent log">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-slate-700">{logs.join("\n")}</pre>
        </Card>
      )}
    </div>
  );
}
