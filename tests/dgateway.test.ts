import { beforeEach, describe, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/api', () => ({ cloud: { functions: { invoke } }, api: { createOrder: vi.fn(), ticketStatus: vi.fn() } }));
import { initiatePayment, pollPaymentStatus } from '../src/lib/dgateway';
import { api } from '../src/lib/api';
const order = { id: 'order-1', code: 'TNK-ABCD2345', eventId: 'event-1', amount: 20000, qty: 1, status: 'PENDING', dgatewayRef: 'dgw-real', externalRef: 'TNK-attempt-1' };
const params = { eventId: 'event-1', orderCode: order.code, externalRef: order.externalRef, name: 'Test Guest', phone: '0772123456', email: 'guest@example.com', qty: 1 };
beforeEach(() => { invoke.mockReset(); vi.mocked(api.createOrder).mockReset(); vi.mocked(api.ticketStatus).mockReset(); });
describe('server-only paid checkout', () => {
  it('calls the collection function with a stable reference and normalized phone', async () => {
    invoke.mockResolvedValue({ data: { ok: true, reference: 'dgw-real', status: 'pending', order } });
    const result = await initiatePayment(params);
    expect(result.order).toEqual(order);
    expect(invoke).toHaveBeenCalledWith('dgateway-collect', { body: expect.objectContaining({ phone: '256772123456', external_ref: 'TNK-attempt-1', code: order.code }) });
    expect(vi.mocked(api.createOrder)).not.toHaveBeenCalled();
  });
  it('surfaces a missing backend instead of simulating a prompt or payment', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Not found', context: new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 }) } });
    await expect(initiatePayment(params)).rejects.toThrow('No payment has been requested');
    expect(vi.mocked(api.createOrder)).not.toHaveBeenCalled();
    expect(vi.mocked(api.ticketStatus)).not.toHaveBeenCalled();
  });
  it('does not turn a failed status lookup into a local success', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Unavailable', context: new Response('{}', { status: 503 }) } });
    vi.mocked(api.ticketStatus).mockResolvedValue('SUCCEEDED');
    await expect(pollPaymentStatus('dgw-real', order.code)).rejects.toThrow();
    expect(vi.mocked(api.ticketStatus)).not.toHaveBeenCalled();
  });
  it('returns only the server-confirmed completed order', async () => {
    invoke.mockResolvedValue({ data: { ok: true, status: 'completed', order: { ...order, status: 'SUCCEEDED' } } });
    const result = await pollPaymentStatus('dgw-real', order.code);
    expect(result.status).toBe('completed');
    expect(result.order?.status).toBe('SUCCEEDED');
  });
});
