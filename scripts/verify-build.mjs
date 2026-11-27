import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync('dist/index.html', 'utf8');
for (const text of [
  'https://xmfvxypioitbsnsbgioq.supabase.co',
  'HMO_h5MMN5GgmJaQiK-0X9uJHkqPN-Zby2Tzo0inBBk',
  'zengapay-collect',
  'zengapay-status',
  'zengapay-transfer',
  '/api/payments/collect',
  '/api/payments/disburse',
  '/api/payments/',
  'Check your phone and approve the prompt',
  'Payment verified',
]) {
  assert(html.includes(text), `Missing ZengaPay or Supabase production marker: ${text}`);
}
for (const text of [
  'DGateway',
  'desispay',
  'Manual USSD',
  'Manual Merchant Codes',
  'I approved the PIN',
  'ZPYPUBK-',
  'dgateway-collect',
  'dgateway-status',
  'dgateway-webhook',
]) {
  assert(!html.includes(text), `Old or server-only payment logic still present: ${text}`);
}
const sha = process.env.VITE_BUILD_SHA || 'development';
assert(html.includes(`<meta name="tank-build" content="${sha}"`), 'Build version marker is missing');
assert.equal(readFileSync('dist/CNAME', 'utf8').trim(), 'tanktickets.site');
console.log(`Verified production bundle (${sha}): valid Supabase anon key, server-only ZengaPay checkout, custom domain preserved.`);
