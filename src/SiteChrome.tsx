import { AnimatePresence, motion } from "framer-motion";
import { Menu, MessageCircle, Ticket, X } from "lucide-react";
import { useState } from "react";
import { Logo } from "./components";
import { CONTACT_PHONE, LOGO_REMOTE_URL, LOGO_URL } from "./lib/config";
import type { Session } from "./lib/types";

export const WA = `https://wa.me/${CONTACT_PHONE}`;

export function sellHref(session: Session | null) {
  return session ? "#/dashboard/new" : "#/register/sell";
}

export function SiteHeader({ session, overlay = false }: { session: Session | null; overlay?: boolean }) {
  const [open, setOpen] = useState(false);
  const accountHref = session ? (session.role === "admin" ? "#/admin" : "#/dashboard") : "#/login";
  const links: [string, string][] = [
    ["Events", "#/"],
    ["Sell tickets", sellHref(session)],
    ["My tickets", "#/dashboard"],
    ["Manuals", "#/guides"],
  ];

  return (
    <header className={`${overlay ? "absolute inset-x-0 top-0" : "sticky top-0 bg-[#0c0c0b]"} z-30 text-white`}>
      <div className="shell flex h-[4.75rem] items-center justify-between gap-3">
        <Logo light />
        <nav className="hidden items-center gap-8 lg:flex">
          {links.map(([l, h]) => <a key={l} className="nav-link" href={h}>{l}</a>)}
        </nav>
        <div className="flex items-center gap-3">
          <a href={accountHref} className="hidden text-[11px] font-extrabold uppercase tracking-[0.16em] sm:block">{session ? session.name.split(" ")[0] : "Sign in"}</a>
          <a href="#/#events" className="btn btn-gold hidden min-h-0! py-2.5 md:inline-flex"><Ticket size={15} /> Get tickets</a>
          <button className="grid h-10 w-10 place-items-center lg:hidden" onClick={() => setOpen((v) => !v)} aria-label="Menu">{open ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-5 border-t border-white/15 bg-[#0c0c0b] p-7 text-2xl font-extrabold uppercase lg:hidden">
            {[...links, [session ? "My account" : "Sign in", accountHref] as [string, string]].map(([l, h]) => (
              <a key={l} href={h} onClick={() => setOpen(false)}>{l}</a>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

export function SiteFooter({ session }: { session: Session | null }) {
  return (
    <footer className="bg-[#0c0c0b] py-12 text-[#efe8d8]">
      <div className="shell flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
        <div>
          <img
            src={LOGO_URL}
            alt="TANK Promotions Co. Ltd. Kila Sekunde Ina Hesabu"
            className="w-36 border border-[#c9a227]/40"
            onError={(e) => {
              const img = e.currentTarget;
              if (img.src !== LOGO_REMOTE_URL) img.src = LOGO_REMOTE_URL;
              else img.style.display = "none";
            }}
          />
          <p className="mt-4 max-w-sm text-sm text-white/45">TANK Tickets is run by TANK Promotions Co. Ltd, Kampala. Pay by MTN or Airtel merchant code; your ticket is confirmed from the payment SMS.</p>
        </div>
        <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-xs font-bold uppercase tracking-widest text-white/55">
          <a href="#/">Find events</a>
          <a href={sellHref(session)}>Sell tickets</a>
          <a href="#/dashboard">My tickets</a>
          <a href="#/guides">Manuals</a>
          <a href={WA} target="_blank" rel="noreferrer">Help on WhatsApp</a>
          <a href="https://tankpromotions.online" target="_blank" rel="noreferrer">TANK Promotions</a>
          <span className="text-white/30">© {new Date().getFullYear()}</span>
        </div>
      </div>
    </footer>
  );
}

export function WhatsAppFab() {
  return <a href={WA} className="wa-fab" target="_blank" rel="noreferrer" aria-label="Get help on WhatsApp"><MessageCircle size={24} /></a>;
}
