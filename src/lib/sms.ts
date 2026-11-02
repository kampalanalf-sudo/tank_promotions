import { detectNetwork, toMsisdn } from "./phone";

export type ParsedSms = {
  code: string | null;
  amount: number | null;
  phone: string | null;
  transactionId: string | null;
  providerReference: string | null;
  paymentRef: string | null;
  network: "MTN" | "Airtel" | "Other" | null;
};

export type MatchableOrder = {
  code: string;
  externalRef: string;
  amount: number;
  phone: string;
  status: string;
  createdAt: string;
  paymentRef: string;
};

/**
 * Reads MTN/Airtel merchant confirmations, including:
 * RECEIVED. TID160268943390 UGX 500 from 758443666 referenceAPCUG220794100006272. BalUGX 500.
 */
export function parsePaymentSms(text: string): ParsedSms {
  const compact = text.replace(/\s+/g, " ").trim();
  const upper = compact.toUpperCase();

  const tagged = upper.match(/\bTNK-?([A-Z0-9]{6,12})\b/);
  const code = tagged ? `TNK-${tagged[1]}` : null;

  // Word boundary keeps "BalUGX 500" from being mistaken for the paid amount.
  const amountMatch = compact.replace(/,/g, "").match(/\bUGX\s*([0-9]{1,9})\b/i);
  const amount = amountMatch ? Number(amountMatch[1]) : null;

  const fromMatch = compact.replace(/[\s-]/g, "").match(/from:?(?:\+?256|0)?(7\d{8})/i);
  const anyPhone = compact.replace(/[\s-]/g, "").match(/(?:\+?256|0)(7\d{8})\b/);
  const rawPhone = fromMatch?.[1] || anyPhone?.[1] || null;
  const phone = rawPhone ? toMsisdn(rawPhone) : null;

  const transactionId = upper.match(/\bTID[:#-]?\s*([A-Z0-9]{6,})\b/)?.[1] || null;
  const providerReference = upper.match(/\bREFERENCE[:#-]?\s*([A-Z0-9]{6,})\b/)?.[1] || null;
  const paymentRef = transactionId ? `TID:${transactionId}` : providerReference ? `REF:${providerReference}` : null;

  return {
    code,
    amount,
    phone,
    transactionId,
    providerReference,
    paymentRef,
    network: phone ? detectNetwork(phone) : null,
  };
}

/** Only one unpaid order, same exact amount, within 30 minutes, may match. */
export function smsMatchesOrder(sms: ParsedSms, order: MatchableOrder, now = Date.now()) {
  if (order.status !== "PENDING") return false;
  if (sms.amount == null || sms.amount !== order.amount) return false;

  const age = now - new Date(order.createdAt).getTime();
  if (!Number.isFinite(age) || age < -5 * 60e3 || age > 30 * 60e3) return false;

  if (sms.code) {
    const ref = sms.code.replace(/-/g, "");
    return ref === order.code.replace(/-/g, "") || ref === order.externalRef.replace(/-/g, "").toUpperCase();
  }

  return Boolean(sms.phone && sms.phone === toMsisdn(order.phone));
}

export function smsAlreadyApplied(sms: ParsedSms, orders: { paymentRef: string; code: string }[]) {
  if (!sms.paymentRef) return null;
  return orders.find((o) => o.paymentRef === sms.paymentRef) || null;
}
