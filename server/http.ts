import { GatewayError } from "./dgateway";

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/tanktickets\.site$/,
  /^https:\/\/www\.tanktickets\.site$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.e2b\.app$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
];

export function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://tanktickets.site",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function preflight(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function methodNotAllowed(req: Request, allowed: string) {
  return new Response(JSON.stringify({ ok: false, error: "Method not allowed." }), {
    status: 405,
    headers: { ...corsHeaders(req), Allow: allowed, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function readJson(req: Request, maxBytes = 16_384) {
  const raw = await req.text();
  if (raw.length > maxBytes) throw new GatewayError("Payload too large.", "PAYLOAD_TOO_LARGE", 413);
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new GatewayError("Invalid JSON.", "INVALID_JSON", 400);
  }
}

export function errorResponse(req: Request, err: unknown) {
  const known = err instanceof GatewayError;
  if (!known) console.error("payments-api: unexpected server error", err instanceof Error ? err.name : "unknown");
  return json(
    req,
    {
      ok: false,
      error: known ? err.message : "The payment service is unavailable. Keep your reference and try again shortly.",
      code: known ? err.code : "PAYMENT_UNAVAILABLE",
    },
    known ? err.status : 503,
  );
}
