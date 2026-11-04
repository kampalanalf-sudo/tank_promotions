import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { json } from "../_shared/cors.ts";
import { GatewayError, normalizeStatus, publicOrder, transactionMatches, verify, type OrderRow } from "../_shared/dgateway.ts";
import { scheduleDelivery, triggerTicketDelivery } from "../_shared/deliveryTrigger.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(req, { ok: true });
  if (req.method !== "POST") return json(req, { ok: false, error: "Method not allowed." }, 405);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.code !== "string" || !/^TNK-[A-Z0-9]{8}$/.test(body.code) ||
      (body.reference != null && (typeof body.reference !== "string" || body.reference.length > 200))) {
      return json(req, { ok: false, error: "A valid ticket reference is required." }, 400);
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin.from("orders").select("*").eq("code", body.code).maybeSingle();
    if (error) throw error;
    const order = data as OrderRow | null;
    if (!order || (order.amount > 0 && !order.dgateway_ref && !order.collection_started_at) ||
      (body.reference && order.dgateway_ref && body.reference !== order.dgateway_ref)) {
      return json(req, { ok: false, error: "No matching payment was found for this ticket." }, 404);
    }
    const status = order.status === "SUCCEEDED" || order.status === "CHECKED_IN" ? "completed" : order.status === "FAILED" ? "failed" : "pending";
    if (status !== "pending" || !order.dgateway_ref) return json(req, { ok: true, status, order: publicOrder(order) });
    const tx = await verify(order.dgateway_ref);
    if (!transactionMatches(tx, order)) throw new GatewayError("The payment does not match this ticket's amount, currency or reference.", "ORDER_MISMATCH");
    const verified = normalizeStatus(tx.status);
    if (verified !== "pending") {
      const next = verified === "completed" ? "SUCCEEDED" : "FAILED";
      const { error: updateError } = await admin.from("orders").update({
        status: next, provider_ref: tx.provider_ref || order.provider_ref, updated_at: new Date().toISOString(),
      }).eq("id", order.id).eq("dgateway_ref", order.dgateway_ref).in("status", ["PENDING", "FAILED"]);
      if (updateError) throw updateError;
      order.status = next;
      if (next === "SUCCEEDED") {
        scheduleDelivery(triggerTicketDelivery({ SUPABASE_URL: Deno.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") }, order.id));
      }
    }
    return json(req, { ok: true, status: verified, order: publicOrder(order) });
  } catch (err) {
    const known = err instanceof GatewayError;
    if (!known) console.error("dgateway-status: verification failed", err instanceof Error ? err.name : "unknown");
    return json(req, { ok: false, error: known ? err.message : "We couldn't verify the payment yet. Keep your ticket reference and check again.", code: known ? err.code : "VERIFICATION_UNAVAILABLE" }, known ? err.status : 503);
  }
});
