import { db } from "./store";

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
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  message: string;
};

const sims = new Map<string, { status: "PENDING" | "SUCCEEDED" | "FAILED"; amount: number }>();

export function toMsisdn(input: string) {
  const d = input.replace(/\D/g, "");
  if (d.startsWith("256") && d.length >= 12) return d.slice(0, 12);
  if (d.startsWith("0") && d.length === 10) return `256${d.slice(1)}`;
  if (d.length === 9) return `256${d}`;
  return d;
}

export function detectNetwork(msisdn: string): "MTN" | "Airtel" | "Other" {
  const n = toMsisdn(msisdn).slice(3, 5);
  if (["77", "78", "76", "39"].includes(n)) return "MTN";
  if (["70", "75", "74"].includes(n)) return "Airtel";
  return "Other";
}

function baseUrl() {
  return db.settings().zengaEnv === "production"
    ? "https://api.zengapay.com/v1"
    : "https://api.sandbox.zengapay.com/v1";
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = db.settings().zengaToken.trim();
  if (!token) throw new Error("No ZengaPay token");
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { message?: string }).message || `ZengaPay ${res.status}`);
  return json as T;
}

export async function collectPayment(input: CollectInput): Promise<CollectResult> {
  const payload = {
    msisdn: toMsisdn(input.msisdn),
    amount: input.amount,
    external_reference: input.external_reference,
    narration: input.narration,
  };
  const settings = db.settings();

  if (settings.zengaToken && !settings.simulate) {
    try {
      const json = await api<{
        code?: number;
        transactionReference?: string;
        result?: { code?: number; transactionReference?: string };
        message?: string;
      }>("/collections", { method: "POST", body: JSON.stringify(payload) });
      const ref = json.transactionReference || json.result?.transactionReference || payload.external_reference;
      return {
        ok: true,
        simulated: false,
        transactionReference: ref,
        status: "PENDING",
        message: "Approve the Mobile Money prompt on your phone.",
      };
    } catch (error) {
      return {
        ok: false,
        simulated: false,
        transactionReference: "",
        status: "FAILED",
        message: error instanceof Error ? error.message : "ZengaPay request failed.",
      };
    }
  }

  const ref = `SIM-${payload.external_reference}`;
  sims.set(ref, { status: "PENDING", amount: payload.amount });
  return {
    ok: true,
    simulated: true,
    transactionReference: ref,
    status: "PENDING",
    message: "Sandbox: a Mobile Money PIN prompt was sent. Approve below to complete.",
  };
}

export async function getCollectionStatus(ref: string): Promise<"PENDING" | "SUCCEEDED" | "FAILED"> {
  if (ref.startsWith("SIM-")) return sims.get(ref)?.status || "FAILED";
  try {
    const json = await api<{ data?: { transactionStatus?: string }; transactionStatus?: string }>(`/collections/${ref}`);
    const status = (json.data?.transactionStatus || json.transactionStatus || "PENDING").toUpperCase();
    if (status === "SUCCEEDED" || status === "FAILED" || status === "PENDING") return status;
    return "PENDING";
  } catch {
    return "PENDING";
  }
}

export function approveSimulation(ref: string) {
  const row = sims.get(ref);
  if (row) sims.set(ref, { ...row, status: "SUCCEEDED" });
}

export function failSimulation(ref: string) {
  const row = sims.get(ref);
  if (row) sims.set(ref, { ...row, status: "FAILED" });
}
