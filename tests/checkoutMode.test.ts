import { describe, expect, it } from 'vitest';
import { checkoutModeFor } from '../src/lib/checkoutMode';

const STORE = 'https://dgatewayadmin.desispay.com/store/shop/tanktickets?products';

describe('checkout mode', () => {
  it('redirects paid events to the hosted DGateway store when configured', () => {
    expect(checkoutModeFor(20000, STORE)).toEqual({ kind: 'hosted', url: STORE });
  });

  it('keeps free events in the internal checkout', () => {
    expect(checkoutModeFor(0, STORE)).toEqual({ kind: 'internal' });
  });

  it('falls back to internal checkout when the hosted store is disabled', () => {
    expect(checkoutModeFor(20000, '')).toEqual({ kind: 'internal' });
    expect(checkoutModeFor(20000, '   ')).toEqual({ kind: 'internal' });
  });
});
