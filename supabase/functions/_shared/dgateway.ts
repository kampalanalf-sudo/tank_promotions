// Server-only credentials. Never import this module into the Vite application.
export const DGATEWAY_API_URL = (Deno.env.get("DGATEWAY_API_URL") || "https://dgatewayapi.desispay.com").replace(/\/$/, "");

export type PaymentStatus = "pending" | "completed" | "failed";
export type OrderRow = {
  id: string; code: string; event_id: string; event_title: string; user_id: string | null;
  name: string; phone: string; email: string; qty: number; amount: number;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "CHECKED_IN";
  dgateway_ref: string; collection_started_at?: string | null; provider: string; provider_ref: string; external_ref: string; created_at: string;
};
export type Transaction = {
  reference: string; provider?: string; provider_slug?: string; provider_ref?: string;
  status: string; amount: number; currency: string; direction?: string; failure_reason?: string;
};
export class GatewayError extends Error {
  constructor(message: string, public code = "PROVIDER_ERROR", public status = 502) {
    super(message);
    this.name = "GatewayError";
  }
}

function apiKey() {
  const key = Deno.env.get("DGATEWAY_API_KEY")?.trim();
  if (!key) throw new GatewayError("Mobile Money checkout is not configured. No payment has been requested.", "PAYMENT_NOT_CONFIGURED", 503);
  return key;
}

export function normalizeStatus(value: unknown): PaymentStatus {
  const status = String(value || "").toLowerCase();
  if (["completed", "succeeded", "successful"].includes(status)) return "completed";
  if (["failed", "cancelled", "canceled", "expired", "rejected"].includes(status)) return "failed";
  return "pending";
}

export function publicOrder(row: OrderRow) {
  return {
    id: row.id, code: row.code, eventId: row.event_id, eventTitle: row.event_title, userId: row.user_id,
    name: row.name, phone: row.phone, email: row.email || "", qty: row.qty, amount: row.amount,
    status: row.status, paymentRef: row.dgateway_ref || "", dgatewayRef: row.dgateway_ref || "",
    provider: row.provider || "iotec", providerRef: row.provider_ref || "", externalRef: row.external_ref,
    createdAt: row.created_at,
  };
}

export function transactionMatches(tx: Transaction, order: OrderRow) {
  return tx.reference === order.dgateway_ref && Number(tx.amount) === order.amount &&
    tx.currency === "UGX" && (!tx.direction || tx.direction === "collect");
}

async function request(path: string, body?: Record<string, unknown>) {
  const key = apiKey();
  const response = await fetch(`${DGATEWAY_API_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "X-Api-Key": key, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25_000),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.error) {
    const error = json?.error;
    const code = typeof error === "object" ? error?.code : json?.code;
    const message = typeof error === "object" ? error?.message : error;
    throw new GatewayError(message || json?.message || `DGateway returned HTTP ${response.status}`, code || "PROVIDER_ERROR", response.status === 429 ? 429 : 502);
  }
  if (!json?.data) throw new GatewayError("DGateway returned an incomplete response.", "INVALID_RESPONSE");
  return json.data;
}

export async function collect(order: OrderRow) {
  const tx = await request("/v1/payments/collect", {
    amount: order.amount,
    currency: "UGX",
    phone_number: order.phone,
    provider: "iotec",
    description: `TANK Tickets: ${order.event_title} (${order.code})`,
    callback_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/dgateway-webhook`,
    metadata: { order_id: order.id, order_code: order.code, external_ref: order.external_ref },
  }) as Transaction;
  if (!tx.reference || !transactionMatches(tx, { ...order, dgateway_ref: tx.reference })) {
    throw new GatewayError("The payment response did not match this order. Contact TANK before retrying.", "ORDER_MISMATCH");
  }
  return tx;
}

export async function verify(reference: string): Promise<Transaction> {
  const tx = await request("/v1/webhooks/verify", { reference }) as Transaction;
  if (tx.reference !== reference || !Number.isFinite(Number(tx.amount)) || !tx.currency) {
    throw new GatewayError("Payment verification did not match the request.", "INVALID_RESPONSE");
  }
  return tx;
}

export async function verifyWebhookSignature(raw: string, signature: string | null): Promise<boolean> {
  const secret = Deno.env.get("DGATEWAY_WEBHOOK_SECRET")?.trim();
  if (!secret) throw new GatewayError("Webhook verification is not configured.", "WEBHOOK_NOT_CONFIGURED", 503);
  if (!signature) return false;
  const received = signature.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(received)) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(raw)));
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ parseInt(received.slice(i * 2, i * 2 + 2), 16);
  return difference === 0;
}
