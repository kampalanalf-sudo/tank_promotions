// Server-only ticket delivery helpers. Never import this module into the Vite browser app.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTicketPdf, ticketDocumentLink, ticketMoney, ticketWhen, type TicketDocumentPayload } from "../../../src/lib/ticketDocument.ts";

export type DeliveryEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_TEMPLATE_NAME?: string;
  WHATSAPP_TEMPLATE_LANGUAGE?: string;
  WHATSAPP_TEMPLATE_BODY_FIELDS?: string;
  TICKET_PUBLIC_URL?: string;
};

export type DeliveryChannelStatus = "pending" | "sent" | "failed" | "skipped";

export type TicketDeliveryRow = {
  order_id: string;
  email_status: DeliveryChannelStatus;
  whatsapp_status: DeliveryChannelStatus;
  email_attempts: number;
  whatsapp_attempts: number;
  email_last_error: string;
  whatsapp_last_error: string;
  email_sent_at: string | null;
  whatsapp_sent_at: string | null;
  pdf_path: string;
  locked_until?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type DeliveryResult = {
  order_id: string;
  code: string;
  email_status: DeliveryChannelStatus;
  whatsapp_status: DeliveryChannelStatus;
  pdf_url?: string;
  email_last_error?: string;
  whatsapp_last_error?: string;
};

export function deliveryConfig(env: DeliveryEnv) {
  const publicUrl = (env.TICKET_PUBLIC_URL || "https://tanktickets.site").trim().replace(/\/+$/, "");
  const emailFrom = (env.EMAIL_FROM || "TANK Tickets <tickets@tanktickets.site>").trim();
  const whatsappTemplate = (env.WHATSAPP_TEMPLATE_NAME || "").trim();
  return {
    publicUrl,
    emailFrom,
    emailReplyTo: (env.EMAIL_REPLY_TO || "").trim(),
    emailEnabled: Boolean(env.RESEND_API_KEY?.trim() && emailFrom),
    whatsappEnabled: Boolean(env.WHATSAPP_ACCESS_TOKEN?.trim() && env.WHATSAPP_PHONE_NUMBER_ID?.trim() && whatsappTemplate),
    whatsappTemplate,
    whatsappLanguage: (env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US").trim(),
    whatsappBodyFields: (env.WHATSAPP_TEMPLATE_BODY_FIELDS || "name,event_title,event_date,ticket_code,ticket_url,pdf_url")
      .split(",").map((s) => s.trim()).filter(Boolean),
  };
}

/** Meta Cloud API expects digits only, including country code. */
export function toWhatsAppNumber(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("256") && digits.length === 12) return digits;
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("255") && digits.length === 12) return digits;
  if (digits.startsWith("250") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `256${digits.slice(1)}`;
  if (digits.length === 9) return `256${digits}`;
  return digits;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

export function ticketEmailHtml(p: TicketDocumentPayload, ticketUrl: string, pdfUrl: string) {
  return `<!doctype html>
<html><body style="margin:0;background:#efe8d8;font-family:Arial,Helvetica,sans-serif;color:#0c0c0b;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:#0c0c0b;color:#c9a227;padding:20px 24px;font-size:22px;font-weight:bold;">TANK TICKETS</div>
    <div style="background:#ffffff;padding:24px;border:1px solid #d8cfb8;">
      <p style="margin:0 0 8px;font-size:14px;">Hello ${escapeHtml(p.n)},</p>
      <p style="margin:0 0 16px;font-size:14px;">Your payment was verified and your ticket is ready.</p>
      <h1 style="margin:0 0 8px;font-size:24px;">${escapeHtml(p.t)}</h1>
      <p style="margin:0 0 4px;font-size:14px;">${escapeHtml(ticketWhen(p.w))}</p>
      <p style="margin:0 0 16px;font-size:14px;">${escapeHtml(p.v)}</p>
      <p style="margin:0 0 4px;font-size:14px;"><b>Tickets:</b> ${p.q}</p>
      <p style="margin:0 0 4px;font-size:14px;"><b>Amount:</b> ${escapeHtml(ticketMoney(p.a, p.cur))}</p>
      <p style="margin:0 0 16px;font-size:14px;"><b>Ticket code:</b> ${escapeHtml(p.c)}</p>
      <p style="margin:0 0 16px;font-size:14px;">The PDF ticket is attached. Show the QR code at the door.</p>
      <p style="margin:0 0 8px;"><a href="${escapeHtml(ticketUrl)}" style="display:inline-block;background:#0c0c0b;color:#c9a227;padding:12px 18px;text-decoration:none;font-weight:bold;">Open ticket</a></p>
      <p style="margin:0;"><a href="${escapeHtml(pdfUrl)}" style="font-size:13px;color:#0c0c0b;">Download PDF ticket</a></p>
    </div>
    <p style="font-size:12px;color:#6b6455;margin-top:16px;">Support: +256 775 497 509 · tanktickets.site</p>
  </div>
</body></html>`;
}

export async function sendResendEmail(env: DeliveryEnv, args: {
  to: string;
  subject: string;
  html: string;
  pdfBase64: string;
  filename: string;
  idempotencyKey: string;
}) {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("RESEND_API_KEY is not configured.");
  const config = deliveryConfig(env);
  const body: Record<string, unknown> = {
    from: config.emailFrom,
    to: [args.to],
    subject: args.subject,
    html: args.html,
    attachments: [{ filename: args.filename, content: args.pdfBase64 }],
  };
  if (config.emailReplyTo) body.reply_to = config.emailReplyTo;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": args.idempotencyKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await response.json().catch(() => null) as { id?: string; message?: string; error?: string } | null;
  if (!response.ok) throw new Error(json?.message || json?.error || `Resend returned HTTP ${response.status}`);
  return json?.id || "";
}

export async function sendWhatsAppTemplate(env: DeliveryEnv, args: {
  to: string;
  payload: TicketDocumentPayload;
  ticketUrl: string;
  pdfUrl: string;
}) {
  const token = env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const config = deliveryConfig(env);
  if (!token || !phoneNumberId || !config.whatsappTemplate) throw new Error("WhatsApp Cloud API is not configured.");
  const to = toWhatsAppNumber(args.to);
  if (!/^\d{10,15}$/.test(to)) throw new Error("Buyer phone number is not valid for WhatsApp delivery.");
  const values: Record<string, string> = {
    name: args.payload.n,
    event_title: args.payload.t,
    event_date: ticketWhen(args.payload.w),
    venue: args.payload.v,
    qty: String(args.payload.q),
    amount: ticketMoney(args.payload.a, args.payload.cur),
    ticket_code: args.payload.c,
    ticket_url: args.ticketUrl,
    pdf_url: args.pdfUrl,
  };
  const parameters = config.whatsappBodyFields
    .filter((field) => values[field] !== undefined)
    .map((field) => ({ type: "text", text: values[field].slice(0, 1024) }));
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: config.whatsappTemplate,
      language: { code: config.whatsappLanguage },
      components: parameters.length ? [{ type: "body", parameters }] : [],
    },
  };
  const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await response.json().catch(() => null) as { messages?: { id?: string }[]; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(json?.error?.message || `WhatsApp returned HTTP ${response.status}`);
  return json?.messages?.[0]?.id || "";
}

type OrderRow = {
  id: string;
  code: string;
  event_id: string;
  event_title: string;
  name: string;
  phone: string;
  email: string;
  qty: number;
  amount: number;
  currency?: string;
  status: string;
};

type EventRow = { title: string; starts_at: string; venue: string; area: string };

export async function deliverOrderTicket(
  admin: SupabaseClient,
  env: DeliveryEnv,
  orderId: string,
  opts: { force?: boolean } = {},
): Promise<DeliveryResult> {
  const { data: order, error: orderError } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (orderError || !order) throw new Error("Could not load the ticket order for delivery.");
  const row = order as OrderRow;
  if (row.status !== "SUCCEEDED" && row.status !== "CHECKED_IN") throw new Error("Tickets can only be delivered after verified payment.");
  const { data: event, error: eventError } = await admin.from("events").select("title,starts_at,venue,area").eq("id", row.event_id).maybeSingle();
  if (eventError || !event) throw new Error("Could not load the ticket event for delivery.");
  const ev = event as EventRow;
  const config = deliveryConfig(env);
  const payload: TicketDocumentPayload = {
    c: row.code,
    t: ev.title || row.event_title,
    w: ev.starts_at,
    v: [ev.venue, ev.area].filter(Boolean).join(", "),
    n: row.name,
    q: row.qty,
    a: row.amount,
    cur: row.currency || "UGX",
  };
  const ticketUrl = ticketDocumentLink(payload, config.publicUrl);
  const pdf = await buildTicketPdf(payload, { ticketUrl });
  const pdfPath = `orders/${row.id}.pdf`;
  const { error: uploadError } = await admin.storage.from("tickets").upload(pdfPath, pdf, { contentType: "application/pdf", upsert: true });
  if (uploadError) throw new Error(`Could not store the PDF ticket: ${uploadError.message}`);
  const { data: signed, error: signError } = await admin.storage.from("tickets").createSignedUrl(pdfPath, 60 * 60 * 24 * 7);
  if (signError || !signed?.signedUrl) throw new Error("Could not create a secure PDF download link.");
  const pdfUrl = signed.signedUrl;

  const { data: claimed, error: claimError } = await admin.rpc("claim_ticket_delivery", { p_order_id: row.id });
  if (claimError) throw new Error(`Could not lock ticket delivery: ${claimError.message}`);
  if (!claimed) throw new Error("Ticket delivery is already in progress. Try again in a moment.");
  const delivery = claimed as TicketDeliveryRow;
  delivery.pdf_path = pdfPath;
  delivery.locked_until = null;
  const now = new Date().toISOString();

  if (!opts.force && delivery.email_status === "sent") {
    // keep sent
  } else if (!row.email) {
    delivery.email_status = "skipped";
    delivery.email_last_error = "No buyer email address.";
  } else if (!config.emailEnabled) {
    delivery.email_status = "skipped";
    delivery.email_last_error = "Server email delivery is not configured.";
  } else {
    delivery.email_attempts += 1;
    try {
      await sendResendEmail(env, {
        to: row.email,
        subject: `Your TANK ticket: ${payload.t} (${payload.c})`,
        html: ticketEmailHtml(payload, ticketUrl, pdfUrl),
        pdfBase64: bytesToBase64(pdf),
        filename: `${payload.c}.pdf`,
        idempotencyKey: `tank-ticket-${row.id}`,
      });
      delivery.email_status = "sent";
      delivery.email_last_error = "";
      delivery.email_sent_at = now;
    } catch (err) {
      delivery.email_status = "failed";
      delivery.email_last_error = err instanceof Error ? err.message.slice(0, 500) : "Email delivery failed.";
    }
  }

  if (!opts.force && delivery.whatsapp_status === "sent") {
    // keep sent
  } else if (!row.phone) {
    delivery.whatsapp_status = "skipped";
    delivery.whatsapp_last_error = "No buyer phone number.";
  } else if (!config.whatsappEnabled) {
    delivery.whatsapp_status = "skipped";
    delivery.whatsapp_last_error = "Server WhatsApp delivery is not configured.";
  } else {
    delivery.whatsapp_attempts += 1;
    try {
      await sendWhatsAppTemplate(env, { to: row.phone, payload, ticketUrl, pdfUrl });
      delivery.whatsapp_status = "sent";
      delivery.whatsapp_last_error = "";
      delivery.whatsapp_sent_at = now;
    } catch (err) {
      delivery.whatsapp_status = "failed";
      delivery.whatsapp_last_error = err instanceof Error ? err.message.slice(0, 500) : "WhatsApp delivery failed.";
    }
  }

  delivery.updated_at = now;
  const { error: upsertError } = await admin.from("ticket_deliveries").upsert(delivery, { onConflict: "order_id" });
  if (upsertError) throw new Error(`Could not record ticket delivery status: ${upsertError.message}`);
  return {
    order_id: row.id,
    code: row.code,
    email_status: delivery.email_status,
    whatsapp_status: delivery.whatsapp_status,
    pdf_url: pdfUrl,
    email_last_error: delivery.email_last_error,
    whatsapp_last_error: delivery.whatsapp_last_error,
  };
}

