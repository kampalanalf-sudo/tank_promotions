import { Download } from "lucide-react";
import { SiteFooter, SiteHeader, WhatsAppFab } from "./SiteChrome";
import type { Session } from "./lib/types";

const guides = [
  {
    title: "Buyer guide",
    who: "Guests",
    copy: "Find an event, pay with MTN or Airtel, and show your QR ticket at the door.",
    file: "TANK-Tickets-Buyer-Guide.pdf",
    image: "./guides/cover-buyer.jpg",
  },
  {
    title: "Organizer guide",
    who: "Promoters and venues",
    copy: "List an event, share the link, watch sales, and scan guests in.",
    file: "TANK-Tickets-Organizer-Guide.pdf",
    image: "./guides/cover-organizer.jpg",
  },
  {
    title: "Admin guide",
    who: "TANK desk only",
    copy: "Approve events, resend tickets, and open the door. For admin@tanktickets.site.",
    file: "TANK-Tickets-Admin-Guide.pdf",
    image: "./guides/cover-admin.jpg",
  },
];

export default function Guides({ session }: { session: Session | null }) {
  return (
    <main className="min-h-screen bg-[#efe8d8] text-[#0c0c0b]">
      <SiteHeader session={session} />
      <section className="shell py-12 md:py-16">
        <p className="eyebrow">Color manuals</p>
        <h1 className="display mt-2 text-5xl md:text-7xl">How to use TANK Tickets</h1>
        <p className="mt-4 max-w-xl text-sm leading-7 text-black/60">
          Open a guide in your browser, or tap Download and save the PDF. If a PDF does not open, use the steps on this page.
        </p>
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {guides.map((guide) => (
            <article key={guide.file} className="overflow-hidden border border-black/12 bg-[#f7f2e6]">
              <img src={guide.image} alt="" className="h-52 w-full object-cover" />
              <div className="p-5">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#a8841a]">{guide.who}</p>
                <h2 className="display mt-2 text-4xl">{guide.title}</h2>
                <p className="mt-3 text-sm leading-6 text-black/60">{guide.copy}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <a className="btn btn-gold" href={`./manuals/${guide.file}`} target="_blank" rel="noreferrer">Open PDF</a>
                  <a className="btn btn-line" href={`./manuals/${guide.file}`} download><Download size={16} /> Download</a>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
      <SiteFooter session={session} />
      <WhatsAppFab />
    </main>
  );
}
