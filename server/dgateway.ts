// Server-only DGateway client. Never import this module into the browser bundle.
export type PaymentStatus = "pending" | "completed" | "failed";

export type ServerEnv = {
  DGATEWAY_API_KEY?: string;
  DGATEWAY_API_URL?: string;
  DGATEWAY_WEBHOOK_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  APP_URL?: string;
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  ADMIN_EMAIL?: string;
};

export type CollectPayload = {
  amount: number;
  currency: string;
  phone_number: string;
  description: string;
  callback_url?: string;
};

export type DisbursePayload = CollectPayload;

export type Transaction = {
  reference: string;
  status: string;
  provider?: string;
  provider_slug?: string;
  provider_ref?: string;
  amount?: number;
  currency?: string;
  direction?: string;
  failure_reason?: string;
};

export class GatewayError extends Error {
  constructor(message: string, public code = "PROVIDER_ERROR", public status = 502) {
    super(message);
    this.name = "GatewayError";
  }
}

export function baseUrl(env: ServerEnv) {
  return (env.DGATEWAY_API_URL || "https://dgatewayapi.desispay.com").replace(/\/$/, "");
}

export function requireApiKey(env: ServerEnv) {
  const key = env.DGATEWAY_API_KEY?.trim();
  if (!key) {
    throw new GatewayError("Mobile Money checkout is not configured. No payment has been requested.", "PAYMENT_NOT_CONFIGURED", 503);
  }
  return key;
}

/** DGateway phone numbers keep their leading 0 or +country code. */
export function cleanPhone(input: string) {
  return input.trim().replace(/[\s().-]/g, "");
}

export function isValidGatewayPhone(input: string) {
  const phone = cleanPhone(input);
  return /^(?:0[17]\d{8}|\+?256[17]\d{8}|\+?2547\d{8}|\+?255[67]\d{8}|\+?2507[2389]\d{7}|0111777(?:77|99|88)\d|256111777(?:77|99|88)\d)$/.test(phone);
}

export function normalizeCurrency(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

export function isWholeUnitAmount(amount: unknown, currency: string) {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return false;
  // Mobile money uses whole units. Stripe USD uses cents; both are integers.
  return ["UGX", "KES", "TZS", "RWF", "USD"].includes(currency);
}

/** Only the exact terminal states from DGateway may fulfil or fail an order. */
export function normalizeStatus(value: unknown): PaymentStatus {
  const status = String(value || "").toLowerCase();
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "pending";
}

async function request(env: ServerEnv, path: string, init?: { method?: string; body?: unknown }) {
  const key = requireApiKey(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${baseUrl(env)}${path}`, {
      method: init?.method || "GET",
      headers: {
        "X-API-Key": key,
        "Content-Type": "application/json",
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null) as
      | { data?: Transaction; error?: { code?: string; message?: string } | string; message?: string; code?: string }
      | null;
    if (!response.ok || json?.error) {
      const error = json?.error;
      const code = typeof error === "object" ? error?.code : json?.code;
      const message = typeof error === "object" ? error?.message : error;
      const status = response.status === 429 ? 429
        : [400, 404, 409, 422].includes(response.status) ? 400
        : [401, 403].includes(response.status) ? 503
        : 502;
      throw new GatewayError(
        message || json?.message || `DGateway returned HTTP ${response.status}`,
        code || (status === 503 ? "PAYMENT_NOT_CONFIGURED" : "PROVIDER_ERROR"),
        status,
      );
    }
    if (!json?.data) throw new GatewayError("DGateway returned an incomplete response.", "INVALID_RESPONSE");
    return json.data;
  } catch (err) {
    if (err instanceof GatewayError) throw err;
    if (controller.signal.aborted) {
      throw new GatewayError("DGateway did not respond in time. Keep your reference and check again shortly.", "PROVIDER_TIMEOUT", 504);
    }
    throw new GatewayError("We couldn't reach DGateway. Keep your reference and try again shortly.", "PROVIDER_UNAVAILABLE", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function collectPayment(env: ServerEnv, payload: CollectPayload) {
  const tx = await request(env, "/v1/payments/collect", { method: "POST", body: payload });
  if (!tx.reference) throw new GatewayError("DGateway did not return a payment reference.", "INVALID_RESPONSE");
  return tx;
}

export async function disbursePayment(env: ServerEnv, payload: DisbursePayload) {
  const tx = await request(env, "/v1/payments/disburse", { method: "POST", body: payload });
  if (!tx.reference) throw new GatewayError("DGateway did not return a payout reference.", "INVALID_RESPONSE");
  return tx;
}

export async function fetchTransactionStatus(env: ServerEnv, reference: string) {
  const tx = await request(env, `/v1/transactions/${encodeURIComponent(reference)}/status`);
  if (tx.reference !== reference) {
    throw new GatewayError("Payment verification did not match the request.", "INVALID_RESPONSE");
  }
  return tx;
}

export function transactionMatches(
  tx: Transaction,
  expected: { reference: string; amount: number; currency: string; direction?: "collect" | "disburse" },
) {
  if (tx.reference !== expected.reference) return false;
  if (tx.amount !== undefined && Number(tx.amount) !== expected.amount) return false;
  if (tx.currency !== undefined && normalizeCurrency(tx.currency) !== expected.currency) return false;
  if (expected.direction && tx.direction && tx.direction !== expected.direction) return false;
  return true;
}

export async function verifyWebhookSignature(raw: string, signature: string | null, secret?: string) {
  // If a webhook secret is configured, require a valid HMAC. If it is not configured,
  // the webhook handler still verifies the transaction directly with DGateway before crediting.
  if (!secret?.trim()) return true;
  if (!signature) return false;
  const received = signature.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(received)) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret.trim()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(raw)));
  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= expected[i] ^ parseInt(received.slice(i * 2, i * 2 + 2), 16);
  }
  return difference === 0;
}

export function publicBaseUrl(env: ServerEnv, req: Request) {
  const configured = env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  if (vercel) return `https://${vercel}`.replace(/\/$/, "");
  return new URL(req.url).origin;
}
