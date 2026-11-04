import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { json } from "../_shared/cors.ts";
import {
  StoreError,
  buildStorePayment,
  fetchStoreTransactionDetail,
  fetchVerifiedStoreTransaction,
  storeConfig,
  storeErrorResponse,
  type StoreEnv,
} from "../_shared/storeCore.ts";

function env(): StoreEnv {
  return {
    DGATEWAY_API_KEY: Deno.env.get("DGATEWAY_API_KEY"),
    DGATEWAY_API_URL: Deno.env.get("DGATEWAY_API_URL"),
    DGATEWAY_WEBHOOK_SECRET: Deno.env.get("DGATEWAY_WEBHOOK_SECRET"),
    DGATEWAY_STORE_SLUG: Deno.env.get("DGATEWAY_STORE_SLUG"),
    DGATEWAY_ALLOW_TEST_PAYMENTS: Deno.env.get("DGATEWAY_ALLOW_TEST_PAYMENTS"),
    SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    ADMIN_EMAIL: Deno.env.get("ADMIN_EMAIL"),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(req, { ok: true });
  if (req.method !== "POST") return json(req, { ok: false, error: "Method not allowed." }, 405);
  try {
    const config = storeConfig(env());
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new StoreError("Sign in as an administrator.", "UNAUTHORIZED", 401);
    const admin = createClient(config.supabaseUrl, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const adminEmail = (env().ADMIN_EMAIL || "admin@tanktickets.site").trim().toLowerCase();
    if (userError || !userData.user || !userData.user.email_confirmed_at || (userData.user.email || "").toLowerCase() !== adminEmail) {
      throw new StoreError("Only TANK administrators can reconcile store payments.", "FORBIDDEN", 403);
    }
    const body = await req.json().catch(() => null) as { reference?: unknown } | null;
    const reference = typeof body?.reference === "string" ? body.reference.trim() : "";
    if (!/^[A-Za-z0-9_-]{6,200}$/.test(reference)) throw new StoreError("A valid payment reference is required.", "INVALID_REFERENCE", 400);

    const { data: stored, error: storedError } = await admin
      .from("dgateway_store_payments")
      .select("*")
      .eq("reference", reference)
      .maybeSingle();
    if (storedError) throw new StoreError("Could not load the stored payment.", "DATABASE_ERROR", 503);

    const verified = await fetchVerifiedStoreTransaction(env(), reference);
    if (verified.is_test === true && !config.allowTest) throw new StoreError("Test payments cannot issue live tickets.", "TEST_PAYMENT", 409);
    const detail = await fetchStoreTransactionDetail(env(), reference).catch((err) => {
      if (err instanceof StoreError && err.status === 400) return null;
      throw err;
    });
    if (detail && Number(detail.amount) !== Number(verified.amount)) throw new StoreError("Transaction detail amount does not match verification.", "AMOUNT_MISMATCH", 409);
    if (detail && String(detail.currency || "").toUpperCase() !== String(verified.currency || "").toUpperCase()) throw new StoreError("Transaction detail currency does not match verification.", "CURRENCY_MISMATCH", 409);
    const merged = detail ? { ...detail, ...verified, metadata: detail.metadata || verified.metadata } : verified;
    const storedData = stored ? {
      reference,
      product_id: stored.product_id,
      product_slug: stored.product_slug,
      quantity: stored.quantity,
      customer_name: stored.buyer_name,
      customer_email: stored.buyer_email,
      customer_phone: stored.buyer_phone,
      metadata: { store_slug: stored.store_slug },
    } : { reference };
    const payment = buildStorePayment(storedData, merged, config.storeSlug);
    const { data, error } = await admin.rpc("apply_dgateway_store_payment", { p_payment: payment });
    if (error) throw new StoreError(error.message || "Could not apply the verified payment.", "DATABASE_ERROR", 503);
    return json(req, { ok: true, ...data });
  } catch (err) {
    if (err instanceof StoreError) {
      return json(req, { ok: false, error: err.message, code: err.code }, err.status);
    }
    return storeErrorResponse(err);
  }
});
