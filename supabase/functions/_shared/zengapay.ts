// Server-only ZengaPay helpers for Supabase Edge Functions.
declare const Deno: { env: { get(key: string): string | undefined } };

import {
  GatewayError,
  baseUrl,
  cleanPhone,
  collectPayment,
  disbursePayment,
  extractWebhookFields,
  fetchCollectionStatus,
  fetchTransferStatus,
  isValidZengaPhone,
  isWholeUnitUgx,
  normalizeStatus,
  requireApiKey,
  toZengaMsisdn,
  transactionMatches,
  verifyWebhookSignature,
  type PaymentStatus,
  type ServerEnv,
  type ZengaInitiation,
  type ZengaTransaction,
} from "../../../server/zengapay.ts";

export {
  GatewayError,
  baseUrl,
  cleanPhone,
  collectPayment,
  disbursePayment,
  extractWebhookFields,
  fetchCollectionStatus,
  fetchTransferStatus,
  isValidZengaPhone,
  isWholeUnitUgx,
  normalizeStatus,
  requireApiKey,
  toZengaMsisdn,
  transactionMatches,
  verifyWebhookSignature,
  type PaymentStatus,
  type ServerEnv,
  type ZengaInitiation,
  type ZengaTransaction,
};

export type OrderRow = {
  id: string;
  code: string;
  event_id: string;
  event_title: string;
  user_id: string | null;
  name: string;
  phone: string;
  email: string;
  qty: number;
  amount: number;
  currency?: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "CHECKED_IN";
  zenga_ref?: string;
  payment_ref?: string;
  dgateway_ref?: string;
  collection_started_at?: string | null;
  last_status_check_at?: string | null;
  provider: string;
  provider_ref: string;
  external_ref: string;
  created_at: string;
};

export type PayoutRow = {
  id: string;
  external_ref: string;
  zenga_ref?: string;
  dgateway_ref?: string;
  amount: number;
  currency: string;
  phone_number: string;
  description: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  provider: string;
  provider_ref: string;
  created_by: string | null;
  last_status_check_at?: string | null;
  created_at: string;
};

export function denoEnv(): ServerEnv {
  return {
    ZENGAPAY_API_KEY: Deno.env.get("ZENGAPAY_API_KEY"),
    ZENGAPAY_USER_API_TOKEN: Deno.env.get("ZENGAPAY_USER_API_TOKEN"),
    ZENGAPAY_BASE_URL: Deno.env.get("ZENGAPAY_BASE_URL"),
    ZENGAPAY_API_URL: Deno.env.get("ZENGAPAY_API_URL"),
    ZENGAPAY_ENVIRONMENT: Deno.env.get("ZENGAPAY_ENVIRONMENT"),
    ZENGAPAY_WEBHOOK_SECRET: Deno.env.get("ZENGAPAY_WEBHOOK_SECRET"),
    ZENGAPAY_CHARGE_CUSTOMER: Deno.env.get("ZENGAPAY_CHARGE_CUSTOMER"),
    SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    ADMIN_EMAIL: Deno.env.get("ADMIN_EMAIL"),
  };
}

export function orderReference(row: OrderRow): string {
  return row.zenga_ref || row.payment_ref || "";
}

export function payoutReference(row: PayoutRow): string {
  return row.zenga_ref || row.dgateway_ref || "";
}

export function publicOrder(row: OrderRow) {
  const ref = orderReference(row);
  return {
    id: row.id,
    code: row.code,
    eventId: row.event_id,
    eventTitle: row.event_title,
    userId: row.user_id,
    name: row.name,
    phone: row.phone,
    email: row.email || "",
    qty: row.qty,
    amount: row.amount,
    status: row.status,
    paymentRef: ref,
    zengaRef: ref,
    provider: row.provider || "zengapay",
    providerRef: row.provider_ref || "",
    externalRef: row.external_ref,
    createdAt: row.created_at,
  };
}

export function publicPayout(row: PayoutRow) {
  return {
    id: row.id,
    externalRef: row.external_ref,
    reference: payoutReference(row),
    amount: row.amount,
    currency: row.currency || "UGX",
    phoneNumber: row.phone_number,
    description: row.description,
    status: row.status,
    provider: row.provider || "zengapay",
    providerRef: row.provider_ref || "",
    createdAt: row.created_at,
  };
}
