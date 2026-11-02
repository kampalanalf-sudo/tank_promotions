import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { parsePaymentSms, smsAlreadyApplied, smsMatchesOrder } from "./sms";
import {
  DEFAULT_SETTINGS,
  type Brief,
  type EventInput,
  type EventStatus,
  type Order,
  type OrderInput,
  type OrderStatus,
  type Session,
  type Settings,
  type TankEvent,
} from "./types";

export const cloud: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
export const isCloud = Boolean(cloud);

/** Admin is decided by email address only. */
export function roleFor(email: string): "admin" | "user" {
  return email.trim().toLowerCase() === ADMIN_EMAIL ? "admin" : "user";
}

export type CheckInResult = { ok: boolean; message: string; order?: Order };

/* ----------------------------- shared helpers ----------------------------- */

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function sha256(value: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const PAID: OrderStatus[] = ["SUCCEEDED", "CHECKED_IN"];

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToEvent(r: any, sold = 0): TankEvent {
  return {
    id: r.id,
    ownerId: r.owner_id,
    title: r.title,
    type: r.type,
    venue: r.venue,
    area: r.area,
    startsAt: r.starts_at,
    price: r.price,
    capacity: r.capacity,
    sold,
    image: r.image || "",
    description: r.description || "",
    organizerName: r.organizer_name || "",
    organizerPhone: r.organizer_phone || "",
    status: r.status,
    createdAt: r.created_at,
  };
}

function rowToOrder(r: any): Order {
  return {
    id: r.id,
    code: r.code,
    eventId: r.event_id,
    eventTitle: r.event_title,
    userId: r.user_id,
    name: r.name,
    phone: r.phone,
    email: r.email || "",
    qty: r.qty,
    amount: r.amount,
    status: r.status,
    paymentRef: r.payment_ref ?? r.zenga_ref ?? "",
    externalRef: r.external_ref || "",
    createdAt: r.created_at,
  };
}

function rowToBrief(r: any): Brief {
  return { id: r.id, venue: r.venue, area: r.area, date: r.date, type: r.type, phone: r.phone, note: r.note, createdAt: r.created_at, status: r.status };
}

function rowToSettings(r: any): Settings {
  if (!r) return { ...DEFAULT_SETTINGS };
  return {
    emailServiceId: r.email_service_id || "",
    emailTemplateId: r.email_template_id || "",
    emailPublicKey: r.email_public_key || "",
    mtnMerchantCode: r.mtn_merchant_code || "",
    mtnMerchantName: r.mtn_merchant_name || "",
    airtelMerchantCode: r.airtel_merchant_code || "",
    airtelMerchantName: r.airtel_merchant_name || "",
    smsSecret: r.sms_secret || "",
  };
}

function eventToRow(e: EventInput) {
  return {
    title: e.title.trim(),
    type: e.type,
    venue: e.venue.trim(),
    area: e.area.trim(),
    starts_at: e.startsAt,
    price: Math.max(0, Math.round(e.price)),
    capacity: Math.max(1, Math.round(e.capacity)),
    image: e.image,
    description: e.description.trim(),
    organizer_name: e.organizerName.trim(),
    organizer_phone: e.organizerPhone.trim(),
  };
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/* ------------------------------ local storage ----------------------------- */

type LocalUser = Session & { passwordHash: string };

const K = {
  users: "tankt.users",
  session: "tankt.session",
  events: "tankt.events",
  orders: "tankt.orders",
  briefs: "tankt.briefs",
  settings: "tankt.settings",
};

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

/** Reads orders and upgrades any old local payment-reference field. */
function readOrders(): Order[] {
  return read<Array<Order & { zengaRef?: string }>>(K.orders, []).map((o) => ({
    ...o,
    paymentRef: o.paymentRef ?? o.zengaRef ?? "",
  }));
}

type LocalEvent = Omit<TankEvent, "sold">;

function localSold(eventId: string) {
  return readOrders()
    .filter((o) => o.eventId === eventId && PAID.includes(o.status))
    .reduce((s, o) => s + o.qty, 0);
}

function localSession(): Session | null {
  return read<Session | null>(K.session, null);
}

/* --------------------------------- the API -------------------------------- */

export const api = {
  /* ---------- auth ---------- */
  async getSession(): Promise<Session | null> {
    if (!cloud) {
      const s = localSession();
      return s ? { ...s, role: roleFor(s.email) } : null;
    }
    const { data } = await cloud.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const { data: profile } = await cloud.from("profiles").select("*").eq("id", user.id).maybeSingle();
    return {
      userId: user.id,
      email: user.email || "",
      name: profile?.name || (user.user_metadata?.name as string) || user.email || "",
      phone: profile?.phone || (user.user_metadata?.phone as string) || "",
      role: user.email_confirmed_at ? roleFor(user.email || "") : "user",
    };
  },

  onAuthChange(cb: (event: string) => void) {
    if (!cloud) return () => {};
    const { data } = cloud.auth.onAuthStateChange((event) => cb(event));
    return () => data.subscription.unsubscribe();
  },

  async signUp(input: { name: string; email: string; phone: string; password: string }): Promise<{ needsConfirm: boolean }> {
    const email = input.email.trim().toLowerCase();
    if (cloud) {
      const { data, error } = await cloud.auth.signUp({
        email,
        password: input.password,
        options: {
          data: { name: input.name.trim(), phone: input.phone.trim() },
          emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
        },
      });
      fail(error);
      return { needsConfirm: !data.session };
    }
    const users = read<LocalUser[]>(K.users, []);
    if (users.some((u) => u.email === email)) throw new Error("That email is already registered.");
    const user: LocalUser = {
      userId: uid(),
      name: input.name.trim(),
      email,
      phone: input.phone.trim(),
      role: roleFor(email),
      passwordHash: await sha256(input.password),
    };
    write(K.users, [...users, user]);
    const { passwordHash: _ph, ...session } = user;
    void _ph;
    write(K.session, session);
    return { needsConfirm: false };
  },

  async signIn(email: string, password: string): Promise<void> {
    const clean = email.trim().toLowerCase();
    if (cloud) {
      const { error } = await cloud.auth.signInWithPassword({ email: clean, password });
      if (error) throw new Error(error.message.includes("confirm") ? "Please confirm your email first. Check your inbox." : "Wrong email or password.");
      return;
    }
    const hash = await sha256(password);
    const user = read<LocalUser[]>(K.users, []).find((u) => u.email === clean && u.passwordHash === hash);
    if (!user) throw new Error("Wrong email or password.");
    const { passwordHash: _ph, ...session } = user;
    void _ph;
    write(K.session, { ...session, role: roleFor(session.email) });
  },

  async resetPassword(email: string) {
    if (!cloud) throw new Error("Password reset needs the online database to be connected.");
    const { error } = await cloud.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}${window.location.pathname}`,
    });
    fail(error);
  },

  async updatePassword(password: string) {
    if (!cloud) throw new Error("Not available on this device-only setup.");
    const { error } = await cloud.auth.updateUser({ password });
    fail(error);
  },

  async signOut() {
    if (cloud) await cloud.auth.signOut();
    localStorage.removeItem(K.session);
  },

  /* ---------- events ---------- */
  async soldCounts(): Promise<Record<string, number>> {
    if (!cloud) return {};
    const { data, error } = await cloud.rpc("event_sold_counts");
    fail(error);
    const map: Record<string, number> = {};
    (data as { event_id: string; sold: number }[] | null)?.forEach((r) => (map[r.event_id] = Number(r.sold)));
    return map;
  },

  async listEvents(scope: "public" | "mine" | "all", session?: Session | null): Promise<TankEvent[]> {
    if (cloud) {
      let q = cloud.from("events").select("*").order("starts_at", { ascending: true });
      if (scope === "public") q = q.eq("status", "published").gte("starts_at", new Date(Date.now() - 12 * 3600e3).toISOString());
      if (scope === "mine") q = q.eq("owner_id", session?.userId || "");
      const [{ data, error }, sold] = await Promise.all([q, api.soldCounts()]);
      fail(error);
      return (data || []).map((r) => rowToEvent(r, sold[r.id] || 0));
    }
    const cutoff = Date.now() - 12 * 3600e3;
    return read<LocalEvent[]>(K.events, [])
      .filter((e) => {
        if (scope === "public") return e.status === "published" && new Date(e.startsAt).getTime() >= cutoff;
        if (scope === "mine") return e.ownerId === session?.userId;
        return true;
      })
      .map((e) => ({ ...e, sold: localSold(e.id) }))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  },

  /** One event, if the viewer may see it (live, or their own, or they are admin). */
  async getEvent(id: string, session: Session | null): Promise<TankEvent | null> {
    if (cloud) {
      const [{ data, error }, sold] = await Promise.all([cloud.from("events").select("*").eq("id", id).maybeSingle(), api.soldCounts()]);
      if (error || !data) return null;
      return rowToEvent(data, sold[data.id] || 0);
    }
    const e = read<LocalEvent[]>(K.events, []).find((x) => x.id === id);
    if (!e) return null;
    const allowed = e.status === "published" || e.ownerId === session?.userId || session?.role === "admin";
    return allowed ? { ...e, sold: localSold(e.id) } : null;
  },

  async saveEvent(input: EventInput, session: Session): Promise<void> {
    if (cloud) {
      const row = eventToRow(input);
      if (input.id) {
        const { error } = await cloud.from("events").update(row).eq("id", input.id);
        fail(error);
      } else {
        const { error } = await cloud.from("events").insert({ ...row, owner_id: session.userId });
        fail(error);
      }
      return;
    }
    const rows = read<LocalEvent[]>(K.events, []);
    if (input.id) {
      write(K.events, rows.map((e) => (e.id === input.id ? { ...e, ...input, id: e.id } : e)));
    } else {
      const { id: _id, ...rest } = input;
      void _id;
      rows.push({
        ...rest,
        id: uid(),
        ownerId: session.userId,
        status: session.role === "admin" ? "published" : "pending",
        createdAt: new Date().toISOString(),
      });
      write(K.events, rows);
    }
  },

  async setEventStatus(id: string, status: EventStatus) {
    if (cloud) {
      const { error } = await cloud.from("events").update({ status }).eq("id", id);
      fail(error);
      return;
    }
    write(K.events, read<LocalEvent[]>(K.events, []).map((e) => (e.id === id ? { ...e, status } : e)));
  },

  async deleteEvent(id: string) {
    if (cloud) {
      const { error } = await cloud.from("events").delete().eq("id", id);
      fail(error);
      return;
    }
    write(K.events, read<LocalEvent[]>(K.events, []).filter((e) => e.id !== id));
    write(K.orders, readOrders().filter((o) => o.eventId !== id));
  },

  /* ---------- orders ---------- */
  async createOrder(input: OrderInput): Promise<Order> {
    if (cloud) {
      const { data, error } = await cloud.rpc("create_order", {
        p_event_id: input.eventId,
        p_code: input.code,
        p_name: input.name.trim(),
        p_phone: input.phone,
        p_email: input.email.trim().toLowerCase(),
        p_qty: input.qty,
        p_external_ref: input.externalRef,
      });
      fail(error);
      return rowToOrder(data);
    }
    const event = read<LocalEvent[]>(K.events, []).find((e) => e.id === input.eventId && e.status === "published");
    if (!event) throw new Error("This event is not available.");
    if (localSold(event.id) + input.qty > event.capacity) throw new Error("Not enough tickets left.");
    const amount = event.price * input.qty;
    const order: Order = {
      id: uid(),
      code: input.code,
      eventId: event.id,
      eventTitle: event.title,
      userId: localSession()?.userId || null,
      name: input.name.trim(),
      phone: input.phone,
      email: input.email.trim().toLowerCase(),
      qty: input.qty,
      amount,
      status: amount === 0 ? "SUCCEEDED" : "PENDING",
      paymentRef: "",
      externalRef: input.externalRef,
      createdAt: new Date().toISOString(),
    };
    write(K.orders, [order, ...readOrders()]);
    return order;
  },

  /** Records the merchant payment reference (status PENDING) or the final payment result. */
  async confirmOrder(code: string, status: "PENDING" | "SUCCEEDED" | "FAILED", paymentRef = "") {
    if (cloud) {
      const { error } = await cloud.rpc("confirm_order", { p_code: code, p_status: status, p_payment_ref: paymentRef });
      fail(error);
      return;
    }
    write(
      K.orders,
      readOrders().map((o) =>
        o.code === code && o.status === "PENDING" ? { ...o, status, paymentRef: paymentRef || o.paymentRef } : o,
      ),
    );
  },

  async listOrders(scope: { all: true } | { eventIds: string[] } | { mine: Session }): Promise<Order[]> {
    if (cloud) {
      let q = cloud.from("orders").select("*").order("created_at", { ascending: false });
      if ("eventIds" in scope) {
        if (!scope.eventIds.length) return [];
        q = q.in("event_id", scope.eventIds);
      }
      if ("mine" in scope) q = q.or(`user_id.eq.${scope.mine.userId},email.eq.${scope.mine.email}`);
      const { data, error } = await q;
      fail(error);
      return (data || []).map(rowToOrder);
    }
    const rows = readOrders();
    if ("eventIds" in scope) return rows.filter((o) => scope.eventIds.includes(o.eventId));
    if ("mine" in scope) return rows.filter((o) => o.userId === scope.mine.userId || (o.email && o.email === scope.mine.email));
    return rows;
  },

  async ticketStatus(code: string): Promise<OrderStatus | null> {
    if (cloud) {
      const { data } = await cloud.rpc("ticket_status", { p_code: code });
      return (data as OrderStatus | null) || null;
    }
    return readOrders().find((o) => o.code === code)?.status || null;
  },

  async checkIn(code: string, session: Session): Promise<CheckInResult> {
    if (cloud) {
      const { data, error } = await cloud.rpc("check_in", { p_code: code });
      if (error) return { ok: false, message: error.message };
      const res = data as { ok: boolean; message: string; order?: any };
      return { ok: res.ok, message: res.message, order: res.order ? rowToOrder(res.order) : undefined };
    }
    const orders = readOrders();
    const order = orders.find((o) => o.code === code);
    if (!order) return { ok: false, message: "No ticket with that code." };
    const event = read<LocalEvent[]>(K.events, []).find((e) => e.id === order.eventId);
    if (session.role !== "admin" && event?.ownerId !== session.userId) return { ok: false, message: "This ticket is for another organizer's event." };
    if (order.status === "CHECKED_IN") return { ok: false, message: `Already checked in: ${order.name}`, order };
    if (order.status !== "SUCCEEDED") return { ok: false, message: "This ticket has not been paid.", order };
    write(K.orders, orders.map((o) => (o.code === code ? { ...o, status: "CHECKED_IN" } : o)));
    return { ok: true, message: `Welcome ${order.name} · ${order.qty} guest(s)`, order: { ...order, status: "CHECKED_IN" } };
  },

  /* ---------- briefs ---------- */
  async addBrief(b: Omit<Brief, "id" | "createdAt" | "status">) {
    if (cloud) {
      const { error } = await cloud.from("briefs").insert(b);
      fail(error);
      return;
    }
    write(K.briefs, [{ ...b, id: uid(), createdAt: new Date().toISOString(), status: "New" }, ...read<Brief[]>(K.briefs, [])]);
  },

  async listBriefs(): Promise<Brief[]> {
    if (cloud) {
      const { data, error } = await cloud.from("briefs").select("*").order("created_at", { ascending: false });
      fail(error);
      return (data || []).map(rowToBrief);
    }
    return read<Brief[]>(K.briefs, []);
  },

  async setBriefStatus(id: string, status: Brief["status"]) {
    if (cloud) {
      const { error } = await cloud.from("briefs").update({ status }).eq("id", id);
      fail(error);
      return;
    }
    write(K.briefs, read<Brief[]>(K.briefs, []).map((b) => (b.id === id ? { ...b, status } : b)));
  },

  /* ---------- settings ---------- */
  async getSettings(): Promise<Settings> {
    if (cloud) {
      const full = await cloud.from("settings").select("*").eq("id", 1).maybeSingle();
      if (full.data) return rowToSettings(full.data);
      const pub = await cloud.rpc("storefront_settings");
      return rowToSettings(pub.data);
    }
    const local = { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K.settings, {}) };
    if (!local.airtelMerchantCode || local.airtelMerchantCode === "7185040") {
      local.airtelMerchantCode = DEFAULT_SETTINGS.airtelMerchantCode;
    }
    if (!local.mtnMerchantCode) local.mtnMerchantCode = DEFAULT_SETTINGS.mtnMerchantCode;
    return local;
  },

  async saveSettings(s: Settings) {
    if (cloud) {
      const { error } = await cloud.from("settings").upsert({
        id: 1,
        email_service_id: s.emailServiceId.trim(),
        email_template_id: s.emailTemplateId.trim(),
        email_public_key: s.emailPublicKey.trim(),
        mtn_merchant_code: s.mtnMerchantCode.trim(),
        mtn_merchant_name: s.mtnMerchantName.trim(),
        airtel_merchant_code: s.airtelMerchantCode.trim(),
        airtel_merchant_name: s.airtelMerchantName.trim(),
        sms_secret: s.smsSecret.trim(),
      });
      fail(error);
      return;
    }
    write(K.settings, s);
  },

  /**
   * Matches a merchant confirmation SMS to a pending order and marks it paid.
   * The secret must match the one saved in Payments, so a stranger cannot issue tickets.
   */
  async applyPaymentSms(secret: string, text: string): Promise<{ ok: boolean; message: string; code?: string }> {
    const parsed = parsePaymentSms(text);
    if (parsed.amount == null) return { ok: false, message: "That message has no UGX amount, so it was ignored." };

    if (cloud) {
      const { data, error } = await cloud.rpc("apply_payment_sms", { p_secret: secret, p_text: text });
      if (error) return { ok: false, message: error.message };
      const res = data as { ok: boolean; message: string; code?: string };
      return res;
    }

    const settings = await api.getSettings();
    if (!settings.smsSecret || secret !== settings.smsSecret) return { ok: false, message: "Wrong confirmation key." };
    const all = readOrders();
    const prior = smsAlreadyApplied(parsed, all);
    if (prior) return { ok: true, message: "This payment was already processed.", code: prior.code };
    const hits = all.filter((o) => smsMatchesOrder(parsed, o));
    if (hits.length !== 1) {
      return { ok: false, message: hits.length === 0 ? "No waiting payment matches that number and exact amount." : "More than one waiting payment matches. Ask the buyer to include the TNK reference." };
    }
    await api.confirmOrder(hits[0].code, "SUCCEEDED", parsed.paymentRef || "SMS");
    return { ok: true, message: `Ticket issued for ${hits[0].name}.`, code: hits[0].code };
  },
};
