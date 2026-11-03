export function ugx(n: number) {
  return n === 0 ? "Free" : `UGX ${n.toLocaleString("en-UG")}`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function dateParts(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: "--", month: "---", full: "", time: "" };
  return {
    day: String(d.getDate()).padStart(2, "0"),
    month: MONTHS[d.getMonth()],
    full: d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    time: d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }),
  };
}

export function eventWhen(iso: string) {
  const p = dateParts(iso);
  return p.full ? `${p.full}, ${p.time}` : "";
}

export type DateFilter = "any" | "today" | "weekend" | "week" | "month";

export const DATE_FILTERS: [DateFilter, string][] = [
  ["any", "Any date"],
  ["today", "Today"],
  ["weekend", "This weekend"],
  ["week", "Next 7 days"],
  ["month", "This month"],
];

export function matchesDate(iso: string, f: DateFilter, now = new Date()) {
  if (f === "any") return true;
  const d = new Date(iso);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = (n: number) => new Date(start.getTime() + n * 86400e3);
  if (f === "today") return d < days(1);
  if (f === "week") return d < days(7);
  if (f === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  // weekend: Friday 17:00 to Sunday night of the current week (or the coming one)
  const dow = start.getDay(); // 0 Sun … 6 Sat
  const toFri = dow === 0 ? -2 : 5 - dow;
  const fri = new Date(days(toFri).getTime() + 17 * 3600e3);
  const monday = days(toFri + 3);
  return d >= fri && d < monday;
}

export function mapsLink(venue: string, area: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venue, area, "Uganda"].filter(Boolean).join(", "))}`;
}

export function calendarLink(e: { title: string; startsAt: string; venue: string; area: string; description: string }) {
  const s = new Date(e.startsAt);
  const end = new Date(s.getTime() + 4 * 3600e3);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${fmt(s)}/${fmt(end)}`,
    location: [e.venue, e.area].filter(Boolean).join(", "),
    details: e.description.slice(0, 500),
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** Value for <input type="datetime-local"> from an ISO string, in local time. */
export function toLocalInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
