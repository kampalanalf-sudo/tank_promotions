// Small server-only helper used by payment webhooks to start ticket delivery.
// It does not import PDF/email/WhatsApp code, so payment webhooks stay lightweight.

export type DeliveryTriggerEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export function scheduleDelivery(work: Promise<unknown>) {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  const safe = work.catch((err) => {
    console.error("ticket-delivery: background delivery failed", err instanceof Error ? err.message : "unknown");
  });
  if (runtime?.waitUntil) runtime.waitUntil(safe);
  return safe;
}

export async function triggerTicketDelivery(env: DeliveryTriggerEnv, orderId: string, force = false) {
  const base = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base || !key || !orderId) return;
  const response = await fetch(`${base}/functions/v1/ticket-delivery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ order_id: orderId, force }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Ticket delivery returned HTTP ${response.status}`);
  }
}
