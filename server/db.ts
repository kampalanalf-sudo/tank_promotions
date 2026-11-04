import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GatewayError, type ServerEnv } from "./dgateway";

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
  currency: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "CHECKED_IN";
  dgateway_ref: string;
  payment_ref?: string;
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
  dgateway_ref: string;
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

export function requireSupabase(env: ServerEnv) {
  const url = env.SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!url || !serviceKey || !anonKey) {
    throw new GatewayError("The payment database is not configured.", "PAYMENT_NOT_CONFIGURED", 503);
  }
  return { url, serviceKey, anonKey };
}

export function adminClient(env: ServerEnv): SupabaseClient {
  const { url, serviceKey } = requireSupabase(env);
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function buyerClient(env: ServerEnv, req: Request): SupabaseClient {
  const { url, anonKey } = requireSupabase(env);
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.get("Authorization") || `Bearer ${anonKey}` } },
  });
}

export async function requireAdmin(env: ServerEnv, req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new GatewayError("Sign in as an administrator to request a payout.", "UNAUTHORIZED", 401);
  const admin = adminClient(env);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new GatewayError("Sign in as an administrator to request a payout.", "UNAUTHORIZED", 401);
  const adminEmail = (env.ADMIN_EMAIL || "admin@tanktickets.site").trim().toLowerCase();
  if (!data.user.email_confirmed_at || (data.user.email || "").toLowerCase() !== adminEmail) {
    throw new GatewayError("Only TANK administrators can request payouts.", "FORBIDDEN", 403);
  }
  return data.user;
}

export function publicOrder(row: OrderRow) {
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
    paymentRef: row.dgateway_ref || row.payment_ref || "",
    dgatewayRef: row.dgateway_ref || "",
    provider: row.provider || "",
    providerRef: row.provider_ref || "",
    externalRef: row.external_ref,
    createdAt: row.created_at,
  };
}

export function publicPayout(row: PayoutRow) {
  return {
    id: row.id,
    externalRef: row.external_ref,
    reference: row.dgateway_ref,
    amount: row.amount,
    currency: row.currency,
    phoneNumber: row.phone_number,
    description: row.description,
    status: row.status,
    provider: row.provider || "",
    providerRef: row.provider_ref || "",
    createdAt: row.created_at,
  };
}

export function orderPaymentStatus(row: OrderRow): "pending" | "completed" | "failed" {
  if (row.status === "SUCCEEDED" || row.status === "CHECKED_IN") return "completed";
  if (row.status === "FAILED") return "failed";
  return "pending";
}

export function payoutPaymentStatus(row: PayoutRow): "pending" | "completed" | "failed" {
  if (row.status === "COMPLETED") return "completed";
  if (row.status === "FAILED") return "failed";
  return "pending";
}
