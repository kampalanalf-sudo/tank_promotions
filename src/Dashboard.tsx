import { Copy, LogOut, Pencil, Plus, Share2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DoorPanel, EventForm, Logo, Notice, OrdersTable, Poster, Spinner, StatusPill, TicketCard, emptyEvent, eventSummary } from "./components";
import { api, isCloud } from "./lib/api";
import { ugx } from "./lib/format";
import { payloadFor } from "./lib/tickets";
import type { EventInput, Order, Session, Settings, TankEvent } from "./lib/types";

const TABS = ["My tickets", "My events", "Sales", "Door"] as const;
type Tab = (typeof TABS)[number];

export function eventLink(id: string) {
  return `${window.location.origin}${window.location.pathname}#/e/${id}`;
}

export function EventStatusPill({ status }: { status: TankEvent["status"] }) {
  const label = { pending: "In review", published: "Live", rejected: "Not approved" }[status];
  return <span className={`pill pill-ev-${status}`}>{label}</span>;
}

export default function Dashboard({ session, settings, initialTab }: { session: Session; settings: Settings | null; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab || "My tickets");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [myEvents, setMyEvents] = useState<TankEvent[]>([]);
  const [lookup, setLookup] = useState<TankEvent[]>([]);
  const [myTickets, setMyTickets] = useState<Order[]>([]);
  const [sales, setSales] = useState<Order[]>([]);
  const [editing, setEditing] = useState<EventInput | null>(initialTab === "My events" && window.location.hash.endsWith("/new") ? emptyEvent(session) : null);
  const [salesFilter, setSalesFilter] = useState("all");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [mine, all, tickets] = await Promise.all([
        api.listEvents("mine", session),
        api.listEvents("all", session),
        api.listOrders({ mine: session }),
      ]);
      setMyEvents(mine);
      setLookup(all);
      setMyTickets(tickets.filter((o) => o.status !== "FAILED"));
      setSales(await api.listOrders({ eventIds: mine.map((e) => e.id) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your dashboard.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const eventById = useMemo(() => new Map([...lookup, ...myEvents].map((e) => [e.id, e])), [lookup, myEvents]);
  const paidSales = sales.filter((o) => o.status === "SUCCEEDED" || o.status === "CHECKED_IN");
  const shownSales = salesFilter === "all" ? sales : sales.filter((o) => o.eventId === salesFilter);

  const share = async (e: TankEvent) => {
    const link = eventLink(e.id);
    try {
      if (navigator.share) await navigator.share({ title: e.title, text: `Get tickets for ${e.title}`, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(e.id);
        setTimeout(() => setCopied(""), 2000);
      }
    } catch {
      /* share sheet dismissed */
    }
  };

  const remove = async (e: TankEvent) => {
    const sold = sales.filter((o) => o.eventId === e.id && o.status !== "FAILED").length;
    if (!window.confirm(sold ? `${e.title} has ${sold} ticket order(s). Delete the event and its orders?` : `Delete ${e.title}?`)) return;
    try {
      await api.deleteEvent(e.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
    }
  };

  const signOut = async () => {
    await api.signOut();
    window.location.hash = "/";
    window.dispatchEvent(new Event("tank-auth"));
  };

  return (
    <div className="min-h-screen bg-[#efe8d8] text-[#0c0c0b]">
      <header className="sticky top-0 z-20 bg-[#0c0c0b] text-white">
        <div className="shell flex h-16 items-center justify-between gap-3">
          <Logo light />
          <div className="flex items-center gap-4 text-[11px] font-extrabold uppercase tracking-widest">
            {session.role === "admin" && <a href="#/admin" className="text-[#c9a227]">Admin</a>}
            <a href="#/" className="hidden sm:inline">Events</a>
            <button onClick={signOut} className="inline-flex items-center gap-1 text-white/70"><LogOut size={14} /> Sign out</button>
          </div>
        </div>
      </header>

      <div className="shell py-10">
        <p className="eyebrow">Dashboard</p>
        <h1 className="display mt-2 text-5xl md:text-6xl">Hello, {session.name.split(" ")[0]}.</h1>
        {!isCloud && (
          <div className="mt-6">
            <Notice tone="warn">
              This site isn't connected to its online database yet, so everything here is saved on <b>this device only</b>. Other people can't see events you add until the database is connected.
            </Notice>
          </div>
        )}

        <div className="mt-8 flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`btn shrink-0 px-4 ${tab === t ? "btn-dark" : "btn-line"}`}>{t}</button>
          ))}
        </div>

        {error && <div className="mt-6"><Notice tone="error">{error}</Notice></div>}
        {loading ? <Spinner /> : (
          <div className="mt-8">
            {tab === "My tickets" && (
              <div className="grid gap-8 lg:grid-cols-2">
                {myTickets.map((o) => {
                  const ev = eventById.get(o.eventId);
                  if (!ev) return null;
                  return (
                    <div key={o.id}>
                      <div className="mb-2 flex items-center justify-between"><StatusPill status={o.status} /></div>
                      {o.status === "PENDING" ? (
                        <Notice tone="warn">{o.eventTitle}: payment not completed. Buy again from the event page.</Notice>
                      ) : (
                        <TicketCard payload={payloadFor(o, ev)} phone={o.phone} email={o.email} settings={settings} />
                      )}
                    </div>
                  );
                })}
                {myTickets.length === 0 && (
                  <p className="text-black/55">No tickets yet. <a href="#/" className="font-bold text-[#a8841a]">Browse events</a></p>
                )}
              </div>
            )}

            {tab === "My events" && (
              <div>
                {editing ? (
                  <EventForm initial={editing} session={session} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
                ) : (
                  <button className="btn btn-gold" onClick={() => setEditing(emptyEvent(session))}><Plus size={16} /> List a new event</button>
                )}
                <div className="mt-8 grid gap-4">
                  {myEvents.map((e) => {
                    const paid = sales.filter((o) => o.eventId === e.id && (o.status === "SUCCEEDED" || o.status === "CHECKED_IN"));
                    return (
                      <article key={e.id} className="grid gap-4 border border-black/12 p-4 sm:grid-cols-[120px_1fr]">
                        <Poster event={e} className="h-28 w-full sm:w-[120px]" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2"><EventStatusPill status={e.status} /><span className="text-xs text-black/45">{e.type}</span></div>
                          <h3 className="display mt-2 text-3xl">{e.title}</h3>
                          <p className="mt-1 text-sm text-black/55">{eventSummary(e)}</p>
                          <p className="mt-2 text-sm"><b>{e.sold}</b> / {e.capacity} sold · {ugx(paid.reduce((s, o) => s + o.amount, 0))} collected · {ugx(e.price)} per ticket</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {e.status === "published" && (
                              <button className="btn-mini" onClick={() => share(e)}>{copied === e.id ? <Copy size={13} /> : <Share2 size={13} />} {copied === e.id ? "Link copied" : "Share link"}</button>
                            )}
                            <button className="btn-mini" onClick={() => { setSalesFilter(e.id); setTab("Sales"); }}>Guest list</button>
                            <button className="btn-mini" onClick={() => setEditing({ ...e })}><Pencil size={13} /> Edit</button>
                            <button className="btn-mini" onClick={() => remove(e)}><Trash2 size={13} /> Delete</button>
                          </div>
                          {e.status === "pending" && <p className="mt-2 text-xs text-black/45">TANK will review this event before it appears on the site.</p>}
                          {e.status === "rejected" && <p className="mt-2 text-xs text-red-700">This event was not approved. Contact TANK on WhatsApp for details.</p>}
                        </div>
                      </article>
                    );
                  })}
                  {myEvents.length === 0 && !editing && <p className="text-black/55">You haven't listed any events yet.</p>}
                </div>
              </div>
            )}

            {tab === "Sales" && (
              <div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="stat"><p className="display text-4xl">{ugx(paidSales.reduce((s, o) => s + o.amount, 0)).replace("Free", "UGX 0")}</p><p className="stat-label">Collected</p></div>
                  <div className="stat"><p className="display text-4xl">{paidSales.reduce((s, o) => s + o.qty, 0)}</p><p className="stat-label">Tickets issued</p></div>
                  <div className="stat"><p className="display text-4xl">{sales.filter((o) => o.status === "CHECKED_IN").reduce((s, o) => s + o.qty, 0)}</p><p className="stat-label">Checked in</p></div>
                </div>
                <select className="field mt-6 max-w-sm" value={salesFilter} onChange={(e) => setSalesFilter(e.target.value)}>
                  <option value="all">All my events</option>
                  {myEvents.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                </select>
                <div className="mt-4"><OrdersTable orders={shownSales} events={myEvents} settings={settings} /></div>
              </div>
            )}

            {tab === "Door" && (
              myEvents.length || session.role === "admin" ? <DoorPanel session={session} onChange={load} /> : <p className="text-black/55">Door check-in is for organizers. List an event first.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
