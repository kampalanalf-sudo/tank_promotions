import { handleWebhook } from "../../server/handlers";
import type { ServerEnv } from "../../server/zengapay";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  return handleWebhook(req, process.env as ServerEnv);
}
