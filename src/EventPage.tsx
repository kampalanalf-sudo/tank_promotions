import { AnimatePresence } from "framer-motion";
import { ArrowLeft, CalendarDays, CalendarPlus, Check, Clock3, MapPin, MessageCircle, Share2, Ticket, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Checkout } from "./Checkout";
import { Notice, Poster, Spinner } from "./components";
import { EventStatusPill, eventLink } from "./Dashboard";
import { EventCard } from "./Home";
import { api } from "./lib/api";
import { calendarLink, dateParts, mapsLink, ugx } from "./lib/format";
import type { Session, Settings, TankEvent } from "./lib/types";
import { toMsisdn } from "./lib/zengapay";
import { SiteFooter, SiteHeader, WhatsAppFab } from "./SiteChrome";

export default function EventPage({ id, session, settings }: { id: string; session: Session | null; settings: Settings | null }) {
  const [event, setEvent] = useState<TankEvent | null | undefined>(undefined);
  const [more, setMore] = useState<TankEvent[]>([]);
  const [buying, setBuying] = useState(false);
  const [shared, setShared] = useState(false);

  const load = useCallback(async () => {
    const [ev, list] = await Promise.all([api.getEvent(id, session).catch(() => null), api.listEvents("public", session).catch(() => [])]);
    setEvent(ev);
    setMore(list.filter((e) => e.id !== id).slice(0, 3));
  }, [id, session]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (event) document.title = `${event.title} · TANK Tickets`;
    return () => {
      document.title = "TANK Tickets · Events & tickets in Kampala";
    };
  }, [event]);

  const share = async () => {
    if (!event) return;
    const url = eventLink(event.id);
    try {
      if (navigator.share) await navigator.share({ title: event.title, text: `Tickets for ${event.title}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch {
      /* share dismissed */
    }
  };

  if (event === undefined) {
    return (
      <main className="min-h-screen bg-[#efe8d8]">
        <SiteHeader session={session} />
        <Spinner label="Loading event…" />
      </main>
    );
  }

  if (event === null) {
    return (
      <main className="min-h-screen bg-[#efe8d8]">
        <SiteHeader session={session} />
        <div className="shell py-20 text-center">
          <p className="display text-5xl">Event not found.</p>
          <p className="mx-auto mt-3 max-w-md text-sm text-black/55">This event may have ended, been removed, or not be live yet. Check the link with the organizer.</p>
          <a href="#/" className="btn btn-dark mt-6">See all events</a>
        </div>
      </main>
    );
  }

  const d = dateParts(event.startsAt);
  const left = Math.max(0, event.capacity - event.sold);
  const ended = new Date(event.startsAt).getTime() < Date.now() - 12 * 3600e3;
  const live = event.status === "published";
  const canBuy = live && !ended && left > 0;
  const soldPct = Math.min(100, Math.round((event.sold / event.capacity) * 100));
  const isOwner = session && (session.userId === event.ownerId || session.role === "admin");
  const buyLabel = !live ? "Not on sale yet" : ended ? "Event ended" : left === 0 ? "Sold out" : event.price === 0 ? "Get free tickets" : "Get tickets";

  return (
    <main className="min-h-screen bg-[#efe8d8] pb-24 text-[#0c0c0b] lg:pb-0">
      <SiteHeader session={session} />

      <div className="shell pt-6">
        <a href="#/" className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-black/55"><ArrowLeft size={14} /> All events</a>
        {isOwner && !live && (
          <div className="mt-4"><Notice tone="warn"><EventStatusPill status={event.status} /> Only you can see this page. It goes live once TANK approves the event.</Notice></div>
        )}
      </div>

      <section className="shell grid gap-8 py-6 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:py-10">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Poster event={event} className={`w-full ${event.image ? "aspect-[4/5] lg:aspect-auto lg:max-h-[78vh]" : "aspect-[16/9] lg:aspect-[4/5]"}`} />
        </div>

        <div>
          <p className="eyebrow">{event.type}</p>
          <h1 className="display mt-2 text-5xl md:text-7xl">{event.title}</h1>

          <div className="mt-6 grid gap-3 text-sm">
            <p className="flex items-start gap-3"><CalendarDays size={18} className="mt-0.5 shrink-0 text-[#a8841a]" /><span><b>{d.full}</b><br /><span className="text-black/55">Starts {d.time}</span></span></p>
            <a href={mapsLink(event.venue, event.area)} target="_blank" rel="noreferrer" className="flex items-start gap-3"><MapPin size={18} className="mt-0.5 shrink-0 text-[#a8841a]" /><span><b>{event.venue}</b><br /><span className="text-black/55 underline">{event.area ? `${event.area} · ` : ""}Open in Google Maps</span></span></a>
          </div>

          <div className="buy-box mt-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-widest text-black/45">General admission</p>
                <p className="display mt-1 text-4xl">{ugx(event.price)}</p>
              </div>
              <p className="text-right text-sm text-black/55"><Users size={14} className="mr-1 inline" />{left === 0 ? "Sold out" : `${left} left`}</p>
            </div>
            <div className="mt-4 h-1.5 bg-black/10"><div className="h-full bg-[#c9a227]" style={{ width: `${soldPct}%` }} /></div>
            <button onClick={() => setBuying(true)} disabled={!canBuy} className="btn btn-gold mt-5 w-full text-sm disabled:opacity-45"><Ticket size={17} /> {buyLabel}</button>
            <p className="mt-3 text-center text-xs text-black/45">{event.price === 0 ? "Free entry · QR ticket by email & WhatsApp" : "Pay with MTN or Airtel Mobile Money · QR ticket by email & WhatsApp"}</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button onClick={share} className="btn btn-line">{shared ? <Check size={16} /> : <Share2 size={16} />} {shared ? "Link copied" : "Share"}</button>
            <a href={calendarLink(event)} target="_blank" rel="noreferrer" className="btn btn-line"><CalendarPlus size={16} /> Add to calendar</a>
          </div>

          {event.description && (
            <div className="mt-10">
              <h2 className="text-xs font-extrabold uppercase tracking-widest text-black/45">About this event</h2>
              <p className="mt-3 whitespace-pre-line text-[15px] leading-7 text-black/80">{event.description}</p>
            </div>
          )}

          <div className="mt-10 border-t border-black/10 pt-6">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-black/45">Organizer</h2>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="font-extrabold">{event.organizerName || "TANK Promotions"}</p>
              {event.organizerPhone && (
                <a href={`https://wa.me/${toMsisdn(event.organizerPhone)}?text=${encodeURIComponent(`Hi, I have a question about ${event.title}.`)}`} target="_blank" rel="noreferrer" className="btn-mini btn-mini-wa"><MessageCircle size={13} /> Ask the organizer</a>
              )}
            </div>
            <p className="mt-2 flex items-center gap-2 text-xs text-black/45"><Clock3 size={12} /> Tickets are checked by QR code at the entrance.</p>
          </div>
        </div>
      </section>

      {more.length > 0 && (
        <section className="border-t border-black/10 py-12">
          <div className="shell">
            <h2 className="display text-4xl">More events</h2>
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{more.map((e, i) => <EventCard key={e.id} event={e} index={i} />)}</div>
          </div>
        </section>
      )}

      <div className="mobile-buy lg:hidden">
        <div className="min-w-0">
          <p className="truncate text-xs text-white/60">{d.day} {d.month} · {event.venue}</p>
          <p className="font-extrabold">{ugx(event.price)}</p>
        </div>
        <button onClick={() => setBuying(true)} disabled={!canBuy} className="btn btn-gold min-h-0! py-3 disabled:opacity-45">{buyLabel}</button>
      </div>

      <SiteFooter session={session} />
      <div className="hidden lg:block"><WhatsAppFab /></div>

      <AnimatePresence>
        {buying && <Checkout event={event} session={session} settings={settings} onClose={() => setBuying(false)} onSold={() => void load()} />}
      </AnimatePresence>
    </main>
  );
}
