import { handleStatus } from "../../../server/handlers";
import type { ServerEnv } from "../../../server/zengapay";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/api\/payments\/([^/]+)\/status$/);
  const reference = match ? decodeURIComponent(match[1]) : "";
  return handleStatus(req, process.env as ServerEnv, reference);
}
