import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StoreError,
  buildStorePayment,
  handleStoreWebhook,
  parseStoreNotification,
  storeConfig,
  verifyStoreSignature,
  type StoreEnv,
  type StorePaymentInput,
} from '../supabase/functions/_shared/storeCore';

const env: StoreEnv = {
  DGATEWAY_API_KEY: 'dgw_test_server',
  DGATEWAY_WEBHOOK_SECRET: 'test-webhook-secret',
  DGATEWAY_API_URL: 'https://dgatewayapi.desispay.com',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
};
const fetchMock = vi.fn();
const secret = env.DGATEWAY_WEBHOOK_SECRET!;

function sign(raw: string) {
  return createHmac('sha256', secret).update(raw).digest('hex');
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function webhook(body: unknown, signature = sign(JSON.stringify(body))) {
  return new Request('https://example.supabase.co/functions/v1/dgateway-store-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DGateway-Signature': signature },
    body: JSON.stringify(body),
  });
}
const notification = {
  event: 'transaction.completed',
  data: {
    reference: 'dgw_store_123',
    status: 'completed',
    amount: 1,
    currency: 'UGX',
    product_id: 49,
    product_slug: 'ruhindo-beach-vibes-740d',
    customer_name: 'Test Buyer',
    customer_email: 'buyer@example.com',
    customer_phone: '0772123456',
    quantity: 1,
  },
};
const verified = {
  reference: 'dgw_store_123',
  status: 'completed',
  amount: 20000,
  currency: 'UGX',
  direction: 'collect',
  provider: 'iotec',
  is_test: false,
  metadata: { product_id: '49', product_slug: 'ruhindo-beach-vibes-740d', store_slug: 'tanktickets' },
  customer_name: 'Test Buyer',
  customer_email: 'buyer@example.com',
  customer_phone: '0772123456',
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('hosted store webhook core', () => {
  it('fails closed when secrets are missing', () => {
    expect(() => storeConfig({ ...env, DGATEWAY_API_KEY: '' })).toThrow(StoreError);
    expect(() => storeConfig({ ...env, DGATEWAY_WEBHOOK_SECRET: '' })).toThrow(StoreError);
  });

  it('requires a valid HMAC over the raw body', async () => {
    const raw = JSON.stringify(notification);
    expect(await verifyStoreSignature(raw, sign(raw), secret)).toBe(true);
    expect(await verifyStoreSignature(raw + ' ', sign(raw), secret)).toBe(false);
    expect(await verifyStoreSignature(raw, null, secret)).toBe(false);
    expect(await verifyStoreSignature(raw, 'bad', secret)).toBe(false);
  });

  it('rejects unsigned webhooks before calling DGateway or applying payment', async () => {
    const apply = vi.fn();
    const res = await handleStoreWebhook(webhook(notification, ''), env, apply);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('uses the verified amount, not the webhook amount', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: verified }))
      .mockResolvedValueOnce(json({ data: { ...verified, metadata: verified.metadata } }));
    const apply = vi.fn(async (payment: StorePaymentInput) => {
      expect(payment.amount).toBe(20000);
      expect(payment.product_id).toBe('49');
      expect(payment.email).toBe('buyer@example.com');
      return { received: true, fulfilment: 'issued' as const, code: 'TNK-12345678' };
    });
    const res = await handleStoreWebhook(webhook(notification), env, apply);
    expect(res.status).toBe(200);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://dgatewayapi.desispay.com/v1/transactions/dgw_store_123/status');
    expect(fetchMock.mock.calls[0][1].headers['X-API-Key']).toBe('dgw_test_server');
  });

  it('does not issue when DGateway says pending or failed', async () => {
    for (const status of ['pending', 'failed']) {
      fetchMock
        .mockResolvedValueOnce(json({ data: { ...verified, status } }))
        .mockResolvedValueOnce(json({ data: verified }));
      const apply = vi.fn(async (payment: StorePaymentInput) => ({ received: true, status: payment.status, fulfilment: status === 'failed' ? 'not_required' as const : 'pending' as const }));
      const res = await handleStoreWebhook(webhook(notification), env, apply);
      expect(res.status).toBe(200);
      expect(apply.mock.calls[0][0].status).toBe(status);
    }
  });

  it('blocks product mismatches and test payments on live fulfilment', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: { ...verified, metadata: { product_id: '999', product_slug: 'other' } } }))
      .mockResolvedValueOnce(json({ data: verified }));
    const apply = vi.fn();
    const mismatch = await handleStoreWebhook(webhook(notification), env, apply);
    expect(mismatch.status).toBe(409);
    expect(apply).not.toHaveBeenCalled();

    fetchMock
      .mockResolvedValueOnce(json({ data: { ...verified, is_test: true } }))
      .mockResolvedValueOnce(json({ data: verified }));
    const test = await handleStoreWebhook(webhook(notification), env, apply);
    expect(test.status).toBe(409);
    expect(apply).not.toHaveBeenCalled();
  });

  it('returns retryable errors when DGateway verification fails', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'RATE_LIMIT', message: 'slow down' } }, 429));
    const apply = vi.fn();
    const res = await handleStoreWebhook(webhook(notification), env, apply);
    expect(res.status).toBe(429);
    expect(apply).not.toHaveBeenCalled();
  });

  it('surfaces blocked fulfilment as retryable/reconcilable', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: verified }))
      .mockResolvedValueOnce(json({ data: verified }));
    const apply = vi.fn(async () => ({ received: true, fulfilment: 'blocked' as const, code: 'PRODUCT_NOT_MAPPED' }));
    const res = await handleStoreWebhook(webhook(notification), env, apply);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'PRODUCT_NOT_MAPPED' });
  });

  it('parses nested transaction payloads and rejects invalid JSON', () => {
    expect(parseStoreNotification(JSON.stringify(notification)).data.reference).toBe('dgw_store_123');
    expect(() => parseStoreNotification('{')).toThrow(StoreError);
  });

  it('does not treat a transaction id as a product id', () => {
    const payment = buildStorePayment({ reference: 'dgw_store_123' }, { ...verified, id: 12345, metadata: {} }, 'tanktickets');
    expect(payment.product_id).toBe('');
  });
});
