import { Check, Copy, LogOut, Pencil, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DoorPanel, EventForm, Logo, Notice, OrdersTable, Poster, Spinner, eventSummary } from "./components";
import { EventStatusPill, eventLink } from "./Dashboard";
import { api, isCloud } from "./lib/api";
import { ugx } from "./lib/format";
import { emailConfigured } from "./lib/tickets";
import { parsePaymentSms } from "./lib/sms";
import type { EventInput, Order, Session, Settings, TankEvent } from "./lib/types";

const TABS = ["Review", "Events", "Orders", "Door", "Ticket delivery", "Payments", "SMS"] as const;
const SAMPLE_SMS = "RECEIVED. TID160268943390 UGX 500 from 758443666 referenceAPCUG220794100006272. BalUGX 500.";
type Tab = (typeof TABS)[number];

export default function Admin({ session, settings, onSettings }: { session: Session; settings: Settings | null; onSettings: (s: Settings) => void }) {
  const [tab, setTab] = useState<Tab>("Review");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [events, setEvents] = useState<TankEvent[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [editing, setEditing] = useState<EventInput | null>(null);
  const [form, setForm] = useState<Settings | null>(settings);
  const [saved, setSaved] = useState("");
  const [smsText, setSmsText] = useState("");
  const [smsResult, setSmsResult] = useState("");
  const [copiedTrigger, setCopiedTrigger] = useState(false);
  const parsedSms = useMemo(() => parsePaymentSms(smsText), [smsText]);
  const savedSecret = settings?.smsSecret || "";
  const triggerUrl = `${window.location.origin}${window.location.pathname}#/sms?key=${encodeURIComponent(savedSecret || "YOUR-KEY")}&text={sms_message}`;

  useEffect(() => setForm(settings), [settings]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [ev, or] = await Promise.all([api.listEvents("all", session), api.listOrders({ all: true })]);
      setEvents(ev);
      setOrders(or);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load admin data.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = events.filter((e) => e.status === "pending");
  const paid = orders.filter((o) => o.status === "SUCCEEDED" || o.status === "CHECKED_IN");
  const stats = useMemo(
    () => [
      { k: `UGX ${paid.reduce((s, o) => s + o.amount, 0).toLocaleString("en-UG")}`, l: "Collected" },
      { k: String(paid.reduce((s, o) => s + o.qty, 0)), l: "Tickets issued" },
      { k: String(events.filter((e) => e.status === "published").length), l: "Live events" },
      { k: String(pending.length), l: "Awaiting review" },
    ],
    [paid, events, pending.length],
  );

  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    }
  };

  const saveSettings = async (e: React.FormEvent, label: string) => {
    e.preventDefault();
    if (!form) return;
    try {
      await api.saveSettings(form);
      onSettings(form);
      setSaved(label);
      setTimeout(() => setSaved(""), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    }
  };

  const signOut = async () => {
    await api.signOut();
    window.location.hash = "/";
    window.dispatchEvent(new Event("tank-auth"));
  };

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => form && setForm({ ...form, [k]: v });

  return (
    <div className="min-h-screen bg-[#efe8d8] text-[#0c0c0b]">
      <header className="sticky top-0 z-20 bg-[#0c0c0b] text-white">
        <div className="shell flex h-16 items-center justify-between gap-3">
          <Logo light label="TANK ADMIN" />
          <div className="flex items-center gap-4 text-[11px] font-extrabold uppercase tracking-widest">
            <a href="#/dashboard" className="text-[#c9a227]">My dashboard</a>
            <a href="#/" className="hidden sm:inline">Site</a>
            <button onClick={signOut} className="inline-flex items-center gap-1 text-white/70"><LogOut size={14} /> Out</button>
          </div>
        </div>
      </header>

      <div className="shell grid gap-8 py-8 lg:grid-cols-[210px_1fr]">
        <aside className="flex gap-2 overflow-x-auto lg:flex-col">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`btn shrink-0 justify-start px-4 ${tab === t ? "btn-dark" : "btn-line"}`}>
              {t}{t === "Review" && pending.length > 0 && <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-[#c9a227] px-1 text-[10px] text-black">{pending.length}</span>}
            </button>
          ))}
        </aside>

        <section className="min-w-0">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((s) => (
              <div key={s.l} className="stat"><p className="display text-3xl">{s.k}</p><p className="stat-label">{s.l}</p></div>
            ))}
          </div>
          {!isCloud && <div className="mt-4"><Notice tone="warn">Database not connected: data is saved on this device only. See the setup guide to connect Supabase.</Notice></div>}
          {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}

          {loading ? <Spinner /> : (
            <div className="mt-8">
              {tab === "Review" && (
                <div>
                  <h1 className="display text-5xl">Events to review</h1>
                  <div className="mt-6 grid gap-4">
                    {pending.map((e) => (
                      <article key={e.id} className="grid gap-4 border border-black/12 p-4 sm:grid-cols-[140px_1fr]">
                        <Poster event={e} className="h-36 w-full sm:w-[140px]" />
                        <div className="min-w-0">
                          <p className="text-xs uppercase tracking-widest text-black/45">{e.type} · by {e.organizerName} · {e.organizerPhone}</p>
                          <h3 className="display mt-1 text-3xl">{e.title}</h3>
                          <p className="mt-1 text-sm text-black/55">{eventSummary(e)}</p>
                          <p className="mt-1 text-sm">{ugx(e.price)} · {e.capacity} tickets</p>
                          {e.description && <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-black/65">{e.description}</p>}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button className="btn btn-dark" onClick={() => act(() => api.setEventStatus(e.id, "published"))}><Check size={15} /> Approve</button>
                            <button className="btn btn-line" onClick={() => act(() => api.setEventStatus(e.id, "rejected"))}><X size={15} /> Reject</button>
                            <a className="btn btn-line" href={`https://wa.me/${e.organizerPhone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp organizer</a>
                          </div>
                        </div>
                      </article>
                    ))}
                    {pending.length === 0 && <p className="text-sm text-black/45">Nothing waiting for review.</p>}
                  </div>
                </div>
              )}

              {tab === "Events" && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h1 className="display text-5xl">All events</h1>
                    <a href="#/dashboard/new" className="btn btn-gold">List a TANK event</a>
                  </div>
                  {editing && <div className="mt-6"><EventForm initial={editing} session={session} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /></div>}
                  <div className="mt-6 divide-y divide-black/10 border-y border-black/10">
                    {events.map((e) => (
                      <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2"><EventStatusPill status={e.status} /><span className="text-xs text-black/45">{e.organizerName}</span></div>
                          <p className="mt-1 font-extrabold">{e.title}</p>
                          <p className="text-sm text-black/50">{eventSummary(e)} · {e.sold}/{e.capacity} sold</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <select className="field w-36 py-2!" value={e.status} onChange={(x) => act(() => api.setEventStatus(e.id, x.target.value as TankEvent["status"]))}>
                            <option value="published">Live</option>
                            <option value="pending">In review</option>
                            <option value="rejected">Not approved</option>
                          </select>
                          <a className="btn-mini" href={eventLink(e.id)} target="_blank" rel="noreferrer">Open</a>
                          <button className="btn-mini" onClick={() => setEditing({ ...e })}><Pencil size={13} /></button>
                          <button className="btn-mini" onClick={() => window.confirm(`Delete ${e.title} and all its orders?`) && act(() => api.deleteEvent(e.id))}><Trash2 size={13} /></button>
                        </div>
                      </div>
                    ))}
                    {events.length === 0 && <p className="py-6 text-sm text-black/45">No events yet.</p>}
                  </div>
                </div>
              )}

              {tab === "Orders" && (
                <div>
                  <h1 className="display text-5xl">Orders</h1>
                  <div className="mt-6"><OrdersTable orders={orders} events={events} settings={settings} /></div>
                </div>
              )}

              {tab === "Ticket delivery" && form && (
                <form onSubmit={(e) => saveSettings(e, "email")} className="max-w-2xl">
                  <h1 className="display text-5xl">Ticket delivery</h1>
                  <div className="mt-4">
                    {emailConfigured(form) ? <Notice tone="ok">Email delivery is on. Buyers get their ticket by email automatically after paying.</Notice> : <Notice tone="warn">Email delivery is off until you add your EmailJS details below.</Notice>}
                  </div>

                  <h2 className="mt-8 font-extrabold uppercase tracking-widest">WhatsApp</h2>
                  <p className="mt-2 text-sm leading-6 text-black/60">
                    After payment, buyers tap <b>Send to WhatsApp</b> to get their ticket and QR link in WhatsApp. Organizers can send any ticket from the guest list in one tap. Sending fully automatically needs the paid WhatsApp Business API and a server.
                  </p>

                  <h2 className="mt-8 font-extrabold uppercase tracking-widest">Email (EmailJS)</h2>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-black/65">
                    <li>Create a free account at <a className="underline" href="https://www.emailjs.com" target="_blank" rel="noreferrer">emailjs.com</a> and connect your email under <b>Email Services</b>.</li>
                    <li>Create an <b>Email Template</b>. Set <b>To Email</b> to <code>{"{{to_email}}"}</code> and use these in the subject or body: <code>{"{{to_name}} {{event_title}} {{event_date}} {{venue}} {{qty}} {{amount}} {{ticket_code}} {{ticket_link}}"}</code></li>
                    <li>Copy the Service ID, Template ID and your Public Key (Account → General) below.</li>
                    <li>In EmailJS <b>Account → Security</b>, add <code>tanktickets.site</code> to the allowed domains.</li>
                  </ol>
                  <label className="label mt-5">Service ID<input className="field" value={form.emailServiceId} onChange={(e) => set("emailServiceId", e.target.value)} /></label>
                  <label className="label mt-3">Template ID<input className="field" value={form.emailTemplateId} onChange={(e) => set("emailTemplateId", e.target.value)} /></label>
                  <label className="label mt-3">Public key<input className="field" value={form.emailPublicKey} onChange={(e) => set("emailPublicKey", e.target.value)} /></label>
                  <button className="btn btn-gold mt-6">Save email settings</button>
                  {saved === "email" && <span className="ml-3 text-sm text-emerald-700">Saved ✓</span>}
                </form>
              )}

              {tab === "Payments" && form && (
                <form onSubmit={(e) => saveSettings(e, "pay")} className="max-w-2xl">
                  <h1 className="display text-5xl">Merchant payments</h1>
                  <p className="mt-4 text-sm leading-6 text-black/60">Buyers pay your MTN or Airtel merchant code. The confirmation SMS on that SIM then issues the ticket. ZengaPay is no longer used at checkout. Airtel code 7185040 is preset from your sample; add the MTN code separately.</p>
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <label className="label">MTN merchant code<input className="field" inputMode="numeric" value={form.mtnMerchantCode} onChange={(e) => set("mtnMerchantCode", e.target.value)} /></label>
                    <label className="label">Name on the MTN code<input className="field" value={form.mtnMerchantName} onChange={(e) => set("mtnMerchantName", e.target.value)} /></label>
                    <label className="label">Airtel merchant code<input className="field" inputMode="numeric" value={form.airtelMerchantCode} onChange={(e) => set("airtelMerchantCode", e.target.value)} /></label>
                    <label className="label">Name on the Airtel code<input className="field" value={form.airtelMerchantName} onChange={(e) => set("airtelMerchantName", e.target.value)} /></label>
                  </div>
                  <label className="label mt-4">SMS confirmation key
                    <input className="field" value={form.smsSecret} onChange={(e) => set("smsSecret", e.target.value)} autoComplete="off" />
                  </label>
                  <button type="button" className="btn btn-line mt-3" onClick={() => set("smsSecret", crypto.randomUUID().replace(/-/g, "").slice(0, 20))}>Generate key</button>
                  <button className="btn btn-gold mt-6">Save merchant codes</button>
                  {saved === "pay" && <span className="ml-3 text-sm text-emerald-700">Saved ✓</span>}
                  <div className="mt-6">
                    <Notice tone="warn">Automatic issuing only works after Supabase is connected, because the buyer's phone and your payment SIM are different devices. Keep the confirmation key private.</Notice>
                  </div>
                </form>
              )}

              {tab === "SMS" && form && (
                <div className="max-w-2xl">
                  <p className="eyebrow">Option A · active</p>
                  <h1 className="display mt-2 text-5xl">Automatic SMS trigger</h1>
                  <p className="mt-4 text-sm leading-6 text-black/60">
                    The phone with your merchant SIM receives the payment SMS. MacroDroid opens the secure TANK link below. TANK matches the payer number and exact amount, then the buyer's waiting page becomes a ticket.
                  </p>

                  <div className="mt-6 grid gap-2 border border-black/12 bg-white/60 p-4 text-sm">
                    {[
                      [isCloud, "Online database connected"],
                      [savedSecret.length >= 8, "SMS confirmation key generated and saved"],
                      [Boolean(settings?.airtelMerchantCode), "Airtel merchant code saved"],
                      [Boolean(settings?.mtnMerchantCode), "MTN merchant code saved (add if you use MTN)"],
                    ].map(([done, label]) => (
                      <p key={String(label)} className="flex items-center gap-2">
                        {done ? <Check size={15} className="text-emerald-700" /> : <X size={15} className="text-red-700" />}
                        <span className={done ? "" : "text-black/55"}>{String(label)}</span>
                      </p>
                    ))}
                  </div>

                  <h2 className="mt-8 font-extrabold uppercase tracking-widest">1 · Copy this trigger link</h2>
                  <div className="mt-3 border border-black/12 bg-white/60 p-4">
                    <p className="break-all text-sm">{triggerUrl}</p>
                    <button
                      type="button"
                      className="btn btn-dark mt-4 disabled:opacity-50"
                      disabled={!savedSecret}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(triggerUrl);
                          setCopiedTrigger(true);
                          setTimeout(() => setCopiedTrigger(false), 2000);
                        } catch {
                          window.prompt("Copy this trigger link:", triggerUrl);
                        }
                      }}
                    >
                      <Copy size={15} /> {copiedTrigger ? "Copied" : savedSecret ? "Copy trigger link" : "Save the key first"}
                    </button>
                  </div>

                  <h2 className="mt-8 font-extrabold uppercase tracking-widest">2 · Set up MacroDroid on the merchant phone</h2>
                  <ol className="mt-3 grid gap-3 text-sm leading-6 text-black/70">
                    <li className="border border-black/12 p-4"><b>1.</b> Install MacroDroid and create a new macro.</li>
                    <li className="border border-black/12 p-4"><b>2.</b> Trigger: <b>SMS Received</b>. Choose the MTN MoMo or Airtel Money sender. If the sender varies, use Any Number and Contains <b>UGX</b>.</li>
                    <li className="border border-black/12 p-4"><b>3.</b> Action: <b>Open Website</b>. Paste the trigger link above.</li>
                    <li className="border border-black/12 p-4"><b>4.</b> Keep <b>{"{sms_message}"}</b> in the link. MacroDroid replaces it with the SMS body. Older versions use <b>[sms_message]</b>.</li>
                    <li className="border border-black/12 p-4"><b>5.</b> Save the macro, allow SMS permission, and keep that phone on with internet. Test with the sample below.</li>
                  </ol>

                  <h2 className="mt-8 font-extrabold uppercase tracking-widest">3 · Paste a test SMS</h2>
                  <textarea className="field mt-3" rows={5} value={smsText} onChange={(e) => setSmsText(e.target.value)} placeholder={SAMPLE_SMS} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn btn-line" onClick={() => setSmsText(SAMPLE_SMS)}>Use sample SMS</button>
                    <button className="btn btn-dark" disabled={!smsText || !savedSecret} onClick={async () => {
                      const result = await api.applyPaymentSms(savedSecret, smsText);
                      setSmsResult(result.message);
                      if (result.ok) void load();
                    }}>Match this SMS</button>
                  </div>
                  {smsText && (
                    <div className="mt-4 grid gap-1 border border-black/12 bg-white/60 p-4 text-sm">
                      <p><b>Amount:</b> {parsedSms.amount == null ? "not found" : ugx(parsedSms.amount)}</p>
                      <p><b>Payer:</b> {parsedSms.phone || "not found"}</p>
                      <p><b>Transaction:</b> {parsedSms.transactionId || parsedSms.providerReference || "not found"}</p>
                      <p><b>Ticket reference:</b> {parsedSms.code || "none — will match by payer number and exact amount"}</p>
                    </div>
                  )}
                  {smsResult && <p className="mt-3 text-sm">{smsResult}</p>}
                </div>
              )}

              {tab === "Door" && (
                <div>
                  <h1 className="display text-5xl">Door check-in</h1>
                  <div className="mt-6"><DoorPanel session={session} onChange={load} /></div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
