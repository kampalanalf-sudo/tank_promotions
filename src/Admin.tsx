import { Check, Copy, ExternalLink, LogOut, Pencil, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DoorPanel, EventForm, Logo, Notice, OrdersTable, Poster, Spinner, eventSummary } from "./components";
import { EventStatusPill, eventLink } from "./Dashboard";
import StoreFulfilmentAdmin from "./StoreFulfilmentAdmin";
import { api } from "./lib/api";
import { API_BASE_URL, DGATEWAY_STORE_URL } from "./lib/config";
import { requestDisburse } from "./lib/dgateway";
import { cleanPhone, isValidGatewayPhone } from "./lib/phone";
import { ugx } from "./lib/format";
import { emailConfigured } from "./lib/tickets";
import type { EventInput, Order, Session, Settings, TankEvent } from "./lib/types";

const TABS = [
  "Review",
  "Events",
  "Orders",
  "Door",
  "DGateway",
  "Ticket delivery",
] as const;
type Tab = (typeof TABS)[number];

export default function Admin({
  session,
  settings,
  onSettings,
}: {
  session: Session;
  settings: Settings | null;
  onSettings: (s: Settings) => void;
}) {
  const [tab, setTab] = useState<Tab>("Review");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [events, setEvents] = useState<TankEvent[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [editing, setEditing] = useState<EventInput | null>(null);
  const [form, setForm] = useState<Settings | null>(settings);
  const [saved, setSaved] = useState("");
  const [copied, setCopied] = useState("");
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutCurrency, setPayoutCurrency] = useState("UGX");
  const [payoutPhone, setPayoutPhone] = useState("");
  const [payoutDescription, setPayoutDescription] = useState("");
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutMessage, setPayoutMessage] = useState("");

  useEffect(() => setForm(settings), [settings]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [ev, or] = await Promise.all([
        api.listEvents("all", session),
        api.listOrders({ all: true }),
      ]);
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
      {
        k: `UGX ${paid.reduce((s, o) => s + o.amount, 0).toLocaleString("en-UG")}`,
        l: "Collected",
      },
      { k: String(paid.reduce((s, o) => s + o.qty, 0)), l: "Tickets issued" },
      {
        k: String(events.filter((e) => e.status === "published").length),
        l: "Live events",
      },
      { k: String(pending.length), l: "Awaiting review" },
    ],
    [paid, events, pending.length]
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

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    form && setForm({ ...form, [k]: v });

  const localPreview = typeof window !== "undefined" && /localhost|127\.0\.0\.1|\.e2b\.app$/.test(window.location.hostname);
  const apiBase = API_BASE_URL || (localPreview ? window.location.origin : "");
  const webhookUrl = apiBase
    ? `${apiBase}/api/webhooks/dgateway`
    : "Deploy the /api server and set VITE_API_BASE_URL";

  const sendPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayoutMessage("");
    const amount = Number(payoutAmount);
    const phone = cleanPhone(payoutPhone);
    if (!Number.isInteger(amount) || amount <= 0) return setPayoutMessage("Enter a positive whole-unit amount.");
    if (!isValidGatewayPhone(phone)) return setPayoutMessage("Enter a valid MTN/Airtel number, e.g. 0772123456 or +256772123456.");
    setPayoutBusy(true);
    try {
      const result = await requestDisburse({
        externalRef: `PAY-${crypto.randomUUID()}`,
        amount,
        currency: payoutCurrency,
        phoneNumber: phone,
        description: payoutDescription.trim() || "TANK Tickets payout",
      });
      setPayoutMessage(`Payout requested. Reference: ${String(result.reference || "pending")} · Status: ${String(result.status || "pending")}`);
      setPayoutAmount("");
      setPayoutPhone("");
      setPayoutDescription("");
    } catch (err) {
      setPayoutMessage(err instanceof Error ? err.message : "Payout request failed.");
    } finally {
      setPayoutBusy(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      window.prompt("Copy this:", text);
    }
  };

  return (
    <div className="min-h-screen bg-[#efe8d8] text-[#0c0c0b]">
      <header className="sticky top-0 z-20 bg-[#0c0c0b] text-white">
        <div className="shell flex h-16 items-center justify-between gap-3">
          <Logo light label="TANK ADMIN" />
          <div className="flex items-center gap-4 text-[11px] font-extrabold uppercase tracking-widest">
            <a href="#/dashboard" className="text-[#c9a227]">
              My dashboard
            </a>
            <a href="#/" className="hidden sm:inline">
              Site
            </a>
            <button
              onClick={signOut}
              className="inline-flex items-center gap-1 text-white/70"
            >
              <LogOut size={14} /> Out
            </button>
          </div>
        </div>
      </header>

      <div className="shell grid gap-8 py-8 lg:grid-cols-[210px_1fr]">
        <aside className="flex gap-2 overflow-x-auto lg:flex-col">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`btn shrink-0 justify-start px-4 ${
                tab === t ? "btn-dark" : "btn-line"
              }`}
            >
              {t}
              {t === "Review" && pending.length > 0 && (
                <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-[#c9a227] px-1 text-[10px] text-black">
                  {pending.length}
                </span>
              )}
            </button>
          ))}
        </aside>

        <section className="min-w-0">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((s) => (
              <div key={s.l} className="stat">
                <p className="display text-3xl">{s.k}</p>
                <p className="stat-label">{s.l}</p>
              </div>
            ))}
          </div>
          {error && (
            <div className="mt-4">
              <Notice tone="error">{error}</Notice>
            </div>
          )}

          {loading ? (
            <Spinner />
          ) : (
            <div className="mt-8">
              {tab === "Review" && (
                <div>
                  <h1 className="display text-5xl">Events to review</h1>
                  <div className="mt-6 grid gap-4">
                    {pending.map((e) => (
                      <article
                        key={e.id}
                        className="grid gap-4 border border-black/12 p-4 sm:grid-cols-[140px_1fr]"
                      >
                        <Poster event={e} className="h-36 w-full sm:w-[140px]" />
                        <div className="min-w-0">
                          <p className="text-xs uppercase tracking-widest text-black/45">
                            {e.type} · by {e.organizerName} · {e.organizerPhone}
                          </p>
                          <h3 className="display mt-1 text-3xl">{e.title}</h3>
                          <p className="mt-1 text-sm text-black/55">
                            {eventSummary(e)}
                          </p>
                          <p className="mt-1 text-sm">
                            {ugx(e.price)} · {e.capacity} tickets
                          </p>
                          {e.description && (
                            <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-black/65">
                              {e.description}
                            </p>
                          )}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              className="btn btn-dark"
                              onClick={() =>
                                act(() => api.setEventStatus(e.id, "published"))
                              }
                            >
                              <Check size={15} /> Approve
                            </button>
                            <button
                              className="btn btn-line"
                              onClick={() =>
                                act(() => api.setEventStatus(e.id, "rejected"))
                              }
                            >
                              <X size={15} /> Reject
                            </button>
                            <a
                              className="btn btn-line"
                              href={`https://wa.me/${e.organizerPhone.replace(
                                /\D/g,
                                ""
                              )}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              WhatsApp organizer
                            </a>
                          </div>
                        </div>
                      </article>
                    ))}
                    {pending.length === 0 && (
                      <p className="text-sm text-black/45">
                        Nothing waiting for review.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {tab === "Events" && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h1 className="display text-5xl">All events</h1>
                    <a href="#/dashboard/new" className="btn btn-gold">
                      List a TANK event
                    </a>
                  </div>
                  {editing && (
                    <div className="mt-6">
                      <EventForm
                        initial={editing}
                        session={session}
                        onCancel={() => setEditing(null)}
                        onSaved={() => {
                          setEditing(null);
                          void load();
                        }}
                      />
                    </div>
                  )}
                  <div className="mt-6 divide-y divide-black/10 border-y border-black/10">
                    {events.map((e) => (
                      <div
                        key={e.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-4"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <EventStatusPill status={e.status} />
                            <span className="text-xs text-black/45">
                              {e.organizerName}
                            </span>
                          </div>
                          <p className="mt-1 font-extrabold">{e.title}</p>
                          <p className="text-sm text-black/50">
                            {eventSummary(e)} · {e.sold}/{e.capacity} sold
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <select
                            className="field w-36 py-2!"
                            value={e.status}
                            onChange={(x) =>
                              act(() =>
                                api.setEventStatus(
                                  e.id,
                                  x.target.value as TankEvent["status"]
                                )
                              )
                            }
                          >
                            <option value="published">Live</option>
                            <option value="pending">In review</option>
                            <option value="rejected">Not approved</option>
                          </select>
                          <a
                            className="btn-mini"
                            href={eventLink(e.id)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open
                          </a>
                          <button
                            className="btn-mini"
                            onClick={() => setEditing({ ...e })}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            className="btn-mini"
                            onClick={() =>
                              window.confirm(
                                `Delete ${e.title} and all its orders?`
                              ) && act(() => api.deleteEvent(e.id))
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {events.length === 0 && (
                      <p className="py-6 text-sm text-black/45">No events yet.</p>
                    )}
                  </div>
                </div>
              )}

              {tab === "Orders" && (
                <div>
                  <h1 className="display text-5xl">Orders</h1>
                  <div className="mt-6">
                    <OrdersTable
                      orders={orders}
                      events={events}
                      settings={settings}
                    />
                  </div>
                </div>
              )}

              {tab === "DGateway" && (
                <section className="max-w-2xl">
                  <h1 className="display text-5xl">Mobile Money payments</h1>
                  <p className="mt-4 text-sm leading-6 text-black/60">
                    Paid tickets use DGateway. A ticket is issued only after the server verifies the payment.
                    There is no manual, SMS, or offline payment confirmation.
                  </p>
                  <div className="mt-6 rounded border border-black/12 bg-white/60 p-5">
                    <h2 className="text-xs font-extrabold uppercase tracking-wider">Hosted DGateway store</h2>
                    <p className="mt-2 text-xs leading-5 text-black/60">
                      {DGATEWAY_STORE_URL
                        ? "Paid Get tickets clicks redirect to DGateway. Mapped products are fulfilled by the Supabase store webhook after verified payment."
                        : "Hosted-store redirect is disabled. Paid checkout uses the in-app /api routes."}
                    </p>
                    {DGATEWAY_STORE_URL && (
                      <a className="mt-3 inline-flex items-center gap-1 text-xs font-bold underline" href={DGATEWAY_STORE_URL} target="_blank" rel="noreferrer">
                        Open DGateway store <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                  <StoreFulfilmentAdmin events={events} />
                  <div className="mt-6 rounded border border-black/12 bg-white/60 p-5">
                    <h2 className="text-xs font-extrabold uppercase tracking-wider">In-app API webhook endpoint</h2>
                    <p className="mt-2 text-xs leading-5 text-black/60">Only for the separate /api checkout mode. Hosted-store payments use the Supabase webhook above.</p>
                    <div className="mt-3 flex items-center gap-2">
                      <input className="field min-w-0 font-mono text-xs" readOnly value={webhookUrl} aria-label="DGateway webhook endpoint" />
                      <button type="button" onClick={() => copyText(webhookUrl, "wh")} className="btn btn-dark shrink-0 px-3 text-xs">
                        {copied === "wh" ? <Check size={14} /> : <Copy size={14} />} {copied === "wh" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <form onSubmit={sendPayout} className="mt-6 rounded border border-black/12 bg-white/60 p-5">
                    <h2 className="text-xs font-extrabold uppercase tracking-wider">Send a payout</h2>
                    <p className="mt-2 text-xs leading-5 text-black/60">Admin-only DGateway disbursement to any supplied MTN/Airtel number. The server stores the reference and verifies completion.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="label">Amount<input className="field" type="number" min={1} step={1} value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} required placeholder="e.g. 5000" /></label>
                      <label className="label">Currency<select className="field" value={payoutCurrency} onChange={(e) => setPayoutCurrency(e.target.value)}><option>UGX</option><option>KES</option><option>TZS</option><option>RWF</option><option>USD</option></select></label>
                      <label className="label sm:col-span-2">Recipient number<input className="field" type="tel" value={payoutPhone} onChange={(e) => setPayoutPhone(e.target.value)} required placeholder="e.g. 0772123456 or +256772123456" /></label>
                      <label className="label sm:col-span-2">Description<input className="field" value={payoutDescription} onChange={(e) => setPayoutDescription(e.target.value)} maxLength={180} placeholder="e.g. Organizer payout" /></label>
                    </div>
                    {payoutMessage && <div role="status" className="mt-3 rounded border border-black/10 bg-white/70 p-3 text-xs font-bold">{payoutMessage}</div>}
                    <button disabled={payoutBusy} className="btn btn-dark mt-4 w-full text-sm font-black disabled:opacity-50">{payoutBusy ? "Requesting payout…" : "Request payout"}</button>
                  </form>
                  <div className="mt-6 rounded border border-amber-500/30 bg-amber-50/70 p-5 text-sm leading-6 text-amber-950">
                    <h2 className="font-extrabold">Server-side configuration</h2>
                    <p className="mt-2">Set DGATEWAY_API_KEY, DGATEWAY_WEBHOOK_SECRET, DGATEWAY_API_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL and APP_URL in the server host environment. Deploy the /api routes, then run the payment migrations.</p>
                    <p className="mt-2">Credentials are never entered or saved in this browser. Test and live modes are determined by the server API key, not by a switch on this page.</p>
                    <a className="mt-3 inline-flex items-center gap-1 font-bold underline" href="https://dgatewayadmin.desispay.com" target="_blank" rel="noreferrer">Open DGateway <ExternalLink size={13} /></a>
                  </div>
                </section>
              )}

              {tab === "Ticket delivery" && form && (
                <form
                  onSubmit={(e) => saveSettings(e, "email")}
                  className="max-w-2xl"
                >
                  <h1 className="display text-5xl">Ticket delivery</h1>
                  <div className="mt-4">
                    {emailConfigured(form) ? (
                      <Notice tone="ok">
                        Email delivery is on. Buyers get their ticket by email
                        automatically after paying.
                      </Notice>
                    ) : (
                      <Notice tone="warn">
                        Email delivery is off until you add your EmailJS details
                        below.
                      </Notice>
                    )}
                  </div>

                  <h2 className="mt-8 font-extrabold uppercase tracking-widest">
                    WhatsApp
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-black/60">
                    After payment, buyers tap <b>Send to WhatsApp</b> to get
                    their ticket and QR link in WhatsApp. Organizers can send
                    any ticket from the guest list in one tap.
                  </p>

                  <h2 className="mt-8 font-extrabold uppercase tracking-widest">
                    Email (EmailJS)
                  </h2>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-black/65">
                    <li>
                      Create a free account at{" "}
                      <a
                        className="underline"
                        href="https://www.emailjs.com"
                        target="_blank"
                        rel="noreferrer"
                      >
                        emailjs.com
                      </a>{" "}
                      and connect your email under <b>Email Services</b>.
                    </li>
                    <li>
                      Create an <b>Email Template</b>. Set <b>To Email</b> to{" "}
                      <code>{"{{to_email}}"}</code> and use these in the subject
                      or body:{" "}
                      <code>
                        {
                          "{{to_name}} {{event_title}} {{event_date}} {{venue}} {{qty}} {{amount}} {{ticket_code}} {{ticket_link}}"
                        }
                      </code>
                    </li>
                    <li>
                      Copy the Service ID, Template ID and your Public Key
                      (Account → General) below.
                    </li>
                    <li>
                      In EmailJS <b>Account → Security</b>, add{" "}
                      <code>tanktickets.site</code> to the allowed domains.
                    </li>
                  </ol>
                  <label className="label mt-5">
                    Service ID
                    <input
                      className="field"
                      value={form.emailServiceId}
                      onChange={(e) => set("emailServiceId", e.target.value)}
                    />
                  </label>
                  <label className="label mt-3">
                    Template ID
                    <input
                      className="field"
                      value={form.emailTemplateId}
                      onChange={(e) => set("emailTemplateId", e.target.value)}
                    />
                  </label>
                  <label className="label mt-3">
                    Public key
                    <input
                      className="field"
                      value={form.emailPublicKey}
                      onChange={(e) => set("emailPublicKey", e.target.value)}
                    />
                  </label>
                  <button className="btn btn-gold mt-6">
                    Save email settings
                  </button>
                  {saved === "email" && (
                    <span className="ml-3 text-sm text-emerald-700">
                      Saved ✓
                    </span>
                  )}
                </form>
              )}

              {tab === "Door" && (
                <div>
                  <h1 className="display text-5xl">Door check-in</h1>
                  <div className="mt-6">
                    <DoorPanel session={session} onChange={load} />
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
