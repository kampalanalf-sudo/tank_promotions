// supabase/functions/dgateway-status/index.ts
// Polls and verifies transaction status against DGateway and synchronizes Supabase orders
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders } from "../_shared/cors.ts";
import { dgatewayVerify } from "../_shared/dgateway.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let reference = "";
    let code = "";

    if (req.method === "GET") {
      const url = new URL(req.url);
      reference = url.searchParams.get("reference") || url.searchParams.get("ref") || "";
      code = url.searchParams.get("code") || "";
    } else {
      const body = await req.json().catch(() => ({}));
      reference = body.reference || body.ref || "";
      code = body.code || "";
    }

    // If only code is provided, look up order to get reference
    if (!reference && code) {
      const { data: order } = await supabase
        .from("orders")
        .select("dgateway_ref, status, payment_ref, zenga_ref")
        .eq("code", code)
        .maybeSingle();

      if (order) {
        if (order.status === "SUCCEEDED" || order.status === "CHECKED_IN") {
          return new Response(
            JSON.stringify({
              ok: true,
              status: "completed",
              order_status: order.status,
              code,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        reference = order.dgateway_ref || order.payment_ref || order.zenga_ref || "";
      }
    }

    if (!reference) {
      return new Response(
        JSON.stringify({ ok: false, error: "Transaction reference is required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify against DGateway API
    const verifyRes = await dgatewayVerify(reference);
    const tx = verifyRes.data;
    const dgwStatus = (tx?.status || "pending").toLowerCase();

    // Map DGateway status to TANK order status
    let orderStatus = "PENDING";
    if (dgwStatus === "completed" || dgwStatus === "succeeded") {
      orderStatus = "SUCCEEDED";
    } else if (dgwStatus === "failed" || dgwStatus === "cancelled") {
      orderStatus = "FAILED";
    }

    // If terminal, update the order in Supabase
    if (orderStatus === "SUCCEEDED" || orderStatus === "FAILED") {
      await supabase
        .from("orders")
        .update({
          status: orderStatus,
          provider_ref: tx.provider_ref || "",
          provider: tx.provider || "",
          updated_at: new Date().toISOString(),
        })
        .or(`dgateway_ref.eq.${reference},payment_ref.eq.${reference},code.eq.${code}`);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        reference,
        status: dgwStatus,
        order_status: orderStatus,
        provider: tx?.provider,
        provider_ref: tx?.provider_ref,
        amount: tx?.amount,
        currency: tx?.currency,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("[dgateway-status error]:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err.message || "Failed to verify transaction status",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
