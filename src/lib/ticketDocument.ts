import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import qrcode from "qrcode-generator";

/** Pure ticket PDF generation shared by the browser download button and Supabase Edge Functions. */
export type TicketDocumentPayload = {
  c: string;
  t: string;
  w: string;
  v: string;
  n: string;
  q: number;
  a: number;
  cur?: string;
};

function base64Url(bytes: Uint8Array) {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function ticketDocumentLink(p: TicketDocumentPayload, baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const json = JSON.stringify({ c: p.c, t: p.t, w: p.w, v: p.v, n: p.n, q: p.q, a: p.a });
  return `${base}/#/t/${p.c}.${base64Url(new TextEncoder().encode(json))}`;
}

export function ticketWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "full", timeStyle: "short" }).format(d);
}

export function ticketMoney(amount: number, currency = "UGX") {
  try {
    return new Intl.NumberFormat("en-UG", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

function clean(text: string) {
  return text.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?").replace(/\s+/g, " ").trim();
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = clean(text).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawWrapped(page: PDFPage, text: string, font: PDFFont, size: number, x: number, y: number, maxWidth: number, lineHeight: number, color = rgb(0.05, 0.05, 0.04)) {
  let cursor = y;
  for (const line of wrap(text, font, size, maxWidth)) {
    page.drawText(line, { x, y: cursor, size, font, color });
    cursor -= lineHeight;
  }
  return cursor;
}

function drawQr(page: PDFPage, link: string, x: number, y: number, size: number) {
  const qr = qrcode(0, "M");
  qr.addData(link);
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / count;
  page.drawRectangle({ x: x - 6, y: y - 6, width: size + 12, height: size + 12, color: rgb(1, 1, 1) });
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        page.drawRectangle({ x: x + col * cell, y: y + (count - 1 - row) * cell, width: cell + 0.2, height: cell + 0.2, color: rgb(0.05, 0.05, 0.04) });
      }
    }
  }
}

export async function buildTicketPdf(p: TicketDocumentPayload, opts: { baseUrl?: string; ticketUrl?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`TANK Ticket ${p.c}`);
  doc.setAuthor("TANK Tickets");
  const page = doc.addPage([420, 595]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const gold = rgb(0.79, 0.64, 0.15);
  const black = rgb(0.05, 0.05, 0.04);
  const muted = rgb(0.35, 0.33, 0.28);
  const link = opts.ticketUrl || ticketDocumentLink(p, opts.baseUrl || "https://tanktickets.site");

  page.drawRectangle({ x: 0, y: 505, width: 420, height: 90, color: black });
  page.drawText("TANK TICKETS", { x: 28, y: 552, size: 22, font: bold, color: gold });
  page.drawText("Official entry ticket", { x: 28, y: 530, size: 10, font: regular, color: rgb(0.94, 0.91, 0.85) });

  let y = 474;
  y = drawWrapped(page, p.t, bold, 20, 28, y, 364, 24);
  y -= 6;
  y = drawWrapped(page, ticketWhen(p.w), regular, 11, 28, y, 364, 15, muted);
  y = drawWrapped(page, p.v || "Venue to be announced", regular, 11, 28, y, 364, 15, muted);
  y -= 10;

  page.drawLine({ start: { x: 28, y }, end: { x: 392, y }, thickness: 1, color: rgb(0.8, 0.77, 0.68), dashArray: [3, 3] });
  y -= 24;
  page.drawText("Guest", { x: 28, y, size: 9, font: bold, color: muted });
  page.drawText(clean(p.n), { x: 28, y: y - 16, size: 13, font: bold, color: black });
  page.drawText("Tickets", { x: 230, y, size: 9, font: bold, color: muted });
  page.drawText(String(p.q), { x: 230, y: y - 16, size: 13, font: bold, color: black });
  page.drawText("Amount", { x: 300, y, size: 9, font: bold, color: muted });
  page.drawText(clean(ticketMoney(p.a, p.cur)), { x: 300, y: y - 16, size: 12, font: bold, color: black });

  const qrSize = 132;
  drawQr(page, link, 28, 92, qrSize);
  page.drawText("Scan at the door", { x: 28, y: 72, size: 9, font: bold, color: muted });
  page.drawText("Ticket code", { x: 190, y: 200, size: 9, font: bold, color: muted });
  drawWrapped(page, p.c, bold, 16, 190, 180, 202, 20, gold);
  drawWrapped(page, "Keep this ticket safe. One QR code admits the number of guests shown above. Valid only after verified payment.", regular, 9, 190, 146, 202, 13, muted);
  drawWrapped(page, "Support: +256 775 497 509", regular, 9, 190, 96, 202, 13, muted);

  page.drawRectangle({ x: 0, y: 0, width: 420, height: 40, color: black });
  page.drawText("tanktickets.site", { x: 28, y: 16, size: 10, font: bold, color: gold });
  page.drawText(clean(p.c), { x: 300, y: 16, size: 9, font: regular, color: rgb(0.94, 0.91, 0.85) });

  return doc.save();
}

export async function downloadTicketPdf(p: TicketDocumentPayload) {
  const bytes = await buildTicketPdf(p, { baseUrl: `${window.location.origin}${window.location.pathname}` });
  const buffer = bytes.slice().buffer as ArrayBuffer;
  const blob = new Blob([buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${p.c}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
