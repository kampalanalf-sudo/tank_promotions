import { useEffect, useState } from "react";
import { Logo } from "./components";
import { api } from "./lib/api";

function readSmsQuery() {
  const hash = window.location.hash.replace(/^#\/sms\??/, "");
  const hashParams = new URLSearchParams(hash);
  const searchParams = new URLSearchParams(window.location.search);
  const key = hashParams.get("key") || searchParams.get("key") || "";
  const text = hashParams.get("text") || searchParams.get("text") || "";
  return { key, text };
}

/** Opened by the merchant phone when a payment SMS arrives. Issues the matching ticket. */
export default function SmsConfirm() {
  const [message, setMessage] = useState("Checking the payment SMS…");
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    const { key, text } = readSmsQuery();
    if (!text) {
      setOk(false);
      setMessage("No SMS text was included.");
      return;
    }
    api.applyPaymentSms(key, text).then((result) => {
      setOk(result.ok);
      setMessage(result.message);
    });
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-[#0c0c0b] px-6 text-[#efe8d8]">
      <div className="w-full max-w-md">
        <Logo light />
        <p className="eyebrow mt-10">Payment SMS</p>
        <h1 className="display mt-2 text-5xl">{ok ? "Ticket issued" : ok === false ? "Not matched" : "Checking"}</h1>
        <p className="mt-4 text-sm leading-6 text-white/70">{message}</p>
      </div>
    </main>
  );
}
