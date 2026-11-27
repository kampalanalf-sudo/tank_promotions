import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { json } from "../_shared/cors.ts";
import {
  GatewayError,
  denoEnv,
  disbursePayment,
  fetchTransferStatus,
  isValidZengaPhone,
  isWholeUnitUgx,
  normalizeStatus,
  payoutReference,
  publicPayout,
  requireApiKey,
  toZengaMsisdn,
  transactionMatches,
  type PayoutRow,
} from "../_shared/zengapay.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(req, { ok: true });
  if (req.method !== "POST") return json(req, { ok: false, error: "Method not allowed." }, 405);
  try {
    const env = denoEnv();
    requireApiKey(env);

    const url = env.SUPABASE_URL?.trim();
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !serviceKey) {
      throw new GatewayError("The payment database is not configured.", "PAYMENT_NOT_CONFIGURED", 503);
    }
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json(req, { ok: false, error: "Sign in as an administrator to request a transfer.", code: "UNAUTHORIZED" }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const adminEmail = (env.ADMIN_EMAIL || "admin@tanktickets.site").trim().toLowerCase();
    if (userError || !userData.user || !userData.user.email_confirmed_at || (userData.user.email || "").toLowerCase() !== adminEmail) {
      return json(req, { ok: false, error: "Only TANK administrators can send transfers.", code: "FORBIDDEN" }, 403);
    }

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const externalRef = typeof body?.external_ref === "string" ? body.external_ref.trim().slice(0, 100) : "";
    const amount = Number(body?.amount);
    const currency = typeof body?.currency === "string" ? body.currency.trim().toUpperCase() : "UGX";
    const rawPhone = typeof body?.phone_number === "string" ? body.phone_number : typeof body?.phone === "string" ? body.phone : "";
    const msisdn = toZengaMsisdn(rawPhone);
    const description = (typeof body?.description === "string" ? body.description.trim().slice(0, 140) : "") || "TANK Tickets payout";

    if (!externalRef) throw new GatewayError("A unique payout reference is required.", "INVALID_REQUEST", 400);
    if (currency !== "UGX" || !isWholeUnitUgx(amount)) {
      throw new GatewayError("ZengaPay transfers support positive whole-shilling UGX amounts.", "INVALID_AMOUNT", 400);
    }
    if (!isValidZengaPhone(msisdn)) {
      throw new GatewayError("Enter a valid Ugandan MTN or Airtel Mobile Money number.", "INVALID_PHONE", 400);
    }

    const { data: existing, error: existingError } = await admin.from("payouts").select("*").eq("external_ref", externalRef).maybeSingle();
    if (existingError) throw new GatewayError("Could not load payout record.", "DATABASE_ERROR", 503);
    if (existing) {
      const row = existing as PayoutRow;
      const status = row.status === "COMPLETED" ? "completed" : row.status === "FAILED" ? "failed" : "pending";
      return json(req, { ok: true, reference: payoutReference(row), status, payout: publicPayout(row), reused: true });
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
        created_by: userData.user.id,
      })
      .select("*")
      .single();
    if (insertError || !inserted) {
      throw new GatewayError("Could not create payout record.", "DATABASE_ERROR", 503);
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

    // Store reference in zenga_ref when migrated, falling back to dgateway_ref if pre-migration.
    let { data: saved, error: saveError } = await admin
      .from("payouts")
      .update({
        zenga_ref: initiated.reference,
        provider: "zengapay",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payout.id)
      .select("*")
      .single();
    if (saveError) {
      const fallback = await admin
        .from("payouts")
        .update({
          dgateway_ref: initiated.reference,
          provider: "zengapay",
          updated_at: new Date().toISOString(),
        })
        .eq("id", payout.id)
        .select("*")
        .single();
      saved = fallback.data;
      saveError = fallback.error;
    }
    if (saveError || !saved) {
      throw new GatewayError("Transfer was requested, but its reference could not be saved. Contact support before retrying.", "DATABASE_ERROR", 503);
    }
    payout = saved as PayoutRow;

    let finalStatus = initiated.status;
    if (initiated.status !== "pending") {
      const verified = await fetchTransferStatus(env, initiated.reference);
      if (transactionMatches(verified, { reference: initiated.reference, amount, externalRef, direction: "transfer" })) {
        finalStatus = normalizeStatus(verified.status);
        if (finalStatus !== "pending") {
          const next = finalStatus === "completed" ? "COMPLETED" : "FAILED";
          const { data: updated } = await admin
            .from("payouts")
            .update({
              status: next,
              provider: verified.provider || "zengapay",
              provider_ref: verified.providerRef || "",
              updated_at: new Date().toISOString(),
            })
            .eq("id", payout.id)
            .select("*")
            .maybeSingle();
          if (updated) payout = updated as PayoutRow;
        }
      }
    }

    return json(req, { ok: true, reference: initiated.reference, status: finalStatus, payout: publicPayout(payout) });
  } catch (err) {
    const known = err instanceof GatewayError;
    if (!known) console.error("zengapay-transfer: failed", err instanceof Error ? err.name : "unknown");
    return json(
      req,
      {
        ok: false,
        error: known ? err.message : "Transfer request failed.",
        code: known ? err.code : "TRANSFER_UNAVAILABLE",
      },
      known ? err.status : 503,
    );
  }
});
