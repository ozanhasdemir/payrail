"use client";

import { useCallback, useEffect, useState } from "react";
import { api, usdc, money, type Health, type Invoice, type PoolStats } from "@/lib/api";
import { AddrLink, Button, Card, Empty, Stat, TxLink } from "@/components/ui";

export default function PoolPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, s, i] = await Promise.all([api.health(), api.pool(), api.invoices()]);
      setHealth(h);
      setStats(s);
      setInvoices(i);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const deposit = async () => {
    setBusy(true);
    try {
      const r = await api.deposit(Number(amount));
      setLastTx(r.hash);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const explorer = health?.explorer ?? "https://testnet.arcscan.app";
  const financed = invoices.filter((i) => i.txs.sell);
  const held = financed.filter((i) => i.status !== "paid");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Early-pay pool</h1>
        <p className="text-sm text-slate-500">
          Depositors fund USDC. Suppliers sell approved receivables at a discount priced by days to due date. When the buyer settles, the pool collects face value.
        </p>
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Net asset value" value={stats ? `${usdc(stats.totalAssets, 4)} USDC` : "—"} sub="cash + receivables held" />
        <Stat label="Cash" value={stats ? `${usdc(stats.cash, 4)} USDC` : "—"} sub="available to buy receivables" />
        <Stat label="Receivables held" value={stats ? `${usdc(stats.outstandingFace)} USDC` : "—"} sub={`${held.length} open`} />
        <Stat label="Rate" value={stats ? `${Number(stats.rateBps) / 100}% APR` : "—"} sub="discount = face × rate × days/365" />
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
        <Card title="Deposit (demo LP)">
          <div className="flex items-end gap-2">
            <label className="flex-1 text-sm">
              <span className="text-xs text-slate-500">USDC</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono" />
            </label>
            <Button onClick={deposit} busy={busy}>
              Deposit
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Deposits mint pool shares at current NAV. Pool: <AddrLink address={health?.pool} explorer={explorer} />
          </p>
          {lastTx && <div className="mt-2"><TxLink hash={lastTx} explorer={explorer} label="deposit tx" /></div>}
        </Card>

        <Card title="Financed receivables">
          {financed.length === 0 ? (
            <Empty>No receivables bought yet. A supplier sells from the Supplier page.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-3">#</th>
                  <th className="pb-2 pr-3">Supplier</th>
                  <th className="pb-2 pr-3 text-right">Face</th>
                  <th className="pb-2 pr-3">State</th>
                  <th className="pb-2">Tx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {financed.map((i) => (
                  <tr key={i.docHash}>
                    <td className="py-2 pr-3 font-mono text-xs text-slate-500">{i.id}</td>
                    <td className="py-2 pr-3">{i.supplierName}<div className="text-xs text-slate-500">{i.invoiceNumber} · {money(i.amount, i.currency)}</div></td>
                    <td className="py-2 pr-3 text-right font-mono">{usdc(i.amountOnChain)} USDC</td>
                    <td className="py-2 pr-3 text-xs">{i.status === "paid" ? <span className="text-emerald-700">buyer settled, pool collected face</span> : <span className="text-amber-700">held, waiting for buyer</span>}</td>
                    <td className="py-2 flex flex-col gap-0.5">
                      <TxLink hash={i.txs.sell} explorer={explorer} label="bought" />
                      <TxLink hash={i.txs.pay} explorer={explorer} label="settled" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
