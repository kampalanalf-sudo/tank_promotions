import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { json } from "../_shared/cors.ts";
import {
  GatewayError,
  collectPayment,
  denoEnv,
  fetchCollectionStatus,
  isValidZengaPhone,
  normalizeStatus,
  orderReference,
  publicOrder,
  requireApiKey,
  toZengaMsisdn,
  transactionMatches,
  type OrderRow,
} from "../_shared/zengapay.ts";
import { scheduleDelivery, triggerTicketDelivery } from "../_shared/deliveryTrigger.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(req, { ok: true });
  if (req.method !== "POST") return json(req, { ok: false, error: "Method not allowed." }, 405);
  try {
    const env = denoEnv();
    requireApiKey(env);

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const msisdn = typeof body?.phone === "string" ? toZengaMsisdn(body.phone) : "";
    if (
      !body ||
      typeof body.event_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.event_id) ||
      typeof body.code !== "string" || !/^TNK-[A-Z0-9]{8}$/.test(body.code) ||
      typeof body.external_ref !== "string" || !/^TNK-[A-Za-z0-9-]{12,80}$/.test(body.external_ref) ||
      typeof body.name !== "string" || !body.name.trim() || body.name.length > 80 ||
      !isValidZengaPhone(msisdn) ||
      !Number.isInteger(body.qty) || Number(body.qty) < 1 || Number(body.qty) > 10 ||
      (body.email != null && body.email !== "" && (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)))
    ) {
      return json(
        req,
        { ok: false, error: "Check the guest name, Ugandan MTN/Airtel number, email, and ticket quantity.", code: "VALIDATION_ERROR" },
        400,
      );
    }

    const url = env.SUPABASE_URL?.trim();
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const anonKey = env.SUPABASE_ANON_KEY?.trim();
    if (!url || !serviceKey || !anonKey) {
      throw new GatewayError("The payment database is not configured.", "PAYMENT_NOT_CONFIGURED", 503);
    }

    const buyer = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: req.headers.get("Authorization") || `Bearer ${anonKey}` } },
    });
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data, error } = await buyer.rpc("create_order", {
      p_event_id: body.event_id,
      p_code: body.code,
      p_name: body.name.trim(),
      p_phone: msisdn,
      p_email: typeof body.email === "string" ? body.email.trim().toLowerCase() : "",
      p_qty: body.qty,
      p_external_ref: body.external_ref,
    });
    if (error) throw new GatewayError(error.message, "ORDER_REJECTED", 400);

    let order = (typeof data === "string" ? JSON.parse(data) : data) as OrderRow;
    if (!order?.id) throw new GatewayError("The order could not be created.", "ORDER_REJECTED", 400);

    const existingRef = orderReference(order);
    if (order.amount === 0 || existingRef || order.status !== "PENDING") {
      const status = order.status === "SUCCEEDED" || order.status === "CHECKED_IN"
        ? "completed"
        : order.status === "FAILED"
          ? "failed"
          : "pending";
      return json(req, {
        ok: true,
        reference: existingRef || order.external_ref,
        status,
        order: publicOrder(order),
      });
    }

    // Atomically claim the order so double clicks or network retries never trigger a duplicate prompt.
    const { data: claimed, error: claimError } = await admin
      .from("orders")
      .update({ collection_started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("status", "PENDING")
      .eq("zenga_ref", "")
      .is("collection_started_at", null)
      .select("*")
      .maybeSingle();
    if (claimError) throw new GatewayError("Could not reserve this payment request.", "ORDER_REJECTED", 503);
    if (!claimed) {
      const { data: current, error: readError } = await admin.from("orders").select("*").eq("id", order.id).single();
      if (readError || !current) throw new GatewayError("Could not load existing payment request.", "DATABASE_ERROR", 503);
      order = current as OrderRow;
      return json(req, {
        ok: true,
        reference: orderReference(order),
        status: order.status === "FAILED" ? "failed" : order.status === "SUCCEEDED" || order.status === "CHECKED_IN" ? "completed" : "pending",
        order: publicOrder(order),
        message: "This payment request already exists. Checking its status.",
      });
    }

    let initiated;
    try {
      initiated = await collectPayment(env, {
        msisdn,
        amount: order.amount,
        external_reference: order.external_ref,
        narration: `TANK Tickets ${order.code} - ${order.event_title}`.slice(0, 140),
      });
    } catch (err) {
      if (err instanceof GatewayError && err.status < 500 && err.status !== 429) {
        await admin
          .from("orders")
          .update({ status: "FAILED", updated_at: new Date().toISOString() })
          .eq("id", order.id)
          .eq("zenga_ref", "")
          .eq("status", "PENDING");
      }
      throw err;
    }

    const { data: saved, error: saveError } = await admin
      .from("orders")
      .update({
        zenga_ref: initiated.reference,
        payment_ref: initiated.reference,
        provider: "zengapay",
        currency: "UGX",
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .select("*")
      .single();
    if (saveError || !saved) {
      throw new GatewayError(
        "The Mobile Money prompt may have been sent, but its reference could not be saved. Do not pay again; contact TANK support.",
        "REFERENCE_SAVE_FAILED",
        503,
      );
    }
    order = saved as OrderRow;

    let finalStatus = initiated.status;
    if (initiated.status !== "pending") {
      const verified = await fetchCollectionStatus(env, initiated.reference);
      if (!transactionMatches(verified, { reference: initiated.reference, amount: order.amount, externalRef: order.external_ref, direction: "collect" })) {
        throw new GatewayError("The ZengaPay collection did not match this order.", "ORDER_MISMATCH", 502);
      }
      finalStatus = normalizeStatus(verified.status);
      if (finalStatus !== "pending") {
        const nextOrderStatus = finalStatus === "completed" ? "SUCCEEDED" : "FAILED";
        const { data: updated } = await admin
          .from("orders")
          .update({
            status: nextOrderStatus,
            provider: verified.provider || "zengapay",
            provider_ref: verified.providerRef || "",
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id)
          .select("*")
          .maybeSingle();
        if (updated) order = updated as OrderRow;
        if (nextOrderStatus === "SUCCEEDED") {
          scheduleDelivery(triggerTicketDelivery({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey }, order.id));
        }
      }
    }

    return json(req, {
      ok: true,
      reference: initiated.reference,
      status: finalStatus,
      order: publicOrder(order),
      message: "Payment requested. Check your phone and approve the prompt.",
    });
  } catch (err) {
    const known = err instanceof GatewayError;
    if (!known) console.error("zengapay-collect: unexpected error", err instanceof Error ? err.name : "unknown");
    return json(
      req,
      {
        ok: false,
        error: known ? err.message : "Payment could not be started. Check My tickets or contact TANK before retrying.",
        code: known ? err.code : "PAYMENT_UNAVAILABLE",
      },
      known ? err.status : 503,
    );
  }
});
