import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Minus,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Ticket,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Admin from "./Admin";
import { AuthScreen } from "./Auth";
import { getSession, logout } from "./lib/auth";
import { ugx } from "./lib/format";
import { db, seedStore } from "./lib/store";
import type { Night, Order, Session } from "./lib/types";
import { approveSimulation, collectPayment, detectNetwork, failSimulation, getCollectionStatus, toMsisdn } from "./lib/zengapay";

const filters = ["All nights", "Nightlife", "Dining", "Live", "Activation"];
const WA = "https://wa.me/256775497509";

const work = [
  { tag: "Nightlife launch / Kampala Central", title: "From new room to weekend capacity.", stat: "86%", label: "Target attendance reached", extra: "3.4h sustained peak energy", image: "event-amapiano.jpg" },
  { tag: "Restaurant opening / Bugolobi", title: "A first night people talked about.", stat: "2.1×", label: "Second-week booking lift", extra: "41 organic guest posts tracked", image: "event-restaurant.jpg" },
  { tag: "Brand pop-up / Kololo", title: "Visibility with evidence behind it.", stat: "73%", label: "Guest activation rate", extra: "48h report turnaround", image: "work-activation.jpg" },
];

const services = [
  { n: "01", title: "Audience Mobilization", copy: "We identify the audience your night needs, map the right community channels and run a coordinated invitation campaign." },
  { n: "02", title: "On-Ground Coordination", copy: "We work alongside your venue team on event day, keeping hosts, promoters, guests and brand partners aligned." },
  { n: "03", title: "Launch & Recurring Nights", copy: "We build launch momentum, then turn one successful night into a reliable weekly or monthly property." },
  { n: "04", title: "Brand Activations", copy: "We connect sponsor objectives to a live experience people can actually participate in — with evidence to review." },
];

function Logo({ light = false }: { light?: boolean }) {
  return (
    <a href="#/" className={`flex items-center gap-3 ${light ? "text-white" : "text-ink"}`} aria-label="TANK Promotions home">
      <span className="mark"><img src="logo.jpg" alt="TANK Promotions logo" /></span>
      <span className="wordmark">TANK PROMOTIONS</span>
    </a>
  );
}

function useRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.startsWith("#/") ? hash.slice(1) : "/";
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const route = useRoute();

  useEffect(() => {
    seedStore().then(() => {
      setSession(getSession());
      setReady(true);
    });
  }, [route]);

  if (!ready) {
    return <div className="grid min-h-screen place-items-center bg-[#0c0c0b] text-[#c9a227]"><span className="wordmark">TANK</span></div>;
  }

  if (route === "/login") return <AuthScreen mode="login" />;
  if (route === "/register") return <AuthScreen mode="register" />;
  if (route === "/admin") {
    if (!session) return <AuthScreen mode="login" />;
    if (session.role !== "admin") return <Account session={session} />;
    return <Admin session={session} />;
  }
  if (route === "/account") {
    if (!session) return <AuthScreen mode="login" />;
    return <Account session={session} />;
  }
  return <PublicSite session={session} />;
}

function Account({ session }: { session: Session }) {
  const mine = db.orders().filter((o) => o.email === session.email);
  return (
    <main className="min-h-screen bg-[#efe8d8]">
      <header className="border-b border-black/10 bg-[#0c0c0b] py-5 text-white">
        <div className="shell flex items-center justify-between">
          <Logo light />
          <div className="flex items-center gap-4 text-xs uppercase tracking-widest">
            {session.role === "admin" && <a href="#/admin">Admin</a>}
            <button onClick={() => { logout(); window.location.hash = "/"; }} className="inline-flex items-center gap-1"><LogOut size={14} /> Out</button>
          </div>
        </div>
      </header>
      <section className="shell py-16">
        <p className="eyebrow">Guest passbook</p>
        <h1 className="display mt-2 text-5xl">Hello, {session.name.split(" ")[0]}.</h1>
        <div className="mt-10 grid gap-4">
          {mine.map((o) => (
            <article key={o.id} className="flex flex-wrap items-center justify-between gap-4 border border-black/12 p-5">
              <div>
                <p className="font-extrabold">{o.nightTitle}</p>
                <p className="text-sm text-black/50">{o.qty} guest(s) · {ugx(o.amount)} · {o.status}</p>
              </div>
              <p className="ticket-code text-[#c9a227]">{o.code}</p>
            </article>
          ))}
          {mine.length === 0 && <p className="text-black/50">No tickets yet. <a href="#/" className="text-[#c9a227]">Browse nights</a></p>}
        </div>
      </section>
    </main>
  );
}

