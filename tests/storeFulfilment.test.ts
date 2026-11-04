import { describe, expect, it } from 'vitest';
import { storeWebhookUrl, validateStoreMapping, type StoreMappingInput } from '../src/lib/storeFulfilment';

const mapping: StoreMappingInput = {
  store_slug: 'tanktickets',
  product_id: '49',
  product_slug: 'ruhindo-beach-vibes-740d',
  event_id: '5534bf00-c5ca-4d8d-b69d-72663d562ff3',
  label: 'General admission',
  unit_amount: 20000,
  currency: 'UGX',
  tickets_per_unit: 1,
  checkout_url: 'https://dgatewayadmin.desispay.com/store/pay/ruhindo-beach-vibes-740d',
  enabled: true,
};

describe('store fulfilment admin helpers', () => {
  it('builds the Supabase Edge Function webhook URL', () => {
    expect(storeWebhookUrl('https://xmfvxypioitbsnsbgioq.supabase.co/')).toBe('https://xmfvxypioitbsnsbgioq.supabase.co/functions/v1/dgateway-store-webhook');
  });
  it('accepts a complete https product mapping', () => {
    expect(validateStoreMapping(mapping)).toBeNull();
  });
  it('rejects unsafe or incomplete mappings', () => {
    expect(validateStoreMapping({ ...mapping, product_id: '' })).not.toBeNull();
    expect(validateStoreMapping({ ...mapping, unit_amount: 0 })).not.toBeNull();
    expect(validateStoreMapping({ ...mapping, tickets_per_unit: 11 })).not.toBeNull();
    expect(validateStoreMapping({ ...mapping, checkout_url: 'http://example.com' })).not.toBeNull();
  });
});
