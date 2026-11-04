import { handleCollect } from "../../server/handlers";
import type { ServerEnv } from "../../server/dgateway";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  return handleCollect(req, process.env as ServerEnv);
}
