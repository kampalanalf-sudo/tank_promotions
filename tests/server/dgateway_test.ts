import { equal as assertEquals } from "node:assert/strict";
import { normalizeStatus, transactionMatches, verifyWebhookSignature, type OrderRow } from "../../supabase/functions/_shared/dgateway.ts";
const order = { dgateway_ref: "dgw-123", amount: 20000 } as OrderRow;
Deno.test("only a matching collect reference, amount and currency can satisfy an order", () => {
  const tx = { reference: "dgw-123", amount: 20000, currency: "UGX", status: "completed", direction: "collect" };
  assertEquals(transactionMatches(tx, order), true);
  assertEquals(transactionMatches({ ...tx, reference: "dgw-other" }, order), false);
  assertEquals(transactionMatches({ ...tx, amount: 1 }, order), false);
  assertEquals(transactionMatches({ ...tx, currency: "USD" }, order), false);
  assertEquals(transactionMatches({ ...tx, direction: "disburse" }, order), false);
});
Deno.test("unknown provider states remain pending", () => {
  assertEquals(normalizeStatus("completed"), "completed");
  assertEquals(normalizeStatus("cancelled"), "failed");
  assertEquals(normalizeStatus("SentToVendor"), "pending");
  assertEquals(normalizeStatus(undefined), "pending");
});
Deno.test("webhook HMAC validates the raw body and rejects tampering", async () => {
  Deno.env.set("DGATEWAY_WEBHOOK_SECRET", "test-only-secret");
  const raw = '{"event":"transaction.completed","data":{"reference":"dgw-123"}}';
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-only-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)))).map(b => b.toString(16).padStart(2, "0")).join("");
  assertEquals(await verifyWebhookSignature(raw, signature), true);
  assertEquals(await verifyWebhookSignature(raw, `sha256=${signature}`), true);
  assertEquals(await verifyWebhookSignature(raw + " ", signature), false);
  assertEquals(await verifyWebhookSignature(raw, null), false);
  assertEquals(await verifyWebhookSignature(raw, "0".repeat(64)), false);
  Deno.env.delete("DGATEWAY_WEBHOOK_SECRET");
  let failed = false;
  try { await verifyWebhookSignature(raw, signature); } catch { failed = true; }
  assertEquals(failed, true);
});
