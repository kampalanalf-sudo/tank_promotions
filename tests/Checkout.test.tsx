import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Checkout } from '../src/Checkout';
import { initiatePayment, pollPaymentStatus, PaymentError } from '../src/lib/dgateway';
import type { Order, TankEvent } from '../src/lib/types';

vi.mock('framer-motion', () => ({ motion: { div: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> } }));
vi.mock('../src/lib/api', () => ({ api: { createOrder: vi.fn() } }));
vi.mock('../src/lib/dgateway', async () => {
  class PaymentError extends Error { code: string; constructor(message: string, code = 'PAYMENT_FAILED') { super(message); this.code = code; } }
  return { PaymentError, initiatePayment: vi.fn(), pollPaymentStatus: vi.fn() };
});
vi.mock('../src/components', () => ({ Poster: () => null, Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, TicketCard: () => <div>Verified QR ticket</div> }));

const event: TankEvent = { id: 'event-1', ownerId: 'owner', title: 'Test Night', type: 'Live', venue: 'Kampala', area: '', startsAt: '2027-01-01T18:00:00Z', price: 20000, capacity: 100, sold: 0, image: '', description: '', organizerName: 'TANK', organizerPhone: '', status: 'published', createdAt: '2026-11-03' };
const order: Order = { id: 'order-1', code: 'TNK-ABCD2345', eventId: event.id, eventTitle: event.title, userId: null, name: 'Test Guest', phone: '0772123456', email: '', qty: 1, amount: 20000, status: 'PENDING', paymentRef: 'dgw-real', dgatewayRef: 'dgw-real', externalRef: 'TNK-attempt-1', createdAt: '2026-11-03' };
const PROMPT = 'Check your phone and approve the prompt';

beforeEach(() => { vi.mocked(initiatePayment).mockReset(); vi.mocked(pollPaymentStatus).mockReset(); vi.useRealTimers(); });

async function openDetails() {
  const user = userEvent.setup();
  render(<Checkout event={event} session={null} settings={null} onClose={vi.fn()} onSold={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /Continue/ }));
  await user.type(screen.getByLabelText('Full name'), 'Test Guest');
  await user.type(screen.getByLabelText('Mobile Money number (MTN / Airtel)'), '0772123456');
  return user;
}

describe('DGateway checkout UI', () => {
  it('shows an honest unavailable message and never shows a fake prompt or ticket', async () => {
    vi.mocked(initiatePayment).mockRejectedValue(new PaymentError('Mobile Money checkout is not available yet. No payment has been requested.', 'PAYMENT_NOT_CONFIGURED'));
    const user = await openDetails();
    await user.click(screen.getByRole('button', { name: /Pay UGX/ }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('No payment has been requested');
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(screen.queryByText('Verified QR ticket')).toBeNull();
  });

  it('waits 10 seconds before the first status check and issues a ticket only after verified completion', async () => {
    vi.mocked(initiatePayment).mockResolvedValue({ reference: 'dgw-real', status: 'pending', order });
    vi.mocked(pollPaymentStatus)
      .mockResolvedValueOnce({ status: 'pending', order })
      .mockResolvedValue({ status: 'completed', order: { ...order, status: 'SUCCEEDED' } });
    await openDetails();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: /Pay UGX/ }));
    await act(async () => {});
    expect(screen.getByText(PROMPT)).toBeTruthy();
    expect(screen.queryByText('Verified QR ticket')).toBeNull();
    expect(initiatePayment).toHaveBeenCalledWith(expect.objectContaining({ phone: '0772123456' }));

    await act(() => vi.advanceTimersByTimeAsync(9_999));
    expect(pollPaymentStatus).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(pollPaymentStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Verified QR ticket')).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(9_999));
    expect(pollPaymentStatus).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('Verified QR ticket')).toBeTruthy();
    expect(screen.queryByText(/Merchant Code|Manual USSD|I approved the PIN/)).toBeNull();

    const count = vi.mocked(pollPaymentStatus).mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(vi.mocked(pollPaymentStatus)).toHaveBeenCalledTimes(count);
  });

  it('blocks a double click from requesting two collections', async () => {
    let resolve!: (value: { reference: string; status: 'pending'; order: Order }) => void;
    vi.mocked(initiatePayment).mockReturnValue(new Promise(r => { resolve = r; }));
    const user = await openDetails();
    const button = screen.getByRole('button', { name: /Pay UGX/ });
    await user.dblClick(button);
    expect(initiatePayment).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ reference: 'dgw-real', status: 'pending', order }); });
    expect(screen.getByText(PROMPT)).toBeTruthy();
  });
});
