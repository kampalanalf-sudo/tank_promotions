export const config = { runtime: "edge" };

export default async function handler() {
  return new Response(JSON.stringify({ ok: true, service: "tank-payments-api" }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
