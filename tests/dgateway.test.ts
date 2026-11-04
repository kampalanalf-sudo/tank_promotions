import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/api', () => ({ cloud: { auth: { getSession } } }));
vi.mock('../src/lib/config', () => ({ API_BASE_URL: '' }));

import { initiatePayment, pollPaymentStatus, requestDisburse } from '../src/lib/dgateway';

const order = { id: 'order-1', code: 'TNK-ABCD2345', eventId: 'event-1', amount: 20000, qty: 1, status: 'PENDING', dgatewayRef: 'dgw-real', externalRef: 'TNK-attempt-1' };
const params = { eventId: 'event-1', orderCode: order.code, externalRef: order.externalRef, name: 'Test Guest', phone: '0772 123 456', email: 'guest@example.com', qty: 1 };
const fetchMock = vi.fn();

beforeEach(() => {
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: 'buyer-token' } } });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('server-only paid checkout client', () => {
  it('calls the server collect route and preserves the leading-zero phone', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, reference: 'dgw-real', status: 'pending', order }));
    const result = await initiatePayment(params);
    expect(result.order).toEqual(order);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/payments/collect');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer buyer-token');
    expect(JSON.parse(init.body)).toMatchObject({ phone: '0772123456', code: order.code, external_ref: order.externalRef });
  });

  it('surfaces a missing API instead of simulating a prompt or payment', async () => {
    fetchMock.mockResolvedValue(new Response('Not found', { status: 404 }));
    await expect(initiatePayment(params)).rejects.toThrow('No payment has been requested');
  });

  it('polls the server status proxy with the ticket code', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, status: 'completed', order: { ...order, status: 'SUCCEEDED' } }));
    const result = await pollPaymentStatus('dgw-real', order.code);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/payments/dgw-real/status?code=TNK-ABCD2345');
    expect(result.status).toBe('completed');
    expect(result.order?.status).toBe('SUCCEEDED');
  });

  it('does not turn a failed status lookup into a local success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'Unavailable', code: 'PAYMENT_UNAVAILABLE' }, 503));
    await expect(pollPaymentStatus('dgw-real', order.code)).rejects.toThrow('Unavailable');
  });

  it('requests admin disbursement through the server route', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, reference: 'dgw-payout', status: 'pending', payout: { id: 'payout-1' } }));
    await requestDisburse({ externalRef: 'PAY-12345678', amount: 5000, currency: 'UGX', phoneNumber: '+256 772 123456', description: 'Organizer payout' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/payments/disburse');
    expect(JSON.parse(init.body)).toMatchObject({ phone_number: '+256772123456', amount: 5000, currency: 'UGX' });
  });
});
