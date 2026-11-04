import { cloud } from "./api";
import { API_BASE_URL } from "./config";
import { cleanPhone } from "./phone";
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

async function authHeaders(): Promise<Record<string, string>> {
  if (!cloud) return {};
  const { data } = await cloud.auth.getSession();
  return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

async function request(path: string, init?: { method?: string; body?: unknown }) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: init?.method || "GET",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new PaymentError("We couldn't reach the payment service. Check My tickets before trying again.", "PAYMENT_UNAVAILABLE");
  }
  const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; code?: string } | null;
  if (response.status === 404 && !data?.code) {
    throw new PaymentError("Mobile Money checkout is not available yet. Please contact TANK support. No payment has been requested.", "PAYMENT_NOT_CONFIGURED");
  }
  if (!response.ok || !data?.ok) {
    throw new PaymentError(data?.error || "The payment service did not confirm this request.", data?.code || "PAYMENT_UNAVAILABLE");
  }
  return data as Record<string, unknown>;
}

/** Paid checkout has no local, SMS, or manual-payment fallback. */
export async function initiatePayment(params: InitiatePaymentParams): Promise<PaymentInitiationResult> {
  const data = await request("/api/payments/collect", {
    method: "POST",
    body: {
      event_id: params.eventId,
      code: params.orderCode,
      external_ref: params.externalRef,
      name: params.name.trim(),
      phone: cleanPhone(params.phone),
      email: params.email.trim(),
      qty: params.qty,
    },
  });
  if (!data.order || typeof data.reference !== "string") {
    throw new PaymentError("The payment service returned an incomplete response. Check My tickets before retrying.", "INVALID_RESPONSE");
  }
  return { reference: data.reference, status: (data.status as PaymentStatus) || "pending", order: data.order as Order };
}

/** Only the server can verify a collection and issue a paid ticket. */
export async function pollPaymentStatus(reference: string, orderCode: string): Promise<{ status: PaymentStatus; order?: Order }> {
  const data = await request(`/api/payments/${encodeURIComponent(reference)}/status?code=${encodeURIComponent(orderCode)}`);
  if (!["pending", "completed", "failed"].includes(String(data.status))) {
    throw new PaymentError("Payment confirmation is not available yet.", "INVALID_STATUS");
  }
  return { status: data.status as PaymentStatus, order: data.order as Order | undefined };
}

/** Admin-only server payout to any supplied MTN/Airtel number. */
export async function requestDisburse(params: DisburseParams) {
  const data = await request("/api/payments/disburse", {
    method: "POST",
    body: {
      external_ref: params.externalRef,
      amount: params.amount,
      currency: params.currency,
      phone_number: cleanPhone(params.phoneNumber),
      description: params.description,
    },
  });
  return data;
}
