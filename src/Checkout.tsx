import { motion } from "framer-motion";
import { CalendarDays, MapPin, Minus, Plus, ShieldCheck, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Notice, Poster, TicketCard } from "./components";
import { api } from "./lib/api";
import { eventWhen, ugx } from "./lib/format";
import { emailConfigured, newTicketCode, payloadFor } from "./lib/tickets";
import type { Order, Session, Settings, TankEvent } from "./lib/types";
import { detectNetwork, isValidUgPhone, toMsisdn } from "./lib/zengapay";

type Step = "qty" | "details" | "pay" | "done";

export function Checkout({
  event,
  session,
  settings,
  onClose,
  onSold,
}: {
  event: TankEvent;
  session: Session | null;
  settings: Settings | null;
  onClose: () => void;
  onSold: () => void;
}) {
  const left = Math.max(0, event.capacity - event.sold);
  const free = event.price === 0;
  const [step, setStep] = useState<Step>("qty");
  const [qty, setQty] = useState(1);
  const [name, setName] = useState(session?.name || "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(session?.email || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [copied, setCopied] = useState("");
  const finished = useRef(false);
  const maxQty = Math.min(10, left);
  const total = event.price * qty;
  const emailOn = Boolean(settings && emailConfigured(settings));

  const finish = (o: Order) => {
    if (finished.current) return;
    finished.current = true;
    setOrder({ ...o, status: "SUCCEEDED" });
    setStep("done");
    onSold();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!isValidUgPhone(phone)) return setError("Enter a Ugandan mobile number, e.g. 0772 123456.");
    if (emailOn && !email) return setError("Enter your email so we can send your ticket.");
    if (!settings) return setError("Still loading. Please try again in a moment.");
    setBusy(true);
    try {
      const code = newTicketCode();
      const created = await api.createOrder({
        eventId: event.id,
        code,
        name,
        phone: toMsisdn(phone),
        email,
        qty,
        externalRef: `TNK${Date.now()}`,
      });
      setOrder(created);
      if (created.status === "SUCCEEDED") return finish(created);
      const network = detectNetwork(created.phone);
      const merchantCode = network === "Airtel" ? settings.airtelMerchantCode : settings.mtnMerchantCode;
      if (!merchantCode) return setError(`The ${network} merchant code is not set yet. WhatsApp the organizer.`);
      setStep("pay");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (step !== "pay" || !order) return;
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      const status = await api.ticketStatus(order.code).catch(() => null);
      if (status === "SUCCEEDED" || status === "CHECKED_IN") return finish(order);
      if (Date.now() - started > 30 * 60e3) return;
      setTimeout(tick, 3000);
    };
    tick();
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, order?.code]);

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={step === "pay" ? undefined : onClose}>
      <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onMouseDown={(e) => e.stopPropagation()} className="relative max-h-[94vh] w-full max-w-lg overflow-y-auto bg-[#efe8d8] p-6 sm:p-8">
        {step !== "pay" && <button onClick={onClose} className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center bg-[#efe8d8]" aria-label="Close"><X size={18} /></button>}

        {step === "done" && order ? (
          <div>
            <p className="eyebrow">{free ? "Booking confirmed" : "Payment received"}</p>
            <h3 className="display mt-2 text-5xl">You’re on the list.</h3>
            <p className="mt-3 text-sm text-black/60">
              {emailOn && order.email ? `We’re emailing your ticket to ${order.email}. ` : ""}
              Tap <b>Send to WhatsApp</b> to keep a copy in your chat, and show the QR code at the door.
            </p>
            <div className="mt-6">
              <TicketCard payload={payloadFor(order, event)} phone={order.phone} email={order.email} settings={settings} autoEmail />
            </div>
            {session && <a href="#/dashboard" className="btn btn-line mt-3 w-full">View in my tickets</a>}
          </div>
        ) : (
          <>
            <p className="eyebrow">Checkout</p>
            <div className="mt-3 flex gap-4 pr-8">
              <Poster event={event} className="h-20 w-20 shrink-0" />
              <div className="min-w-0">
                <h3 className="display text-3xl">{event.title}</h3>
                <div className="mt-1 grid gap-0.5 text-sm text-black/60">
                  <span className="inline-flex items-center gap-2"><CalendarDays size={13} /> {eventWhen(event.startsAt)}</span>
                  <span className="inline-flex items-center gap-2"><MapPin size={13} /> {event.venue}{event.area ? `, ${event.area}` : ""}</span>
                  <span className="inline-flex items-center gap-2"><Users size={13} /> {left} tickets left</span>
                </div>
              </div>
            </div>

            {step === "qty" && (
              left === 0 ? (
                <div className="mt-7"><Notice tone="warn">This event is sold out.</Notice></div>
              ) : (
                <>
                  <div className="my-7 flex items-center justify-between border-y border-black/12 py-5">
                    <div>
                      <p className="font-extrabold">General admission</p>
                      <p className="mt-1 text-sm text-black/50">{ugx(event.price)}{free ? "" : " each"}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <button onClick={() => setQty(Math.max(1, qty - 1))} className="qty-btn" aria-label="Fewer tickets"><Minus size={16} /></button>
                      <b className="w-5 text-center">{qty}</b>
                      <button onClick={() => setQty(Math.min(maxQty, qty + 1))} className="qty-btn" aria-label="More tickets"><Plus size={16} /></button>
                    </div>
                  </div>
                  <button onClick={() => setStep("details")} className="btn btn-dark w-full">Continue · {ugx(total)}</button>
                </>
              )
            )}

            {step === "details" && (
              <form onSubmit={submit} className="mt-7 grid gap-3">
                <label className="label">Full name
                  <input className="field" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" />
                </label>
                <label className="label">{free ? "WhatsApp number" : "Number you will pay from"}
                  <input className="field" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="0772 123456" autoComplete="tel" />
                </label>
                {!free && <p className="-mt-1 text-xs leading-5 text-black/50">Use the MTN or Airtel number that sends the money. We match the confirmation SMS by this number and the exact amount.</p>}
                {phone && isValidUgPhone(phone) && !free && <p className="-mt-1 text-xs uppercase tracking-widest text-black/45">{detectNetwork(phone)} Mobile Money</p>}
                <label className="label">Email {emailOn ? "" : "(optional)"}
                  <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required={emailOn} autoComplete="email" />
                </label>
                {error && <p className="text-sm text-red-700">{error}</p>}
                <button disabled={busy || !name || !phone} className="btn btn-gold w-full disabled:opacity-50">
                  {busy ? "Please wait…" : free ? `Get ${qty} free ticket${qty > 1 ? "s" : ""}` : `Pay ${ugx(total)} with Mobile Money`} <ShieldCheck size={16} />
                </button>
                <button type="button" onClick={() => setStep("qty")} className="text-xs uppercase tracking-widest text-black/50">← Change quantity</button>
              </form>
            )}

            {step === "pay" && order && settings && (
              <PayInstructions order={order} settings={settings} copied={copied} onCopy={async (value, label) => {
                try { await navigator.clipboard.writeText(value); setCopied(label); } catch { window.prompt("Copy this:", value); }
              }} />
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function PayInstructions({
  order,
  settings,
  copied,
  onCopy,
}: {
  order: Order;
  settings: Settings;
  copied: string;
  onCopy: (value: string, label: string) => void;
}) {
  const network = detectNetwork(order.phone);
  const merchantCode = network === "Airtel" ? settings.airtelMerchantCode : network === "MTN" ? settings.mtnMerchantCode : settings.mtnMerchantCode || settings.airtelMerchantCode;
  const merchantName = network === "Airtel" ? settings.airtelMerchantName : settings.mtnMerchantName;
  const menu = network === "Airtel" ? "*185#" : "*165*3*3#";
  return (
    <div className="mt-7">
      <p className="eyebrow">{network} merchant</p>
      <h3 className="display mt-2 text-4xl">Pay, then wait here</h3>
      <p className="mt-3 text-sm text-black/60">Pay this exact amount from <b>{order.phone}</b> to the merchant code below. This page issues the ticket when the confirmation SMS arrives.</p>
      <div className="mt-5 grid gap-2 border border-black/12 bg-white/50 p-4 text-sm">
        <p className="flex justify-between gap-3"><span>Pay</span><b>{ugx(order.amount)}</b></p>
        <p className="flex justify-between gap-3"><span>Merchant code</span><b>{merchantCode}</b></p>
        <p className="flex justify-between gap-3"><span>Name</span><b>{merchantName || "TANK Promotions"}</b></p>
        <p className="flex justify-between gap-3"><span>Reference (optional)</span><b className="tracking-wider">{order.code}</b></p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-line" onClick={() => onCopy(order.code, "ref")}>{copied === "ref" ? "Copied" : "Copy reference"}</button>
        <a className="btn btn-dark" href={`tel:${menu.replace("#", "%23")}`}>Open {network} menu</a>
      </div>
      <p className="mt-4 text-sm text-black/55">Dial {menu}, choose pay merchant, enter code {merchantCode} and amount {order.amount}. If the menu asks for a reason, add {order.code}; otherwise the paying number and amount are enough.</p>
      <div className="mt-5 h-1 overflow-hidden bg-black/10"><div className="progress-bar h-full bg-[#c9a227]" /></div>
      <p className="mt-3 text-xs uppercase tracking-widest text-black/45">Waiting for the payment SMS… keep this page open.</p>
    </div>
  );
}
