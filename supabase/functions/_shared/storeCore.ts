// Server-only hosted-store fulfilment core. Shared by Supabase Edge Functions and Node tests.
// Never import this module into the Vite browser application.

export type StoreEnv = {
  DGATEWAY_API_KEY?: string;
  DGATEWAY_API_URL?: string;
  DGATEWAY_WEBHOOK_SECRET?: string;
  DGATEWAY_STORE_SLUG?: string;
  DGATEWAY_ALLOW_TEST_PAYMENTS?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ADMIN_EMAIL?: string;
};

export type StorePaymentInput = {
  reference: string;
  store_slug: string;
  product_id: string;
  product_slug: string;
  status: "pending" | "completed" | "failed";
  amount: number;
  currency: string;
  quantity: number;
  name: string;
  email: string;
  phone: string;
  provider: string;
  provider_ref: string;
  failure_reason: string;
};

export type StoreApplyResult = {
  received?: boolean;
  status?: string;
  fulfilment?: "issued" | "blocked" | "pending" | "not_required";
  code?: string;
  order_id?: string;
  idempotent?: boolean;
};

export class StoreError extends Error {
  constructor(message: string, public code = "STORE_ERROR", public status = 502) {
    super(message);
    this.name = "StoreError";
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max = 200): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, max);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function metadata(value: unknown): JsonObject {
  if (isObject(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return isObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function storeConfig(env: StoreEnv) {
  const apiKey = env.DGATEWAY_API_KEY?.trim();
  const webhookSecret = env.DGATEWAY_WEBHOOK_SECRET?.trim();
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!apiKey) throw new StoreError("DGateway API key is not configured.", "PAYMENT_NOT_CONFIGURED", 503);
  if (!webhookSecret) throw new StoreError("DGateway webhook secret is not configured.", "WEBHOOK_NOT_CONFIGURED", 503);
  if (!supabaseUrl || !serviceKey) throw new StoreError("The payment database is not configured.", "PAYMENT_NOT_CONFIGURED", 503);
  return {
    apiKey,
    webhookSecret,
    supabaseUrl,
    serviceKey,
    baseUrl: (env.DGATEWAY_API_URL || "https://dgatewayapi.desispay.com").trim().replace(/\/$/, ""),
    storeSlug: (env.DGATEWAY_STORE_SLUG || "tanktickets").trim().toLowerCase(),
    allowTest: env.DGATEWAY_ALLOW_TEST_PAYMENTS === "true",
  };
}

export async function verifyStoreSignature(raw: string, signature: string | null, secret: string | undefined): Promise<boolean> {
  const key = secret?.trim();
  if (!key) throw new StoreError("DGateway webhook secret is not configured.", "WEBHOOK_NOT_CONFIGURED", 503);
  if (!signature) return false;
  const received = signature.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(received)) return false;
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(raw)));
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ parseInt(received.slice(i * 2, i * 2 + 2), 16);
  return difference === 0;
}

export function parseStoreNotification(raw: string): { event: string; data: JsonObject } {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new StoreError("Invalid webhook JSON.", "INVALID_JSON", 400);
  }
  if (!isObject(payload)) throw new StoreError("Invalid webhook payload.", "INVALID_PAYLOAD", 400);
  const data = isObject(payload.data) ? payload.data : isObject(payload.transaction) ? payload.transaction : payload;
  return { event: text(payload.event, 100), data };
}

export function notificationReference(data: JsonObject): string {
  const reference = text(data.reference, 200);
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(reference)) {
    throw new StoreError("Webhook did not include a valid transaction reference.", "INVALID_REFERENCE", 400);
  }
  return reference;
}

