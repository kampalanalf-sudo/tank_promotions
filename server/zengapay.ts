// Server-only ZengaPay REST API v1 client. Never import this module into the browser bundle.

export type PaymentStatus = "pending" | "completed" | "failed";

export type ServerEnv = {
  ZENGAPAY_API_KEY?: string;
  ZENGAPAY_USER_API_TOKEN?: string;
  ZENGAPAY_BASE_URL?: string;
  ZENGAPAY_API_URL?: string;
  ZENGAPAY_ENVIRONMENT?: string;
  ZENGAPAY_WEBHOOK_SECRET?: string;
  ZENGAPAY_CHARGE_CUSTOMER?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  APP_URL?: string;
  API_PUBLIC_URL?: string;
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  ADMIN_EMAIL?: string;
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

export type CollectPayload = {
  msisdn: string;
  amount: number;
  external_reference: string;
  narration: string;
  charge_customer?: boolean;
};

export type TransferPayload = {
  msisdn: string;
  amount: number;
  external_reference: string;
  narration: string;
};

export type ZengaInitiation = {
  reference: string;
  status: PaymentStatus;
  message: string;
};

export type ZengaTransaction = {
  reference: string;
  status: string;
  amount: number;
  msisdn: string;
  provider: string;
  providerRef: string;
  externalReference: string;
  currencyCode: string;
  entryType: string;
};

export class GatewayError extends Error {
  constructor(message: string, public code = "PROVIDER_ERROR", public status = 502) {
    super(message);
    this.name = "GatewayError";
  }
}

function asString(value: unknown, max = 300): string {
  if (typeof value === "string") return value.trim().slice(0, max);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function baseUrl(env: ServerEnv): string {
  const configured = (env.ZENGAPAY_BASE_URL || env.ZENGAPAY_API_URL || "").trim();
  const raw = configured || (
    env.ZENGAPAY_ENVIRONMENT?.trim().toLowerCase() === "sandbox"
      ? "https://api.sandbox.zengapay.com/v1"
      : "https://api.zengapay.com/v1"
  );
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export function requireApiKey(env: ServerEnv): string {
  const key = (env.ZENGAPAY_API_KEY || env.ZENGAPAY_USER_API_TOKEN || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!key) {
    throw new GatewayError(
      "Mobile Money checkout is not configured yet. Please contact TANK support. No payment has been requested.",
      "PAYMENT_NOT_CONFIGURED",
      503,
    );
  }
  return key;
}

export function cleanPhone(input: string): string {
  return input.trim().replace(/[\s().-]/g, "");
}

/** ZengaPay requires Ugandan MSISDN digits without a leading +, e.g. 256775203801. */
export function toZengaMsisdn(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("256") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `256${digits.slice(1)}`;
  if (digits.length === 9 && /^[732]/.test(digits)) return `256${digits}`;
  return digits;
}

export function isValidZengaPhone(input: string): boolean {
  return /^256(?:7\d{8}|39\d{7}|20\d{7})$/.test(toZengaMsisdn(input));
}

export function isWholeUnitUgx(amount: unknown): amount is number {
  return typeof amount === "number" && Number.isInteger(amount) && amount > 0;
}

/**
 * ZengaPay transaction statuses: PENDING, SUCCEEDED, FAILED, INDETERMINATE.
 * Only SUCCEEDED issues a ticket and only FAILED is terminal failure;
 * INDETERMINATE remains pending until ZengaPay resolves it with the MNO.
 */
export function normalizeStatus(value: unknown): PaymentStatus {
  const status = String(value || "").trim().toUpperCase();
  if (status === "SUCCEEDED") return "completed";
  if (status === "FAILED") return "failed";
  return "pending";
}

async function zengaRequest(env: ServerEnv, path: string, init?: { method?: string; body?: unknown }): Promise<Record<string, unknown>> {
  const key = requireApiKey(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${baseUrl(env)}${path}`, {
      method: init?.method || "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = asString(json?.message) || asString(json?.error) || `ZengaPay returned HTTP ${response.status}`;
      const zengaData = json?.data && typeof json.data === "object" ? json.data as Record<string, unknown> : null;
      const zengaEnv = asString(zengaData?.env, 40);
      if (response.status === 401) {
        throw new GatewayError(
          `ZengaPay authentication failed${zengaEnv ? ` (${zengaEnv})` : ""}: ${message}`,
          "PAYMENT_NOT_CONFIGURED",
          503,
        );
      }
      if (response.status === 403) {
        throw new GatewayError(message, "IP_NOT_WHITELISTED", 503);
      }
      if (response.status === 429) {
        throw new GatewayError("Too many payment requests right now. Please wait a moment and try again.", "RATE_LIMITED", 429);
      }
      if ([400, 404, 409, 422].includes(response.status)) {
        throw new GatewayError(message, "PROVIDER_REJECTED", 400);
      }
      throw new GatewayError(message, "PROVIDER_ERROR", 502);
    }
    if (!json || typeof json !== "object") {
      throw new GatewayError("ZengaPay returned an unreadable response.", "INVALID_RESPONSE", 502);
    }
    return json;
  } catch (err) {
    if (err instanceof GatewayError) throw err;
    if (controller.signal.aborted) {
      throw new GatewayError(
        "ZengaPay did not respond in time. Check your phone and My tickets before trying again.",
        "PROVIDER_TIMEOUT",
        504,
      );
    }
    throw new GatewayError(
      "We couldn't reach ZengaPay right now. Check My tickets before trying again.",
      "PROVIDER_UNAVAILABLE",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function parseChargeCustomer(env: ServerEnv, explicit?: boolean): boolean | undefined {
  if (typeof explicit === "boolean") return explicit;
  const raw = env.ZENGAPAY_CHARGE_CUSTOMER?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

export async function collectPayment(env: ServerEnv, payload: CollectPayload): Promise<ZengaInitiation> {
  const msisdn = toZengaMsisdn(payload.msisdn);
  if (!isValidZengaPhone(msisdn)) {
    throw new GatewayError("Enter a valid Ugandan MTN or Airtel Mobile Money number.", "INVALID_PHONE", 400);
  }
  if (!isWholeUnitUgx(payload.amount)) {
    throw new GatewayError("Collection amount must be a positive whole-shilling UGX integer.", "INVALID_AMOUNT", 400);
  }
  const body: Record<string, unknown> = {
    msisdn,
    amount: payload.amount,
    external_reference: payload.external_reference,
    narration: payload.narration,
  };
  const chargeCustomer = parseChargeCustomer(env, payload.charge_customer);
  if (chargeCustomer !== undefined) body.charge_customer = chargeCustomer;

  const json = await zengaRequest(env, "/collections", { method: "POST", body });
  const data = json.data && typeof json.data === "object" ? json.data as Record<string, unknown> : null;
  const reference = asString(json.transactionReference) || asString(data?.transactionReference);
  if (!reference) {
    throw new GatewayError("ZengaPay did not return a transaction reference.", "INVALID_RESPONSE", 502);
  }
  return {
    reference,
    status: normalizeStatus(data?.transactionStatus || json.transactionStatus || "PENDING"),
    message: asString(json.message) || "Transaction Initiated",
  };
}

export async function disbursePayment(env: ServerEnv, payload: TransferPayload): Promise<ZengaInitiation> {
  const msisdn = toZengaMsisdn(payload.msisdn);
  if (!isValidZengaPhone(msisdn)) {
    throw new GatewayError("Enter a valid Ugandan MTN or Airtel Mobile Money number.", "INVALID_PHONE", 400);
  }
  if (!isWholeUnitUgx(payload.amount)) {
    throw new GatewayError("Transfer amount must be a positive whole-shilling UGX integer.", "INVALID_AMOUNT", 400);
  }
  const json = await zengaRequest(env, "/transfers", {
    method: "POST",
    body: {
      msisdn,
      amount: payload.amount,
      external_reference: payload.external_reference,
      narration: payload.narration,
      use_contact: false,
    },
  });
  const data = json.data && typeof json.data === "object" ? json.data as Record<string, unknown> : null;
  const reference = asString(json.transactionReference) || asString(data?.transactionReference);
  if (!reference) {
    throw new GatewayError("ZengaPay did not return a transfer reference.", "INVALID_RESPONSE", 502);
  }
  return {
    reference,
    status: normalizeStatus(data?.transactionStatus || json.transactionStatus || "PENDING"),
    message: asString(json.message) || "Transaction Initiated",
  };
}

function parseTransactionRecord(json: Record<string, unknown>, expectedReference: string): ZengaTransaction {
  const data = json.data && typeof json.data === "object" ? json.data as Record<string, unknown> : json;
  const reference = asString(data.transactionReference);
  const amount = Number(data.amount);
  if (!reference || reference !== expectedReference || !Number.isFinite(amount)) {
    throw new GatewayError("ZengaPay verification did not match the requested reference.", "INVALID_RESPONSE", 502);
  }
  return {
    reference,
    status: asString(data.transactionStatus) || "PENDING",
    amount,
    msisdn: asString(data.msisdn),
    provider: asString(data.paymentProvider) || asString(data.currencyCode) || "zengapay",
    providerRef: asString(data.MNOTransactionReferenceId),
    externalReference: asString(data.transactionExternalReference),
    currencyCode: asString(data.currencyCode),
    entryType: asString(data.transactionEntryGeneralType),
  };
}

export async function fetchCollectionStatus(env: ServerEnv, reference: string): Promise<ZengaTransaction> {
  const json = await zengaRequest(env, `/collections/${encodeURIComponent(reference)}`);
  return parseTransactionRecord(json, reference);
}

export async function fetchTransferStatus(env: ServerEnv, reference: string): Promise<ZengaTransaction> {
  const json = await zengaRequest(env, `/transfers/${encodeURIComponent(reference)}`);
  return parseTransactionRecord(json, reference);
}

export function transactionMatches(
  tx: ZengaTransaction,
  expected: {
    reference: string;
    amount: number;
    externalRef?: string;
    direction?: "collect" | "transfer";
  },
): boolean {
  if (tx.reference !== expected.reference) return false;
  if (!Number.isFinite(tx.amount) || Math.round(tx.amount) !== expected.amount) return false;
  if (tx.currencyCode && !tx.currencyCode.toUpperCase().startsWith("UGX")) return false;
  if (expected.externalRef && tx.externalReference && tx.externalReference !== expected.externalRef) return false;
  if (expected.direction === "collect" && tx.entryType && tx.entryType.toUpperCase() !== "CREDIT") return false;
  if (expected.direction === "transfer" && tx.entryType && tx.entryType.toUpperCase() !== "DEBIT") return false;
  return true;
}

export function extractWebhookFields(payload: Record<string, unknown>) {
  const event = asString(payload.event, 80).toLowerCase();
  const data = payload.data && typeof payload.data === "object"
    ? payload.data as Record<string, unknown>
    : payload;
  const reference = asString(data.transactionReference, 200);
  const externalReference = asString(data.transactionExternalReference, 200);
  const msisdn = asString(data.msisdn, 40);
  const rawAmount = data.amount;
  const status = asString(data.transactionStatus, 40);
  const entryType = asString(data.transactionEntryGeneralType, 40).toUpperCase();
  const isTransfer = event.startsWith("transfer.") || entryType === "DEBIT";
  return { event, data, reference, externalReference, msisdn, rawAmount, status, entryType, isTransfer };
}

function constantTimeHexEquals(expectedBytes: Uint8Array, receivedHex: string): boolean {
  if (receivedHex.length !== expectedBytes.length * 2) return false;
  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    diff |= expectedBytes[i] ^ parseInt(receivedHex.slice(i * 2, i * 2 + 2), 16);
  }
  return diff === 0;
}

/**
 * Verifies ZengaPay's X-ZENGAPAY-SIGNATURE HMAC-SHA256 header using ZENGAPAY_WEBHOOK_SECRET.
 * Fails closed when ZENGAPAY_WEBHOOK_SECRET is unset or when the signature is missing/invalid.
 * Supports ZengaPay's documented concatenation (transactionReference + msisdn + amount),
 * the official WooCommerce plugin's two-decimal form (sprintf('%.2f', amount)), and raw-body HMAC.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret?: string,
  parsedPayload?: Record<string, unknown> | null,
): Promise<boolean> {
  const trimmedSecret = secret?.trim();
  if (!trimmedSecret) {
    throw new GatewayError("ZengaPay webhook secret is not configured.", "WEBHOOK_NOT_CONFIGURED", 503);
  }
  if (!signatureHeader) return false;
  const received = signatureHeader.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(received)) return false;

  let payload = parsedPayload;
  if (payload === undefined) {
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }

  const candidates = new Set<string>([rawBody]);
  if (payload && typeof payload === "object") {
    const { reference, msisdn, rawAmount } = extractWebhookFields(payload);
    if (reference && msisdn && rawAmount !== undefined && rawAmount !== null && String(rawAmount) !== "") {
      const amountStr = String(rawAmount).trim();
      candidates.add(`${reference}${msisdn}${amountStr}`);
      const numericAmount = Number(amountStr);
      if (Number.isFinite(numericAmount)) {
        candidates.add(`${reference}${msisdn}${numericAmount.toFixed(2)}`);
        candidates.add(`${reference}${msisdn}${Math.round(numericAmount)}`);
      }
    }
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(trimmedSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  let matched = false;
  for (const message of candidates) {
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
    if (constantTimeHexEquals(digest, received)) {
      matched = true;
    }
  }
  return matched;
}
