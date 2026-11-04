import { handleWebhook } from "../../server/handlers";
import type { ServerEnv } from "../../server/dgateway";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  return handleWebhook(req, process.env as ServerEnv);
}
