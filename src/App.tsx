import { useCallback, useEffect, useState } from "react";
import Admin from "./Admin";
import { AuthScreen } from "./Auth";
import { Logo, Notice, TicketCard } from "./components";
import Dashboard from "./Dashboard";
import EventPage from "./EventPage";
import Guides from "./Guides";
import Home from "./Home";
import SmsConfirm from "./SmsConfirm";
import { api, isCloud } from "./lib/api";
import { parseTicketRoute, type TicketPayload } from "./lib/tickets";
import type { OrderStatus, Session, Settings } from "./lib/types";

function useRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  if (!hash.startsWith("#/")) return "/";
  return hash.slice(1).split("#")[0] || "/";
}

export default function App() {
  const route = useRoute();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  const refresh = useCallback(async () => {
    setSession(await api.getSession().catch(() => null));
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    api.getSettings().then(setSettings).catch(() => setSettings(null));
    const off = api.onAuthChange((event) => {
      if (event === "PASSWORD_RECOVERY") window.location.hash = "/new-password";
      void refresh();
    });
    window.addEventListener("tank-auth", refresh);
    return () => {
      off();
      window.removeEventListener("tank-auth", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (window.location.hash !== "#/#events") window.scrollTo(0, 0);
  }, [route]);

  if (!ready) return <div className="grid min-h-screen place-items-center bg-[#0c0c0b] text-[#c9a227]"><span className="wordmark">TANK TICKETS</span></div>;

  const ticket = parseTicketRoute(route);
  if (ticket) return <TicketPage payload={ticket} settings={settings} />;

  if (route === "/guides") return <Guides session={session} />;
  if (route.startsWith("/sms")) return <SmsConfirm />;
  if (route.startsWith("/e/")) return <EventPage key={route} id={route.slice(3)} session={session} settings={settings} />;

  if (route === "/login") return session ? <Redirect to="/dashboard" /> : <AuthScreen mode="login" />;
  if (route === "/register") return session ? <Redirect to="/dashboard" /> : <AuthScreen mode="register" />;
  if (route === "/register/sell") return session ? <Redirect to="/dashboard/new" /> : <AuthScreen mode="register" next="/dashboard/new" />;
  if (route === "/forgot") return <AuthScreen mode="forgot" />;
  if (route === "/new-password") return <AuthScreen mode="new-password" />;

  if (route.startsWith("/dashboard")) {
    if (!session) return <AuthScreen mode="login" next={route} />;
    return <Dashboard key={route} session={session} settings={settings} initialTab={route === "/dashboard/new" ? "My events" : undefined} />;
  }
  if (route === "/admin") {
    if (!session) return <AuthScreen mode="login" next="/admin" />;
    if (session.role !== "admin") return <Redirect to="/dashboard" />;
    return <Admin session={session} settings={settings} onSettings={setSettings} />;
  }

  return <Home session={session} />;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.hash = to;
  }, [to]);
  return null;
}

function TicketPage({ payload, settings }: { payload: TicketPayload; settings: Settings | null }) {
  const [status, setStatus] = useState<OrderStatus | null | "loading">("loading");

  useEffect(() => {
    api.ticketStatus(payload.c).then(setStatus).catch(() => setStatus(null));
  }, [payload.c]);

  return (
    <main className="min-h-screen bg-[#0c0c0b] px-4 py-10 text-[#efe8d8]">
      <div className="mx-auto max-w-lg">
        <Logo light />
        <h1 className="display mt-8 text-5xl">Your ticket</h1>
        <p className="mt-2 text-sm text-white/55">Show this QR code at the door. Turn your screen brightness up.</p>
        <div className="mt-5">
          {status === "SUCCEEDED" && <Notice tone="ok"><span className="text-emerald-200">Valid ticket ✓</span></Notice>}
          {status === "CHECKED_IN" && <Notice tone="info">This ticket has already been used to enter.</Notice>}
          {status === "PENDING" && <Notice tone="warn">Payment for this ticket was not completed.</Notice>}
          {status === "FAILED" && <Notice tone="error">This ticket's payment failed. It is not valid.</Notice>}
          {status === null && isCloud && <Notice tone="error">We couldn't find this ticket. Please contact the organizer.</Notice>}
        </div>
        <div className="mt-5 text-[#0c0c0b]"><TicketCard payload={payload} settings={settings} /></div>
        <a href="#/" className="btn btn-line-light mt-6 w-full">Find more events</a>
      </div>
    </main>
  );
}
