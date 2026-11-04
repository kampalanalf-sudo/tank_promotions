import { Mail, MessageCircle, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Notice, Spinner } from "./components";
import { api } from "./lib/api";
import type { TicketDelivery, TicketDeliveryStatus } from "./lib/storeFulfilment";

function statusTone(status: string) {
  if (status === "sent") return "text-emerald-700";
  if (status === "failed") return "text-red-700";
  if (status === "skipped") return "text-amber-700";
  return "text-black/55";
}

export default function TicketDeliveryAdmin() {
  const [status, setStatus] = useState<TicketDeliveryStatus | null>(null);
  const [deliveries, setDeliveries] = useState<TicketDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [s, d] = await Promise.all([api.ticketDeliveryStatus(), api.listTicketDeliveries()]);
      setStatus(s);
      setDeliveries(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load ticket delivery.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const deliver = async (body: { order_id?: string; reference?: string }, force = false) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = body.order_id
        ? await api.deliverTicket(body.order_id, force)
        : await api.deliverTicketByReference(body.reference || "", force);
      setMessage(`Delivery for ${result.code || body.order_id || body.reference}: email ${result.email_status}, WhatsApp ${result.whatsapp_status}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not deliver this ticket.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = target.trim();
    if (!value) return;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      await deliver({ order_id: value }, true);
    } else {
      await deliver({ reference: value }, true);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="mb-10 grid gap-6">
      <section className="rounded border border-black/12 bg-white/60 p-5">
        <h2 className="text-xs font-extrabold uppercase tracking-wider">Automatic server delivery</h2>
        <p className="mt-2 text-xs leading-5 text-black/60">
          After a verified payment, Supabase generates a PDF ticket, emails it with Resend, and sends a WhatsApp template with the ticket and secure PDF link. Delivery is idempotent and can be retried below.
        </p>
        {status && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-black/10 bg-white/70 p-3 text-xs">
              <p className="flex items-center gap-2 font-extrabold"><Mail size={14} /> Email (Resend)</p>
              <p className={`mt-1 font-bold ${status.email_enabled ? "text-emerald-700" : "text-amber-700"}`}>{status.email_enabled ? "Configured" : "Not configured"}</p>
              <p className="mt-1 text-black/60">From: {status.email_from || "not set"}</p>
              <p className="mt-1 text-black/60">Set <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> in Supabase Edge Function secrets. Verify the sending domain in Resend.</p>
            </div>
            <div className="rounded border border-black/10 bg-white/70 p-3 text-xs">
              <p className="flex items-center gap-2 font-extrabold"><MessageCircle size={14} /> WhatsApp (Meta Cloud API)</p>
              <p className={`mt-1 font-bold ${status.whatsapp_enabled ? "text-emerald-700" : "text-amber-700"}`}>{status.whatsapp_enabled ? "Configured" : "Not configured"}</p>
              <p className="mt-1 text-black/60">Template: {status.whatsapp_template || "not set"} ({status.whatsapp_language})</p>
              <p className="mt-1 text-black/60">Set <code>WHATSAPP_ACCESS_TOKEN</code>, <code>WHATSAPP_PHONE_NUMBER_ID</code>, and <code>WHATSAPP_TEMPLATE_NAME</code>. The template must be approved by Meta.</p>
            </div>
          </div>
        )}
        <p className="mt-3 text-xs leading-5 text-black/60">
          Optional: <code>EMAIL_REPLY_TO</code>, <code>WHATSAPP_TEMPLATE_LANGUAGE</code> (default <code>en_US</code>), <code>WHATSAPP_TEMPLATE_BODY_FIELDS</code> (default <code>name,event_title,event_date,ticket_code,ticket_url,pdf_url</code>), <code>TICKET_PUBLIC_URL</code> (default <code>https://tanktickets.site</code>).
        </p>
      </section>

      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="ok">{message}</Notice>}

      <form onSubmit={submit} className="rounded border border-black/12 bg-white/60 p-5">
        <h2 className="text-xs font-extrabold uppercase tracking-wider">Deliver / resend a ticket</h2>
        <p className="mt-2 text-xs text-black/60">Enter a Tank order ID or DGateway payment reference. This forces a fresh email/WhatsApp send and regenerates the secure PDF link.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input className="field min-w-0 font-mono text-xs" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="order UUID or DGateway reference" required />
          <button disabled={busy} className="btn btn-dark shrink-0 text-sm disabled:opacity-50"><Send size={14} /> {busy ? "Sending…" : "Send ticket"}</button>
        </div>
      </form>

      <section className="rounded border border-black/12 bg-white/60 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-extrabold uppercase tracking-wider">Recent automatic deliveries</h2>
          <button type="button" className="btn btn-line min-h-0! px-2 py-1 text-[11px]" onClick={() => void load()}><RefreshCw size={12} /> Refresh</button>
        </div>
        {deliveries.length === 0 ? <p className="mt-2 text-xs text-black/55">No automatic delivery attempts yet.</p> : (
          <div className="mt-3 grid gap-3">
            {deliveries.map((d) => (
              <article key={d.order_id} className="rounded border border-black/10 bg-white/70 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono font-extrabold">{d.order_id}</p>
                  <button type="button" disabled={busy} className="btn btn-line min-h-0! px-2 py-1 text-[11px] disabled:opacity-40" onClick={() => void deliver({ order_id: d.order_id }, true)}>Resend</button>
                </div>
                <p className="mt-1 text-black/60">
                  Email: <span className={statusTone(d.email_status)}>{d.email_status}</span> ({d.email_attempts}) · WhatsApp: <span className={statusTone(d.whatsapp_status)}>{d.whatsapp_status}</span> ({d.whatsapp_attempts})
                </p>
                {d.email_last_error && <p className="mt-1 text-red-700">Email: {d.email_last_error}</p>}
                {d.whatsapp_last_error && <p className="mt-1 text-red-700">WhatsApp: {d.whatsapp_last_error}</p>}
                <p className="mt-1 text-black/45">Updated {new Date(d.updated_at).toLocaleString()}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
