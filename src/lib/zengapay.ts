import { cloud } from "./api";
import { API_BASE_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { toMsisdn } from "./phone";
import type { Order } from "./types";

export type PaymentStatus = "pending" | "completed" | "failed";

export interface InitiatePaymentParams {
  eventId: string;
  orderCode: string;
  externalRef: string;
  name: string;
  phone: string;
  email: string;
  qty: number;
}

export interface PaymentInitiationResult {
  reference: string;
  status: PaymentStatus;
  order: Order;
}

export interface DisburseParams {
  externalRef: string;
  amount: number;
  currency: string;
  phoneNumber: string;
  description: string;
}

export class PaymentError extends Error {
  constructor(message: string, public readonly code = "PAYMENT_FAILED") {
    super(message);
    this.name = "PaymentError";
  }
}

function useEdgeFunctions(): boolean {
  if (typeof window !== "undefined" && /(^|\.)tanktickets\.site$/i.test(window.location.hostname)) {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  }
  return !API_BASE_URL && Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function zengaWebhookUrl(supabaseUrl = SUPABASE_URL, apiBaseUrl = API_BASE_URL): string {
  if (supabaseUrl && !apiBaseUrl) return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/zengapay-webhook`;
  if (apiBaseUrl) return `${apiBaseUrl.replace(/\/$/, "")}/api/webhooks/zengapay`;
  if (supabaseUrl) return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/zengapay-webhook`;
  return "";
}

async function sessionToken(): Promise<string> {
  if (!cloud) return "";
  try {
    const { data } = await cloud.auth.getSession();
    return data.session?.access_token || "";
  } catch {
    return "";
  }
}

async function callPaymentEndpoint(
  edgeSlug: "zengapay-collect" | "zengapay-status" | "zengapay-transfer",
  apiPath: string,
  init: { method?: string; body?: unknown },
): Promise<Record<string, unknown>> {
  const token = await sessionToken();
  const edge = useEdgeFunctions();
  const url = edge
    ? `${SUPABASE_URL}/functions/v1/${edgeSlug}`
    : `${API_BASE_URL}${apiPath}`;
  const method = edge ? "POST" : (init.method || "GET");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (edge) {
    headers.apikey = SUPABASE_ANON_KEY;
    headers.Authorization = `Bearer ${token || SUPABASE_ANON_KEY}`;
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method === "GET" || init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new PaymentError("We couldn't reach the payment service. Check My tickets before trying again.", "PAYMENT_UNAVAILABLE");
  }

  const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; message?: string; code?: string } | null;
  if (response.status === 404 && !data?.code) {
    throw new PaymentError(
      "Mobile Money checkout is not available yet. Please contact TANK support. No payment has been requested.",
      "PAYMENT_NOT_CONFIGURED",
    );
  }
  if (!response.ok || !data?.ok) {
    throw new PaymentError(
      data?.error || data?.message || `Payment request failed (HTTP ${response.status}).`,
      data?.code || "PAYMENT_UNAVAILABLE",
    );
  }
  return data as Record<string, unknown>;
}

/** Paid checkout is verified server-side via ZengaPay; there is no manual or simulated fallback. */
export async function initiatePayment(params: InitiatePaymentParams): Promise<PaymentInitiationResult> {
  const data = await callPaymentEndpoint("zengapay-collect", "/api/payments/collect", {
    method: "POST",
    body: {
      event_id: params.eventId,
      code: params.orderCode,
      external_ref: params.externalRef,
      name: params.name.trim(),
      phone: toMsisdn(params.phone),
      email: params.email.trim().toLowerCase(),
      qty: params.qty,
    },
  });
  if (!data.order || typeof data.reference !== "string") {
    throw new PaymentError("The payment service returned an incomplete response. Check My tickets before retrying.", "INVALID_RESPONSE");
  }
  return { reference: data.reference, status: (data.status as PaymentStatus) || "pending", order: data.order as Order };
}

/** Only the server can verify a ZengaPay collection and issue a paid ticket. */
export async function pollPaymentStatus(reference: string, orderCode: string): Promise<{ status: PaymentStatus; order?: Order }> {
  const apiPath = `/api/payments/${encodeURIComponent(reference)}/status?code=${encodeURIComponent(orderCode)}`;
  const data = await callPaymentEndpoint("zengapay-status", apiPath, {
    method: "GET",
    body: { code: orderCode, reference },
  });
  if (!["pending", "completed", "failed"].includes(String(data.status))) {
    throw new PaymentError("Payment confirmation is not available yet.", "INVALID_STATUS");
  }
  return { status: data.status as PaymentStatus, order: data.order as Order | undefined };
}

/** Admin-only ZengaPay transfer to any Ugandan MTN or Airtel Mobile Money number. */
export async function requestDisburse(params: DisburseParams) {
  return callPaymentEndpoint("zengapay-transfer", "/api/payments/disburse", {
    method: "POST",
    body: {
      external_ref: params.externalRef,
      amount: params.amount,
      currency: params.currency,
      phone_number: toMsisdn(params.phoneNumber),
      description: params.description,
    },
  });
}
