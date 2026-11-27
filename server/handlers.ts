import {
  GatewayError,
  collectPayment,
  disbursePayment,
  extractWebhookFields,
  fetchCollectionStatus,
  fetchTransferStatus,
  isValidZengaPhone,
  isWholeUnitUgx,
  normalizeStatus,
  requireApiKey,
  toZengaMsisdn,
  transactionMatches,
  verifyWebhookSignature,
  type ServerEnv,
  type ZengaTransaction,
} from "./zengapay";
import {
  adminClient,
  buyerClient,
  orderPaymentStatus,
  orderReference,
  payoutPaymentStatus,
  payoutReference,
  publicOrder,
  publicPayout,
  requireAdmin,
  type OrderRow,
  type PayoutRow,
} from "./db";
import { errorResponse, json, methodNotAllowed, preflight, readJson } from "./http";
import { triggerTicketDelivery } from "../supabase/functions/_shared/deliveryTrigger";

const STATUS_POLL_INTERVAL_MS = 8_000;

function asString(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function loadOrderByReference(env: ServerEnv, reference: string, externalReference = "") {
  const admin = adminClient(env);
  const { data: byZenga, error } = await admin.from("orders").select("*").eq("zenga_ref", reference).maybeSingle();
  if (error) throw new GatewayError("We couldn't load the payment record.", "DATABASE_ERROR", 503);
  if (byZenga) return byZenga as OrderRow;
  const { data: byPayRef } = await admin.from("orders").select("*").eq("payment_ref", reference).maybeSingle();
  if (byPayRef) return byPayRef as OrderRow;
  if (externalReference) {
    const { data: byExternal } = await admin.from("orders").select("*").eq("external_ref", externalReference).maybeSingle();
    if (byExternal) return byExternal as OrderRow;
  }
  return null;
}

async function loadPayoutByReference(env: ServerEnv, reference: string, externalReference = "") {
  const admin = adminClient(env);
  const { data: byZenga } = await admin.from("payouts").select("*").eq("zenga_ref", reference).maybeSingle();
  if (byZenga) return byZenga as PayoutRow;
  const { data: byLegacy } = await admin.from("payouts").select("*").eq("dgateway_ref", reference).maybeSingle();
  if (byLegacy) return byLegacy as PayoutRow;
  if (externalReference) {
    const { data: byExt } = await admin.from("payouts").select("*").eq("external_ref", externalReference).maybeSingle();
    if (byExt) return byExt as PayoutRow;
  }
  return null;
}

async function applyOrderTransaction(env: ServerEnv, row: OrderRow, tx: ZengaTransaction) {
  const expectedRef = orderReference(row) || tx.reference;
  if (!transactionMatches(tx, { reference: expectedRef, amount: row.amount, externalRef: row.external_ref, direction: "collect" })) {
    throw new GatewayError("ZengaPay verification did not match this order.", "PAYMENT_MISMATCH", 409);
  }
  const status = normalizeStatus(tx.status);
  if (status === "pending") return row;
  const nextStatus = status === "completed" ? "SUCCEEDED" : "FAILED";
  const admin = adminClient(env);
  const { data, error } = await admin
    .from("orders")
    .update({
      status: nextStatus,
      zenga_ref: tx.reference,
      payment_ref: tx.reference,
      provider: tx.provider || row.provider || "zengapay",
      provider_ref: tx.providerRef || row.provider_ref || "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .in("status", ["PENDING", "FAILED"])
    .select("*")
    .maybeSingle();
  if (error) throw new GatewayError("We couldn't update the payment record.", "DATABASE_ERROR", 503);
  const updated = (data as OrderRow | null) || row;
  if (nextStatus === "SUCCEEDED") {
    void triggerTicketDelivery(env, updated.id).catch((err) => {
      console.error("ticket-delivery trigger error", err instanceof Error ? err.message : "unknown");
    });
  }
  if (data) return updated;
  const { data: fresh, error: freshError } = await admin.from("orders").select("*").eq("id", row.id).single();
  if (freshError || !fresh) throw new GatewayError("We couldn't reload the payment record.", "DATABASE_ERROR", 503);
  return fresh as OrderRow;
}

async function applyPayoutTransaction(env: ServerEnv, row: PayoutRow, tx: ZengaTransaction) {
  const expectedRef = payoutReference(row) || tx.reference;
  if (!transactionMatches(tx, { reference: expectedRef, amount: row.amount, externalRef: row.external_ref, direction: "transfer" })) {
    throw new GatewayError("ZengaPay transfer verification did not match this request.", "PAYOUT_MISMATCH", 409);
  }
  const status = normalizeStatus(tx.status);
  if (status === "pending") return row;
  const nextStatus = status === "completed" ? "COMPLETED" : "FAILED";
  const admin = adminClient(env);
  const { data, error } = await admin
    .from("payouts")
    .update({
      status: nextStatus,
      provider: tx.provider || row.provider || "zengapay",
      provider_ref: tx.providerRef || row.provider_ref || "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .in("status", ["PENDING", "FAILED"])
    .select("*")
    .maybeSingle();
  if (error) throw new GatewayError("We couldn't update the payout record.", "DATABASE_ERROR", 503);
  if (data) return data as PayoutRow;
  const { data: fresh, error: freshError } = await admin.from("payouts").select("*").eq("id", row.id).single();
  if (freshError || !fresh) throw new GatewayError("We couldn't reload the payout record.", "DATABASE_ERROR", 503);
  return fresh as PayoutRow;
}

async function claimStatusPoll(env: ServerEnv, table: "orders" | "payouts", id: string) {
  const admin = adminClient(env);
  const cutoff = new Date(Date.now() - STATUS_POLL_INTERVAL_MS).toISOString();
  const { data, error } = await admin
    .from(table)
    .update({ last_status_check_at: new Date().toISOString() })
    .eq("id", id)
    .or(`last_status_check_at.is.null,last_status_check_at.lt.${cutoff}`)
    .select("id")
    .maybeSingle();
  if (error) throw new GatewayError("We couldn't schedule a payment check.", "DATABASE_ERROR", 503);
  return Boolean(data);
}

export async function handleCollect(req: Request, env: ServerEnv): Promise<Response> {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return methodNotAllowed(req, "POST, OPTIONS");
  try {
    requireApiKey(env);
    const body = await readJson(req);
    const eventId = asString(body.event_id);
    const code = asString(body.code, 20);
    const externalRef = asString(body.external_ref, 100);
    const name = asString(body.name, 80);
    const msisdn = toZengaMsisdn(asString(body.phone, 30));
    const email = asString(body.email, 120).toLowerCase();
    const qty = Number(body.qty);
    if (!eventId || !code || !externalRef || !name || !msisdn || !Number.isInteger(qty) || qty < 1 || qty > 10) {
      throw new GatewayError("Complete the checkout details before paying.", "INVALID_REQUEST", 400);
    }
    if (!isValidZengaPhone(msisdn)) {
      throw new GatewayError("Enter a valid Ugandan MTN or Airtel Mobile Money number.", "INVALID_PHONE", 400);
    }

    const buyer = buyerClient(env, req);
    const { data: created, error: createError } = await buyer.rpc("create_order", {
      p_event_id: eventId,
      p_code: code,
      p_name: name,
      p_phone: msisdn,
      p_email: email,
      p_qty: qty,
      p_external_ref: externalRef,
    });
    if (createError || !created) throw new GatewayError(createError?.message || "We couldn't create the order.", "ORDER_ERROR", 400);
    let row = (typeof created === "string" ? JSON.parse(created) : created) as OrderRow;
    if (row.status === "SUCCEEDED" || row.status === "CHECKED_IN") {
      return json(req, { ok: true, reference: orderReference(row), status: "completed", order: publicOrder(row) });
    }
    if (row.status === "FAILED") throw new GatewayError("This checkout attempt failed. Start a new checkout.", "ORDER_FAILED", 409);
    if (row.amount <= 0) throw new GatewayError("This order does not require payment.", "INVALID_AMOUNT", 400);
    const existingRef = orderReference(row);
    if (existingRef) {
      return json(req, { ok: true, reference: existingRef, status: orderPaymentStatus(row), order: publicOrder(row) });
    }
    if (row.collection_started_at) {
      throw new GatewayError("A payment prompt is already being requested for this checkout. Wait a moment and check the status.", "COLLECTION_IN_PROGRESS", 409);
    }

    const admin = adminClient(env);
    const { data: claimed, error: claimError } = await admin
      .from("orders")
      .update({ collection_started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "PENDING")
      .eq("zenga_ref", "")
      .is("collection_started_at", null)
      .select("*")
      .maybeSingle();
    if (claimError) throw new GatewayError("We couldn't start the payment request.", "DATABASE_ERROR", 503);
    if (!claimed) throw new GatewayError("This checkout is already being processed. Check My tickets before trying again.", "COLLECTION_IN_PROGRESS", 409);
    row = claimed as OrderRow;

    let initiated;
    try {
      initiated = await collectPayment(env, {
        msisdn,
        amount: row.amount,
        external_reference: row.external_ref,
        narration: `TANK Tickets ${row.code} - ${row.event_title}`.slice(0, 140),
      });
    } catch (err) {
      if (err instanceof GatewayError && err.status < 500 && err.status !== 429) {
        await admin.from("orders").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("id", row.id).eq("zenga_ref", "").eq("status", "PENDING");
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
      .eq("id", row.id)
      .select("*")
      .single();
    if (saveError || !saved) throw new GatewayError("Payment was requested, but its reference could not be saved. Contact TANK support before paying again.", "DATABASE_ERROR", 503);
    row = saved as OrderRow;

    if (initiated.status !== "pending") {
      const verified = await fetchCollectionStatus(env, initiated.reference);
      row = await applyOrderTransaction(env, row, verified);
    }
    return json(req, { ok: true, reference: initiated.reference, status: orderPaymentStatus(row), order: publicOrder(row) });
  } catch (err) {
    return errorResponse(req, err);
  }
}

export async function handleDisburse(req: Request, env: ServerEnv): Promise<Response> {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return methodNotAllowed(req, "POST, OPTIONS");
  try {
    requireApiKey(env);
    const user = await requireAdmin(env, req);
    const body = await readJson(req);
    const externalRef = asString(body.external_ref, 100);
    const amount = Number(body.amount);
    const currency = asString(body.currency || "UGX", 10).toUpperCase();
    const msisdn = toZengaMsisdn(asString(body.phone_number || body.phone, 30));
    const description = asString(body.description, 140) || "TANK Tickets payout";
    if (!externalRef) throw new GatewayError("A unique payout reference is required.", "INVALID_REQUEST", 400);
    if (currency !== "UGX" || !isWholeUnitUgx(amount)) {
      throw new GatewayError("ZengaPay transfers support positive whole-shilling UGX amounts.", "INVALID_AMOUNT", 400);
    }
    if (!isValidZengaPhone(msisdn)) {
      throw new GatewayError("Enter a valid Ugandan MTN or Airtel Mobile Money number.", "INVALID_PHONE", 400);
    }

    const admin = adminClient(env);
    const { data: existing, error: existingError } = await admin.from("payouts").select("*").eq("external_ref", externalRef).maybeSingle();
    if (existingError) throw new GatewayError("We couldn't load the payout record.", "DATABASE_ERROR", 503);
    if (existing) {
      const payout = existing as PayoutRow;
      return json(req, { ok: true, reference: payoutReference(payout), status: payoutPaymentStatus(payout), payout: publicPayout(payout), reused: true });
    }

    const { data: inserted, error: insertError } = await admin
      .from("payouts")
      .insert({
        external_ref: externalRef,
        amount,
        currency: "UGX",
        phone_number: msisdn,
        description,
        status: "PENDING",
        provider: "zengapay",
        created_by: user.id,
      })
      .select("*")
      .single();
    if (insertError || !inserted) {
      const { data: raced } = await admin.from("payouts").select("*").eq("external_ref", externalRef).maybeSingle();
      if (raced) {
        const payout = raced as PayoutRow;
        return json(req, { ok: true, reference: payoutReference(payout), status: payoutPaymentStatus(payout), payout: publicPayout(payout), reused: true });
      }
      throw new GatewayError("We couldn't create the payout record.", "DATABASE_ERROR", 503);
    }
    let payout = inserted as PayoutRow;
    let initiated;
    try {
      initiated = await disbursePayment(env, {
        msisdn,
        amount,
        external_reference: externalRef,
        narration: description,
      });
    } catch (err) {
      if (err instanceof GatewayError && err.status < 500 && err.status !== 429) {
        await admin.from("payouts").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("id", payout.id).eq("status", "PENDING");
      }
      throw err;
    }

    let { data: saved, error: saveError } = await admin
      .from("payouts")
      .update({ zenga_ref: initiated.reference, provider: "zengapay", updated_at: new Date().toISOString() })
      .eq("id", payout.id)
      .select("*")
      .single();
    if (saveError) {
      const fallback = await admin
        .from("payouts")
        .update({ dgateway_ref: initiated.reference, provider: "zengapay", updated_at: new Date().toISOString() })
        .eq("id", payout.id)
        .select("*")
        .single();
      saved = fallback.data;
      saveError = fallback.error;
    }
    if (saveError || !saved) throw new GatewayError("Transfer was requested, but its reference could not be saved. Contact support before retrying.", "DATABASE_ERROR", 503);
    payout = saved as PayoutRow;
    if (initiated.status !== "pending") {
      const verified = await fetchTransferStatus(env, initiated.reference);
      payout = await applyPayoutTransaction(env, payout, verified);
    }
    return json(req, { ok: true, reference: initiated.reference, status: payoutPaymentStatus(payout), payout: publicPayout(payout) });
  } catch (err) {
    return errorResponse(req, err);
  }
}

export async function handleStatus(req: Request, env: ServerEnv, reference: string): Promise<Response> {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "GET") return methodNotAllowed(req, "GET, OPTIONS");
  try {
    requireApiKey(env);
    if (!reference) throw new GatewayError("A payment reference is required.", "INVALID_REQUEST", 400);
    const url = new URL(req.url);
    const code = asString(url.searchParams.get("code"), 20);
    const order = await loadOrderByReference(env, reference);
    if (order) {
      if (!code || code !== order.code) throw new GatewayError("Payment reference not found.", "NOT_FOUND", 404);
      if (orderPaymentStatus(order) !== "pending") {
        return json(req, { ok: true, reference, status: orderPaymentStatus(order), order: publicOrder(order) });
      }
      const claimed = await claimStatusPoll(env, "orders", order.id);
      if (!claimed) return json(req, { ok: true, reference, status: "pending", order: publicOrder(order), throttled: true });
      const tx = await fetchCollectionStatus(env, reference);
      const updated = await applyOrderTransaction(env, order, tx);
      return json(req, { ok: true, reference, status: orderPaymentStatus(updated), order: publicOrder(updated) });
    }

    const payout = await loadPayoutByReference(env, reference);
    if (payout) {
      await requireAdmin(env, req);
      if (payoutPaymentStatus(payout) !== "pending") {
        return json(req, { ok: true, reference, status: payoutPaymentStatus(payout), payout: publicPayout(payout) });
      }
      const claimed = await claimStatusPoll(env, "payouts", payout.id);
      if (!claimed) return json(req, { ok: true, reference, status: "pending", payout: publicPayout(payout), throttled: true });
      const tx = await fetchTransferStatus(env, reference);
      const updated = await applyPayoutTransaction(env, payout, tx);
      return json(req, { ok: true, reference, status: payoutPaymentStatus(updated), payout: publicPayout(updated) });
    }
    throw new GatewayError("Payment reference not found.", "NOT_FOUND", 404);
  } catch (err) {
    return errorResponse(req, err);
  }
}

export async function handleWebhook(req: Request, env: ServerEnv): Promise<Response> {
  if (req.method !== "POST") return methodNotAllowed(req, "POST");
  try {
    requireApiKey(env);
    const raw = await req.text();
    if (raw.length > 65_536) throw new GatewayError("Payload too large.", "PAYLOAD_TOO_LARGE", 413);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new GatewayError("Invalid webhook JSON.", "INVALID_JSON", 400);
    }

    const signature = req.headers.get("x-zengapay-signature");
    if (!(await verifyWebhookSignature(raw, signature, env.ZENGAPAY_WEBHOOK_SECRET, payload))) {
      throw new GatewayError("Invalid webhook signature.", "INVALID_SIGNATURE", 401);
    }

    const { reference, externalReference, isTransfer } = extractWebhookFields(payload);
    if (!reference) throw new GatewayError("Webhook did not include a transactionReference.", "INVALID_REQUEST", 400);

    if (isTransfer) {
      const payout = await loadPayoutByReference(env, reference, externalReference);
      if (!payout) return json(req, { ok: true, status: "Received", received: true, ignored: true }, 202);
      const tx = await fetchTransferStatus(env, reference);
      const updated = await applyPayoutTransaction(env, payout, tx);
      return json(req, { ok: true, status: "Received", received: true, reference, payment_status: payoutPaymentStatus(updated) }, 202);
    }

    const order = await loadOrderByReference(env, reference, externalReference);
    if (!order) throw new GatewayError("Order not found; retry this webhook later.", "NOT_FOUND", 404);
    if (order.status === "SUCCEEDED" || order.status === "CHECKED_IN") {
      void triggerTicketDelivery(env, order.id).catch(() => undefined);
      return json(req, { ok: true, status: "Received", received: true, idempotent: true }, 202);
    }
    const tx = await fetchCollectionStatus(env, reference);
    const updated = await applyOrderTransaction(env, order, tx);
    return json(req, { ok: true, status: "Received", received: true, reference, payment_status: orderPaymentStatus(updated) }, 202);
  } catch (err) {
    return errorResponse(req, err);
  }
}
