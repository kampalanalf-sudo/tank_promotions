// supabase/functions/_shared/dgateway.ts
// Server-side DGateway client for Supabase Edge Functions (Deno runtime)

export const DGATEWAY_API_URL =
  Deno.env.get("DGATEWAY_API_URL") || "https://dgatewayapi.desispay.com";

export function getApiKey(): string {
  const key = Deno.env.get("DGATEWAY_API_KEY");
  if (!key) {
    throw new Error(
      "DGATEWAY_API_KEY is not configured in Supabase Edge Function secrets."
    );
  }
  return key.trim();
}

export function getWebhookSecret(): string {
  const secret = Deno.env.get("DGATEWAY_WEBHOOK_SECRET");
  if (!secret) {
    throw new Error(
      "DGATEWAY_WEBHOOK_SECRET is not configured in Supabase Edge Function secrets."
    );
  }
  return secret.trim();
}

export interface CollectParams {
  amount: number;
  currency: string;
  phone_number: string;
  provider?: string; // "iotec" | "relworx" | "stripe" (defaults to iotec for UGX)
  description?: string;
  callback_url?: string;
  metadata?: Record<string, unknown>;
}

export interface DGatewayCollectResponse {
  data: {
    reference: string;
    provider: string;
    provider_ref?: string;
    status: string; // "pending"
    amount: number;
    currency: string;
    phone_number?: string;
    raw_response?: Record<string, unknown>;
    client_secret?: string;
    stripe_publishable_key?: string;
  };
  message?: string;
  error?: string;
  code?: string;
}

export interface DGatewayTransaction {
  reference: string;
  provider: string;
  provider_ref?: string;
  direction: "collect" | "disburse";
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed";
  phone_number?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Initiates collection from a customer phone via DGateway.
 * Uses 30-second timeout and X-Api-Key header.
 */
export async function dgatewayCollect(
  params: CollectParams
): Promise<DGatewayCollectResponse> {
  const apiKey = getApiKey();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${DGATEWAY_API_URL}/v1/payments/collect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errorMsg =
        json.error || json.message || `DGateway returned HTTP ${res.status}`;
      const err = new Error(errorMsg);
      // @ts-ignore attach code
      err.code = json.code || `HTTP_${res.status}`;
      throw err;
    }

    return json as DGatewayCollectResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Verifies or polls the status of a transaction reference against DGateway.
 */
export async function dgatewayVerify(
  reference: string
): Promise<{ data: DGatewayTransaction }> {
  const apiKey = getApiKey();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${DGATEWAY_API_URL}/v1/webhooks/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({ reference }),
      signal: controller.signal,
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      // Fallback to GET /v1/payments/transactions/:reference if verify endpoint is not available
      const getRes = await fetch(
        `${DGATEWAY_API_URL}/v1/payments/transactions/${encodeURIComponent(reference)}`,
        {
          headers: {
            "X-Api-Key": apiKey,
          },
        }
      );
      if (getRes.ok) {
        return (await getRes.json()) as { data: DGatewayTransaction };
      }
      throw new Error(
        json.error || json.message || `Verification failed with HTTP ${res.status}`
      );
    }

    return json as { data: DGatewayTransaction };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Verifies DGateway webhook signature using Web Crypto HMAC-SHA256.
 * Signature header: X-DGateway-Signature
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret?: string
): Promise<boolean> {
  if (!signatureHeader) return false;
  const webhookSecret = secret || getWebhookSecret();

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(rawBody)
    );

    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    const expectedHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const receivedHex = signatureHeader.trim().toLowerCase();

    // Constant-time comparison
    if (expectedHex.length !== receivedHex.length) return false;
    let diff = 0;
    for (let i = 0; i < expectedHex.length; i++) {
      diff |= expectedHex.charCodeAt(i) ^ receivedHex.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}
