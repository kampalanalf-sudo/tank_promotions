import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { json } from "../_shared/cors.ts";
import { collect, GatewayError, normalizeStatus, publicOrder, type OrderRow } from "../_shared/dgateway.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(req, { ok: true });
  if (req.method !== "POST") return json(req, { ok: false, error: "Method not allowed." }, 405);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.event_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.event_id) ||
      typeof body.code !== "string" || !/^TNK-[A-Z0-9]{8}$/.test(body.code) ||
      typeof body.external_ref !== "string" || !/^TNK-[A-Za-z0-9-]{12,80}$/.test(body.external_ref) ||
      typeof body.name !== "string" || !body.name.trim() || body.name.length > 80 ||
      typeof body.phone !== "string" || !/^256(?:7\d{8}|111777(?:77\d|99\d|88\d))$/.test(body.phone) ||
      !Number.isInteger(body.qty) || body.qty < 1 || body.qty > 10 ||
      (body.email != null && body.email !== "" && (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)))) {
      return json(req, { ok: false, error: "Check the guest name, phone number, email and ticket quantity.", code: "VALIDATION_ERROR" }, 400);
    }
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    if (!url || !serviceKey || !anonKey) throw new GatewayError("The payment database is not configured.", "PAYMENT_NOT_CONFIGURED", 503);
    // Keep the buyer's identity on the order. Never accept a user ID or price from the browser.
    const buyer = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") || `Bearer ${anonKey}` } } });
    const admin = createClient(url, serviceKey);
    const { data, error } = await buyer.rpc("create_order", {
      p_event_id: body.event_id, p_code: body.code, p_name: body.name.trim(), p_phone: body.phone,
      p_email: body.email || "", p_qty: body.qty, p_external_ref: body.external_ref,
    });
    if (error) throw new GatewayError(error.message, "ORDER_REJECTED", 400);
    let order = (typeof data === "string" ? JSON.parse(data) : data) as OrderRow;
    if (!order?.id) throw new GatewayError("The order could not be created.", "ORDER_REJECTED", 400);
    if (order.amount === 0 || order.dgateway_ref || order.status !== "PENDING") {
      return json(req, { ok: true, reference: order.dgateway_ref || order.external_ref, status: order.status === "SUCCEEDED" || order.status === "CHECKED_IN" ? "completed" : order.status === "FAILED" ? "failed" : "pending", order: publicOrder(order) });
    }
    // Exactly one request may collect for an order, even after a lost response or a double click.
    const { data: claimed, error: claimError } = await admin.from("orders").update({ collection_started_at: new Date().toISOString() })
      .eq("id", order.id).eq("status", "PENDING").eq("dgateway_ref", "").is("collection_started_at", null).select("*").maybeSingle();
    if (claimError) throw new GatewayError("Could not reserve this payment request.", "ORDER_REJECTED", 503);
    if (!claimed) {
      const { data: current, error: readError } = await admin.from("orders").select("*").eq("id", order.id).single();
      if (readError) throw readError;
      order = current as OrderRow;
      return json(req, { ok: true, reference: order.dgateway_ref || "", status: order.status === "FAILED" ? "failed" : "pending", order: publicOrder(order), message: "This payment request already exists. Checking its status." });
    }
    let tx;
    try {
      tx = await collect(order);
    } catch (err) {
      // A timeout may mean the prompt was sent. Keep the claim and reconcile by webhook/support.
      if (err instanceof GatewayError && err.status < 500 && err.status !== 429) {
        await admin.from("orders").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("id", order.id).eq("dgateway_ref", "").eq("status", "PENDING");
      }
      throw err;
    }
    const { data: saved, error: saveError } = await admin.from("orders").update({
      dgateway_ref: tx.reference, payment_ref: tx.reference, provider: tx.provider || tx.provider_slug || "iotec",
      provider_ref: tx.provider_ref || "", updated_at: new Date().toISOString(),
    }).eq("id", order.id).eq("dgateway_ref", "").select("*").single();
    if (saveError) throw new GatewayError("The prompt may have been sent, but its reference could not be saved. Do not pay again; contact TANK support.", "REFERENCE_SAVE_FAILED", 503);
    order = saved as OrderRow;
    return json(req, { ok: true, reference: order.dgateway_ref, status: normalizeStatus(tx.status), order: publicOrder(order), message: "Payment requested. Approve the prompt on your phone." });
  } catch (err) {
    const known = err instanceof GatewayError;
    if (!known) console.error("dgateway-collect: unexpected server error", err instanceof Error ? err.name : "unknown");
    return json(req, { ok: false, error: known ? err.message : "Payment could not be confirmed. Check My tickets or contact TANK before retrying.", code: known ? err.code : "PAYMENT_UNAVAILABLE" }, known ? err.status : 503);
  }
});
