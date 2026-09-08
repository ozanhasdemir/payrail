/**
 * World ID: is there a verified human behind this supplier?
 *
 * Flow (World ID 4.0):
 *   1. frontend asks us for a signed request context (we hold the RP signing key)
 *   2. IDKit widget runs in the browser, the user proves with World App
 *   3. frontend posts the IDKit result here; we verify it with World's API
 *   4. on success we write the nullifier into the supplier's ENS record `payrail.worldid`
 *
 * From then on the AP agent sees `worldVerified: true` when it resolves the supplier, and the
 * payment policy can require it. The nullifier is stable per (user, action), so one human can
 * back one supplier identity for this action and no more.
 */
import { signRequest } from "@worldcoin/idkit-core/signing";
import { ENS_KEYS } from "../chains.js";
import { config } from "../config.js";
import { resolveSupplier, setSupplierRecords } from "../resolve/ens.js";
import { supplierByEns } from "../suppliers.js";

export interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

export function worldConfigured(): boolean {
  const c = config();
  return !!(c.WORLD_APP_ID && c.WORLD_RP_ID && c.WORLD_RP_SIGNING_KEY);
}

/** Step 1: sign a request for our action so World App knows it came from us. */
export function requestContext(): { app_id: string; action: string; rp_context: RpContext } {
  const c = config();
  if (!worldConfigured()) throw new Error("World ID is not configured (WORLD_APP_ID, WORLD_RP_ID, WORLD_RP_SIGNING_KEY)");
  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex: c.WORLD_RP_SIGNING_KEY!, action: c.WORLD_ACTION_ID });
  return {
    app_id: c.WORLD_APP_ID!,
    action: c.WORLD_ACTION_ID,
    rp_context: { rp_id: c.WORLD_RP_ID!, nonce, created_at: createdAt, expires_at: expiresAt, signature: sig },
  };
}

export interface VerifyOutcome {
  ok: boolean;
  nullifier?: string;
  ensTx?: string[];
  detail?: string;
}

/** Steps 3 and 4: verify with World, then bind the human to the supplier's ENS name. */
export async function verifyAndBind(supplierEns: string, idkitResponse: unknown): Promise<VerifyOutcome> {
  const c = config();
  if (!worldConfigured()) return { ok: false, detail: "World ID not configured" };
  const supplier = supplierByEns(supplierEns);
  if (!supplier) return { ok: false, detail: `unknown supplier ${supplierEns}` };

  const res = await fetch(`https://developer.world.org/api/v4/verify/${c.WORLD_RP_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(idkitResponse),
  });
  const body = (await res.json().catch(() => ({}))) as { nullifier?: string; detail?: string; code?: string };
  if (!res.ok || !body.nullifier) {
    return { ok: false, detail: body.detail ?? body.code ?? `verify returned ${res.status}` };
  }

  // One human, one supplier identity for this action.
  const existing = await resolveSupplier(supplierEns);
  if (existing.worldId && existing.worldId !== body.nullifier) {
    return { ok: false, nullifier: body.nullifier, detail: `${supplierEns} is already bound to a different human` };
  }

  const ensTx = await setSupplierRecords(supplierEns, { [ENS_KEYS.worldId]: body.nullifier });
  return { ok: true, nullifier: body.nullifier, ensTx };
}
