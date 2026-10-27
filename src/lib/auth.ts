import { db, sha256 } from "./store";
import type { Session, User } from "./types";

const SESSION_KEY = "tank.session";

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (session.exp < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function setSession(user: User) {
  const session: Session = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

export async function login(email: string, password: string) {
  const hash = await sha256(password);
  const user = db.users().find((u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.passwordHash === hash);
  if (!user) throw new Error("Wrong email or password.");
  return setSession(user);
}

export async function register(input: { name: string; email: string; phone: string; password: string }) {
  const users = db.users();
  if (users.some((u) => u.email.toLowerCase() === input.email.trim().toLowerCase())) {
    throw new Error("That email is already registered.");
  }
  const user: User = {
    id: db.uid(),
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    passwordHash: await sha256(input.password),
    role: "guest",
  };
  db.saveUsers([...users, user]);
  return setSession(user);
}
