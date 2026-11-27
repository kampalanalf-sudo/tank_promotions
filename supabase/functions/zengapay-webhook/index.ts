import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { json } from "../_shared/cors.ts";
import {
  GatewayError,
  denoEnv,
  extractWebhookFields,
  fetchCollectionStatus,
  fetchTransferStatus,
  normalizeStatus,
  requireApiKey,
  transactionMatches,
  verifyWebhookSignature,
  type OrderRow,
  type PayoutRow,
} from "../_shared/zengapay.ts";
import { scheduleDelivery, triggerTicketDelivery } from "../_shared/deliveryTrigger.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(req, { ok: true });
  if (req.method !== "POST") return json(req, { ok: false, error: "Method not allowed." }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 65_536) return json(req, { ok: false, error: "Payload too large." }, 413);

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json(req, { ok: false, error: "Invalid JSON." }, 400);
    }

    const env = denoEnv();
    requireApiKey(env);
    // Fail closed: require X-ZENGAPAY-SIGNATURE verified with ZENGAPAY_WEBHOOK_SECRET.
    const validSignature = await verifyWebhookSignature(
      raw,
      req.headers.get("x-zengapay-signature"),
      env.ZENGAPAY_WEBHOOK_SECRET,
      payload,
    );
    if (!validSignature) {
      return json(req, { ok: false, error: "Invalid webhook signature." }, 401);
    }

    const { reference, externalReference, isTransfer } = extractWebhookFields(payload);
    if (!reference) {
      return json(req, { ok: false, error: "A transactionReference is required." }, 400);
    }

    const url = env.SUPABASE_URL?.trim();
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !serviceKey) {
      throw new GatewayError("The payment database is not configured.", "PAYMENT_NOT_CONFIGURED", 503);
    }
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    if (isTransfer) {
      let { data: payoutRow } = await admin.from("payouts").select("*").eq("zenga_ref", reference).maybeSingle();
      if (!payoutRow) {
        const fallback = await admin.from("payouts").select("*").eq("dgateway_ref", reference).maybeSingle();
        payoutRow = fallback.data;
      }
      if (!payoutRow && externalReference) {
        const byExt = await admin.from("payouts").select("*").eq("external_ref", externalReference).maybeSingle();
        payoutRow = byExt.data;
      }
      if (!payoutRow) {
        return json(req, { ok: true, status: "Received", received: true, ignored: true }, 202);
      }
      const payout = payoutRow as PayoutRow;
      if (payout.status !== "COMPLETED") {
        const tx = await fetchTransferStatus(env, reference);
        if (!transactionMatches(tx, { reference, amount: payout.amount, externalRef: payout.external_ref, direction: "transfer" })) {
          throw new GatewayError("Webhook transfer does not match the payout record.", "PAYOUT_MISMATCH", 409);
        }
        const verified = normalizeStatus(tx.status);
        if (verified !== "pending") {
          await admin
            .from("payouts")
            .update({
              status: verified === "completed" ? "COMPLETED" : "FAILED",
              provider: tx.provider || "zengapay",
              provider_ref: tx.providerRef || payout.provider_ref,
              updated_at: new Date().toISOString(),
            })
            .eq("id", payout.id)
            .in("status", ["PENDING", "FAILED"]);
        }
      }
      return json(req, { ok: true, status: "Received", received: true }, 202);
    }

    // Collection webhook: match by zenga_ref, payment_ref, or external_ref (if reference save raced).
    let { data: row, error } = await admin.from("orders").select("*").eq("zenga_ref", reference).maybeSingle();
    if (error) throw error;
    if (!row) {
      const byPaymentRef = await admin.from("orders").select("*").eq("payment_ref", reference).maybeSingle();
      row = byPaymentRef.data;
    }
    if (!row && externalReference) {
      const byExternal = await admin.from("orders").select("*").eq("external_ref", externalReference).maybeSingle();
      row = byExternal.data;
    }
    if (!row) {
      // Non-2xx prompts ZengaPay to retry (up to 3 times) if webhook arrived before DB commit.
      return json(req, { ok: false, error: "Order not found; retry this webhook later." }, 404);
    }

    const order = row as OrderRow;
    if (order.status === "SUCCEEDED" || order.status === "CHECKED_IN") {
      scheduleDelivery(triggerTicketDelivery({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey }, order.id));
      return json(req, { ok: true, status: "Received", received: true, idempotent: true }, 202);
    }

    // Always re-fetch the authoritative collection from ZengaPay before issuing a ticket.
    const tx = await fetchCollectionStatus(env, reference);
    if (!transactionMatches(tx, { reference, amount: order.amount, externalRef: order.external_ref, direction: "collect" })) {
      throw new GatewayError("Webhook collection does not match the order.", "ORDER_MISMATCH", 409);
    }

    const verifiedStatus = normalizeStatus(tx.status);
    if (verifiedStatus !== "pending") {
      const nextStatus = verifiedStatus === "completed" ? "SUCCEEDED" : "FAILED";
      const { error: updateError } = await admin
        .from("orders")
        .update({
          status: nextStatus,
          zenga_ref: reference,
          payment_ref: reference,
          provider: tx.provider || order.provider || "zengapay",
          provider_ref: tx.providerRef || order.provider_ref,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .in("status", ["PENDING", "FAILED"]);
      if (updateError) throw updateError;
      if (nextStatus === "SUCCEEDED") {
        scheduleDelivery(triggerTicketDelivery({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey }, order.id));
      }
    }

    // ZengaPay documentation recommends returning HTTP 202 to acknowledge receipt.
    return json(req, { ok: true, status: "Received", received: true, payment_status: verifiedStatus }, 202);
  } catch (err) {
    const known = err instanceof GatewayError;
    console.error("zengapay-webhook: error", err instanceof Error ? err.name : "unknown");
    return json(
      req,
      { ok: false, error: known ? err.message : "Could not process this webhook. Please retry." },
      known ? err.status : 503,
    );
  }
});
