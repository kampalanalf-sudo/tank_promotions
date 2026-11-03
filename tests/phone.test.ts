import { describe, expect, it } from 'vitest';
import { isValidUgPhone, toMsisdn } from '../src/lib/phone';
describe('Ugandan checkout numbers', () => {
  it.each(['0772 123456', '+256 772 123456', '256772123456', '0758443666'])('accepts %s', value => expect(isValidUgPhone(value)).toBe(true));
  it.each(['123', '0772123456789', '+15551234567'])('rejects %s', value => expect(isValidUgPhone(value)).toBe(false));
  it('uses DGateway documented sandbox numbers, not invented local success numbers', () => {
    expect(isValidUgPhone('0111777771')).toBe(true);
    expect(toMsisdn('0111777771')).toBe('256111777771');
    expect(isValidUgPhone('0111777991')).toBe(true);
    expect(isValidUgPhone('0111777111')).toBe(false);
  });
});
