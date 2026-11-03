import { motion } from "framer-motion";
import { CalendarDays, CheckCircle2, MapPin, Minus, Plus, RefreshCw, ShieldCheck, Smartphone, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Notice, Poster, TicketCard } from "./components";
import { api } from "./lib/api";
import { initiatePayment, PaymentError, pollPaymentStatus } from "./lib/dgateway";
import { eventWhen, ugx } from "./lib/format";
import { detectNetwork, isValidUgPhone, toMsisdn } from "./lib/phone";
import { emailConfigured, newTicketCode, payloadFor } from "./lib/tickets";
import { CONTACT_PHONE } from "./lib/config";
import type { Order, Session, Settings, TankEvent } from "./lib/types";

type Step = "qty" | "details" | "pay" | "done";
const POLL_INTERVAL = 10_000;
const POLL_TIMEOUT = 5 * 60_000;

export function Checkout({ event, session, settings, onClose, onSold }: {
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
  const [phone, setPhone] = useState(session?.phone || "");
  const [email, setEmail] = useState(session?.email || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [copied, setCopied] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const [pollEpoch, setPollEpoch] = useState(0);
  const [pollNotice, setPollNotice] = useState("");
  const [timedOut, setTimedOut] = useState(false);
  const [checking, setChecking] = useState(false);
  const finished = useRef(false);
  const submitting = useRef(false);
  // Reuse the same reference when a network response is lost, preventing a second charge.
  const attempt = useRef<{ code: string; externalRef: string } | null>(null);
  const maxQty = Math.min(10, left);
  const total = event.price * qty;
  const emailOn = Boolean(settings && emailConfigured(settings));

  const finish = (verified: Order) => {
    if (finished.current) return;
    if (!free && !["SUCCEEDED", "CHECKED_IN"].includes(verified.status)) return;
    finished.current = true;
    setOrder(verified);
    setStep("done");
    onSold();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || left === 0) return;
    setError("");
    if (!name.trim()) return setError("Enter the guest's full name.");
    if (!isValidUgPhone(phone)) return setError("Enter a valid Ugandan mobile number, e.g. 0772 123456 or 0758 443666.");
    if (emailOn && !email.trim()) return setError("Enter your email so we can send your ticket.");
    submitting.current = true;
    setBusy(true);
    attempt.current ||= { code: newTicketCode(), externalRef: `TNK-${crypto.randomUUID()}` };
    const { code, externalRef } = attempt.current;
    const input = { eventId: event.id, code, name: name.trim(), phone: toMsisdn(phone), email: email.trim(), qty, externalRef };
    try {
      if (free) {
        const created = await api.createOrder(input);
        if (created.status !== "SUCCEEDED") throw new Error("The booking was not confirmed. Please try again.");
        finish(created);
        return;
      }
      const result = await initiatePayment({ ...input, orderCode: code });
      if (result.order.amount !== total || result.order.qty !== qty || result.order.eventId !== event.id) {
        throw new PaymentError("The order details changed. Please contact TANK support before paying again.", "ORDER_MISMATCH");
      }
      setOrder(result.order);
      if (result.status === "failed") {
        attempt.current = null;
        throw new PaymentError("The payment was declined or cancelled. Check your balance and try again.");
      }
      if (result.status === "completed" && ["SUCCEEDED", "CHECKED_IN"].includes(result.order.status)) {
        finish(result.order);
        return;
      }
      setPollNotice("");
      setTimedOut(false);
      setPollCount(0);
      setStep("pay");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't start payment. Check My tickets before trying again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (step !== "pay" || !order) return;
    let stopped = false;
    let timer: number | undefined;
    const started = Date.now();
    const currentOrder = order;
    setTimedOut(false);
    setPollNotice("");
    const tick = async () => {
      setChecking(true);
      try {
        const result = await pollPaymentStatus(currentOrder.dgatewayRef || currentOrder.paymentRef || "", currentOrder.code);
        if (stopped) return;
        setPollCount((count) => count + 1);
        if (result.status === "completed" && result.order) {
          finish(result.order);
          return;
        }
        if (result.status === "failed") {
          attempt.current = null;
          setError("The payment was declined or cancelled. Check your Mobile Money balance and try again.");
          setStep("details");
          return;
        }
        setPollNotice("");
      } catch {
        if (stopped) return;
        setPollNotice("We couldn't check confirmation just yet. Keep your ticket reference; we'll keep checking.");
      } finally {
        if (!stopped) setChecking(false);
      }
      if (stopped) return;
      if (Date.now() - started >= POLL_TIMEOUT) {
        setTimedOut(true);
        setPollNotice("Confirmation is taking longer than usual. Do not pay again. Check the status below or contact TANK with your ticket reference.");
        return;
      }
      timer = window.setTimeout(tick, POLL_INTERVAL);
    };
    timer = window.setTimeout(tick, 4000);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // A retry checks the existing order; it never starts another collection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, order?.code, pollEpoch]);

  const copyReference = async () => {
    if (!order) return;
    try {
      await navigator.clipboard.writeText(order.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy your ticket reference:", order.code);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-xs sm:items-center sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={busy ? undefined : onClose}>
      <motion.div role="dialog" aria-modal="true" aria-labelledby="checkout-title" initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onMouseDown={(e) => e.stopPropagation()} className="relative max-h-[94vh] w-full max-w-lg overflow-y-auto bg-[#efe8d8] p-6 sm:p-8">
        <button onClick={onClose} disabled={busy} className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center bg-[#efe8d8] hover:bg-black/10 disabled:opacity-40" aria-label="Close checkout"><X size={18} /></button>
        {step === "done" && order ? (
          <div>
            <div className="flex items-center gap-2"><CheckCircle2 className="text-emerald-700" size={24} /><p className="eyebrow m-0! text-emerald-800">{free ? "Booking confirmed" : "Payment verified"}</p></div>
            <h3 id="checkout-title" className="display mt-2 text-5xl">You’re on the list.</h3>
            <p className="mt-3 text-sm text-black/60">{emailOn && order.email ? `Your QR ticket is being emailed to ${order.email}. ` : ""}Save your ticket and show its QR code at the door.</p>
            <div className="mt-6"><TicketCard payload={payloadFor(order, event)} phone={order.phone} email={order.email} settings={settings} autoEmail /></div>
            {session && <a href="#/dashboard" className="btn btn-line mt-3 w-full">View in my tickets</a>}
          </div>
        ) : (
          <>
            <p className="eyebrow">Checkout</p>
            <div className="mt-3 flex gap-4 pr-8">
              <Poster event={event} className="h-20 w-20 shrink-0" />
              <div className="min-w-0">
                <h3 id="checkout-title" className="display text-3xl">{event.title}</h3>
                <div className="mt-1 grid gap-0.5 text-sm text-black/60">
                  <span className="inline-flex items-center gap-2"><CalendarDays size={13} />{eventWhen(event.startsAt)}</span>
                  <span className="inline-flex items-center gap-2"><MapPin size={13} />{event.venue}{event.area ? `, ${event.area}` : ""}</span>
                  <span className="inline-flex items-center gap-2"><Users size={13} />{left} tickets left</span>
                </div>
              </div>
            </div>
            {step === "qty" && (left === 0 ? <div className="mt-7"><Notice tone="warn">This event is sold out.</Notice></div> : <>
              <div className="my-7 flex items-center justify-between border-y border-black/12 py-5">
                <div><p className="font-extrabold">General admission</p><p className="mt-1 text-sm text-black/50">{ugx(event.price)}{free ? "" : " each"}</p></div>
                <div className="flex items-center gap-4">
                  <button onClick={() => setQty(Math.max(1, qty - 1))} className="qty-btn" aria-label="Fewer tickets"><Minus size={16} /></button>
                  <b className="w-5 text-center">{qty}</b>
                  <button onClick={() => setQty(Math.min(maxQty, qty + 1))} className="qty-btn" aria-label="More tickets"><Plus size={16} /></button>
                </div>
              </div>
              <button onClick={() => setStep("details")} className="btn btn-dark w-full">Continue · {ugx(total)}</button>
            </>)}
            {step === "details" && (
              <form onSubmit={submit} className="mt-7 grid gap-3">
                <label className="label">Full name<input className="field" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" placeholder="e.g. Sarah Namubiru" /></label>
                <label className="label">{free ? "WhatsApp number" : "Mobile Money number (MTN / Airtel)"}<input className="field" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="e.g. 0772 123456" autoComplete="tel" /></label>
                {phone && isValidUgPhone(phone) && !free && <div className="rounded bg-[#c9a227]/15 p-2 text-xs font-bold text-[#6d5308]">{detectNetwork(phone)} Mobile Money · Direct phone prompt</div>}
                <label className="label">Email {emailOn ? "(required for ticket delivery)" : "(optional)"}<input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required={emailOn} autoComplete="email" placeholder="e.g. sarah@gmail.com" /></label>
                {!free && <div className="rounded border border-black/10 bg-white/70 p-3 text-xs leading-5 text-black/70"><p className="font-extrabold uppercase tracking-wider text-black">How Mobile Money works</p><p className="mt-1">Tap Pay, then approve {ugx(total)} on your phone with your Mobile Money PIN. Your ticket unlocks after the payment is verified. Never share your PIN on this website.</p></div>}
                {error && <div role="alert" className="border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
                <button disabled={busy || !name.trim() || !phone.trim()} className="btn btn-gold w-full text-sm font-black disabled:opacity-50">{busy ? "Requesting…" : free ? `Get ${qty} free ticket${qty > 1 ? "s" : ""}` : `Pay ${ugx(total)} with Mobile Money`}<ShieldCheck size={16} /></button>
                <button type="button" disabled={busy} onClick={() => { attempt.current = null; setStep("qty"); }} className="text-xs uppercase tracking-widest text-black/50">← Change quantity</button>
              </form>
            )}
            {step === "pay" && order && (
              <div className="mt-7">
                <div className="flex items-center gap-2"><Smartphone className="text-[#a8841a]" size={24} /><p className="eyebrow m-0! text-[#a8841a]">{detectNetwork(order.phone)} Mobile Money</p></div>
                <h3 className="display mt-2 text-4xl">Check your phone</h3>
                <p className="mt-4 text-sm leading-6 text-black/70">Approve the payment prompt of <b>{ugx(order.amount)}</b> sent to <b>{order.phone}</b>. Enter your PIN on your phone, not on this page.</p>
                <div className="mt-4 grid gap-2 border border-black/12 bg-white/70 p-4 text-sm">
                  <p className="flex justify-between gap-3"><span>Ticket reference</span><b className="font-mono">{order.code}</b></p>
                  {order.dgatewayRef && <p className="flex flex-wrap justify-between gap-2 text-xs text-black/50"><span>Payment reference</span><span className="break-all font-mono">{order.dgatewayRef}</span></p>}
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-black/60" role="status">
                  <span className="flex items-center gap-2"><RefreshCw size={13} className={checking ? "animate-spin" : ""} />{checking ? "Checking payment…" : timedOut ? "Still awaiting confirmation" : `Waiting for confirmation · ${pollCount} check${pollCount === 1 ? "" : "s"}`}</span>
                  <button type="button" onClick={copyReference} className="font-bold underline">{copied ? "Copied ✓" : "Copy ticket reference"}</button>
                </div>
                {pollNotice && <div className="mt-4"><Notice tone="warn">{pollNotice}</Notice></div>}
                {timedOut && <button type="button" onClick={() => setPollEpoch((n) => n + 1)} className="btn btn-dark mt-4 w-full"><RefreshCw size={15} />Check status again</button>}
                <p className="mt-4 text-xs leading-5 text-black/55">No prompt? Keep this reference and contact support before trying another payment. Closing this window does not cancel a payment already requested.</p>
                <a className="mt-3 inline-block text-xs font-bold underline" target="_blank" rel="noreferrer" href={`https://wa.me/${CONTACT_PHONE}?text=${encodeURIComponent(`Hello TANK, I need help confirming ticket ${order.code} for ${event.title}.`)}`}>Get help on WhatsApp</a>
              </div>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
