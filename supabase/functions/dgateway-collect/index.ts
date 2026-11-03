// supabase/functions/dgateway-collect/index.ts
// Initiates Mobile Money collection via DGateway and records pending order in Supabase
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders } from "../_shared/cors.ts";
import { dgatewayCollect } from "../_shared/dgateway.ts";

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const {
      event_id,
      code,
      name,
      phone,
      email,
      qty,
      amount,
      currency = "UGX",
      provider = "iotec",
      external_ref,
      callback_url,
    } = body;

    if (!event_id || !code || !name || !phone || !qty) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Missing required fields: event_id, code, name, phone, qty",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 1. Reserve / create the order in Supabase via RPC
    const extRef = external_ref || `TNK${Date.now()}`;
    const { data: orderData, error: orderError } = await supabase.rpc(
      "create_order",
      {
        p_event_id: event_id,
        p_code: code,
        p_name: name,
        p_phone: phone,
        p_email: email || "",
        p_qty: Number(qty),
        p_external_ref: extRef,
      }
    );

    if (orderError) {
      return new Response(
        JSON.stringify({ ok: false, error: orderError.message }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const order = typeof orderData === "string" ? JSON.parse(orderData) : orderData;

    // Free ticket bypass
    if (order.amount === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          status: "completed",
          reference: extRef,
          order,
          message: "Free ticket confirmed",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 2. Determine Webhook Callback URL
    const appUrl = Deno.env.get("APP_URL") || "";
    const defaultCallbackUrl = `${supabaseUrl}/functions/v1/dgateway-webhook`;
    const finalCallbackUrl = callback_url || defaultCallbackUrl;

    // 3. Initiate DGateway Mobile Money Collection
    const collectRes = await dgatewayCollect({
      amount: order.amount,
      currency: currency || "UGX",
      phone_number: phone,
      provider: provider || "iotec",
      description: `TANK Tickets: ${order.event_title || "Event"} (${code})`,
      callback_url: finalCallbackUrl,
      metadata: {
        order_id: order.id,
        order_code: code,
        event_id,
        event_title: order.event_title,
        buyer_name: name,
        buyer_phone: phone,
        buyer_email: email || "",
        qty,
        external_ref: extRef,
      },
    });

    const dgwRef = collectRes.data?.reference || "";
    const providerRef = collectRes.data?.provider_ref || "";
    const providerName = collectRes.data?.provider || provider || "iotec";

    // 4. Update the order with DGateway transaction reference
    await supabase
      .from("orders")
      .update({
        dgateway_ref: dgwRef,
        provider: providerName,
        provider_ref: providerRef,
        payment_ref: dgwRef,
        zenga_ref: dgwRef,
      })
      .eq("code", code);

    return new Response(
      JSON.stringify({
        ok: true,
        reference: dgwRef,
        status: collectRes.data?.status || "pending",
        provider: providerName,
        amount: collectRes.data?.amount || order.amount,
        currency: collectRes.data?.currency || currency,
        order_code: code,
        message: "Payment prompt sent to your phone",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("[dgateway-collect error]:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err.message || "Failed to initiate payment collection",
        code: err.code || "COLLECT_FAILED",
      }),
      {
        status: err.code === "PROVIDER_LINE_DOWN" ? 503 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
