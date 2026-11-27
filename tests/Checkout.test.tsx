import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Checkout } from "../src/Checkout";
import type { Order, TankEvent } from "../src/lib/types";

const initiateMock = vi.fn();
const pollMock = vi.fn();
const createOrderMock = vi.fn();

vi.mock("../src/lib/zengapay", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/zengapay")>("../src/lib/zengapay");
  return {
    ...actual,
    initiatePayment: (...args: unknown[]) => initiateMock(...args),
    pollPaymentStatus: (...args: unknown[]) => pollMock(...args),
  };
});

vi.mock("../src/lib/api", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/api")>("../src/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      createOrder: (...args: unknown[]) => createOrderMock(...args),
    },
  };
});

const paidEvent: TankEvent = {
  id: "event-paid",
  ownerId: "owner-1",
  title: "Rukindo Beach Vibes",
  type: "Festival",
  venue: "Rukindo Beach",
  area: "Entebbe",
  startsAt: "2026-12-13T15:30:00.000Z",
  price: 20000,
  capacity: 200,
  sold: 10,
  image: "",
  description: "Beach party",
  organizerName: "TANK Promotions",
  organizerPhone: "256775497509",
  status: "published",
  createdAt: "2026-11-01T00:00:00.000Z",
};

const pendingOrder: Order = {
  id: "ord-1",
  code: "TNK-23456789",
  eventId: paidEvent.id,
  eventTitle: paidEvent.title,
  userId: null,
  name: "Sarah Namubiru",
  phone: "256772123456",
  email: "sarah@example.com",
  qty: 1,
  amount: 20000,
  status: "PENDING",
  paymentRef: "7666749a-07c3-4f88-a069-277c50ac7f0f",
  zengaRef: "7666749a-07c3-4f88-a069-277c50ac7f0f",
  provider: "zengapay",
  externalRef: "TNK-11111111-2222-3333-4444-555555555555",
  createdAt: "2026-11-03T12:00:00.000Z",
};

describe("Checkout with ZengaPay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initiateMock.mockReset();
    pollMock.mockReset();
    createOrderMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps paid ticket locked until ZengaPay status poll verifies SUCCEEDED", async () => {
    initiateMock.mockResolvedValueOnce({
      reference: pendingOrder.zengaRef,
      status: "pending",
      order: pendingOrder,
    });
    pollMock
      .mockResolvedValueOnce({ status: "pending", order: pendingOrder })
      .mockResolvedValueOnce({ status: "completed", order: { ...pendingOrder, status: "SUCCEEDED" } });

    const onSold = vi.fn();
    render(<Checkout event={paidEvent} session={null} settings={null} onClose={() => {}} onSold={onSold} />);

    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: "Sarah Namubiru" } });
    fireEvent.change(screen.getByLabelText(/Mobile Money number/i), { target: { value: "0772 123456" } });
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "sarah@example.com" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pay UGX 20,000 with Mobile Money/i }));
    });

    expect(screen.getByText(/Check your phone and approve the prompt/i)).toBeInTheDocument();
    expect(screen.getByText("TNK-23456789")).toBeInTheDocument();
    expect(screen.queryByText(/You’re on the list/i)).not.toBeInTheDocument();
    expect(onSold).not.toHaveBeenCalled();

    // First 10s poll: still pending
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.queryByText(/You’re on the list/i)).not.toBeInTheDocument();

    // Second 10s poll: ZengaPay SUCCEEDED
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText(/You’re on the list/i)).toBeInTheDocument();
    expect(onSold).toHaveBeenCalledTimes(1);
  });

  it("generates a fresh checkout reference when buyer edits details after an error", async () => {
    initiateMock
      .mockRejectedValueOnce(new Error("Temporary network error"))
      .mockResolvedValueOnce({
        reference: pendingOrder.zengaRef,
        status: "pending",
        order: { ...pendingOrder, phone: "256755123456" },
      });

    render(<Checkout event={paidEvent} session={null} settings={null} onClose={() => {}} onSold={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: "Sarah Namubiru" } });
    fireEvent.change(screen.getByLabelText(/Mobile Money number/i), { target: { value: "0772 123456" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pay UGX 20,000 with Mobile Money/i }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Temporary network error/i);
    const firstExternalRef = initiateMock.mock.calls[0][0].externalRef;

    // Buyer changes Mobile Money number -> must get a fresh externalRef so create_order does not reject
    fireEvent.change(screen.getByLabelText(/Mobile Money number/i), { target: { value: "0755 123456" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pay UGX 20,000 with Mobile Money/i }));
    });
    const secondExternalRef = initiateMock.mock.calls[1][0].externalRef;
    expect(secondExternalRef).not.toBe(firstExternalRef);
  });

  it("confirms free events immediately without calling ZengaPay", async () => {
    const freeEvent: TankEvent = { ...paidEvent, id: "event-free", price: 0 };
    createOrderMock.mockResolvedValueOnce({
      ...pendingOrder,
      eventId: freeEvent.id,
      amount: 0,
      status: "SUCCEEDED",
      paymentRef: "",
      zengaRef: "",
    });
    const onSold = vi.fn();
    render(<Checkout event={freeEvent} session={null} settings={null} onClose={() => {}} onSold={onSold} />);

    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: "Sarah Namubiru" } });
    fireEvent.change(screen.getByLabelText(/WhatsApp number/i), { target: { value: "0772 123456" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Get 1 free ticket/i }));
    });
    expect(initiateMock).not.toHaveBeenCalled();
    expect(createOrderMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/You’re on the list/i)).toBeInTheDocument();
    expect(onSold).toHaveBeenCalledTimes(1);
  });
});
