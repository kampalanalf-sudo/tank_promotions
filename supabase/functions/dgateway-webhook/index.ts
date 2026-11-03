// supabase/functions/dgateway-webhook/index.ts
// Inbound Webhook handler for DGateway transaction events with HMAC-SHA256 verification
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyWebhookSignature } from "../_shared/dgateway.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const rawBody = await req.text();
    const signature =
      req.headers.get("x-dgateway-signature") ||
      req.headers.get("X-DGateway-Signature") ||
      req.headers.get("X-Signature");

    const webhookSecret = Deno.env.get("DGATEWAY_WEBHOOK_SECRET");

    // 1. Verify HMAC-SHA256 signature if secret is configured
    if (webhookSecret) {
      const isValid = await verifyWebhookSignature(
        rawBody,
        signature,
        webhookSecret
      );
      if (!isValid) {
        console.warn("[dgateway-webhook] Invalid HMAC signature rejected.");
        return new Response(
          JSON.stringify({ error: "Invalid webhook signature" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // 2. Parse payload
    const payload = JSON.parse(rawBody);
    console.log("[dgateway-webhook] Received event:", payload);

    const {
      event,
      reference,
      status,
      provider,
      provider_ref,
      amount,
      currency,
      metadata = {},
    } = payload;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const orderCode = metadata.order_code || metadata.code;
    const externalRef = metadata.external_ref;

    // 3. Find the corresponding order
    let query = supabase.from("orders").select("id, code, status, qty, event_id");

    if (reference) {
      query = query.or(`dgateway_ref.eq.${reference},payment_ref.eq.${reference},code.eq.${orderCode || reference}`);
    } else if (orderCode) {
      query = query.eq("code", orderCode);
    } else if (externalRef) {
      query = query.eq("external_ref", externalRef);
    }

    const { data: existingOrder } = await query.maybeSingle();

    if (existingOrder) {
      // Idempotency: skip if already processed
      if (
        existingOrder.status === "SUCCEEDED" ||
        existingOrder.status === "CHECKED_IN"
      ) {
        console.log(
          `[dgateway-webhook] Order ${existingOrder.code} is already completed. Skipping.`
        );
        return new Response(
          JSON.stringify({ received: true, idempotency: "already_completed" }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Map status
      const normalizedStatus = (status || "").toLowerCase();
      let newStatus: "SUCCEEDED" | "FAILED" | "PENDING" = "PENDING";

      if (
        normalizedStatus === "completed" ||
        normalizedStatus === "succeeded" ||
        event === "transaction.completed"
      ) {
        newStatus = "SUCCEEDED";
      } else if (
        normalizedStatus === "failed" ||
        normalizedStatus === "cancelled" ||
        event === "transaction.failed"
      ) {
        newStatus = "FAILED";
      }

      // 4. Update the order in Supabase
      if (newStatus !== "PENDING") {
        await supabase
          .from("orders")
          .update({
            status: newStatus,
            dgateway_ref: reference || existingOrder.dgateway_ref,
            provider_ref: provider_ref || "",
            provider: provider || "",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingOrder.id);

        console.log(
          `[dgateway-webhook] Successfully updated order ${existingOrder.code} status to ${newStatus}`
        );
      }
    } else {
      console.warn(
        `[dgateway-webhook] No matching order found for ref: ${reference}, code: ${orderCode}`
      );
    }

    // Always respond 200 quickly
    return new Response(JSON.stringify({ received: true, status: "ok" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[dgateway-webhook error]:", err);
    // Respond 200 on parse error to avoid infinite webhook retry loops from gateway, but log error
    return new Response(
      JSON.stringify({ received: true, error: err.message }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
