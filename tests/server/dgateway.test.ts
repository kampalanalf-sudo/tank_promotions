import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GatewayError,
  cleanPhone,
  collectPayment,
  disbursePayment,
  fetchTransactionStatus,
  isWholeUnitAmount,
  isValidGatewayPhone,
  normalizeStatus,
  requireApiKey,
  transactionMatches,
  verifyWebhookSignature,
  type ServerEnv,
} from '../../server/dgateway';

const env: ServerEnv = { DGATEWAY_API_KEY: 'dgw_test_server', DGATEWAY_API_URL: 'https://dgatewayapi.desispay.com' };
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('server DGateway contract', () => {
  it('keeps leading-zero and +country phone formats', () => {
    expect(cleanPhone(' 0772 123 456 ')).toBe('0772123456');
    expect(cleanPhone('+256 (772) 123-456')).toBe('+256772123456');
    expect(isValidGatewayPhone('0772123456')).toBe(true);
    expect(isValidGatewayPhone('256772123456')).toBe(true);
    expect(isValidGatewayPhone('+256772123456')).toBe(true);
    expect(isValidGatewayPhone('+254712345678')).toBe(true);
    expect(isValidGatewayPhone('+255712345678')).toBe(true);
    expect(isValidGatewayPhone('+250781234567')).toBe(true);
    expect(isValidGatewayPhone('12345')).toBe(false);
  });

  it('only treats completed and failed as terminal', () => {
    expect(normalizeStatus('completed')).toBe('completed');
    expect(normalizeStatus('failed')).toBe('failed');
    expect(normalizeStatus('cancelled')).toBe('pending');
    expect(normalizeStatus('SentToVendor')).toBe('pending');
    expect(normalizeStatus(undefined)).toBe('pending');
  });

  it('requires whole-unit integer amounts', () => {
    expect(isWholeUnitAmount(20000, 'UGX')).toBe(true);
    expect(isWholeUnitAmount(2500, 'USD')).toBe(true);
    expect(isWholeUnitAmount(20.5, 'UGX')).toBe(false);
    expect(isWholeUnitAmount(0, 'UGX')).toBe(false);
    expect(isWholeUnitAmount(100, 'EUR')).toBe(false);
  });

  it('fails closed when the server key is missing', () => {
    expect(() => requireApiKey({})).toThrowError(GatewayError);
    try {
      requireApiKey({});
    } catch (err) {
      expect((err as GatewayError).code).toBe('PAYMENT_NOT_CONFIGURED');
      expect((err as GatewayError).status).toBe(503);
    }
  });

  it('sends collect with X-API-Key and the exact payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { reference: 'dgw-1', status: 'pending' } }));
    await collectPayment(env, { amount: 20000, currency: 'UGX', phone_number: '0772123456', description: 'TANK', callback_url: 'https://api.example.com/api/webhooks/dgateway' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dgatewayapi.desispay.com/v1/payments/collect');
    expect(init.method).toBe('POST');
    expect(init.headers['X-API-Key']).toBe('dgw_test_server');
    expect(JSON.parse(init.body)).toEqual({ amount: 20000, currency: 'UGX', phone_number: '0772123456', description: 'TANK', callback_url: 'https://api.example.com/api/webhooks/dgateway' });
  });

  it('sends disburse and status to the documented endpoints', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { reference: 'dgw-2', status: 'pending' } }));
    await disbursePayment(env, { amount: 5000, currency: 'UGX', phone_number: '0772123456', description: 'Payout' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://dgatewayapi.desispay.com/v1/payments/disburse');
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { reference: 'dgw-2', status: 'completed' } }));
    const tx = await fetchTransactionStatus(env, 'dgw-2');
    expect(fetchMock.mock.calls[1][0]).toBe('https://dgatewayapi.desispay.com/v1/transactions/dgw-2/status');
    expect(tx.status).toBe('completed');
  });

  it('rejects a status response for a different reference', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { reference: 'dgw-other', status: 'completed' } }));
    await expect(fetchTransactionStatus(env, 'dgw-2')).rejects.toThrow('did not match');
  });

  it('matches reference, amount, currency and direction before fulfilment', () => {
    const tx = { reference: 'dgw-1', amount: 20000, currency: 'UGX', status: 'completed', direction: 'collect' };
    expect(transactionMatches(tx, { reference: 'dgw-1', amount: 20000, currency: 'UGX', direction: 'collect' })).toBe(true);
    expect(transactionMatches({ ...tx, reference: 'dgw-other' }, { reference: 'dgw-1', amount: 20000, currency: 'UGX' })).toBe(false);
    expect(transactionMatches({ ...tx, amount: 1 }, { reference: 'dgw-1', amount: 20000, currency: 'UGX' })).toBe(false);
    expect(transactionMatches({ ...tx, currency: 'USD' }, { reference: 'dgw-1', amount: 20000, currency: 'UGX' })).toBe(false);
    expect(transactionMatches({ ...tx, direction: 'disburse' }, { reference: 'dgw-1', amount: 20000, currency: 'UGX', direction: 'collect' })).toBe(false);
  });

  it('validates webhook HMAC only when a secret is configured', async () => {
    const raw = '{"reference":"dgw-1"}';
    expect(await verifyWebhookSignature(raw, null, undefined)).toBe(true);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(await verifyWebhookSignature(raw, signature, 'secret')).toBe(true);
    expect(await verifyWebhookSignature(raw, `sha256=${signature}`, 'secret')).toBe(true);
    expect(await verifyWebhookSignature(raw + ' ', signature, 'secret')).toBe(false);
    expect(await verifyWebhookSignature(raw, null, 'secret')).toBe(false);
  });
});
