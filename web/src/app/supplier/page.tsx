"use client";

import { useCallback, useEffect, useState } from "react";
import { api, money, usdc, daysUntil, type Health, type Invoice, type Supplier } from "@/lib/api";
import { AddrLink, Button, Card, Empty, Stat, StatusPill, TxLink } from "@/components/ui";
import { WorldVerify } from "@/components/WorldVerify";

export default function SupplierPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState<string>("blueridge");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotes, setQuotes] = useState<Record<string, { payout: string; discount: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, s, i] = await Promise.all([api.health(), api.suppliers(), api.invoices()]);
      setHealth(h);
      setSuppliers(s);
      setInvoices(i);
      setError(null);
      const open = i.filter((x) => (x.status === "approved" || x.status === "pending_approval") && x.id && !x.txs.sell);
      const q: Record<string, { payout: string; discount: string }> = {};
      await Promise.all(open.map(async (x) => { try { q[x.id!] = await api.quote(x.id!); } catch { /* not sellable */ } }));
      setQuotes(q);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const sell = async (id: string) => {
    setBusy(id);
    try {
      await api.sell(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const explorer = health?.explorer ?? "https://testnet.arcscan.app";
  const sup = suppliers.find((s) => s.label === selected);
  const mine = invoices.filter((i) => i.supplierEns?.toLowerCase() === sup?.ens.toLowerCase());
  const outstanding = mine.filter((i) => i.status !== "paid" && i.status !== "rejected" && i.status !== "blocked");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Supplier receivables</h1>
          <p className="text-sm text-slate-500">Approved invoices are receivable tokens. Sell one to the pool and get paid today instead of at due date.</p>
        </div>
        <div className="flex gap-1">
          {suppliers.map((s) => (
            <button key={s.label} onClick={() => setSelected(s.label)} className={`rounded-md px-3 py-1.5 text-sm ${selected === s.label ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
              {s.name.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</div>}

      {sup && (
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
          <Card title="Identity from ENS">
            <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-sm">
              <dt className="text-slate-500">Name</dt>
              <dd className="font-mono">{sup.ens}</dd>
              <dt className="text-slate-500">Display name</dt>
              <dd>{sup.resolved.displayName ?? "—"}</dd>
              <dt className="text-slate-500">Pays to</dt>
              <dd><AddrLink address={sup.resolved.arcAddress} explorer={explorer}>{sup.resolved.arcAddress}</AddrLink></dd>
              <dt className="text-slate-500">Terms</dt>
              <dd>{sup.resolved.terms ?? "—"}</dd>
              <dt className="text-slate-500">Max discount</dt>
              <dd>{sup.resolved.discountBps ? `${sup.resolved.discountBps / 100}%` : "—"}</dd>
              <dt className="text-slate-500">World ID</dt>
              <dd>
                <WorldVerify supplierEns={sup.ens} verified={!!sup.resolved.worldId} onVerified={refresh} />
              </dd>
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              Records live on <span className="font-mono">payrail.eth</span>&apos;s ENSv2 resolver on Sepolia and resolve through wildcard lookup. Onboarding a supplier is a name, not a config change.
            </p>
          </Card>
          <Stat label="Wallet balance" value={`${Number(sup.balance ?? 0).toFixed(2)} USDC`} sub="on Arc" />
          <Stat label="Outstanding" value={money(outstanding.reduce((a, i) => a + i.amount, 0))} sub={`${outstanding.length} approved, unpaid`} />
        </div>
      )}

      <Card title="Receivables">
        {mine.length === 0 ? (
          <Empty>No invoices for this supplier yet. Run the inbox from the Buyer page.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-3">#</th>
                  <th className="pb-2 pr-3">Invoice</th>
                  <th className="pb-2 pr-3 text-right">Face</th>
                  <th className="pb-2 pr-3">Due</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3 text-right">Pool pays now</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mine.map((i) => {
                  const q = i.id ? quotes[i.id] : undefined;
                  const sold = !!i.txs.sell;
                  const sellable = !!q && !sold && i.status !== "paid";
                  return (
                    <tr key={i.docHash}>
                      <td className="py-2 pr-3 font-mono text-xs text-slate-500">{i.id ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <div className="font-mono text-xs">{i.invoiceNumber}</div>
                        <div className="text-xs text-slate-500">PO {i.poNumber}</div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {money(i.amount, i.currency)}
                        <div className="text-xs text-slate-500">{usdc(i.amountOnChain)} USDC</div>
                      </td>
                      <td className="py-2 pr-3 text-xs">net{i.netDays} · {i.status === "paid" ? "settled" : `${daysUntil(i.dueDate)}d`}</td>
                      <td className="py-2 pr-3">
                        <StatusPill status={i.status} />
                        {sold && <div className="mt-1 text-[11px] text-slate-500">receivable sold to pool</div>}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-xs">
                        {q ? (
                          <>
                            <div>{usdc(q.payout)} USDC</div>
                            <div className="text-slate-500">discount {usdc(q.discount, 3)}</div>
                          </>
                        ) : sold ? (
                          <TxLink hash={i.txs.sell} explorer={explorer} label="sale tx" />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {sellable && (
                          <Button onClick={() => sell(i.id!)} busy={busy === i.id}>
                            Sell to pool
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
