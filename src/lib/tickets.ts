import emailjs from "@emailjs/browser";
import QRCode from "qrcode";
import { eventWhen, ugx } from "./format";
import type { Order, Settings, TankEvent } from "./types";
import { toMsisdn } from "./phone";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newTicketCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `TNK-${[...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("")}`;
}

/** Pulls a ticket code out of typed text, a pasted link, or a scanned QR. */
export function extractCode(text: string) {
  return text.toUpperCase().match(/TNK-[A-Z0-9]{6,}/)?.[0] || "";
}

/** Ticket details travel inside the link so it opens on any phone. */
export type TicketPayload = {
  c: string; // code
  t: string; // event title
  w: string; // starts at (ISO)
  v: string; // venue, area
  n: string; // guest name
  q: number; // quantity
  a: number; // amount
};

function toBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string) {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function payloadFor(order: Order, event: TankEvent): TicketPayload {
  return {
    c: order.code,
    t: event.title,
    w: event.startsAt,
    v: [event.venue, event.area].filter(Boolean).join(", "),
    n: order.name,
    q: order.qty,
    a: order.amount,
  };
}

export function ticketLink(p: TicketPayload) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#/t/${p.c}.${toBase64Url(JSON.stringify(p))}`;
}

export function parseTicketRoute(route: string): TicketPayload | null {
  const m = route.match(/^\/t\/(TNK-[A-Z0-9]+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    const p = JSON.parse(fromBase64Url(m[2])) as TicketPayload;
    return p.c === m[1] ? p : null;
  } catch {
    return null;
  }
}

export function qrDataUrl(text: string) {
  return QRCode.toDataURL(text, { margin: 1, width: 320, color: { dark: "#0c0c0b", light: "#ffffff" } });
}

export function ticketMessage(p: TicketPayload) {
  return [
    `🎟️ Your TANK ticket`,
    ``,
    `${p.t}`,
    `📅 ${eventWhen(p.w)}`,
    `📍 ${p.v}`,
    `👤 ${p.n} · ${p.q} guest(s) · ${ugx(p.a)}`,
    ``,
    `Ticket code: ${p.c}`,
    `Show this QR at the door: ${ticketLink(p)}`,
  ].join("\n");
}

export function whatsappLink(phone: string, p: TicketPayload) {
  return `https://wa.me/${toMsisdn(phone)}?text=${encodeURIComponent(ticketMessage(p))}`;
}

export function emailConfigured(s: Settings) {
  return Boolean(s.emailServiceId && s.emailTemplateId && s.emailPublicKey);
}

/** Sends the ticket through EmailJS. Template variables are listed in Admin → Ticket delivery. */
export async function emailTicket(to: string, p: TicketPayload, s: Settings) {
  if (!emailConfigured(s)) throw new Error("Email delivery is not set up yet.");
  if (!to) throw new Error("No email address on this ticket.");
  await emailjs.send(
    s.emailServiceId,
    s.emailTemplateId,
    {
      to_email: to,
      to_name: p.n,
      event_title: p.t,
      event_date: eventWhen(p.w),
      venue: p.v,
      qty: p.q,
      amount: ugx(p.a),
      ticket_code: p.c,
      ticket_link: ticketLink(p),
      message: ticketMessage(p),
    },
    { publicKey: s.emailPublicKey },
  );
}

/** Shrinks an uploaded poster so it can be stored with the event. */
export function readPoster(file: File, maxWidth = 1100): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Please choose an image file."));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    };
    img.src = url;
  });
}
