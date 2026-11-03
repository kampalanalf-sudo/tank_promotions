import { motion } from "framer-motion";
import {
  CalendarDays,
  CheckCircle2,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Notice, Poster, TicketCard } from "./components";
import { api } from "./lib/api";
import { initiatePayment, pollPaymentStatus } from "./lib/dgateway";
import { eventWhen, ugx } from "./lib/format";
import { detectNetwork, isValidUgPhone, toMsisdn } from "./lib/phone";
import { emailConfigured, newTicketCode, payloadFor } from "./lib/tickets";
import type { Order, Session, Settings, TankEvent } from "./lib/types";

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
  const [phone, setPhone] = useState(session?.phone || "");
  const [email, setEmail] = useState(session?.email || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [dgwRef, setDgwRef] = useState("");
  const [copied, setCopied] = useState("");
  const [pollCount, setPollCount] = useState(0);
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
    if (!isValidUgPhone(phone)) {
      return setError(
        "Enter a valid Ugandan mobile number, e.g. 0772 123456 or 0758 443666."
      );
    }
    if (emailOn && !email) {
      return setError("Enter your email so we can send your ticket.");
    }
    setBusy(true);

    try {
      const code = newTicketCode();
      const normalizedPhone = toMsisdn(phone);

      // Handle free events directly
      if (free) {
        const created = await api.createOrder({
          eventId: event.id,
          code,
          name,
          phone: normalizedPhone,
          email,
          qty,
          externalRef: `TNK${Date.now()}`,
        });
        setOrder(created);
        return finish(created);
      }

      // Initiate collection via DGateway
      const payRes = await initiatePayment({
        eventId: event.id,
        orderCode: code,
        name,
        phone: normalizedPhone,
        email,
        qty,
        amount: total,
        currency: "UGX",
        provider: "iotec",
      });

      if (!payRes.ok) {
        throw new Error(payRes.error || "Failed to initiate payment collection.");
      }

      const tempOrder: Order = payRes.order || {
        id: `ord_${Date.now()}`,
        code,
        eventId: event.id,
        eventTitle: event.title,
        userId: session?.userId || null,
        name,
        phone: normalizedPhone,
        email,
        qty,
        amount: total,
        status: payRes.status === "completed" ? "SUCCEEDED" : "PENDING",
        paymentRef: payRes.reference,
        dgatewayRef: payRes.reference,
        provider: payRes.provider || "iotec",
        externalRef: `TNK${Date.now()}`,
        createdAt: new Date().toISOString(),
      };

      setOrder(tempOrder);
      setDgwRef(payRes.reference);

      if (payRes.status === "completed" || tempOrder.status === "SUCCEEDED") {
        return finish(tempOrder);
      }

      setStep("pay");
    } catch (err: any) {
      console.error("[checkout error]:", err);
      setError(
        err.message || "Failed to start payment. Please check your network and try again."
      );
    } finally {
      setBusy(false);
    }
  };

  // Poll transaction status every 10 seconds (strict rate-limit compliance)
  useEffect(() => {
    if (step !== "pay" || !order) return;
    let stopped = false;
    const started = Date.now();
    const MAX_POLL_TIME = 5 * 60 * 1000; // 5 minutes ceiling

    const tick = async () => {
      if (stopped) return;

      try {
        const res = await pollPaymentStatus(dgwRef, order.code);
        setPollCount((c) => c + 1);

        if (res.status === "completed") {
          return finish(order);
        }

        if (res.status === "failed") {
          setError(
            "The payment was declined or cancelled. Please verify your Mobile Money balance and try again."
          );
          setStep("details");
          return;
        }

        if (Date.now() - started > MAX_POLL_TIME) {
          setError(
            "We did not receive confirmation in time. If you completed payment, check your tickets in a moment or WhatsApp TANK support."
          );
          setStep("details");
          return;
        }
      } catch (err) {
        // Continue polling
      }

      // Schedule next check in 10 seconds
      if (!stopped) {
        setTimeout(tick, 10000);
      }
    };

    // Initial check after 4s, then 10s intervals
    const initialTimer = setTimeout(tick, 4000);

    return () => {
      stopped = true;
      clearTimeout(initialTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, dgwRef, order?.code]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-xs sm:items-center sm:p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={step === "pay" ? undefined : onClose}
    >
      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative max-h-[94vh] w-full max-w-lg overflow-y-auto bg-[#efe8d8] p-6 sm:p-8"
      >
        {step !== "pay" && (
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center bg-[#efe8d8] hover:bg-black/10"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        )}

        {step === "done" && order ? (
          <div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="text-emerald-700" size={24} />
              <p className="eyebrow m-0! text-emerald-800">
                {free ? "Booking confirmed" : "Payment received"}
              </p>
            </div>
            <h3 className="display mt-2 text-5xl">You’re on the list.</h3>
            <p className="mt-3 text-sm text-black/60">
              {emailOn && order.email
                ? `Your QR ticket is being emailed to ${order.email}. `
                : ""}
              Tap <b>Send to WhatsApp</b> to keep a copy in your chat, and show the
              QR code at the door.
            </p>
            <div className="mt-6">
              <TicketCard
                payload={payloadFor(order, event)}
                phone={order.phone}
                email={order.email}
                settings={settings}
                autoEmail
              />
            </div>
            {session && (
              <a href="#/dashboard" className="btn btn-line mt-3 w-full">
                View in my tickets
              </a>
            )}
          </div>
        ) : (
          <>
            <p className="eyebrow">Checkout</p>
            <div className="mt-3 flex gap-4 pr-8">
              <Poster event={event} className="h-20 w-20 shrink-0" />
              <div className="min-w-0">
                <h3 className="display text-3xl">{event.title}</h3>
                <div className="mt-1 grid gap-0.5 text-sm text-black/60">
                  <span className="inline-flex items-center gap-2">
                    <CalendarDays size={13} /> {eventWhen(event.startsAt)}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <MapPin size={13} /> {event.venue}
                    {event.area ? `, ${event.area}` : ""}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <Users size={13} /> {left} tickets left
                  </span>
                </div>
              </div>
            </div>

            {step === "qty" && (
              left === 0 ? (
                <div className="mt-7">
                  <Notice tone="warn">This event is sold out.</Notice>
                </div>
              ) : (
                <>
                  <div className="my-7 flex items-center justify-between border-y border-black/12 py-5">
                    <div>
                      <p className="font-extrabold">General admission</p>
                      <p className="mt-1 text-sm text-black/50">
                        {ugx(event.price)}
                        {free ? "" : " each"}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setQty(Math.max(1, qty - 1))}
                        className="qty-btn"
                        aria-label="Fewer tickets"
                      >
                        <Minus size={16} />
                      </button>
                      <b className="w-5 text-center">{qty}</b>
                      <button
                        onClick={() => setQty(Math.min(maxQty, qty + 1))}
                        className="qty-btn"
                        aria-label="More tickets"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => setStep("details")}
                    className="btn btn-dark w-full"
                  >
                    Continue · {ugx(total)}
                  </button>
                </>
              )
            )}

            {step === "details" && (
              <form onSubmit={submit} className="mt-7 grid gap-3">
                <label className="label">
                  Full name
                  <input
                    className="field"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={80}
                    autoComplete="name"
                    placeholder="e.g. Sarah Namubiru"
                  />
                </label>
                <label className="label">
                  {free
                    ? "WhatsApp number"
                    : "Mobile Money Phone Number (MTN / Airtel)"}
                  <input
                    className="field"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    placeholder="e.g. 0772 123456 or 0758 443666"
                    autoComplete="tel"
                  />
                </label>
                {phone && isValidUgPhone(phone) && !free && (
                  <div className="flex items-center justify-between rounded bg-[#c9a227]/15 p-2 text-xs font-bold text-[#6d5308]">
                    <span>
                      Detected: <b>{detectNetwork(phone)} Mobile Money</b>
                    </span>
                    <span>Direct STK Prompt</span>
                  </div>
                )}
                <label className="label">
                  Email {emailOn ? "(required for ticket delivery)" : "(optional)"}
                  <input
                    className="field"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required={emailOn}
                    autoComplete="email"
                    placeholder="e.g. sarah@gmail.com"
                  />
                </label>

                {!free && (
                  <div className="rounded border border-black/10 bg-white/70 p-3 text-xs leading-5 text-black/70">
                    <p className="font-extrabold uppercase tracking-wider text-black">
                      How Mobile Money works:
                    </p>
                    <p className="mt-1">
                      1. When you tap Pay, a prompt appears on your phone screen.
                      <br />
                      2. Enter your Mobile Money PIN to approve <b>{ugx(total)}</b>.
                      <br />
                      3. Your QR ticket unlocks instantly on this screen!
                    </p>
                  </div>
                )}

                {error && (
                  <div className="p-2 text-sm font-bold text-red-700 bg-red-50 border border-red-200">
                    {error}
                  </div>
                )}

                <button
                  disabled={busy || !name || !phone}
                  className="btn btn-gold w-full text-sm font-black disabled:opacity-50"
                >
                  {busy ? (
                    "Sending prompt to phone…"
                  ) : free ? (
                    `Get ${qty} free ticket${qty > 1 ? "s" : ""}`
                  ) : (
                    `Pay ${ugx(total)} with Mobile Money`
                  )}{" "}
                  <ShieldCheck size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setStep("qty")}
                  className="text-xs uppercase tracking-widest text-black/50"
                >
                  ← Change quantity
                </button>
              </form>
            )}

            {step === "pay" && order && (
              <PayWaitingScreen
                order={order}
                dgwRef={dgwRef}
                settings={settings}
                pollCount={pollCount}
                copied={copied}
                onCopy={async (value, label) => {
                  try {
                    await navigator.clipboard.writeText(value);
                    setCopied(label);
                    setTimeout(() => setCopied(""), 2000);
                  } catch {
                    window.prompt("Copy this:", value);
                  }
                }}
              />
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function PayWaitingScreen({
  order,
  dgwRef,
  settings,
  pollCount,
  copied,
  onCopy,
}: {
  order: Order;
  dgwRef: string;
  settings: Settings | null;
  pollCount: number;
  copied: string;
  onCopy: (value: string, label: string) => void;
}) {
  const network = detectNetwork(order.phone);
  const merchantCode =
    network === "Airtel"
      ? settings?.airtelMerchantCode || "7280543"
      : settings?.mtnMerchantCode || "89713371";
  const ussdMenu = network === "Airtel" ? "*185*9#" : "*165*3#";

  return (
    <div className="mt-7">
      <div className="flex items-center gap-2">
        <Smartphone className="text-[#a8841a] animate-pulse" size={24} />
        <p className="eyebrow m-0! text-[#a8841a]">
          {network} Mobile Money · STK Push
        </p>
      </div>

      <h3 className="display mt-2 text-4xl">
        Check your phone and approve the prompt
      </h3>

      <div className="mt-4 rounded border border-[#c9a227]/40 bg-[#c9a227]/10 p-4">
        <p className="text-sm font-semibold text-black/85">
          A payment prompt of <b>{ugx(order.amount)}</b> has been sent to your phone:{" "}
          <span className="font-mono font-bold">{order.phone}</span>
        </p>
        <p className="mt-2 text-xs leading-5 text-black/70">
          👉 Please check your phone screen now and <b>enter your PIN</b> to authorize the transaction.
        </p>
      </div>

      <div className="mt-4 grid gap-2 border border-black/12 bg-white/70 p-4 text-sm">
        <p className="flex justify-between gap-3">
          <span>Amount</span>
          <b className="text-base text-[#a8841a]">{ugx(order.amount)}</b>
        </p>
        <p className="flex justify-between gap-3">
          <span>Phone</span>
          <b className="font-mono">{order.phone}</b>
        </p>
        <p className="flex justify-between gap-3">
          <span>Ticket Ref</span>
          <b className="font-mono tracking-wider">{order.code}</b>
        </p>
        {dgwRef && (
          <p className="flex justify-between gap-3 text-xs text-black/50">
            <span>DGateway Ref</span>
            <span className="font-mono">{dgwRef}</span>
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-black/55">
        <span className="flex items-center gap-1.5">
          <RefreshCw size={13} className="animate-spin text-[#a8841a]" />
          Waiting for confirmation… ({pollCount * 10}s)
        </span>
        <button
          type="button"
          onClick={() => onCopy(order.code, "ref")}
          className="font-bold underline text-black/70"
        >
          {copied === "ref" ? "Copied ✓" : "Copy Ref"}
        </button>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden bg-black/10">
        <div className="progress-bar h-full bg-[#c9a227]" />
      </div>

      {/* Manual USSD Fallback in case prompt timed out on user phone */}
      <div className="mt-6 border-t border-black/10 pt-4">
        <details className="text-xs text-black/70 cursor-pointer">
          <summary className="font-bold uppercase tracking-wider text-black/80 hover:text-[#a8841a]">
            Didn't receive the prompt on your phone? Tap here for manual USSD
          </summary>
          <div className="mt-3 bg-white/50 p-3 rounded border border-black/10 space-y-2">
            <p>
              Dial <b>{ussdMenu}</b> on your phone:
              <br />
              1. Merchant Code: <b>{merchantCode}</b>
              <br />
              2. Amount: <b>{order.amount}</b>
              <br />
              3. Reference: <b>{order.code}</b>
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <a className="btn-mini btn-dark" href={`tel:${ussdMenu.replace("#", "%23")}`}>
                Dial {ussdMenu}
              </a>
              <button
                type="button"
                className="btn-mini"
                onClick={() => onCopy(merchantCode, "code")}
              >
                {copied === "code" ? "Code Copied ✓" : `Copy Code (${merchantCode})`}
              </button>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
