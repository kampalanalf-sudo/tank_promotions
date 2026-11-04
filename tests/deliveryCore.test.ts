import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bytesToBase64,
  deliverOrderTicket,
  deliveryConfig,
  escapeHtml,
  sendResendEmail,
  sendWhatsAppTemplate,
  toWhatsAppNumber,
} from "../supabase/functions/_shared/deliveryCore";

const payload = { c: "TNK-ABC12345", t: "Beach Vibes", w: "2026-12-13T15:30:00.000Z", v: "Entebbe", n: "Buyer", q: 1, a: 20000, cur: "UGX" };

afterEach(() => vi.unstubAllGlobals());

describe("delivery helpers", () => {
  it("normalizes East African WhatsApp numbers", () => {
    expect(toWhatsAppNumber("0772123456")).toBe("256772123456");
    expect(toWhatsAppNumber("+256 772 123456")).toBe("256772123456");
    expect(toWhatsAppNumber("254712345678")).toBe("254712345678");
    expect(toWhatsAppNumber("255712345678")).toBe("255712345678");
    expect(toWhatsAppNumber("250788123456")).toBe("250788123456");
    expect(toWhatsAppNumber("772123456")).toBe("256772123456");
  });

  it("base64 encodes binary PDF bytes", () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 2, 250, 255]))).toBe("AAEC+v8=");
  });

  it("escapes HTML and detects configured channels", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
    expect(deliveryConfig({}).emailEnabled).toBe(false);
    expect(deliveryConfig({}).whatsappEnabled).toBe(false);
    const cfg = deliveryConfig({ RESEND_API_KEY: "re_123", WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_TEMPLATE_NAME: "ticket" });
    expect(cfg.emailEnabled).toBe(true);
    expect(cfg.whatsappEnabled).toBe(true);
  });

  it("sends Resend email with PDF attachment and idempotency key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendResendEmail({ RESEND_API_KEY: "re_123", EMAIL_FROM: "tickets@tanktickets.site" }, {
      to: "buyer@example.com",
      subject: "Ticket",
      html: "<p>Hi</p>",
      pdfBase64: "JVBERi0=",
      filename: "TNK-ABC12345.pdf",
      idempotencyKey: "tank-ticket-order-1",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("tank-ticket-order-1");
    const body = JSON.parse(String(init.body));
    expect(body.attachments[0].filename).toBe("TNK-ABC12345.pdf");
    expect(body.to).toEqual(["buyer@example.com"]);
  });

  it("sends an approved WhatsApp template with body parameters", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendWhatsAppTemplate({ WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "12345", WHATSAPP_TEMPLATE_NAME: "ticket_ready" }, {
      to: "0772123456",
      payload,
      ticketUrl: "https://tanktickets.site/#/t/TNK-ABC12345.x",
      pdfUrl: "https://example.supabase.co/storage/v1/object/sign/tickets/orders/1.pdf?token=abc",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v20.0/12345/messages");
    const body = JSON.parse(String(init.body));
    expect(body.to).toBe("256772123456");
    expect(body.template.name).toBe("ticket_ready");
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toContain("TNK-ABC12345");
  });
});

function mockAdmin(deliveryRow: Record<string, unknown> | null) {
  const upsert = vi.fn(async () => ({ error: null }));
  const upload = vi.fn(async () => ({ error: null }));
  const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://signed.example/pdf" }, error: null }));
  const rpc = vi.fn(async () => ({ data: deliveryRow, error: null }));
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "orders") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "order-1", code: "TNK-ABC12345", event_id: "event-1", event_title: "Beach Vibes", name: "Buyer", phone: "0772123456", email: "buyer@example.com", qty: 1, amount: 20000, currency: "UGX", status: "SUCCEEDED" }, error: null }) }) }) };
      if (table === "events") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { title: "Beach Vibes", starts_at: payload.w, venue: "Entebbe", area: "Beach" }, error: null }) }) }) };
      if (table === "ticket_deliveries") return { upsert };
      throw new Error(`unexpected table ${table}`);
    }),
    storage: { from: () => ({ upload, createSignedUrl }) },
    rpc,
  };
  return { admin, upsert, upload, createSignedUrl, rpc };
}

describe("deliverOrderTicket", () => {
  it("skips unconfigured channels but still stores a PDF and records status", async () => {
    const row = { order_id: "order-1", email_status: "pending", whatsapp_status: "pending", email_attempts: 0, whatsapp_attempts: 0, email_last_error: "", whatsapp_last_error: "", email_sent_at: null, whatsapp_sent_at: null, pdf_path: "" };
    const { admin, upsert, upload } = mockAdmin(row);
    const result = await deliverOrderTicket(admin as never, {}, "order-1");
    expect(upload).toHaveBeenCalled();
    expect(result.email_status).toBe("skipped");
    expect(result.whatsapp_status).toBe("skipped");
    expect(result.pdf_url).toBe("https://signed.example/pdf");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ email_status: "skipped", whatsapp_status: "skipped", locked_until: null }), { onConflict: "order_id" });
  });

  it("does not resend channels already sent unless forced", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const row = { order_id: "order-1", email_status: "sent", whatsapp_status: "sent", email_attempts: 1, whatsapp_attempts: 1, email_last_error: "", whatsapp_last_error: "", email_sent_at: "2026-11-04T00:00:00Z", whatsapp_sent_at: "2026-11-04T00:00:00Z", pdf_path: "" };
    const { admin } = mockAdmin(row);
    const result = await deliverOrderTicket(admin as never, { RESEND_API_KEY: "re_123", WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_TEMPLATE_NAME: "ticket" }, "order-1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.email_status).toBe("sent");
    expect(result.whatsapp_status).toBe("sent");
  });

  it("refuses delivery while another worker holds the lock", async () => {
    const { admin } = mockAdmin(null);
    await expect(deliverOrderTicket(admin as never, {}, "order-1")).rejects.toThrow(/already in progress/);
  });
});
