import { motion } from "framer-motion";
import { ArrowRight, CalendarDays, MapPin, Plus, QrCode, Search, Smartphone, Ticket, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Notice, Poster, Spinner } from "./components";
import { api } from "./lib/api";
import { DATE_FILTERS, dateParts, matchesDate, ugx, type DateFilter } from "./lib/format";
import type { Session, TankEvent } from "./lib/types";
import { SiteFooter, SiteHeader, WA, WhatsAppFab, sellHref } from "./SiteChrome";

export function EventCard({ event, index = 0 }: { event: TankEvent; index?: number }) {
  const d = dateParts(event.startsAt);
  const left = event.capacity - event.sold;
  return (
    <motion.a
      href={`#/e/${event.id}`}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: Math.min(index, 8) * 0.04 }}
      className="ev-card group"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-black">
        <Poster event={event} className="h-full w-full transition duration-500 group-hover:scale-[1.04]" />
        <div className="date-badge">
          <span className="display text-3xl leading-none">{d.day}</span>
          <span className="text-[10px] font-extrabold tracking-[0.2em]">{d.month}</span>
        </div>
        {left <= 0 ? <span className="flag flag-out">Sold out</span> : left <= 20 && <span className="flag">Only {left} left</span>}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-black/45">{event.type}</p>
        <h3 className="display mt-1 line-clamp-2 text-3xl">{event.title}</h3>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-black/55"><MapPin size={13} className="shrink-0" /> <span className="truncate">{event.venue}{event.area ? `, ${event.area}` : ""}</span></p>
        <p className="flex items-center gap-1.5 text-sm text-black/55"><CalendarDays size={13} className="shrink-0" /> {d.full.split(",")[0]}, {d.time}</p>
        <div className="mt-auto flex items-center justify-between pt-4">
          <span className="font-extrabold">{event.price === 0 ? "Free" : `From ${ugx(event.price)}`}</span>
          <span className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-widest text-[#a8841a]">{left <= 0 ? "View" : "Tickets"} <ArrowRight size={14} /></span>
        </div>
      </div>
    </motion.a>
  );
}