async function gatewayJson(env: StoreEnv, path: string): Promise<{ status: number; body: JsonObject | null }> {
  const config = storeConfig(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      headers: { "X-API-Key": config.apiKey, "Content-Type": "application/json" },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null) as JsonObject | null;
    return { status: response.status, body: isObject(body) ? body : null };
  } catch (err) {
    if (controller.signal.aborted) throw new StoreError("DGateway verification timed out.", "PROVIDER_TIMEOUT", 504);
    throw new StoreError("Could not reach DGateway for verification.", "PROVIDER_UNAVAILABLE", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function gatewayError(status: number, body: JsonObject | null): StoreError {
  const error = isObject(body?.error) ? body.error : null;
  const code = text(error?.code) || text(body?.code) || "PROVIDER_ERROR";
  const message = text(error?.message) || text(body?.message) || `DGateway returned HTTP ${status}`;
  const http = status === 429 ? 429 : [401, 403].includes(status) ? 503 : [400, 404, 409, 422].includes(status) ? 400 : 502;
  return new StoreError(message, code, http);
}

export async function fetchVerifiedStoreTransaction(env: StoreEnv, reference: string): Promise<JsonObject> {
  const { status, body } = await gatewayJson(env, `/v1/transactions/${encodeURIComponent(reference)}/status`);
  if (status < 200 || status >= 300 || body?.error) throw gatewayError(status, body);
  const data = isObject(body?.data) ? body.data : null;
  if (!data || text(data.reference, 200) !== reference) {
    throw new StoreError("Payment verification did not match the reference.", "INVALID_RESPONSE", 502);
  }
  const amount = Number(data.amount);
  const currency = text(data.currency, 3).toUpperCase();
  if (!Number.isInteger(amount) || amount <= 0 || amount > 2_000_000_000 || !/^[A-Z]{3}$/.test(currency)) {
    throw new StoreError("DGateway returned an invalid amount or currency.", "INVALID_RESPONSE", 502);
  }
  const direction = text(data.direction, 20).toLowerCase();
  if (direction && direction !== "collect") {
    throw new StoreError("Only collected payments can issue tickets.", "DIRECTION_MISMATCH", 400);
  }
  const rawStatus = text(data.status, 30).toLowerCase();
  const normalized = rawStatus === "completed" ? "completed" : rawStatus === "failed" ? "failed" : "pending";
  return { ...data, reference, amount, currency, status: normalized };
}

export async function fetchStoreTransactionDetail(env: StoreEnv, reference: string): Promise<JsonObject | null> {
  const { status, body } = await gatewayJson(env, `/v1/payments/transactions/${encodeURIComponent(reference)}`);
  if (status === 404) return null;
  if (status < 200 || status >= 300 || body?.error) throw gatewayError(status, body);
  const data = isObject(body?.data) ? body.data : null;
  if (!data || text(data.reference, 200) !== reference) {
    throw new StoreError("Transaction detail did not match the reference.", "INVALID_RESPONSE", 502);
  }
  return data;
}

function firstText(sources: JsonObject[], keys: string[], max = 200): string {
  for (const source of sources) {
    for (const key of keys) {
      const value = text(source[key], max);
      if (value) return value;
    }
  }
  return "";
}

function productIdentity(source: JsonObject): { id: string; slug: string } {
  const product = isObject(source.product) ? source.product : {};
  const meta = metadata(source.metadata);
  // Do not treat a transaction/event top-level `id` as a product id.
  return {
    id: firstText([source, meta], ["product_id", "productId"], 100) || text(product.id, 100),
    slug: firstText([source, meta], ["product_slug", "productSlug"], 120) || text(product.slug, 120),
  };
}

function itemIdentity(item: JsonObject): { id: string; slug: string; quantity: number } {
  const product = isObject(item.product) ? item.product : {};
  const id = firstText([item], ["product_id", "productId"], 100) || text(product.id, 100);
  const slug = firstText([item], ["product_slug", "productSlug"], 120) || text(product.slug, 120);
  const quantity = Number(item.quantity ?? 1);
  return { id, slug, quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1 };
}

function extractItems(data: JsonObject): { id: string; slug: string; quantity: number } | null {
  const items = Array.isArray(data.items) ? data.items : Array.isArray(data.line_items) ? data.line_items : null;
  if (!items || items.length === 0) return null;
  let combined: { id: string; slug: string; quantity: number } | null = null;
  for (const raw of items) {
    if (!isObject(raw)) throw new StoreError("Unsupported store line item.", "INVALID_PAYLOAD", 400);
    const item = itemIdentity(raw);
    if (!combined) combined = item;
    else {
      if ((item.id && combined.id && item.id !== combined.id) || (item.slug && combined.slug && item.slug !== combined.slug)) {
        throw new StoreError("Multi-product carts must be split into one product per payment.", "MULTI_PRODUCT_UNSUPPORTED", 409);
      }
      combined = { id: combined.id || item.id, slug: combined.slug || item.slug, quantity: combined.quantity + item.quantity };
    }
  }
  return combined;
}

export function buildStorePayment(data: JsonObject, verified: JsonObject, storeSlug: string): StorePaymentInput {
  const reference = text(verified.reference, 200);
  const verifiedMeta = metadata(verified.metadata);
  const notificationMeta = metadata(data.metadata);
  const verifiedProduct = productIdentity({ ...verified, metadata: verifiedMeta });
  const notificationProduct = productIdentity({ ...data, metadata: notificationMeta });
  const verifiedItems = extractItems(verified);
  const notificationItems = extractItems(data);
  const verifiedId = verifiedItems?.id || verifiedProduct.id;
  const verifiedSlug = verifiedItems?.slug || verifiedProduct.slug;
  const notificationId = notificationItems?.id || notificationProduct.id;
  const notificationSlug = notificationItems?.slug || notificationProduct.slug;
  if (verifiedId && notificationId && verifiedId !== notificationId) throw new StoreError("Product identity mismatch.", "PRODUCT_MISMATCH", 409);
  if (verifiedSlug && notificationSlug && verifiedSlug !== notificationSlug) throw new StoreError("Product identity mismatch.", "PRODUCT_MISMATCH", 409);

  const foundStore = firstText([verified, verifiedMeta, data, notificationMeta], ["store_slug", "app_slug", "shop_slug"], 100).toLowerCase();
  if (foundStore && foundStore !== storeSlug) throw new StoreError("Payment belongs to a different store.", "STORE_MISMATCH", 409);

  const verifiedCustomer = isObject(verified.customer) ? verified.customer : {};
  const notificationCustomer = isObject(data.customer) ? data.customer : {};
  const customer = { ...notificationCustomer, ...verifiedCustomer };
  const buyerSources = [verified, verifiedMeta, customer, data, notificationMeta];
  const name = firstText(buyerSources, ["customer_name", "name", "full_name"], 80);
  const email = firstText(buyerSources, ["customer_email", "email"], 120).toLowerCase();
  const phone = firstText(buyerSources, ["customer_phone", "phone_number", "phone"], 30).replace(/[\s().-]/g, "");
  const quantity = verifiedItems?.quantity ?? notificationItems?.quantity ?? Number(firstText([verified, verifiedMeta, data, notificationMeta], ["quantity", "qty"], 3) || 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    throw new StoreError("Invalid ticket quantity.", "INVALID_QUANTITY", 400);
  }
  const status = text(verified.status, 20).toLowerCase();
  if (status !== "pending" && status !== "completed" && status !== "failed") {
    throw new StoreError("Invalid verified payment status.", "INVALID_RESPONSE", 502);
  }
  return {
    reference,
    store_slug: storeSlug,
    product_id: verifiedId || notificationId,
    product_slug: (verifiedSlug || notificationSlug).toLowerCase(),
    status,
    amount: Number(verified.amount),
    currency: text(verified.currency, 3).toUpperCase(),
    quantity,
    name,
    email,
    phone,
    provider: firstText([verified, data], ["provider", "provider_slug"], 100),
    provider_ref: firstText([verified, data], ["provider_ref", "provider_reference"], 200),
    failure_reason: firstText([verified, data], ["failure_reason"], 500),
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function storeErrorResponse(err: unknown): Response {
  if (err instanceof StoreError) return jsonResponse({ ok: false, error: err.message, code: err.code }, err.status);
  return jsonResponse({ ok: false, error: "Could not process this webhook. Please retry.", code: "STORE_ERROR" }, 503);
}

export async function handleStoreWebhook(
  req: Request,
  env: StoreEnv,
  apply: (payment: StorePaymentInput) => Promise<StoreApplyResult>,
): Promise<Response> {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  try {
    const config = storeConfig(env);
    const raw = await req.text();
    if (raw.length > 65_536) throw new StoreError("Payload too large.", "PAYLOAD_TOO_LARGE", 413);
    const signature = req.headers.get("x-dgateway-signature");
    if (!(await verifyStoreSignature(raw, signature, config.webhookSecret))) {
      throw new StoreError("Invalid webhook signature.", "INVALID_SIGNATURE", 401);
    }
    const { event, data } = parseStoreNotification(raw);
    if (event && !event.startsWith("transaction.")) return jsonResponse({ received: true, ignored: true });
    const reference = notificationReference(data);
    const verified = await fetchVerifiedStoreTransaction(env, reference);
    if (verified.is_test === true && !config.allowTest) {
      throw new StoreError("Test payments cannot issue live tickets.", "TEST_PAYMENT", 409);
    }
    const detail = await fetchStoreTransactionDetail(env, reference).catch((err) => {
      if (err instanceof StoreError && err.status === 400) return null;
      throw err;
    });
    if (detail && Number(detail.amount) !== Number(verified.amount)) {
      throw new StoreError("Transaction detail amount does not match verification.", "AMOUNT_MISMATCH", 409);
    }
    if (detail && text(detail.currency, 3).toUpperCase() !== text(verified.currency, 3).toUpperCase()) {
      throw new StoreError("Transaction detail currency does not match verification.", "CURRENCY_MISMATCH", 409);
    }
    const merged = detail ? {
      ...detail,
      ...verified,
      metadata: { ...metadata(detail.metadata), ...metadata(verified.metadata) },
    } : verified;
    if (detail) {
      const fromStatus = buildStorePayment({}, verified, config.storeSlug);
      const fromDetail = buildStorePayment({}, { ...detail, status: verified.status, amount: verified.amount, currency: verified.currency }, config.storeSlug);
      if (fromStatus.product_id && fromDetail.product_id && fromStatus.product_id !== fromDetail.product_id) {
        throw new StoreError("Product identity mismatch.", "PRODUCT_MISMATCH", 409);
      }
      if (fromStatus.product_slug && fromDetail.product_slug && fromStatus.product_slug !== fromDetail.product_slug) {
        throw new StoreError("Product identity mismatch.", "PRODUCT_MISMATCH", 409);
      }
    }
    const payment = buildStorePayment(data, merged, config.storeSlug);
    const result = await apply(payment);
    if (result.fulfilment === "blocked") {
      return jsonResponse({ ok: false, received: true, ...result, error: "Payment verified but ticket fulfilment is blocked." }, 409);
    }
    return jsonResponse({ ok: true, ...result });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
