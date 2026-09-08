import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

const sans = IBM_Plex_Sans({ variable: "--font-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "PayRail",
  description: "Agentic accounts payable on Arc",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-6 py-4 text-xs text-slate-400">
          Testnet amounts are scaled 1:1000. An invoice for $12,600 moves 12.60 USDC on Arc.
        </footer>
      </body>
    </html>
  );
}
