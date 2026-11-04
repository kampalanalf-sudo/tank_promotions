import { describe, expect, it } from "vitest";
import { buildTicketPdf, ticketDocumentLink, ticketMoney, ticketWhen } from "../src/lib/ticketDocument";

const payload = {
  c: "TNK-ABC12345",
  t: "Rukindo Beach Vibes",
  w: "2026-12-13T15:30:00.000Z",
  v: "Rukindo Beach, Entebbe",
  n: "Test Buyer",
  q: 2,
  a: 40000,
  cur: "UGX",
};

describe("ticket PDF document", () => {
  it("builds a real PDF with a QR ticket link", async () => {
    const bytes = await buildTicketPdf(payload, { baseUrl: "https://tanktickets.site" });
    expect(bytes.length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const link = ticketDocumentLink(payload, "https://tanktickets.site/");
    expect(link).toContain("https://tanktickets.site/#/t/TNK-ABC12345.");
    expect(link).not.toContain("=");
  });

  it("formats ticket date and money", () => {
    expect(ticketWhen("not-a-date")).toBe("not-a-date");
    expect(ticketWhen(payload.w)).toContain("2026");
    expect(ticketMoney(40000, "UGX")).toMatch(/40,000/);
    expect(ticketMoney(10, "USD")).toMatch(/10/);
  });
});
