import { cloud } from "./api";
import { toMsisdn } from "./phone";
import type { Order } from "./types";

export const DGATEWAY_TEST_SUCCESS_PHONE = "256111777771";
export const DGATEWAY_TEST_FAIL_PHONE = "256111777991";
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

export class PaymentError extends Error {
  constructor(message: string, public readonly code = "PAYMENT_FAILED") {
    super(message);
    this.name = "PaymentError";
  }
}

async function invoke(name: "dgateway-collect" | "dgateway-status", body: Record<string, unknown>) {
  if (!cloud) {
    throw new PaymentError("Online payments are not connected. No payment has been requested.", "PAYMENT_NOT_CONFIGURED");
  }
  const { data, error } = await cloud.functions.invoke(name, { body });
  if (error) {
    // FunctionsHttpError carries the server's safe, actionable error message.
    const response = (error as { context?: Response }).context;
    const detail = response && typeof response.json === "function"
      ? await response.json().catch(() => null) as { error?: string; code?: string } | null
      : null;
    if (response?.status === 404) {
      throw new PaymentError("Mobile Money checkout is not available yet. Please contact TANK support. No payment has been requested.", "PAYMENT_NOT_CONFIGURED");
    }
    throw new PaymentError(detail?.error || "We couldn't reach the payment service. Check My tickets before trying again.", detail?.code || "PAYMENT_UNAVAILABLE");
  }
  if (!data?.ok) throw new PaymentError(data?.error || "The payment service did not confirm this request.", data?.code);
  return data;
}

/** Paid checkout has no local, SMS, or manual-payment fallback. */
export async function initiatePayment(params: InitiatePaymentParams): Promise<PaymentInitiationResult> {
  const data = await invoke("dgateway-collect", {
    event_id: params.eventId,
    code: params.orderCode,
    external_ref: params.externalRef,
    name: params.name.trim(),
    phone: toMsisdn(params.phone),
    email: params.email.trim(),
    qty: params.qty,
  });
  if (!data.order || typeof data.reference !== "string") {
    throw new PaymentError("The payment service returned an incomplete response. Check My tickets before retrying.", "INVALID_RESPONSE");
  }
  return { reference: data.reference, status: data.status || "pending", order: data.order };
}

/** Only the server can verify a collection and issue a paid ticket. */
export async function pollPaymentStatus(reference: string, orderCode: string): Promise<{ status: PaymentStatus; order?: Order }> {
  const data = await invoke("dgateway-status", { reference, code: orderCode });
  if (!["pending", "completed", "failed"].includes(data.status)) {
    throw new PaymentError("Payment confirmation is not available yet.", "INVALID_STATUS");
  }
  return { status: data.status, order: data.order };
}
