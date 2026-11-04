import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { json } from "../_shared/cors.ts";
import { deliverOrderTicket, deliveryConfig, type DeliveryEnv } from "../_shared/deliveryCore.ts";

function env(): DeliveryEnv & { ADMIN_EMAIL?: string } {
  return {
    SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
    EMAIL_FROM: Deno.env.get("EMAIL_FROM"),
    EMAIL_REPLY_TO: Deno.env.get("EMAIL_REPLY_TO"),
    WHATSAPP_ACCESS_TOKEN: Deno.env.get("WHATSAPP_ACCESS_TOKEN"),
    WHATSAPP_PHONE_NUMBER_ID: Deno.env.get("WHATSAPP_PHONE_NUMBER_ID"),
    WHATSAPP_TEMPLATE_NAME: Deno.env.get("WHATSAPP_TEMPLATE_NAME"),
    WHATSAPP_TEMPLATE_LANGUAGE: Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE"),
    WHATSAPP_TEMPLATE_BODY_FIELDS: Deno.env.get("WHATSAPP_TEMPLATE_BODY_FIELDS"),
    TICKET_PUBLIC_URL: Deno.env.get("TICKET_PUBLIC_URL"),
    ADMIN_EMAIL: Deno.env.get("ADMIN_EMAIL"),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(req, { ok: true });
  if (req.method !== "POST") return json(req, { ok: false, error: "Method not allowed." }, 405);
  try {
    const config = env();
    const supabaseUrl = config.SUPABASE_URL?.trim();
    const serviceKey = config.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseUrl || !serviceKey) return json(req, { ok: false, error: "Ticket delivery is not configured." }, 503);
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json(req, { ok: false, error: "Sign in as an administrator." }, 401);
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // Payment webhooks call this with the service-role key; admins call it with their JWT.
    if (token !== serviceKey) {
      const { data: userData, error: userError } = await admin.auth.getUser(token);
      const adminEmail = (config.ADMIN_EMAIL || "admin@tanktickets.site").trim().toLowerCase();
      if (userError || !userData.user || !userData.user.email_confirmed_at || (userData.user.email || "").toLowerCase() !== adminEmail) {
        return json(req, { ok: false, error: "Only TANK administrators can deliver tickets." }, 403);
      }
    }

    const body = await req.json().catch(() => null) as { action?: unknown; order_id?: unknown; reference?: unknown; force?: unknown } | null;
    if (body?.action === "status") {
      const status = deliveryConfig(config);
      return json(req, {
        ok: true,
        email_enabled: status.emailEnabled,
        whatsapp_enabled: status.whatsappEnabled,
        email_from: status.emailFrom,
        whatsapp_template: status.whatsappTemplate,
        whatsapp_language: status.whatsappLanguage,
        public_url: status.publicUrl,
      });
    }
    let orderId = typeof body?.order_id === "string" ? body.order_id.trim() : "";
    const reference = typeof body?.reference === "string" ? body.reference.trim() : "";
    if (!orderId && reference) {
      const { data, error } = await admin.from("dgateway_store_payments").select("order_id").eq("reference", reference).maybeSingle();
      if (error) return json(req, { ok: false, error: "Could not load the store payment." }, 503);
      orderId = (data?.order_id as string | null) || "";
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
      return json(req, { ok: false, error: "A valid order_id or issued store reference is required." }, 400);
    }
    const result = await deliverOrderTicket(admin, config, orderId, { force: body?.force === true });
    return json(req, { ok: true, ...result });
  } catch (err) {
    console.error("ticket-delivery: failed", err instanceof Error ? err.message : "unknown");
    return json(req, { ok: false, error: err instanceof Error ? err.message : "Could not deliver this ticket." }, 502);
  }
});
