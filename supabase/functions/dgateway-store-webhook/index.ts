import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { scheduleDelivery, triggerTicketDelivery } from "../_shared/deliveryTrigger.ts";
import {
  handleStoreWebhook,
  jsonResponse,
  storeConfig,
  storeErrorResponse,
  type StoreApplyResult,
  type StoreEnv,
  type StorePaymentInput,
} from "../_shared/storeCore.ts";

function env(): StoreEnv {
  return {
    DGATEWAY_API_KEY: Deno.env.get("DGATEWAY_API_KEY"),
    DGATEWAY_API_URL: Deno.env.get("DGATEWAY_API_URL"),
    DGATEWAY_WEBHOOK_SECRET: Deno.env.get("DGATEWAY_WEBHOOK_SECRET"),
    DGATEWAY_STORE_SLUG: Deno.env.get("DGATEWAY_STORE_SLUG"),
    DGATEWAY_ALLOW_TEST_PAYMENTS: Deno.env.get("DGATEWAY_ALLOW_TEST_PAYMENTS"),
    SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

Deno.serve(async (req: Request) => {
  try {
    const config = storeConfig(env());
    const admin = createClient(config.supabaseUrl, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return await handleStoreWebhook(req, env(), async (payment: StorePaymentInput) => {
      const { data, error } = await admin.rpc("apply_dgateway_store_payment", { p_payment: payment });
      if (error) {
        console.error("dgateway-store-webhook: database rejected verified payment", error.code);
        return { received: false, fulfilment: "blocked", code: "DATABASE_ERROR" } satisfies StoreApplyResult;
      }
      const result = data as StoreApplyResult;
      if (result.fulfilment === "issued" && result.order_id) {
        scheduleDelivery(triggerTicketDelivery(env(), result.order_id));
      }
      return result;
    });
  } catch (err) {
    return storeErrorResponse(err);
  }
});

export { jsonResponse };