export default function Home({ session }: { session: Session | null }) {
  const [events, setEvents] = useState<TankEvent[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All");
  const [when, setWhen] = useState<DateFilter>("any");

  const load = useCallback(async () => {
    try {
      setEvents(await api.listEvents("public", session));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load events.");
      setEvents([]);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (events && window.location.hash === "#/#events") {
      document.getElementById("events")?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events]);

  const types = useMemo(() => ["All", ...Array.from(new Set((events || []).map((e) => e.type))).sort()], [events]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (events || []).filter(
      (e) =>
        (type === "All" || e.type === type) &&
        matchesDate(e.startsAt, when) &&
        (!q || `${e.title} ${e.type} ${e.venue} ${e.area} ${e.organizerName}`.toLowerCase().includes(q)),
    );
  }, [events, type, when, query]);
  const filtering = query || type !== "All" || when !== "any";
  const clear = () => {
    setQuery("");
    setType("All");
    setWhen("any");
  };

  return (
    <main className="min-h-screen bg-[#efe8d8] text-[#0c0c0b]">
      <SiteHeader session={session} overlay />

      <section className="hero relative overflow-hidden text-white">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('./hero.jpg')" }} />
        <div className="hero-overlay absolute inset-0" />
        <div className="shell relative z-10 pb-10 pt-32 md:pb-14 md:pt-40">
          <p className="eyebrow mb-4">TANK Tickets · Kampala</p>
          <h1 className="display max-w-4xl text-[15vw] sm:text-[10vw] lg:text-[7.2rem]">Your ticket to<br /><span className="text-[#c9a227]">the night.</span></h1>
          <p className="mt-5 max-w-lg text-sm leading-7 text-white/70 md:text-base">Find events, pay with MTN or Airtel Mobile Money, and get a QR ticket by email and WhatsApp in seconds.</p>
          <form onSubmit={(e) => { e.preventDefault(); document.getElementById("events")?.scrollIntoView({ behavior: "smooth" }); }} className="search-bar mt-8">
            <Search size={18} className="shrink-0 text-[#c9a227]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events or venues" aria-label="Search events" />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-white/60"><X size={16} /></button>}
            <button className="btn btn-gold min-h-0! px-5 py-3">Search</button>
          </form>
        </div>
      </section>

      <section id="events" className="scroll-mt-4 py-12 md:py-16">
        <div className="shell">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="eyebrow mb-2">On sale now</p>
              <h2 className="display text-5xl md:text-7xl">{filtering ? `${list.length} event${list.length === 1 ? "" : "s"} found` : "Upcoming events"}</h2>
            </div>
            <a href={sellHref(session)} className="btn btn-line w-fit"><Plus size={16} /> Sell tickets</a>
          </div>

          <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
            {DATE_FILTERS.map(([k, l]) => (
              <button key={k} onClick={() => setWhen(k)} className={`chip ${when === k ? "chip-on" : ""}`}>{l}</button>
            ))}
          </div>
          {types.length > 2 && (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {types.map((t) => (
                <button key={t} onClick={() => setType(t)} className={`chip ${type === t ? "chip-on" : ""}`}>{t === "All" ? "All categories" : t}</button>
              ))}
            </div>
          )}

          <div className="mt-8">
            {events === null ? <Spinner label="Loading events…" /> : (
              <>
                {error && <div className="mb-6"><Notice tone="error">{error}</Notice></div>}
                {list.length > 0 && (
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map((e, i) => <EventCard key={e.id} event={e} index={i} />)}
                  </div>
                )}
                {list.length === 0 && !error && (
                  <div className="border border-dashed border-black/25 px-6 py-14 text-center">
                    <Ticket className="mx-auto text-[#a8841a]" size={32} />
                    <p className="display mt-4 text-4xl">{events.length ? "No events match." : "No events on sale yet."}</p>
                    <p className="mx-auto mt-3 max-w-md text-sm text-black/55">
                      {events.length ? "Try another date, category or search word." : "New events are added all the time. Organizing one? List it and start selling tickets today."}
                    </p>
                    {events.length ? (
                      <button onClick={clear} className="btn btn-dark mt-6">Clear filters</button>
                    ) : (
                      <a href={sellHref(session)} className="btn btn-gold mt-6"><Plus size={16} /> List your event</a>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 py-14 md:py-20">
        <div className="shell">
          <p className="eyebrow mb-2">How it works</p>
          <h2 className="display text-4xl md:text-6xl">Ticket in three steps.</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              [Ticket, "Pick your event", "Choose an event and how many tickets you need."],
              [Smartphone, "Pay with Mobile Money", "Approve the MTN or Airtel prompt with your PIN. Free events need no payment."],
              [QrCode, "Show your QR at the door", "Your ticket arrives by email and WhatsApp, and is saved in My tickets."],
            ].map(([Icon, t, d], i) => {
              const I = Icon as typeof Ticket;
              return (
                <div key={t as string} className="border border-black/12 p-6">
                  <div className="flex items-center gap-3"><span className="display text-3xl text-[#a8841a]">0{i + 1}</span><I size={20} /></div>
                  <h3 className="mt-3 font-extrabold">{t as string}</h3>
                  <p className="mt-1 text-sm leading-6 text-black/55">{d as string}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-6 text-sm text-black/55">
            Lost your ticket? Open the link in your email or WhatsApp, or <a href="#/dashboard" className="font-bold text-[#a8841a] underline">sign in</a> with the email you used to buy it. Still stuck? <a href={WA} target="_blank" rel="noreferrer" className="font-bold text-[#a8841a] underline">WhatsApp us</a>.
          </p>
        </div>
      </section>

      <section className="bg-[#0c0c0b] py-14 text-[#efe8d8] md:py-20">
        <div className="shell grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <p className="eyebrow mb-2">For organizers</p>
            <h2 className="display text-4xl md:text-6xl">Sell tickets for your event.</h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-white/60">
              List your event for free. Once TANK approves it, share your event link and sell with Mobile Money. Every buyer gets a QR ticket, you see sales live, and you scan guests in at the door with your phone.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href={sellHref(session)} className="btn btn-gold">Start selling <ArrowRight size={16} /></a>
              <a href={WA} target="_blank" rel="noreferrer" className="btn btn-line-light">Need promotion too?</a>
            </div>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {["Free to list your event", "MTN & Airtel Mobile Money", "QR tickets by email & WhatsApp", "Live sales and guest list", "Phone-camera door check-in", "Audience campaigns by TANK"].map((t) => (
              <li key={t} className="border border-white/10 px-4 py-3 text-sm font-bold">✓ {t}</li>
            ))}
          </ul>
        </div>
      </section>

      <SiteFooter session={session} />
      <WhatsAppFab />
    </main>
  );
}
