import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync('dist/index.html', 'utf8');
for (const text of [
  'zengapay-collect',
  'zengapay-status',
  'zengapay-transfer',
  '/api/payments/collect',
  '/api/payments/disburse',
  '/api/payments/',
  'Check your phone and approve the prompt',
  'Payment verified',
]) {
  assert(html.includes(text), `Missing ZengaPay checkout marker: ${text}`);
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
const sha = process.env.VITE_BUILD_SHA || '%VITE_BUILD_SHA%';
assert(
  html.includes(`<meta name="tank-build" content="${sha}"`) || html.includes('<meta name="tank-build" content="development"'),
  'Build version marker is missing',
);
assert.equal(readFileSync('dist/CNAME', 'utf8').trim(), 'tanktickets.site');
console.log(`Verified production bundle (${sha}): server-only ZengaPay checkout, no DGateway/manual fallback, custom domain preserved.`);
