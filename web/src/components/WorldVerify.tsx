"use client";

import { useState } from "react";
import { IDKitRequestWidget, proofOfHuman } from "@worldcoin/idkit";
import { API } from "@/lib/api";
import { Button } from "@/components/ui";

interface RequestContext {
  app_id: string;
  action: string;
  rp_context: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
}

/**
 * Supplier onboarding: prove there is a human behind this supplier identity.
 * The proof is verified by the agent, which then writes the nullifier into the supplier's ENS record.
 */
export function WorldVerify({ supplierEns, verified, onVerified }: { supplierEns: string; verified: boolean; onVerified: () => void }) {
  const [ctx, setCtx] = useState<RequestContext | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/world/request`);
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "World ID not configured on the agent");
      setCtx(body);
      setOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (verified) return <span className="text-emerald-700">verified human</span>;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-slate-500">not verified</span>
        <Button variant="ghost" onClick={start} busy={busy}>
          Verify with World ID
        </Button>
      </div>
      {error && <span className="text-xs text-rose-700">{error}</span>}
      {ctx && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={ctx.app_id as `app_${string}`}
          action={ctx.action}
          rp_context={ctx.rp_context}
          allow_legacy_proofs={true}
          preset={proofOfHuman({ signal: supplierEns })}
          handleVerify={async (result) => {
            const r = await fetch(`${API}/api/world/verify`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ supplier: supplierEns, idkitResponse: result }),
            });
            const body = await r.json();
            if (!r.ok) throw new Error(body.detail ?? "verification failed");
          }}
          onSuccess={() => {
            setOpen(false);
            onVerified();
          }}
        />
      )}
    </div>
  );
}
