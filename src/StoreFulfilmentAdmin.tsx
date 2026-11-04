import { Check, Copy, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Notice, Spinner } from "./components";
import { api } from "./lib/api";
import { SUPABASE_URL } from "./lib/config";
import { storeWebhookUrl, validateStoreMapping, type StoreMapping, type StoreMappingInput, type StorePayment } from "./lib/storeFulfilment";
import type { TankEvent } from "./lib/types";

const EMPTY: StoreMappingInput = {
  store_slug: "tanktickets",
  product_id: "",
  product_slug: "",
  event_id: "",
  label: "",
  unit_amount: 20000,
  currency: "UGX",
  tickets_per_unit: 1,
  checkout_url: "",
  enabled: false,
};

export default function StoreFulfilmentAdmin({ events }: { events: TankEvent[] }) {
  const [mappings, setMappings] = useState<StoreMapping[]>([]);
  const [payments, setPayments] = useState<StorePayment[]>([]);
  const [form, setForm] = useState<StoreMappingInput>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const webhookUrl = storeWebhookUrl(SUPABASE_URL);

  const load = useCallback(async () => {
    setError("");
    try {
      const [m, p] = await Promise.all([api.listStoreMappings(), api.listStorePayments()]);
      setMappings(m);
      setPayments(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load store fulfilment.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof StoreMappingInput>(key: K, value: StoreMappingInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validateStoreMapping(form);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.saveStoreMapping(form);
      setMessage(form.id ? "Mapping updated." : "Mapping created.");
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save mapping.");
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async (reference: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api.reconcileStorePayment(reference);
      setMessage(result.fulfilment === "issued" ? `Ticket issued for ${reference}.` : `Rechecked ${reference}: ${result.fulfilment || "unknown"}${result.code ? ` (${result.code})` : ""}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reconcile payment.");
    } finally {
      setBusy(false);
    }
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this webhook URL:", webhookUrl);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="mt-6 grid gap-6">
      <section className="rounded border border-black/12 bg-white/60 p-5">
        <h2 className="text-xs font-extrabold uppercase tracking-wider">Hosted-store webhook</h2>
        <p className="mt-2 text-xs leading-5 text-black/60">
          Register this Supabase Edge Function URL in DGateway → My Apps → Settings → Webhook URL. It verifies the HMAC signature, re-checks the transaction with DGateway, and issues a ticket only for a mapped product and verified completed payment.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input className="field min-w-0 font-mono text-xs" readOnly value={webhookUrl || "Set VITE_SUPABASE_URL"} aria-label="Hosted store webhook endpoint" />
          <button type="button" onClick={copyWebhook} className="btn btn-dark shrink-0 px-3 text-xs">
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-3 text-xs leading-5 text-black/60">
          Required Supabase Edge Function secrets: <code>DGATEWAY_API_KEY</code>, <code>DGATEWAY_WEBHOOK_SECRET</code>, <code>SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>. Optional: <code>DGATEWAY_STORE_SLUG</code> (default <code>tanktickets</code>), <code>DGATEWAY_ALLOW_TEST_PAYMENTS=true</code> only for a sandbox project.
        </p>
        <a className="mt-3 inline-flex items-center gap-1 text-xs font-bold underline" href="https://dgatewayadmin.desispay.com" target="_blank" rel="noreferrer">Open DGateway settings <ExternalLink size={13} /></a>
      </section>

      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="ok">{message}</Notice>}

      <form onSubmit={save} className="rounded border border-black/12 bg-white/60 p-5">
        <h2 className="text-xs font-extrabold uppercase tracking-wider">{form.id ? "Edit product mapping" : "Map a DGateway product to an event"}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="label">DGateway product ID<input className="field" value={form.product_id} onChange={(e) => set("product_id", e.target.value)} required placeholder="e.g. 49" /></label>
          <label className="label">DGateway product slug<input className="field" value={form.product_slug} onChange={(e) => set("product_slug", e.target.value)} required placeholder="e.g. ruhindo-beach-vibes-740d" /></label>
          <label className="label">Tank Tickets event<select className="field" value={form.event_id} onChange={(e) => set("event_id", e.target.value)} required><option value="">Choose event…</option>{events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}</select></label>
          <label className="label">Label<input className="field" value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="e.g. General admission" /></label>
          <label className="label">Product price (whole units)<input className="field" type="number" min={1} step={1} value={form.unit_amount} onChange={(e) => set("unit_amount", Number(e.target.value))} required /></label>
          <label className="label">Currency<select className="field" value={form.currency} onChange={(e) => set("currency", e.target.value)}><option>UGX</option><option>KES</option><option>TZS</option><option>RWF</option><option>USD</option></select></label>
          <label className="label">Tickets per product<input className="field" type="number" min={1} max={10} step={1} value={form.tickets_per_unit} onChange={(e) => set("tickets_per_unit", Number(e.target.value))} required /></label>
          <label className="label">Store slug<input className="field" value={form.store_slug} onChange={(e) => set("store_slug", e.target.value)} required /></label>
          <label className="label sm:col-span-2">Hosted checkout URL<input className="field" type="url" value={form.checkout_url} onChange={(e) => set("checkout_url", e.target.value)} required placeholder="https://dgatewayadmin.desispay.com/store/pay/…" /></label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Enabled for verified fulfilment and event-page checkout</label>
        <div className="mt-4 flex gap-2">
          <button disabled={busy} className="btn btn-dark text-sm disabled:opacity-50">{busy ? "Saving…" : form.id ? "Update mapping" : "Create mapping"}</button>
          {form.id && <button type="button" className="btn btn-line text-sm" onClick={() => setForm(EMPTY)}>Cancel</button>}
        </div>
      </form>

      <section className="rounded border border-black/12 bg-white/60 p-5">
        <h2 className="text-xs font-extrabold uppercase tracking-wider">Product mappings</h2>
        {mappings.length === 0 ? <p className="mt-2 text-xs text-black/55">No mappings yet.</p> : (
          <div className="mt-3 grid gap-3">
            {mappings.map((m) => (
              <article key={m.id} className="rounded border border-black/10 bg-white/70 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-extrabold">{m.label || m.product_slug} · {m.enabled ? "Enabled" : "Disabled"}</p>
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-line min-h-0! px-2 py-1 text-[11px]" onClick={() => setForm(m)}>Edit</button>
                    <button type="button" className="btn btn-line min-h-0! px-2 py-1 text-[11px]" onClick={async () => { if (!window.confirm("Delete this mapping? Existing issued tickets are kept.")) return; try { await api.deleteStoreMapping(m.id); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Could not delete mapping."); } }}><Trash2 size={12} /> Delete</button>
                  </div>
                </div>
                <p className="mt-1 text-black/60">Product {m.product_id} / {m.product_slug} → {events.find((e) => e.id === m.event_id)?.title || m.event_id}</p>
                <p className="mt-1 text-black/60">{m.currency} {m.unit_amount.toLocaleString()} · {m.tickets_per_unit} ticket(s) per unit · {m.store_slug}</p>
                <a className="mt-1 inline-block font-bold underline" href={m.checkout_url} target="_blank" rel="noreferrer">Open checkout</a>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded border border-black/12 bg-white/60 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-extrabold uppercase tracking-wider">Recent store payments</h2>
          <button type="button" className="btn btn-line min-h-0! px-2 py-1 text-[11px]" onClick={() => void load()}><RefreshCw size={12} /> Refresh</button>
        </div>
        {payments.length === 0 ? <p className="mt-2 text-xs text-black/55">No hosted-store payments received yet.</p> : (
          <div className="mt-3 grid gap-3">
            {payments.map((p) => (
              <article key={p.reference} className="rounded border border-black/10 bg-white/70 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono font-extrabold">{p.reference}</p>
                  <button type="button" disabled={busy || p.fulfilment_status === "issued"} className="btn btn-line min-h-0! px-2 py-1 text-[11px] disabled:opacity-40" onClick={() => void reconcile(p.reference)}>Recheck with DGateway</button>
                </div>
                <p className="mt-1 text-black/60">{p.currency} {p.amount.toLocaleString()} · {p.payment_status} · fulfilment: {p.fulfilment_status}{p.error_code ? ` (${p.error_code})` : ""}</p>
                <p className="mt-1 text-black/60">{p.buyer_name || "Unknown buyer"} · {p.buyer_email || "no email"} · product {p.product_id || "?"} / {p.product_slug || "?"}</p>
                {p.failure_reason && <p className="mt-1 text-red-700">{p.failure_reason}</p>}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
