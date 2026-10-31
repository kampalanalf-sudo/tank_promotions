import { useEffect, useState } from "react";
import { Logo } from "./components";
import { api } from "./lib/api";

function readSmsQuery() {
  const hash = window.location.hash.replace(/^#\/sms\??/, "");
  const params = new URLSearchParams(hash);
  return { key: params.get("key") || "", text: params.get("text") || "" };
}

/** Opened by the merchant phone when a payment SMS arrives. Issues the matching ticket. */
export default function SmsConfirm() {
  const [query, setQuery] = useState(readSmsQuery);
  const [message, setMessage] = useState("Checking the payment SMS…");
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    const onHash = () => setQuery(readSmsQuery());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!query.text) {
      setOk(false);
      setMessage("No SMS text was included.");
      return;
    }
    setOk(null);
    setMessage("Checking the payment SMS…");
    let live = true;
    api.applyPaymentSms(query.key, query.text).then((result) => {
      if (!live) return;
      setOk(result.ok);
      setMessage(result.message);
    });
    return () => {
      live = false;
    };
  }, [query.key, query.text]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#0c0c0b] px-6 text-[#efe8d8]">
      <div className="w-full max-w-md">
        <Logo light />
        <p className="eyebrow mt-10">Option A · Payment SMS</p>
        <h1 className="display mt-2 text-5xl">{ok ? "Ticket issued" : ok === false ? "Not matched" : "Checking"}</h1>
        <p className="mt-4 text-sm leading-6 text-white/70">{message}</p>
      </div>
    </main>
  );
}
