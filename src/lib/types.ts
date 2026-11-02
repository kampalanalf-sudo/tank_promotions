export type Role = "admin" | "user";

export type Session = {
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
};

export type EventStatus = "pending" | "published" | "rejected";

export type TankEvent = {
  id: string;
  ownerId: string;
  title: string;
  type: string;
  venue: string;
  area: string;
  startsAt: string;
  price: number;
  capacity: number;
  sold: number;
  image: string;
  description: string;
  organizerName: string;
  organizerPhone: string;
  status: EventStatus;
  createdAt: string;
};

export type EventInput = Omit<TankEvent, "id" | "ownerId" | "sold" | "status" | "createdAt"> & { id?: string };

export type OrderStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "CHECKED_IN";

export type Order = {
  id: string;
  code: string;
  eventId: string;
  eventTitle: string;
  userId: string | null;
  name: string;
  phone: string;
  email: string;
  qty: number;
  amount: number;
  status: OrderStatus;
  paymentRef: string;
  externalRef: string;
  createdAt: string;
};

export type OrderInput = {
  eventId: string;
  code: string;
  name: string;
  phone: string;
  email: string;
  qty: number;
  externalRef: string;
};

export type Brief = {
  id: string;
  venue: string;
  area: string;
  date: string;
  type: string;
  phone: string;
  note: string;
  createdAt: string;
  status: "New" | "In review" | "Replied";
};

export type Settings = {
  emailServiceId: string;
  emailTemplateId: string;
  emailPublicKey: string;
  mtnMerchantCode: string;
  mtnMerchantName: string;
  airtelMerchantCode: string;
  airtelMerchantName: string;
  smsSecret: string;
};

export const DEFAULT_SETTINGS: Settings = {
  emailServiceId: "",
  emailTemplateId: "",
  emailPublicKey: "",
  mtnMerchantCode: "89713371",
  mtnMerchantName: "TANK Promotions",
  airtelMerchantCode: "7280543",
  airtelMerchantName: "TANK Promotions",
  smsSecret: "",
};

export const EVENT_TYPES = ["Nightlife", "Live music", "Dining", "Party", "Festival", "Sports", "Conference", "Activation", "Other"];
