// supabase/functions/_shared/cors.ts
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dgateway-signature",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};
