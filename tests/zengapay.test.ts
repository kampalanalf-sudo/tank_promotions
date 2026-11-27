import { afterEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../src/lib/types";

const sampleOrder: Order = {
  id: "order-1",
  code: "TNK-ABCD2345",
  eventId: "event-1",
  eventTitle: "Rukindo Beach Vibes",
  userId: null,
  name: "Sarah Namubiru",
  phone: "256772123456",
  email: "sarah@example.com",
  qty: 2,
  amount: 40000,
  status: "PENDING",
  paymentRef: "7666749a-07c3-4f88-a069-277c50ac7f0f",
  zengaRef: "7666749a-07c3-4f88-a069-277c50ac7f0f",
  provider: "zengapay",
  externalRef: "TNK-ext-123456789012",
  createdAt: "2026-11-03T10:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("zengapay browser payment client", () => {
  it("computes webhook URLs for Supabase Edge Functions and custom API base URLs", async () => {
    const { zengaWebhookUrl } = await import("../src/lib/zengapay");
    expect(zengaWebhookUrl("https://xmfvxypioitbsnsbgioq.supabase.co/", "")).toBe(
      "https://xmfvxypioitbsnsbgioq.supabase.co/functions/v1/zengapay-webhook",
    );
    expect(zengaWebhookUrl("https://xmfvxypioitbsnsbgioq.supabase.co", "https://api.tanktickets.site/")).toBe(
      "https://api.tanktickets.site/api/webhooks/zengapay",
    );
  });

  it("initiates and polls ZengaPay collections against /api when SUPABASE_URL is unset", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, reference: sampleOrder.paymentRef, status: "pending", order: sampleOrder }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, reference: sampleOrder.paymentRef, status: "completed", order: { ...sampleOrder, status: "SUCCEEDED" } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { initiatePayment, pollPaymentStatus } = await import("../src/lib/zengapay");
    const initiated = await initiatePayment({
      eventId: "event-1",
      orderCode: "TNK-ABCD2345",
      externalRef: "TNK-ext-123456789012",
      name: "Sarah Namubiru",
      phone: "0772 123456",
      email: "Sarah@Example.com",
      qty: 2,
    });
    expect(initiated.reference).toBe(sampleOrder.paymentRef);
    expect(initiated.status).toBe("pending");

    const [collectUrl, collectInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(collectUrl).toContain("/api/payments/collect");
    expect(JSON.parse(String(collectInit.body))).toMatchObject({
      event_id: "event-1",
      code: "TNK-ABCD2345",
      phone: "256772123456",
      email: "sarah@example.com",
      qty: 2,
    });

    const polled = await pollPaymentStatus(sampleOrder.paymentRef, sampleOrder.code);
    expect(polled.status).toBe("completed");
    expect(polled.order?.status).toBe("SUCCEEDED");
  });

  it("fails closed with PaymentError when the payment endpoint returns 404 or gateway error", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const { initiatePayment, PaymentError } = await import("../src/lib/zengapay");
    await expect(
      initiatePayment({
        eventId: "event-1",
        orderCode: "TNK-ABCD2345",
        externalRef: "TNK-ext-123456789012",
        name: "Sarah",
        phone: "0772123456",
        email: "",
        qty: 1,
      }),
    ).rejects.toBeInstanceOf(PaymentError);
  });
});
