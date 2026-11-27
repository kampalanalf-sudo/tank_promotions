import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { json } from "../_shared/cors.ts";
import {
  GatewayError,
  denoEnv,
  fetchCollectionStatus,
  normalizeStatus,
  orderReference,
  publicOrder,
  requireApiKey,
  transactionMatches,
  type OrderRow,
} from "../_shared/zengapay.ts";
import { scheduleDelivery, triggerTicketDelivery } from "../_shared/deliveryTrigger.ts";

const STATUS_POLL_THROTTLE_MS = 8_000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(req, { ok: true });
  if (req.method !== "POST") return json(req, { ok: false, error: "Method not allowed." }, 405);
  try {
    const env = denoEnv();
    requireApiKey(env);

    const body = await req.json().catch(() => null) as { code?: unknown; reference?: unknown } | null;
    if (
      !body ||
      typeof body.code !== "string" ||
      !/^TNK-[A-Z0-9]{8}$/.test(body.code) ||
      (body.reference != null && body.reference !== "" && (typeof body.reference !== "string" || body.reference.length > 200))
    ) {
      return json(req, { ok: false, error: "A valid ticket reference is required." }, 400);
    }

    const url = env.SUPABASE_URL?.trim();
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !serviceKey) {
      throw new GatewayError("The payment database is not configured.", "PAYMENT_NOT_CONFIGURED", 503);
    }
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data, error } = await admin.from("orders").select("*").eq("code", body.code).maybeSingle();
    if (error) throw error;
    const order = data as OrderRow | null;
    const ref = order ? orderReference(order) : "";

    if (
      !order ||
      (order.amount > 0 && !ref && !order.collection_started_at) ||
      (typeof body.reference === "string" && body.reference && ref && body.reference !== ref)
    ) {
      return json(req, { ok: false, error: "No matching payment was found for this ticket.", code: "NOT_FOUND" }, 404);
    }

    const currentStatus = order.status === "SUCCEEDED" || order.status === "CHECKED_IN"
      ? "completed"
      : order.status === "FAILED"
        ? "failed"
        : "pending";
    if (currentStatus !== "pending" || !ref) {
      return json(req, { ok: true, reference: ref, status: currentStatus, order: publicOrder(order) });
    }

    // Throttle upstream ZengaPay queries across concurrent tabs/polls.
    const cutoff = new Date(Date.now() - STATUS_POLL_THROTTLE_MS).toISOString();
    const { data: pollClaim } = await admin
      .from("orders")
      .update({ last_status_check_at: new Date().toISOString() })
      .eq("id", order.id)
      .or(`last_status_check_at.is.null,last_status_check_at.lt.${cutoff}`)
      .select("id")
      .maybeSingle();
    if (!pollClaim) {
      return json(req, { ok: true, reference: ref, status: "pending", order: publicOrder(order), throttled: true });
    }

    const tx = await fetchCollectionStatus(env, ref);
    if (!transactionMatches(tx, { reference: ref, amount: order.amount, externalRef: order.external_ref, direction: "collect" })) {
      throw new GatewayError("The ZengaPay transaction does not match this ticket's amount or reference.", "ORDER_MISMATCH", 502);
    }

    const verified = normalizeStatus(tx.status);
    if (verified !== "pending") {
      const next = verified === "completed" ? "SUCCEEDED" : "FAILED";
      const { data: updated, error: updateError } = await admin
        .from("orders")
        .update({
          status: next,
          zenga_ref: ref,
          payment_ref: ref,
          provider: tx.provider || order.provider || "zengapay",
          provider_ref: tx.providerRef || order.provider_ref,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .in("status", ["PENDING", "FAILED"])
        .select("*")
        .maybeSingle();
      if (updateError) throw updateError;
      if (updated) {
        Object.assign(order, updated);
      } else {
        order.status = next;
      }
      if (next === "SUCCEEDED") {
        scheduleDelivery(triggerTicketDelivery({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey }, order.id));
      }
    }

    return json(req, { ok: true, reference: ref, status: verified, order: publicOrder(order) });
  } catch (err) {
    const known = err instanceof GatewayError;
    if (!known) console.error("zengapay-status: verification failed", err instanceof Error ? err.name : "unknown");
    return json(
      req,
      {
        ok: false,
        error: known ? err.message : "We couldn't verify the payment yet. Keep your ticket reference and check again.",
        code: known ? err.code : "VERIFICATION_UNAVAILABLE",
      },
      known ? err.status : 503,
    );
  }
});
