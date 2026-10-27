import type { Brief, Night, Order, Settings, User } from "./types";

const K = {
  users: "tank.users",
  session: "tank.session",
  nights: "tank.nights",
  orders: "tank.orders",
  briefs: "tank.briefs",
  settings: "tank.settings",
};

export const SEED_NIGHTS: Night[] = [
  { id: 1, day: "08", month: "MAY", date: "Friday, 8 May 2026", title: "First Friday: Kololo", type: "Nightlife", venue: "Private rooftop", area: "Kololo", time: "9:00 PM", price: 30000, image: "event-rooftop.jpg", spots: 42 },
  { id: 2, day: "15", month: "MAY", date: "Friday, 15 May 2026", title: "After Hours", type: "Dining", venue: "Launch restaurant", area: "Bugolobi", time: "7:30 PM", price: 25000, image: "event-restaurant.jpg", spots: 28 },
  { id: 3, day: "17", month: "MAY", date: "Sunday, 17 May 2026", title: "Amapiano Sundays", type: "Nightlife", venue: "Weekend room", area: "Kansanga", time: "6:00 PM", price: 20000, image: "event-amapiano.jpg", spots: 80 },
  { id: 4, day: "23", month: "MAY", date: "Saturday, 23 May 2026", title: "Live Session", type: "Live", venue: "Central stage", area: "Kampala Central", time: "8:00 PM", price: 40000, image: "https://images.pexels.com/photos/3101521/pexels-photo-3101521.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=1400", spots: 55 },
  { id: 5, day: "29", month: "MAY", date: "Friday, 29 May 2026", title: "Brand Night", type: "Activation", venue: "Pop-up lounge", area: "Kololo", time: "6:30 PM", price: 15000, image: "work-activation.jpg", spots: 36 },
];

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

export async function sha256(value: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function seedStore() {
  if (!localStorage.getItem(K.nights)) write(K.nights, SEED_NIGHTS);
  if (!localStorage.getItem(K.orders)) write(K.orders, [] as Order[]);
  if (!localStorage.getItem(K.briefs)) write(K.briefs, [] as Brief[]);
  if (!localStorage.getItem(K.settings)) {
    write<Settings>(K.settings, { zengaEnv: "sandbox", zengaToken: "", simulate: true });
  }
  const users = read<User[]>(K.users, []);
  if (!users.some((u) => u.role === "admin")) {
    users.push({
      id: "admin-1",
      name: "TANK Admin",
      email: "admin@tankpromotions.online",
      phone: "256775497509",
      passwordHash: await sha256("Tank@2026"),
      role: "admin",
    });
    write(K.users, users);
  }
}

export const db = {
  users: () => read<User[]>(K.users, []),
  saveUsers: (rows: User[]) => write(K.users, rows),
  nights: () => {
    const rows = read<Night[]>(K.nights, SEED_NIGHTS);
    return rows.length ? rows : SEED_NIGHTS;
  },
  saveNights: (rows: Night[]) => write(K.nights, rows),
  orders: () => read<Order[]>(K.orders, []),
  saveOrders: (rows: Order[]) => write(K.orders, rows),
  briefs: () => read<Brief[]>(K.briefs, []),
  saveBriefs: (rows: Brief[]) => write(K.briefs, rows),
  settings: () => read<Settings>(K.settings, { zengaEnv: "sandbox", zengaToken: "", simulate: true }),
  saveSettings: (s: Settings) => write(K.settings, s),
  uid: () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}`),
};
