import { useState } from "react";
import { Logo } from "./components";
import { api, isCloud } from "./lib/api";
import { ADMIN_EMAIL } from "./lib/config";
import { isValidUgPhone, toMsisdn } from "./lib/zengapay";

type Mode = "login" | "register" | "forgot" | "new-password";

export function AuthScreen({ mode, next = "/dashboard" }: { mode: Mode; next?: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      if (mode === "register") {
        if (isCloud && email.trim().toLowerCase() === ADMIN_EMAIL) throw new Error("This email can't be registered here. Sign in instead.");
        if (!isValidUgPhone(phone)) throw new Error("Enter a Ugandan mobile number, e.g. 0772 123456.");
        const { needsConfirm } = await api.signUp({ name, email, phone: toMsisdn(phone), password });
        if (needsConfirm) {
          setInfo("Account created. Check your email and tap the confirmation link, then sign in.");
          return;
        }
      } else if (mode === "login") {
        await api.signIn(email, password);
      } else if (mode === "forgot") {
        await api.resetPassword(email);
        setInfo("If that email has an account, a reset link is on its way.");
        return;
      } else {
        await api.updatePassword(password);
      }
      window.location.hash = next;
      window.dispatchEvent(new Event("tank-auth"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue.");
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, string> = {
    login: "Sign in",
    register: "Create account",
    forgot: "Reset password",
    "new-password": "New password",
  };

  return (
    <main className="grid min-h-screen bg-[#0c0c0b] lg:grid-cols-2">
      <div className="relative hidden overflow-hidden lg:block">
        <img src="./hero.jpg" alt="" className="h-full w-full object-cover opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
        <div className="absolute bottom-12 left-12 right-12 text-white">
          <p className="eyebrow">Kila Sekunde Ina Hesabu</p>
          <h1 className="display mt-4 max-w-lg text-6xl">List your event. Sell tickets. Fill the room.</h1>
        </div>
      </div>
      <div className="flex items-center px-6 py-16 text-[#efe8d8]">
        <form onSubmit={submit} className="mx-auto w-full max-w-md">
          <Logo light />
          <h2 className="display mt-10 text-5xl">{titles[mode]}</h2>
          <p className="mt-3 text-sm text-white/50">
            {mode === "login" && "Organizers, guests and the TANK team."}
            {mode === "register" && "List events, sell tickets and keep all your tickets in one place."}
            {mode === "forgot" && "We will email you a link to choose a new password."}
            {mode === "new-password" && "Choose a new password for your account."}
          </p>

          {mode === "register" && (
            <>
              <input className="field field-dark mt-8" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              <input className="field field-dark mt-3" inputMode="tel" placeholder="WhatsApp number" value={phone} onChange={(e) => setPhone(e.target.value)} required autoComplete="tel" />
            </>
          )}
          {mode !== "new-password" && (
            <input className={`field field-dark ${mode === "register" ? "mt-3" : "mt-8"}`} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          )}
          {mode !== "forgot" && (
            <input
              className={`field field-dark ${mode === "new-password" ? "mt-8" : "mt-3"}`}
              type="password"
              placeholder={mode === "new-password" ? "New password" : "Password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          )}

          {error && <p className="mt-3 text-sm text-[#e9a824]">{error}</p>}
          {info && <p className="mt-3 text-sm text-emerald-300">{info}</p>}
          <button className="btn btn-gold mt-6 w-full" disabled={busy}>{busy ? "Please wait…" : titles[mode]}</button>

          <div className="mt-6 space-y-2 text-sm text-white/45">
            {mode === "login" && (
              <>
                <p>New here? <a href="#/register" className="text-[#c9a227]">Create an account</a></p>
                {isCloud && <p><a href="#/forgot" className="text-[#c9a227]">Forgot your password?</a></p>}
              </>
            )}
            {mode !== "login" && <p>Already have an account? <a href="#/login" className="text-[#c9a227]">Sign in</a></p>}
            {mode === "register" && !isCloud && (
              <p className="text-xs text-white/35">This site is not connected to its online database yet, so accounts are saved on this device only.</p>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}
