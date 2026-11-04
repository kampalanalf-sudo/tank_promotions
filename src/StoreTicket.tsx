import { useState } from "react";
import { Logo, Notice, TicketCard } from "./components";
import { SiteFooter, SiteHeader } from "./SiteChrome";
import { api } from "./lib/api";
import type { Session, Settings } from "./lib/types";
import type { StoreTicket } from "./lib/storeFulfilment";
import type { TicketPayload } from "./lib/tickets";

export default function StoreTicketPage({ session, settings }: { session: Session | null; settings: Settings | null }) {
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ticket, setTicket] = useState<StoreTicket | null>(null);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setTicket(null);
    try {
      const found = await api.storeTicketByReference(reference, email);
      if (!found) {
        setError("No issued ticket was found for that DGateway reference and email. If you just paid, wait a moment and try again. If it stays missing, contact TANK with your payment reference.");
        return;
      }
      setTicket(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not look up this ticket.");
    } finally {
      setBusy(false);
    }
  };

  const payload: TicketPayload | null = ticket ? {
    c: ticket.code,
    t: ticket.event_title,
    w: ticket.starts_at,
    v: [ticket.venue, ticket.area].filter(Boolean).join(", "),
    n: ticket.name,
    q: ticket.qty,
    a: ticket.amount,
  } : null;

  return (
    <div className="min-h-screen bg-[#efe8d8] text-[#0c0c0b]">
      <SiteHeader session={session} />
      <main className="shell max-w-2xl py-12">
        <Logo />
        <h1 className="display mt-6 text-5xl">Find your DGateway ticket</h1>
        <p className="mt-3 text-sm leading-6 text-black/60">
          Enter the DGateway payment reference and the email used at checkout. A ticket is shown only after the payment has been verified and issued.
        </p>
        <form onSubmit={lookup} className="mt-6 grid gap-4 rounded border border-black/12 bg-white/60 p-5">
          <label className="label">DGateway payment reference
            <input className="field font-mono" value={reference} onChange={(e) => setReference(e.target.value)} required placeholder="e.g. dgw_…" autoComplete="off" />
          </label>
          <label className="label">Checkout email
            <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" autoComplete="email" />
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <button disabled={busy} className="btn btn-dark w-full text-sm disabled:opacity-50">{busy ? "Checking…" : "Find my ticket"}</button>
        </form>
        {ticket && payload && (
          <section className="mt-8">
            <Notice tone="ok">Payment verified · ticket {ticket.status === "CHECKED_IN" ? "already checked in" : "ready"}.</Notice>
            <div className="mt-4"><TicketCard payload={payload} settings={settings} /></div>
          </section>
        )}
      </main>
      <SiteFooter session={session} />
    </div>
  );
}
