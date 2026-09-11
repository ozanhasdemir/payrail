"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/buyer", label: "Buyer AP", sub: "Harbor Wholesale" },
  { href: "/supplier", label: "Supplier", sub: "Receivables" },
  { href: "/pool", label: "Early-pay pool", sub: "Liquidity" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3">
        <Link href="/buyer" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="PayRail" width={28} height={28} className="h-7 w-7 rounded-md" />
          <span className="text-base font-semibold tracking-tight text-slate-900">PayRail</span>
        </Link>
        <nav className="flex gap-1">
          {links.map((l) => {
            const active = path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600 hover:text-slate-900"}`}>
                {l.label} <span className="ml-1 text-xs text-slate-400">{l.sub}</span>
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto text-xs text-slate-500">
          Arc Testnet · USDC native · <span className="font-mono">payrail.eth</span>
        </div>
      </div>
    </header>
  );
}
