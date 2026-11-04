import {
  GatewayError,
  cleanPhone,
  collectPayment,
  disbursePayment,
  fetchTransactionStatus,
  isWholeUnitAmount,
  isValidGatewayPhone,
  normalizeCurrency,
  normalizeStatus,
  publicBaseUrl,
  requireApiKey,
  transactionMatches,
  verifyWebhookSignature,
  type ServerEnv,
  type Transaction,
} from "./dgateway";
import {
  adminClient,
  buyerClient,
  orderPaymentStatus,
  payoutPaymentStatus,
  publicOrder,
  publicPayout,
  requireAdmin,
  type OrderRow,
  type PayoutRow,
} from "./db";
import { errorResponse, json, methodNotAllowed, preflight, readJson } from "./http";

const STATUS_POLL_INTERVAL_MS = 10_000;

function asString(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function webhookReference(payload: Record<string, unknown>) {
  const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : null;
  const transaction = payload.transaction && typeof payload.transaction === "object" ? payload.transaction as Record<string, unknown> : null;
  return asString(payload.reference) || asString(data?.reference) || asString(transaction?.reference);
}

async function loadOrderByReference(env: ServerEnv, reference: string) {
  const admin = adminClient(env);
  const { data, error } = await admin.from("orders").select("*").eq("dgateway_ref", reference).maybeSingle();
  if (error) throw new GatewayError("We couldn't load the payment record.", "DATABASE_ERROR", 503);
  return data as OrderRow | null;
}

async function loadPayoutByReference(env: ServerEnv, reference: string) {
  const admin = adminClient(env);
  const { data, error } = await admin.from("payouts").select("*").eq("dgateway_ref", reference).maybeSingle();
  if (error) throw new GatewayError("We couldn't load the payout record.", "DATABASE_ERROR", 503);
  return data as PayoutRow | null;
}

async function applyOrderTransaction(env: ServerEnv, row: OrderRow, tx: Transaction) {
  if (!transactionMatches(tx, { reference: row.dgateway_ref, amount: row.amount, currency: row.currency || "UGX", direction: "collect" })) {
    throw new GatewayError("Payment verification did not match this order.", "PAYMENT_MISMATCH", 502);
  }
  const status = normalizeStatus(tx.status);
  if (status === "pending") return row;
  const nextStatus = status === "completed" ? "SUCCEEDED" : "FAILED";
  const admin = adminClient(env);
  const { data, error } = await admin
    .from("orders")
    .update({
      status: nextStatus,
      provider: tx.provider || tx.provider_slug || row.provider || "",
      provider_ref: tx.provider_ref || row.provider_ref || "",
      payment_ref: row.dgateway_ref,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "PENDING")
    .select("*")
    .maybeSingle();
  if (error) throw new GatewayError("We couldn't update the payment record.", "DATABASE_ERROR", 503);
  if (data) return data as OrderRow;
  const { data: fresh, error: freshError } = await admin.from("orders").select("*").eq("id", row.id).single();
  if (freshError || !fresh) throw new GatewayError("We couldn't reload the payment record.", "DATABASE_ERROR", 503);
  return fresh as OrderRow;
}

async function applyPayoutTransaction(env: ServerEnv, row: PayoutRow, tx: Transaction) {
  if (!transactionMatches(tx, { reference: row.dgateway_ref, amount: row.amount, currency: row.currency, direction: "disburse" })) {
    throw new GatewayError("Payout verification did not match this request.", "PAYOUT_MISMATCH", 502);
  }
  const status = normalizeStatus(tx.status);
  if (status === "pending") return row;
  const nextStatus = status === "completed" ? "COMPLETED" : "FAILED";
  const admin = adminClient(env);
  const { data, error } = await admin
    .from("payouts")
    .update({
      status: nextStatus,
      provider: tx.provider || tx.provider_slug || row.provider || "",
      provider_ref: tx.provider_ref || row.provider_ref || "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "PENDING")
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
    const phone = cleanPhone(asString(body.phone, 30));
    const email = asString(body.email, 120);
    const qty = Number(body.qty);
    if (!eventId || !code || !externalRef || !name || !phone || !Number.isInteger(qty) || qty < 1 || qty > 10) {
      throw new GatewayError("Complete the checkout details before paying.", "INVALID_REQUEST", 400);
    }
    if (!isValidGatewayPhone(phone)) throw new GatewayError("Enter a valid Mobile Money number.", "INVALID_PHONE", 400);

    const buyer = buyerClient(env, req);
    const { data: created, error: createError } = await buyer.rpc("create_order", {
      p_event_id: eventId,
      p_code: code,
      p_name: name,
      p_phone: phone,
      p_email: email,
      p_qty: qty,
      p_external_ref: externalRef,
    });
    if (createError || !created) throw new GatewayError(createError?.message || "We couldn't create the order.", "ORDER_ERROR", 400);
    let row = created as OrderRow;
    if (row.status === "SUCCEEDED" || row.status === "CHECKED_IN") {
      return json(req, { ok: true, reference: row.dgateway_ref, status: "completed", order: publicOrder(row) });
    }
    if (row.status === "FAILED") throw new GatewayError("This checkout attempt failed. Start a new checkout.", "ORDER_FAILED", 409);
    if (row.amount <= 0) throw new GatewayError("This order does not require payment.", "INVALID_AMOUNT", 400);
    if (row.dgateway_ref) {
      return json(req, { ok: true, reference: row.dgateway_ref, status: orderPaymentStatus(row), order: publicOrder(row) });
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
      .is("collection_started_at", null)
      .select("*")
      .maybeSingle();
    if (claimError) throw new GatewayError("We couldn't start the payment request.", "DATABASE_ERROR", 503);
    if (!claimed) throw new GatewayError("This checkout is already being processed. Check My tickets before trying again.", "COLLECTION_IN_PROGRESS", 409);
    row = claimed as OrderRow;

    let tx: Transaction;
    try {
      tx = await collectPayment(env, {
        amount: row.amount,
        currency: row.currency || "UGX",
        phone_number: row.phone,
        description: `TANK Tickets ${row.code} · ${row.event_title}`.slice(0, 180),
        callback_url: `${publicBaseUrl(env, req)}/api/webhooks/dgateway`,
      });
    } catch (err) {
      // A definitive provider rejection can be retried safely; timeouts/5xx/429 cannot.
      if (err instanceof GatewayError && err.status === 400) {
        await admin.from("orders").update({ collection_started_at: null, updated_at: new Date().toISOString() }).eq("id", row.id).is("dgateway_ref", "");
      }
      throw err;
    }

    const { data: saved, error: saveError } = await admin
      .from("orders")
      .update({
        dgateway_ref: tx.reference,
        payment_ref: tx.reference,
        provider: tx.provider || tx.provider_slug || "",
        provider_ref: tx.provider_ref || "",
        currency: row.currency || "UGX",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (saveError || !saved) throw new GatewayError("Payment was requested but the reference could not be saved. Contact TANK support before paying again.", "DATABASE_ERROR", 503);
    row = saved as OrderRow;

    if (normalizeStatus(tx.status) !== "pending") {
      const verified = await fetchTransactionStatus(env, row.dgateway_ref);
      row = await applyOrderTransaction(env, row, verified);
    }
    return json(req, { ok: true, reference: row.dgateway_ref, status: orderPaymentStatus(row), order: publicOrder(row) });
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
    const currency = normalizeCurrency(body.currency || "UGX");
    const phone = cleanPhone(asString(body.phone_number || body.phone, 30));
    const description = asString(body.description, 180) || "TANK Tickets payout";
    if (!externalRef) throw new GatewayError("A unique payout reference is required.", "INVALID_REQUEST", 400);
    if (!isWholeUnitAmount(amount, currency)) throw new GatewayError("Enter a positive whole-unit amount for this currency.", "INVALID_AMOUNT", 400);
    if (!isValidGatewayPhone(phone)) throw new GatewayError("Enter a valid MTN/Airtel payout number.", "INVALID_PHONE", 400);

    const admin = adminClient(env);
    const { data: existing, error: existingError } = await admin.from("payouts").select("*").eq("external_ref", externalRef).maybeSingle();
    if (existingError) throw new GatewayError("We couldn't load the payout record.", "DATABASE_ERROR", 503);
    if (existing) {
      const payout = existing as PayoutRow;
      return json(req, { ok: true, reference: payout.dgateway_ref, status: payoutPaymentStatus(payout), payout: publicPayout(payout), reused: true });
    }

    const { data: inserted, error: insertError } = await admin
      .from("payouts")
      .insert({
        external_ref: externalRef,
        amount,
        currency,
        phone_number: phone,
        description,
        status: "PENDING",
        created_by: user.id,
      })
      .select("*")
      .single();
    if (insertError || !inserted) {
      const { data: raced } = await admin.from("payouts").select("*").eq("external_ref", externalRef).maybeSingle();
      if (raced) {
        const payout = raced as PayoutRow;
        return json(req, { ok: true, reference: payout.dgateway_ref, status: payoutPaymentStatus(payout), payout: publicPayout(payout), reused: true });
      }
      throw new GatewayError("We couldn't create the payout record.", "DATABASE_ERROR", 503);
    }
    let payout = inserted as PayoutRow;
    let tx: Transaction;
    try {
      tx = await disbursePayment(env, {
        amount,
        currency,
        phone_number: phone,
        description,
        callback_url: `${publicBaseUrl(env, req)}/api/webhooks/dgateway`,
      });
    } catch (err) {
      if (err instanceof GatewayError && err.status === 400) {
        await admin.from("payouts").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("id", payout.id).eq("status", "PENDING");
      }
      throw err;
    }
    const { data: saved, error: saveError } = await admin
      .from("payouts")
      .update({ dgateway_ref: tx.reference, provider: tx.provider || tx.provider_slug || "", provider_ref: tx.provider_ref || "", updated_at: new Date().toISOString() })
      .eq("id", payout.id)
      .select("*")
      .single();
    if (saveError || !saved) throw new GatewayError("Payout was requested but the reference could not be saved. Contact support before retrying.", "DATABASE_ERROR", 503);
    payout = saved as PayoutRow;
    if (normalizeStatus(tx.status) !== "pending") {
      const verified = await fetchTransactionStatus(env, payout.dgateway_ref);
      payout = await applyPayoutTransaction(env, payout, verified);
    }
    return json(req, { ok: true, reference: payout.dgateway_ref, status: payoutPaymentStatus(payout), payout: publicPayout(payout) });
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
      const tx = await fetchTransactionStatus(env, reference);
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
      const tx = await fetchTransactionStatus(env, reference);
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
    const raw = await req.text();
    if (raw.length > 65_536) throw new GatewayError("Payload too large.", "PAYLOAD_TOO_LARGE", 413);
    const signature = req.headers.get("x-dgateway-signature") || req.headers.get("x-webhook-signature") || req.headers.get("x-signature");
    if (!(await verifyWebhookSignature(raw, signature, env.DGATEWAY_WEBHOOK_SECRET))) {
      throw new GatewayError("Invalid webhook signature.", "INVALID_SIGNATURE", 401);
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new GatewayError("Invalid webhook JSON.", "INVALID_JSON", 400);
    }
    const reference = webhookReference(payload);
    if (!reference) throw new GatewayError("Webhook did not include a reference.", "INVALID_REQUEST", 400);

    // Never trust the webhook body alone: re-fetch the transaction from DGateway.
    const tx = await fetchTransactionStatus(env, reference);
    const order = await loadOrderByReference(env, reference);
    if (order) {
      const updated = await applyOrderTransaction(env, order, tx);
      return json(req, { ok: true, reference, status: orderPaymentStatus(updated) });
    }
    const payout = await loadPayoutByReference(env, reference);
    if (payout) {
      const updated = await applyPayoutTransaction(env, payout, tx);
      return json(req, { ok: true, reference, status: payoutPaymentStatus(updated) });
    }
    return json(req, { ok: true, reference, status: normalizeStatus(tx.status), ignored: true });
  } catch (err) {
    return errorResponse(req, err);
  }
}
