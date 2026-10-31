import type { Settings } from "./types";

export type CollectInput = {
  msisdn: string;
  amount: number;
  external_reference: string;
  narration: string;
};

export type CollectResult = {
  ok: boolean;
  simulated: boolean;
  transactionReference: string;
  message: string;
};

export type PayStatus = "PENDING" | "SUCCEEDED" | "FAILED";

const sims = new Map<string, PayStatus>();

export function toMsisdn(input: string) {
  const d = input.replace(/\D/g, "");
  if (d.startsWith("256") && d.length >= 12) return d.slice(0, 12);
  if (d.startsWith("0") && d.length === 10) return `256${d.slice(1)}`;
  if (d.length === 9) return `256${d}`;
  return d;
}

export function isValidUgPhone(input: string) {
  return /^2567\d{8}$/.test(toMsisdn(input));
}

export function detectNetwork(msisdn: string): "MTN" | "Airtel" | "Other" {
  const n = toMsisdn(msisdn).slice(3, 5);
  if (["77", "78", "76", "79"].includes(n)) return "MTN";
  if (["70", "75", "74"].includes(n)) return "Airtel";
  return "Other";
}

function baseUrl(s: Settings) {
  return s.zengaEnv === "production" ? "https://api.zengapay.com/v1" : "https://api.sandbox.zengapay.com/v1";
}

async function call<T>(s: Settings, path: string, init?: RequestInit): Promise<T> {
  const token = s.zengaToken.trim();
  if (!token) throw new Error("ZengaPay is not configured yet. Please contact the organizer.");
  const res = await fetch(`${baseUrl(s)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { message?: string }).message || `ZengaPay error ${res.status}`);
  return json as T;
}

export async function collectPayment(input: CollectInput, s: Settings): Promise<CollectResult> {
  const payload = { ...input, msisdn: toMsisdn(input.msisdn) };

  if (s.simulate) {
    const ref = `TEST-${payload.external_reference}`;
    sims.set(ref, "PENDING");
    return { ok: true, simulated: true, transactionReference: ref, message: "Test mode: no money will be taken." };
  }

  try {
    const json = await call<{ transactionReference?: string; result?: { transactionReference?: string } }>(s, "/collections", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return {
      ok: true,
      simulated: false,
      transactionReference: json.transactionReference || json.result?.transactionReference || payload.external_reference,
      message: "Approve the Mobile Money prompt on your phone.",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Payment request failed.";
    return {
      ok: false,
      simulated: false,
      transactionReference: "",
      message: msg === "Failed to fetch" ? "Could not reach ZengaPay from this browser. Please try again or contact the organizer." : msg,
    };
  }
}

export async function getCollectionStatus(ref: string, s: Settings): Promise<PayStatus> {
  if (ref.startsWith("TEST-")) return sims.get(ref) || "FAILED";
  try {
    const json = await call<{ data?: { transactionStatus?: string }; transactionStatus?: string }>(s, `/collections/${ref}`);
    const status = (json.data?.transactionStatus || json.transactionStatus || "PENDING").toUpperCase();
    return status === "SUCCEEDED" || status === "FAILED" ? status : "PENDING";
  } catch {
    return "PENDING";
  }
}

export function setTestResult(ref: string, status: "SUCCEEDED" | "FAILED") {
  if (sims.has(ref)) sims.set(ref, status);
}
