import { Check, LogOut, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { logout } from "./lib/auth";
import { db } from "./lib/store";
import type { Brief, Night, Order, Session, Settings as PaySettings } from "./lib/types";
import { ugx } from "./lib/format";

const tabs = ["Overview", "Nights", "Tickets", "Briefs", "Door", "ZengaPay"] as const;
type Tab = (typeof tabs)[number];

const emptyNight: Night = {
  id: 0,
  day: "01",
  month: "JUN",
  date: "Monday, 1 June 2026",
  title: "",
  type: "Nightlife",
  venue: "",
  area: "Kampala",
  time: "9:00 PM",
  price: 20000,
  image: "event-rooftop.jpg",
  spots: 40,
};

export default function Admin({ session }: { session: Session }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [nights, setNights] = useState(db.nights());
  const [orders, setOrders] = useState(db.orders());
  const [briefs, setBriefs] = useState(db.briefs());
  const [settings, setSettings] = useState(db.settings());
  const [draft, setDraft] = useState<Night | null>(null);
  const [scan, setScan] = useState("");
  const [scanMsg, setScanMsg] = useState("");

  const paid = orders.filter((o) => o.status === "SUCCEEDED" || o.status === "CHECKED_IN");
  const revenue = paid.reduce((s, o) => s + o.amount, 0);

  const saveNights = (rows: Night[]) => { setNights(rows); db.saveNights(rows); };
  const saveOrders = (rows: Order[]) => { setOrders(rows); db.saveOrders(rows); };
  const saveBriefs = (rows: Brief[]) => { setBriefs(rows); db.saveBriefs(rows); };

  const saveDraft = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const parsed = new Date(draft.date);
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const next: Night = {
      ...draft,
      id: draft.id || Math.max(0, ...nights.map((n) => n.id)) + 1,
      day: Number.isNaN(parsed.getTime()) ? draft.day : String(parsed.getDate()).padStart(2, "0"),
      month: Number.isNaN(parsed.getTime()) ? draft.month : months[parsed.getMonth()],
    };
    saveNights(draft.id ? nights.map((n) => (n.id === next.id ? next : n)) : [...nights, next]);
    setDraft(null);
  };

  const checkIn = () => {
    const code = scan.trim().toUpperCase();
    const hit = orders.find((o) => o.code === code);
    if (!hit) return setScanMsg("No pass with that code.");
    if (hit.status === "CHECKED_IN") return setScanMsg(`${hit.name} already in.`);
    if (hit.status !== "SUCCEEDED") return setScanMsg("Payment is not complete.");
    saveOrders(orders.map((o) => (o.id === hit.id ? { ...o, status: "CHECKED_IN" } : o)));
    setScanMsg(`${hit.name} · ${hit.qty} guest(s) · ${hit.nightTitle}`);
    setScan("");
  };

  const savePay = (e: React.FormEvent) => {
    e.preventDefault();
    db.saveSettings(settings);
  };

  const stats = useMemo(() => [
    { k: ugx(revenue), l: "Collected" },
    { k: String(paid.reduce((s, o) => s + o.qty, 0)), l: "Guests paid" },
    { k: String(nights.length), l: "Nights live" },
    { k: String(briefs.filter((b) => b.status === "New").length), l: "New briefs" },
  ], [revenue, paid, nights.length, briefs]);

  return (
    <div className="min-h-screen bg-[#efe8d8] text-[#0c0c0b]">
      <header className="sticky top-0 z-20 border-b border-black/10 bg-[#0c0c0b] text-white">
        <div className="shell flex h-16 items-center justify-between">
          <a href="#/" className="flex items-center gap-3">
            <span className="mark"><img src="logo.jpg" alt="" /></span>
            <span className="wordmark hidden sm:block">TANK ADMIN</span>
          </a>
          <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-white/55">
            <a href="#/" className="hidden sm:inline-flex items-center gap-1 text-[#c9a227]"><LogOut size={14} /> Back to site</a>
            <span>{session.name}</span>
            <button onClick={() => { logout(); window.location.hash = "/login"; }} className="inline-flex items-center gap-1 text-[#c9a227]"><LogOut size={14} /> Out</button>
          </div>
        </div>
      </header>

      <div className="shell grid gap-8 py-8 lg:grid-cols-[220px_1fr]">
        <aside className="flex gap-2 overflow-x-auto lg:flex-col">
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`btn shrink-0 justify-start ${tab === t ? "btn-dark" : "btn-line"}`}>{t}</button>
          ))}
        </aside>

        <section>
          {tab === "Overview" && (
            <div>
              <p className="eyebrow">Desk</p>
              <h1 className="display mt-2 text-5xl">Campaign control</h1>
              <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {stats.map((s) => (
                  <div key={s.l} className="border border-black/12 p-5">
                    <p className="display text-4xl">{s.k}</p>
                    <p className="mt-2 text-xs uppercase tracking-widest text-black/45">{s.l}</p>
                  </div>
                ))}
              </div>
              <div className="mt-8 grid gap-3">
                {orders.slice(0, 6).map((o) => (
                  <div key={o.id} className="flex items-center justify-between border border-black/10 px-4 py-3 text-sm">
                    <span>{o.name} · {o.nightTitle}</span>
                    <b className={o.status === "SUCCEEDED" || o.status === "CHECKED_IN" ? "text-emerald-700" : ""}>{o.status}</b>
                  </div>
                ))}
                {orders.length === 0 && <p className="text-sm text-black/45">No ticket sales yet.</p>}
              </div>
            </div>
          )}

          {tab === "Nights" && (
            <div>
              <div className="flex items-center justify-between">
                <h1 className="display text-5xl">Nights</h1>
                <button className="btn btn-gold" onClick={() => setDraft({ ...emptyNight })}><Plus size={16} /> New night</button>
              </div>
              {draft && (
                <form onSubmit={saveDraft} className="mt-6 grid gap-3 border border-black/12 p-5">
                  <input className="field" placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input className="field" placeholder="Venue" value={draft.venue} onChange={(e) => setDraft({ ...draft, venue: e.target.value })} required />
                    <input className="field" placeholder="Area" value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })} required />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <input className="field" placeholder="Date label" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
                    <input className="field" placeholder="Time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
                    <select className="field" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                      {["Nightlife", "Dining", "Live", "Activation"].map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input className="field" type="number" placeholder="Price UGX" value={draft.price} onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })} />
                    <input className="field" type="number" placeholder="Spots" value={draft.spots} onChange={(e) => setDraft({ ...draft, spots: Number(e.target.value) })} />
                  </div>
                  <input className="field" placeholder="Image URL" value={draft.image} onChange={(e) => setDraft({ ...draft, image: e.target.value })} />
                  <div className="flex gap-2">
                    <button className="btn btn-dark">Save night</button>
                    <button type="button" className="btn btn-line" onClick={() => setDraft(null)}>Cancel</button>
                  </div>
                </form>
              )}
              <div className="mt-6 divide-y divide-black/10 border-t border-black/10">
                {nights.map((n) => (
                  <div key={n.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div>
                      <p className="font-extrabold">{n.title}</p>
                      <p className="text-sm text-black/50">{n.date} · {n.area} · {ugx(n.price)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn btn-line" onClick={() => setDraft(n)}>Edit</button>
                      <button className="btn btn-line" onClick={() => saveNights(nights.filter((x) => x.id !== n.id))} aria-label="Delete"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "Tickets" && (
            <div>
              <h1 className="display text-5xl">Tickets</h1>
              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-widest text-black/40">
                    <tr>{["Code", "Guest", "Night", "Amount", "Status"].map((h) => <th key={h} className="border-b border-black/10 py-3">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td className="py-3 font-bold">{o.code}</td>
                        <td>{o.name}<br /><span className="text-black/40">{o.phone}</span></td>
                        <td>{o.nightTitle} × {o.qty}</td>
                        <td>{ugx(o.amount)}</td>
                        <td>{o.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {orders.length === 0 && <p className="py-8 text-sm text-black/45">No collections yet.</p>}
              </div>
            </div>
          )}

          {tab === "Briefs" && (
            <div>
              <h1 className="display text-5xl">Venue briefs</h1>
              <div className="mt-6 grid gap-4">
                {briefs.map((b) => (
                  <article key={b.id} className="border border-black/12 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-extrabold">{b.venue} · {b.area}</p>
                        <p className="mt-1 text-sm text-black/50">{b.type} · {b.date} · {b.phone}</p>
                        <p className="mt-3 text-sm">{b.note}</p>
                      </div>
                      <select className="field w-36" value={b.status} onChange={(e) => saveBriefs(briefs.map((x) => x.id === b.id ? { ...x, status: e.target.value as Brief["status"] } : x))}>
                        {["New", "In review", "Replied"].map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  </article>
                ))}
                {briefs.length === 0 && <p className="text-sm text-black/45">No campaign briefs yet.</p>}
              </div>
            </div>
          )}

          {tab === "Door" && (
            <div className="max-w-lg">
              <h1 className="display text-5xl">Door</h1>
              <p className="mt-3 text-sm text-black/55">Enter the guest pass code to check in.</p>
              <div className="mt-6 flex gap-2">
                <input className="field" placeholder="TNK-…" value={scan} onChange={(e) => setScan(e.target.value)} />
                <button className="btn btn-dark" onClick={checkIn}><Check size={16} /></button>
              </div>
              {scanMsg && <p className="mt-4 text-sm font-bold">{scanMsg}</p>}
            </div>
          )}

          {tab === "ZengaPay" && (
            <form onSubmit={savePay} className="max-w-xl">
              <p className="eyebrow">Collections</p>
              <h1 className="display mt-2 text-5xl">ZengaPay</h1>
              <p className="mt-4 text-sm leading-6 text-black/55">
                Collections API: POST /v1/collections with msisdn, amount, external_reference and narration.
                Token lives only in this browser. For production, proxy the call from a server so the key never ships to guests.
              </p>
              <label className="mt-8 block text-xs font-extrabold uppercase tracking-widest">Environment</label>
              <select className="field mt-2" value={settings.zengaEnv} onChange={(e) => setSettings({ ...settings, zengaEnv: e.target.value as PaySettings["zengaEnv"] })}>
                <option value="sandbox">Sandbox · api.sandbox.zengapay.com</option>
                <option value="production">Production · api.zengapay.com</option>
              </select>
              <label className="mt-5 block text-xs font-extrabold uppercase tracking-widest">API token</label>
              <input className="field mt-2" type="password" placeholder="Settings → Developer Settings" value={settings.zengaToken} onChange={(e) => setSettings({ ...settings, zengaToken: e.target.value })} />
              <label className="mt-5 flex items-center gap-3 text-sm">
                <input type="checkbox" checked={settings.simulate} onChange={(e) => setSettings({ ...settings, simulate: e.target.checked })} />
                Use sandbox simulator (no live debit)
              </label>
              <button className="btn btn-gold mt-6">Save ZengaPay</button>
              <p className="mt-4 text-xs text-black/40">dashboard.sandbox.zengapay.com · developers.zengapay.com</p>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
