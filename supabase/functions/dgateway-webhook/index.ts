import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { json } from "../_shared/cors.ts";
import { GatewayError, normalizeStatus, transactionMatches, verify, verifyWebhookSignature, type OrderRow } from "../_shared/dgateway.ts";
import { scheduleDelivery, triggerTicketDelivery } from "../_shared/deliveryTrigger.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(req, { ok: true });
  if (req.method !== "POST") return json(req, { ok: false, error: "Method not allowed." }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 65_536) return json(req, { ok: false, error: "Payload too large." }, 413);
    // Fail closed: an unsigned webhook must never issue a ticket.
    if (!await verifyWebhookSignature(raw, req.headers.get("x-dgateway-signature"))) {
      return json(req, { ok: false, error: "Invalid webhook signature." }, 401);
    }
    const payload = JSON.parse(raw);
    const data = payload.data || payload;
    if (typeof data.reference !== "string" || !data.reference || data.reference.length > 200) {
      return json(req, { ok: false, error: "A transaction reference is required." }, 400);
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row, error } = await admin.from("orders").select("*").eq("dgateway_ref", data.reference).maybeSingle();
    if (error) throw error;
    if (!row) return json(req, { ok: false, error: "Order not found; retry this webhook later." }, 404);
    const order = row as OrderRow;
    if (order.status === "SUCCEEDED" || order.status === "CHECKED_IN") {
      scheduleDelivery(triggerTicketDelivery({ SUPABASE_URL: Deno.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") }, order.id));
      return json(req, { received: true, idempotent: true });
    }
    // The signed notification is also checked against the provider, including amount and currency.
    const tx = await verify(order.dgateway_ref);
    if (!transactionMatches(tx, order)) throw new GatewayError("Webhook transaction does not match the order.", "ORDER_MISMATCH");
    const status = normalizeStatus(tx.status);
    if (status !== "pending") {
      const { error: updateError } = await admin.from("orders").update({
        status: status === "completed" ? "SUCCEEDED" : "FAILED",
        provider_ref: tx.provider_ref || order.provider_ref,
        updated_at: new Date().toISOString(),
      }).eq("id", order.id).eq("dgateway_ref", order.dgateway_ref).in("status", ["PENDING", "FAILED"]);
      if (updateError) throw updateError;
      if (status === "completed") {
        scheduleDelivery(triggerTicketDelivery({ SUPABASE_URL: Deno.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") }, order.id));
      }
    }
    return json(req, { received: true, status });
  } catch (err) {
    const known = err instanceof GatewayError;
    if (err instanceof SyntaxError) return json(req, { ok: false, error: "Invalid JSON." }, 400);
    console.error("dgateway-webhook: rejected or retryable event", err instanceof Error ? err.name : "unknown");
    // Non-2xx asks DGateway to retry instead of silently losing a paid ticket.
    return json(req, { ok: false, error: known ? err.message : "Could not process this webhook. Please retry." }, known ? err.status : 503);
  }
});
