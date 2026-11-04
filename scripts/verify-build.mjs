import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const html = readFileSync('dist/index.html', 'utf8');
for (const text of ['/api/payments/collect', '/api/payments/disburse', '/api/payments/', 'Check your phone and approve the prompt', 'Payment verified']) {
  assert(html.includes(text), `Missing new checkout marker: ${text}`);
}
for (const text of ['ZengaPay', 'Manual USSD', 'Manual Merchant Codes', 'I approved the PIN', 'dgw_test_${', 'X-API-Key', 'dgateway-collect', 'dgateway-status']) {
  assert(!html.includes(text), `Old or server-only payment logic still present: ${text}`);
}
const sha = process.env.VITE_BUILD_SHA || 'development';
assert(html.includes(`<meta name="tank-build" content="${sha}"`), 'Build version marker is missing');
assert.equal(readFileSync('dist/CNAME', 'utf8').trim(), 'tanktickets.site');
console.log(`Verified production bundle ${sha}: server-only DGateway checkout, no manual fallback, custom domain preserved.`);