function PublicSite({ session }: { session: Session | null }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All nights");
  const [nights, setNights] = useState(db.nights());
  const [selected, setSelected] = useState<Night | null>(null);
  const [qty, setQty] = useState(1);
  const [step, setStep] = useState(1);
  const [name, setName] = useState(session?.name || "");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [briefSent, setBriefSent] = useState(false);
  const [phase, setPhase] = useState(1);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const [zengaRef, setZengaRef] = useState("");
  const [simulated, setSimulated] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => { setNights(db.nights()); }, []);

  const list = useMemo(() => nights.filter((n) => {
    const cat = filter === "All nights" || n.type === filter;
    const q = `${n.title} ${n.type} ${n.area} ${n.venue}`.toLowerCase().includes(query.toLowerCase());
    return cat && q;
  }), [nights, filter, query]);

  const openNight = (n: Night) => {
    setSelected(n);
    setQty(1);
    setStep(1);
    setName(session?.name || "");
    setPhone("");
    setCode("");
    setPayError("");
    setZengaRef("");
    setOrder(null);
  };

  const persistOrder = (row: Order) => {
    db.saveOrders([row, ...db.orders()]);
    setOrder(row);
    if (row.status === "SUCCEEDED") {
      db.saveNights(db.nights().map((n) => n.id === row.nightId ? { ...n, spots: Math.max(0, n.spots - row.qty) } : n));
      setNights(db.nights());
    }
  };

  const pay = async () => {
    if (!selected) return;
    setPaying(true);
    setPayError("");
    const msisdn = toMsisdn(phone);
    const ext = `TNK${Date.now()}`;
    const amount = selected.price * qty;
    const result = await collectPayment({
      msisdn,
      amount,
      external_reference: ext,
      narration: `TANK ${selected.title} x${qty}`,
    });
    setPaying(false);
    if (!result.ok) {
      setPayError(result.message);
      return;
    }
    const pass = `TNK-${selected.day}${selected.month.slice(0, 1)}-${ext.slice(-4)}`;
    const draft: Order = {
      id: db.uid(),
      code: pass,
      nightId: selected.id,
      nightTitle: selected.title,
      name,
      phone: msisdn,
      email: session?.email,
      qty,
      amount,
      network: detectNetwork(msisdn),
      status: "PENDING",
      zengaRef: result.transactionReference,
      externalRef: ext,
      createdAt: new Date().toISOString(),
    };
    persistOrder(draft);
    setCode(pass);
    setZengaRef(result.transactionReference);
    setSimulated(result.simulated);
    setStep(4);
  };

  useEffect(() => {
    if (step !== 4 || !zengaRef || !order) return;
    const timer = window.setInterval(async () => {
      const status = await getCollectionStatus(zengaRef);
      if (status === "SUCCEEDED") {
        const next = { ...order, status: "SUCCEEDED" as const };
        db.saveOrders(db.orders().map((o) => (o.id === order.id ? next : o)));
        db.saveNights(db.nights().map((n) => n.id === next.nightId ? { ...n, spots: Math.max(0, n.spots - next.qty) } : n));
        setNights(db.nights());
        setOrder(next);
        setStep(3);
      }
      if (status === "FAILED") {
        const next = { ...order, status: "FAILED" as const };
        db.saveOrders(db.orders().map((o) => (o.id === order.id ? next : o)));
        setPayError("Payment was declined or timed out.");
        setStep(2);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [step, zengaRef, order]);

  const submitBrief = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    db.saveBriefs([{
      id: db.uid(),
      venue: String(form.get("venue")),
      area: String(form.get("area")),
      date: String(form.get("date")),
      type: String(form.get("type")),
      phone: String(form.get("phone")),
      note: String(form.get("note")),
      createdAt: new Date().toISOString(),
      status: "New",
    }, ...db.briefs()]);
    setBriefSent(true);
  };

  return (
    <main id="top" className="min-h-screen bg-[#efe8d8] text-[#0c0c0b]">
      <header className="absolute inset-x-0 top-0 z-30">
        <div className="shell flex h-[5.25rem] items-center justify-between text-white">
          <div className="flex items-center gap-4">
            <Logo light />
            <a href={session?.role === "admin" ? "#/admin" : "#/login"} className="btn btn-line-light hidden h-9 items-center px-3 text-[10px] sm:inline-flex">Admin portal</a>
          </div>
          <nav className="hidden items-center gap-8 lg:flex">
            <a className="nav-link" href="#nights">Nights</a>
            <a className="nav-link" href="#work">Work</a>
            <a className="nav-link" href="#system">System</a>
            <a className="nav-link" href="#venues">For venues</a>
          </nav>
          <div className="flex items-center gap-2">
            <button className="grid h-10 w-10 place-items-center" onClick={() => setSearchOpen((v) => !v)} aria-label="Search nights"><Search size={18} /></button>
            <a href={session ? (session.role === "admin" ? "#/admin" : "#/account") : "#/login"} className="hidden text-[11px] font-extrabold uppercase tracking-[0.16em] sm:block">{session ? session.name.split(" ")[0] : "Sign in"}</a>
            <button className="grid h-10 w-10 place-items-center lg:hidden" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
            <a href="#nights" className="btn btn-gold hidden sm:inline-flex">Get tickets</a>
          </div>
        </div>
        <AnimatePresence>
          {searchOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 68, opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-white/15 bg-black/90">
              <div className="shell flex h-[68px] items-center gap-3 text-white">
                <Search size={16} className="text-[#c9a227]" />
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search nights, areas, rooms…" className="w-full bg-transparent text-sm outline-none placeholder:text-white/40" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {menuOpen && (
            <motion.nav initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-5 border-t border-white/15 bg-[#0c0c0b] p-7 text-2xl font-extrabold uppercase text-white lg:hidden">
              {[["Nights", "#nights"], ["Work", "#work"], ["System", "#system"], ["For venues", "#venues"], [session ? "Account" : "Sign in", session ? "#/account" : "#/login"]].map(([l, h]) => (
                <a key={l} href={h} onClick={() => setMenuOpen(false)}>{l}</a>
              ))}
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      <section className="hero relative flex min-h-[92vh] items-end overflow-hidden text-white">
        <motion.div initial={{ scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 1.5, ease: [0.2, 0.7, 0.2, 1] }} className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/hero.jpg')" }} />
        <div className="hero-overlay absolute inset-0" />
        <div className="shell relative z-10 pb-14 pt-36 md:pb-20">
          <p className="eyebrow mb-5">Event & audience marketing — Kampala</p>
          <h1 className="display max-w-5xl text-[18vw] sm:text-[12vw] lg:text-[8.6rem]">
            We fill venues.<br />On purpose,<br /><span className="text-[#c9a227]">on schedule.</span>
          </h1>
          <p className="mt-7 max-w-xl text-sm leading-7 text-white/70 md:text-base">
            TANK Promotions Co. Ltd plans, mobilizes and runs audience-building campaigns for bars, restaurants and event rooms across Kampala — then reports the results, every time.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a href="#nights" className="btn btn-gold">Get tickets <ArrowRight size={16} /></a>
            <a href="#venues" className="btn btn-line-light">Book a campaign</a>
          </div>
        </div>
      </section>

      <div className="ticker">
        <div className="ticker-track">
          {Array.from({ length: 2 }).map((_, i) => (
            <span key={i} className="flex gap-10">
              <span>Kila Sekunde Ina Hesabu</span><span>Every Second Counts</span><span>ZengaPay collections</span><span>Kampala</span><span>TBC-002-26-EVT</span>
            </span>
          ))}
        </div>
      </div>

      <section id="nights" className="py-24 md:py-32">
        <div className="shell">
          <div className="mb-10 flex flex-col justify-between gap-6 border-b border-black/15 pb-8 md:flex-row md:items-end">
            <div>
              <p className="eyebrow mb-3">On the list</p>
              <h2 className="display text-6xl md:text-8xl">Upcoming nights</h2>
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {filters.map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`btn shrink-0 px-4 ${filter === f ? "btn-dark" : "btn-line"}`}>{f}</button>
              ))}
            </div>
          </div>
          {list.map((n, i) => (
            <motion.article key={n.id} initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }} className="event-card group">
              <div>
                <p className="display text-5xl leading-none">{n.day}</p>
                <p className="mt-1 text-[11px] font-extrabold tracking-[0.22em] text-[#c9a227]">{n.month}</p>
              </div>
              <div className="hidden h-28 overflow-hidden md:block">
                <img src={n.image} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.2em] text-black/45">{n.type} · {n.area}</p>
                <h3 className="display text-3xl md:text-4xl">{n.title}</h3>
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-black/55">
                  <span className="inline-flex items-center gap-1"><MapPin size={13} /> {n.venue}</span>
                  <span className="inline-flex items-center gap-1"><Clock3 size={13} /> {n.time}</span>
                </p>
              </div>
              <button onClick={() => openNight(n)} className="btn btn-dark w-full md:w-auto">{ugx(n.price)} <Ticket size={16} /></button>
            </motion.article>
          ))}
        </div>
      </section>

      <section id="work" className="bg-[#0c0c0b] py-24 text-[#efe8d8] md:py-32">
        <div className="shell">
          <p className="eyebrow mb-3">Our work</p>
          <h2 className="display mb-4 max-w-4xl text-5xl md:text-8xl">Proof lives in the room.</h2>
          <div className="mt-14 grid gap-8 lg:grid-cols-3">
            {work.map((w) => (
              <article key={w.tag} className="border border-white/10">
                <img src={w.image} alt="" className="h-52 w-full object-cover" />
                <div className="p-6">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#c9a227]">{w.tag}</p>
                  <h3 className="display mt-3 text-3xl">{w.title}</h3>
                  <p className="mt-6 display text-5xl text-[#c9a227]">{w.stat}</p>
                  <p className="mt-1 text-sm text-white/55">{w.label}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="system" className="py-24 md:py-32">
        <div className="shell grid gap-14 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="eyebrow mb-3">TBC-002-26-EVT</p>
            <h2 className="display text-5xl md:text-7xl">Three phases. One accountable night.</h2>
            <div className="mt-10 grid grid-cols-2 gap-4">
              {services.map((s) => (
                <div key={s.n} className="border border-black/12 p-5">
                  <p className="text-[11px] font-extrabold tracking-[0.2em] text-[#c9a227]">SERVICE / {s.n}</p>
                  <h3 className="mt-3 font-extrabold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-black/55">{s.copy}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            {[
              { id: 1, t: "TBC-1 Mobilize", d: "Before doors open, we define who the night is for and track invitations against the target." },
              { id: 2, t: "TBC-2 Coordinate", d: "During the event, our team works the room — arrivals, hosts and energy." },
              { id: 3, t: "TBC-3 Report", d: "Within 48 hours you receive a debrief with evidence and next-night recommendations." },
            ].map((p) => (
              <button key={p.id} onClick={() => setPhase(p.id)} className={`block w-full border p-6 text-left ${phase === p.id ? "border-[#c9a227] bg-[#0c0c0b] text-[#efe8d8]" : "border-black/12"}`}>
                <p className="display text-3xl">{p.t}</p>
                {phase === p.id && <p className="mt-4 max-w-lg text-sm leading-7 text-white/65">{p.d}</p>}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section id="venues" className="py-24 md:py-32">
        <div className="shell grid gap-12 lg:grid-cols-2">
          <div>
            <p className="eyebrow mb-3">Let’s talk</p>
            <h2 className="display text-5xl md:text-7xl">Tell us your next night.</h2>
            <div className="mt-8 space-y-4 text-sm">
              <p className="flex items-center gap-3"><Phone size={16} /> +256 775 497 509</p>
              <p className="flex items-center gap-3"><MapPin size={16} /> Kampala, Uganda</p>
              <a href={WA} className="btn btn-gold mt-4 w-fit"><MessageCircle size={16} /> WhatsApp TANK</a>
            </div>
          </div>
          {briefSent ? (
            <div className="flex flex-col justify-center border border-black/12 p-10">
              <span className="mb-5 grid h-12 w-12 place-items-center rounded-full bg-[#c9a227]"><Check /></span>
              <h3 className="display text-4xl">Brief received.</h3>
            </div>
          ) : (
            <form className="grid gap-3" onSubmit={submitBrief}>
              <input required name="venue" className="field" placeholder="Venue / brand name" />
              <div className="grid gap-3 sm:grid-cols-2">
                <input required name="area" className="field" placeholder="Area" />
                <input required name="date" type="date" className="field" />
              </div>
              <select name="type" className="field" defaultValue="Nightlife launch">
                <option>Nightlife launch</option><option>Restaurant opening</option><option>Weekly residency</option><option>Brand activation</option>
              </select>
              <input required name="phone" className="field" placeholder="Phone or WhatsApp" />
              <textarea required name="note" rows={4} className="field" placeholder="What does packed look like for you?" />
              <button className="btn btn-dark">Send campaign brief <ArrowRight size={16} /></button>
            </form>
          )}
        </div>
      </section>

      <section className="bg-[#0c0c0b] py-24 text-center text-[#efe8d8]">
        <div className="shell">
          <img src="logo.jpg" alt="TANK Promotions Co. Ltd logo" className="mx-auto w-full max-w-[360px]" />
          <h2 className="display mx-auto mt-10 text-5xl md:text-7xl">Our logo is more than a logo</h2>
          <p className="mt-8 text-xl font-extrabold uppercase tracking-[0.18em] text-[#c9a227]">Kila Sekunde Ina Hesabu</p>
        </div>
      </section>

      <footer className="bg-[#0c0c0b] py-12 text-[#efe8d8]">
        <div className="shell flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div>
            <Logo light />
            <p className="mt-4 max-w-sm text-sm text-white/40">TANK Promotions Co. Ltd, Kampala. Payments by ZengaPay.</p>
          </div>
          <div className="text-xs uppercase tracking-widest text-white/40">
            <a href="#/login">Staff login</a>
            <p className="mt-2">© 2026 TANK Promotions</p>
          </div>
        </div>
      </footer>

      <a href={WA} className="wa-fab" target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp"><MessageCircle size={24} /></a>

      <AnimatePresence>
        {selected && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setSelected(null)}>
            <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onMouseDown={(e) => e.stopPropagation()} className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto bg-[#efe8d8] p-6 sm:p-9">
              <button onClick={() => setSelected(null)} className="absolute right-4 top-4 p-2" aria-label="Close"><X size={18} /></button>
              {step === 3 ? (
                <div>
                  <p className="eyebrow">Ticket confirmed</p>
                  <h3 className="display mt-2 text-5xl">You’re on the door.</h3>
                  <img src="logo.jpg" alt="" className="mt-6 h-28 w-28 object-cover" />
                  <div className="mt-8 flex items-start justify-between border border-black/15 p-5">
                    <div>
                      <p className="font-extrabold">{selected.title}</p>
                      <p className="mt-1 text-sm text-black/55">{selected.date} · {qty} guest(s)</p>
                      <p className="ticket-code mt-4 text-[#c9a227]">{code}</p>
                    </div>
                    <div className="qr-block" />
                  </div>
                  <p className="mt-4 text-sm text-black/50">Paid with ZengaPay. Show this code at the door.</p>
                  <button onClick={() => setSelected(null)} className="btn btn-dark mt-6 w-full">Done</button>
                </div>
              ) : (
                <>
                  <img src={selected.image} alt="" className="h-44 w-full object-cover" />
                  <p className="eyebrow mt-6">Tickets</p>
                  <h3 className="display mt-2 pr-8 text-4xl">{selected.title}</h3>
                  <p className="mt-3 flex flex-wrap gap-4 text-sm text-black/55">
                    <span className="inline-flex items-center gap-1"><CalendarDays size={14} /> {selected.date}</span>
                    <span className="inline-flex items-center gap-1"><Users size={14} /> {selected.spots} spots left</span>
                  </p>
                  {step === 1 && (
                    <>
                      <div className="my-7 flex items-center justify-between border-y border-black/12 py-5">
                        <div>
                          <p className="font-extrabold">General admission</p>
                          <p className="mt-1 text-sm text-black/45">{ugx(selected.price)}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease"><Minus size={16} /></button>
                          <b>{qty}</b>
                          <button onClick={() => setQty(Math.min(6, qty + 1))} aria-label="Increase"><Plus size={16} /></button>
                        </div>
                      </div>
                      <button onClick={() => setStep(2)} className="btn btn-dark w-full">Continue · {ugx(selected.price * qty)}</button>
                    </>
                  )}
                  {step === 2 && (
                    <div className="mt-7 grid gap-3">
                      <input className="field" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
                      <input className="field" placeholder="MTN or Airtel number" value={phone} onChange={(e) => setPhone(e.target.value)} />
                      {phone && <p className="text-xs uppercase tracking-widest text-black/45">Network · {detectNetwork(phone)} · ZengaPay collection</p>}
                      {payError && <p className="text-sm text-red-700">{payError}</p>}
                      <button disabled={!name || !phone || paying} onClick={pay} className="btn btn-gold w-full disabled:opacity-50">
                        {paying ? "Requesting…" : `Pay ${ugx(selected.price * qty)}`} <ShieldCheck size={16} />
                      </button>
                    </div>
                  )}
                  {step === 4 && (
                    <div className="mt-8">
                      <p className="eyebrow">ZengaPay</p>
                      <h3 className="display mt-2 text-4xl">Approve on your phone</h3>
                      <p className="mt-4 text-sm text-black/55">A collection of {ugx(selected.price * qty)} was sent to {toMsisdn(phone)}. Enter your Mobile Money PIN.</p>
                      {simulated && (
                        <div className="mt-6 flex gap-2">
                          <button className="btn btn-gold" onClick={() => approveSimulation(zengaRef)}>I approved the PIN</button>
                          <button className="btn btn-line" onClick={() => failSimulation(zengaRef)}>Decline</button>
                        </div>
                      )}
                      <p className="mt-4 text-xs text-black/40">Ref {zengaRef}</p>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
