export function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = origin === "https://tanktickets.site" || origin === "https://www.tanktickets.site" ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || /^https:\/\/[a-z0-9-]+\.e2b\.app$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://tanktickets.site",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
