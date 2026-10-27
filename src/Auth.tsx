import { useState } from "react";
import { login, register } from "./lib/auth";

function LogoMark() {
  return (
    <a href="#/" className="flex items-center gap-3 text-white" aria-label="TANK Promotions home">
      <span className="mark"><img src="logo.jpg" alt="" /></span>
      <span className="wordmark">TANK PROMOTIONS</span>
    </a>
  );
}

export function AuthScreen({ mode }: { mode: "login" | "register" }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(mode === "login" ? "admin@tankpromotions.online" : "");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState(mode === "login" ? "Tank@2026" : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "register") await register({ name, email, phone, password });
      else await login(email, password);
      const session = JSON.parse(localStorage.getItem("tank.session") || "{}");
      window.location.hash = session.role === "admin" ? "/admin" : "/account";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen bg-[#0c0c0b] lg:grid-cols-2">
      <div className="relative hidden overflow-hidden lg:block">
        <img src="hero.jpg" alt="" className="h-full w-full object-cover opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
        <div className="absolute bottom-12 left-12 right-12 text-white">
          <p className="eyebrow">Kila Sekunde Ina Hesabu</p>
          <h1 className="display mt-4 max-w-lg text-6xl">Staff and guests. Same door.</h1>
        </div>
      </div>
      <div className="flex items-center px-6 py-16 text-[#efe8d8]">
        <form onSubmit={submit} className="mx-auto w-full max-w-md">
          <LogoMark />
          <h2 className="display mt-10 text-5xl">{mode === "login" ? "Sign in" : "Create account"}</h2>
          <p className="mt-3 text-sm text-white/50">
            {mode === "login" ? "Admin desk or guest tickets." : "Save your TANK passes against your phone."}
          </p>
          {mode === "register" && <input className="field field-dark mt-8" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required />}
          <input className="field field-dark mt-3" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {mode === "register" && <input className="field field-dark mt-3" placeholder="WhatsApp / MoMo number" value={phone} onChange={(e) => setPhone(e.target.value)} required />}
          <input className="field field-dark mt-3" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          {error && <p className="mt-3 text-sm text-[#e9a824]">{error}</p>}
          <button className="btn btn-gold mt-6 w-full" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Enter" : "Register"}</button>
          {mode === "login" ? (
            <p className="mt-6 text-sm text-white/45">New guest? <a href="#/register" className="text-[#c9a227]">Create an account</a></p>
          ) : (
            <p className="mt-6 text-sm text-white/45">Already on the list? <a href="#/login" className="text-[#c9a227]">Sign in</a></p>
          )}
          <p className="mt-8 text-[11px] uppercase tracking-widest text-white/30">Demo admin · admin@tankpromotions.online · Tank@2026</p>
        </form>
      </div>
    </main>
  );
}
