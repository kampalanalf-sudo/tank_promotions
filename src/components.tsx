import { Camera, Check, Copy, Download, ImagePlus, Mail, MessageCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "./lib/api";
import { LOGO_ICON_URL, LOGO_REMOTE_URL, LOGO_URL } from "./lib/config";
import { dateParts, eventWhen, toLocalInput, ugx } from "./lib/format";
import {
  emailConfigured,
  emailTicket,
  extractCode,
  qrDataUrl,
  readPoster,
  ticketLink,
  whatsappLink,
  type TicketPayload,
} from "./lib/tickets";
import { EVENT_TYPES, type EventInput, type Order, type Session, type Settings, type TankEvent } from "./lib/types";
import { isValidUgPhone } from "./lib/zengapay";

/** Round TANK emblem. Falls back to the hosted logo, then to the letters "TP". */
export function LogoMark({ size }: { size?: number }) {
  const sources = [LOGO_ICON_URL, LOGO_URL, LOGO_REMOTE_URL];
  const [index, setIndex] = useState(0);
  const style = size ? { width: size, height: size } : undefined;
  return (
    <span className="mark" style={style}>
      {index < sources.length ? (
        <img src={sources[index]} alt="TANK Promotions logo" onError={() => setIndex((i) => i + 1)} />
      ) : (
        <span className="mark-fallback">TP</span>
      )}
    </span>
  );
}

export function Logo({ light = false, label = "TANK TICKETS" }: { light?: boolean; label?: string }) {
  return (
    <a href="#/" className={`flex items-center gap-3 ${light ? "text-white" : "text-ink"}`} aria-label="TANK Tickets home">
      <LogoMark />
      <span className="wordmark">{label}</span>
    </a>
  );
}

/** Event poster, or a branded block with the title when no poster was uploaded. */
export function Poster({ event, className = "" }: { event: Pick<TankEvent, "image" | "title" | "type">; className?: string }) {
  if (event.image) return <img src={event.image} alt={event.title} className={`object-cover ${className}`} />;
  return (
    <div className={`poster-fallback ${className}`} role="img" aria-label={event.title}>
      <img src={LOGO_ICON_URL} alt="" className="poster-emblem" onError={(e) => (e.currentTarget.style.display = "none")} />
      <span className="poster-type">{event.type}</span>
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <p className="py-10 text-center text-sm text-black/45">{label}</p>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "ok" | "error"; children: React.ReactNode }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

/* ------------------------------- ticket card ------------------------------ */

export function TicketCard({
  payload,
  phone,
  email,
  settings,
  autoEmail = false,
}: {
  payload: TicketPayload;
  phone?: string;
  email?: string;
  settings?: Settings | null;
  autoEmail?: boolean;
}) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [emailState, setEmailState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [emailError, setEmailError] = useState("");
  const sentOnce = useRef(false);
  const link = ticketLink(payload);
  const when = dateParts(payload.w);
  const canEmail = Boolean(settings && emailConfigured(settings) && email);

  useEffect(() => {
    qrDataUrl(link).then(setQr).catch(() => setQr(""));
  }, [link]);

  const sendEmail = async () => {
    if (!settings || !email) return;
    setEmailState("sending");
    setEmailError("");
    try {
      await emailTicket(email, payload, settings);
      setEmailState("sent");
    } catch (err) {
      setEmailState("error");
      setEmailError(err instanceof Error ? err.message : (err as { text?: string })?.text || "Email could not be sent.");
    }
  };

  useEffect(() => {
    if (autoEmail && canEmail && !sentOnce.current) {
      sentOnce.current = true;
      void sendEmail();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEmail, canEmail]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy your ticket link:", link);
    }
  };

  return (
    <div>
      <div className="ticket">
        <div className="flex items-center gap-3 border-b border-dashed border-black/20 pb-4">
          <LogoMark size={36} />
          <span className="wordmark">TANK TICKETS</span>
        </div>
        <div className="grid gap-5 pt-5 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <p className="display text-3xl">{payload.t}</p>
            <p className="mt-2 text-sm text-black/60">{when.full} · {when.time}</p>
            <p className="text-sm text-black/60">{payload.v}</p>
            <p className="mt-4 text-sm"><b>{payload.n}</b> · {payload.q} guest(s) · {ugx(payload.a)}</p>
            <p className="ticket-code mt-3 text-[#a8841a]">{payload.c}</p>
          </div>
          {qr ? <img src={qr} alt={`QR code for ticket ${payload.c}`} className="h-40 w-40 justify-self-center border border-black/10 bg-white p-1" /> : <div className="h-40 w-40" />}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {phone && (
          <a href={whatsappLink(phone, payload)} target="_blank" rel="noreferrer" className="btn btn-wa">
            <MessageCircle size={16} /> Send to WhatsApp
          </a>
        )}
        {canEmail && (
          <button type="button" onClick={sendEmail} disabled={emailState === "sending"} className="btn btn-dark disabled:opacity-60">
            <Mail size={16} />
            {emailState === "sending" ? "Sending…" : emailState === "sent" ? "Emailed ✓" : "Email ticket"}
          </button>
        )}
        <button type="button" onClick={copy} className="btn btn-line">
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Link copied" : "Copy ticket link"}
        </button>
        {qr && (
          <a href={qr} download={`${payload.c}.png`} className="btn btn-line">
            <Download size={16} /> Save QR image
          </a>
        )}
      </div>
      {emailState === "sent" && <p className="mt-3 text-sm text-emerald-700">Ticket emailed to {email}.</p>}
      {emailState === "error" && <p className="mt-3 text-sm text-red-700">Email failed: {emailError}</p>}
    </div>
  );
}

/* -------------------------------- event form ------------------------------ */

export function emptyEvent(session: Session): EventInput {
  const start = new Date(Date.now() + 7 * 86400e3);
  start.setHours(20, 0, 0, 0);
  return {
    title: "",
    type: EVENT_TYPES[0],
    venue: "",
    area: "",
    startsAt: start.toISOString(),
    price: 0,
    capacity: 100,
    image: "",
    description: "",
    organizerName: session.name,
    organizerPhone: session.phone,
  };
}

export function EventForm({
  initial,
  session,
  onSaved,
  onCancel,
}: {
  initial: EventInput;
  session: Session;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<EventInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof EventInput>(key: K, value: EventInput[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const pickPoster = async (file?: File) => {
    if (!file) return;
    try {
      set("image", await readPoster(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not use that image.");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (new Date(draft.startsAt).getTime() < Date.now() - 3600e3 && !draft.id) return setError("The event date is in the past.");
    if (draft.organizerPhone && !isValidUgPhone(draft.organizerPhone)) return setError("Enter the organizer phone as a Ugandan mobile number, e.g. 0772 123456.");
    setBusy(true);
    try {
      await api.saveEvent(draft, session);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the event.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 border border-black/12 bg-white/40 p-5">
      <label className="label">Event name
        <input className="field" value={draft.title} onChange={(e) => set("title", e.target.value)} required maxLength={90} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="label">Venue
          <input className="field" value={draft.venue} onChange={(e) => set("venue", e.target.value)} required maxLength={90} />
        </label>
        <label className="label">Area / town
          <input className="field" value={draft.area} onChange={(e) => set("area", e.target.value)} required maxLength={60} />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="label">Date and start time
          <input
            className="field"
            type="datetime-local"
            value={toLocalInput(draft.startsAt)}
            onChange={(e) => e.target.value && set("startsAt", new Date(e.target.value).toISOString())}
            required
          />
        </label>
        <label className="label">Category
          <select className="field" value={draft.type} onChange={(e) => set("type", e.target.value)}>
            {EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="label">Ticket price (UGX, 0 = free)
          <input className="field" type="number" min={0} step={500} value={draft.price} onChange={(e) => set("price", Number(e.target.value))} required />
        </label>
        <label className="label">Number of tickets
          <input className="field" type="number" min={1} max={100000} value={draft.capacity} onChange={(e) => set("capacity", Number(e.target.value))} required />
        </label>
      </div>
      <label className="label">Description
        <textarea className="field" rows={4} value={draft.description} onChange={(e) => set("description", e.target.value)} maxLength={1500} placeholder="Line-up, dress code, what is included…" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="label">Organizer name
          <input className="field" value={draft.organizerName} onChange={(e) => set("organizerName", e.target.value)} required maxLength={80} />
        </label>
        <label className="label">Organizer WhatsApp
          <input className="field" inputMode="tel" value={draft.organizerPhone} onChange={(e) => set("organizerPhone", e.target.value)} required />
        </label>
      </div>
      <div className="label">Poster
        <div className="flex flex-wrap items-center gap-4">
          {draft.image ? (
            <div className="relative">
              <img src={draft.image} alt="Poster preview" className="h-28 w-28 object-cover" />
              <button type="button" onClick={() => set("image", "")} className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-black text-white" aria-label="Remove poster"><X size={13} /></button>
            </div>
          ) : (
            <Poster event={draft} className="h-28 w-28" />
          )}
          <label className="btn btn-line cursor-pointer">
            <ImagePlus size={16} /> {draft.image ? "Change poster" : "Upload poster"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => pickPoster(e.target.files?.[0])} />
          </label>
        </div>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!draft.id && session.role !== "admin" && (
        <p className="text-xs text-black/50">New events are reviewed by TANK before they go live. You will see the status in your dashboard.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-dark" disabled={busy}>{busy ? "Saving…" : draft.id ? "Save changes" : "Submit event"}</button>
        <button type="button" className="btn btn-line" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/* ------------------------------- orders table ----------------------------- */

const statusLabel: Record<Order["status"], string> = {
  PENDING: "Awaiting payment",
  SUCCEEDED: "Paid",
  FAILED: "Failed",
  CHECKED_IN: "Checked in",
};

export function StatusPill({ status }: { status: Order["status"] }) {
  return <span className={`pill pill-${status.toLowerCase()}`}>{statusLabel[status]}</span>;
}

export function OrdersTable({ orders, events, settings }: { orders: Order[]; events: TankEvent[]; settings: Settings | null }) {
  const [msg, setMsg] = useState<Record<string, string>>({});
  const byId = new Map(events.map((e) => [e.id, e]));

  const payloadOf = (o: Order): TicketPayload | null => {
    const ev = byId.get(o.eventId);
    if (!ev) return null;
    return { c: o.code, t: ev.title, w: ev.startsAt, v: [ev.venue, ev.area].filter(Boolean).join(", "), n: o.name, q: o.qty, a: o.amount };
  };

  const resendEmail = async (o: Order) => {
    const p = payloadOf(o);
    if (!p || !settings) return;
    setMsg((m) => ({ ...m, [o.id]: "Sending…" }));
    try {
      await emailTicket(o.email, p, settings);
      setMsg((m) => ({ ...m, [o.id]: "Emailed ✓" }));
    } catch (err) {
      setMsg((m) => ({ ...m, [o.id]: err instanceof Error ? err.message : "Email failed" }));
    }
  };

  if (!orders.length) return <p className="py-8 text-sm text-black/45">No tickets sold yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-[11px] uppercase tracking-widest text-black/40">
          <tr>{["Guest", "Event", "Tickets", "Status", "Send ticket"].map((h) => <th key={h} className="border-b border-black/10 py-3 pr-3">{h}</th>)}</tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const p = payloadOf(o);
            const delivered = o.status === "SUCCEEDED" || o.status === "CHECKED_IN";
            return (
              <tr key={o.id} className="border-b border-black/5 align-top">
                <td className="py-3 pr-3">
                  <b>{o.name}</b>
                  <br /><span className="text-black/45">{o.phone}</span>
                  {o.email && <><br /><span className="text-black/45">{o.email}</span></>}
                </td>
                <td className="py-3 pr-3">{o.eventTitle}<br /><span className="font-mono text-xs text-black/45">{o.code}</span></td>
                <td className="py-3 pr-3">{o.qty} · {ugx(o.amount)}</td>
                <td className="py-3 pr-3"><StatusPill status={o.status} /></td>
                <td className="py-3">
                  {delivered && p ? (
                    <div className="flex flex-wrap gap-1.5">
                      <a href={whatsappLink(o.phone, p)} target="_blank" rel="noreferrer" className="btn-mini btn-mini-wa"><MessageCircle size={13} /> WhatsApp</a>
                      {o.email && settings && emailConfigured(settings) && (
                        <button onClick={() => resendEmail(o)} className="btn-mini"><Send size={13} /> Email</button>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-black/35">After payment</span>
                  )}
                  {msg[o.id] && <p className="mt-1 text-xs text-black/55">{msg[o.id]}</p>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------- door panel ------------------------------ */

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

export function DoorPanel({ session, onChange }: { session: Session; onChange?: () => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canScan = typeof window !== "undefined" && "BarcodeDetector" in window;

  const check = async (raw: string) => {
    const code = extractCode(raw);
    if (!code) return setResult({ ok: false, message: "That is not a TANK ticket code." });
    const res = await api.checkIn(code, session);
    setResult(res);
    setText("");
    if (res.ok) onChange?.();
  };

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  useEffect(() => stop, []);

  const start = async () => {
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setScanning(true);
      requestAnimationFrame(async () => {
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        const detector = new Ctor({ formats: ["qr_code"] });
        const loop = async () => {
          if (!streamRef.current) return;
          try {
            const codes = await detector.detect(video);
            if (codes[0]?.rawValue) {
              stop();
              await check(codes[0].rawValue);
              return;
            }
          } catch {
            /* keep trying */
          }
          setTimeout(loop, 300);
        };
        loop();
      });
    } catch {
      stop();
      setResult({ ok: false, message: "Camera not available. Type the ticket code instead." });
    }
  };

  return (
    <div className="max-w-lg">
      <p className="text-sm text-black/55">Scan the guest's QR code or type the code printed under it.</p>
      {canScan && (
        <button onClick={scanning ? stop : start} className="btn btn-gold mt-5 w-full">
          <Camera size={16} /> {scanning ? "Stop camera" : "Scan QR code"}
        </button>
      )}
      {scanning && <video ref={videoRef} className="mt-4 aspect-square w-full bg-black object-cover" playsInline muted />}
      <form onSubmit={(e) => { e.preventDefault(); void check(text); }} className="mt-4 flex gap-2">
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="TNK-XXXXXXXX" autoCapitalize="characters" />
        <button className="btn btn-dark" aria-label="Check in"><Check size={16} /></button>
      </form>
      {result && <div className={`mt-4 p-4 text-sm font-bold ${result.ok ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>{result.message}</div>}
    </div>
  );
}

export function eventSummary(e: TankEvent) {
  return `${eventWhen(e.startsAt)} · ${e.venue}${e.area ? `, ${e.area}` : ""}`;
}
