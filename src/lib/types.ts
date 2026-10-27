export type Role = "admin" | "guest";

export type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: Role;
};

export type Session = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  exp: number;
};

export type Night = {
  id: number;
  day: string;
  month: string;
  date: string;
  title: string;
  type: string;
  venue: string;
  area: string;
  time: string;
  price: number;
  image: string;
  spots: number;
};

export type Order = {
  id: string;
  code: string;
  nightId: number;
  nightTitle: string;
  name: string;
  phone: string;
  email?: string;
  qty: number;
  amount: number;
  network: "MTN" | "Airtel" | "Other";
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "CHECKED_IN";
  zengaRef: string;
  externalRef: string;
  createdAt: string;
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
  zengaEnv: "sandbox" | "production";
  zengaToken: string;
  simulate: boolean;
};
