export type ParsedSms = {
  code: string | null;
  amount: number | null;
  phone: string | null;
  tid: string | null;
  ref: string | null;
};

/**
 * Pulls a ticket code, UGX amount, payer number, TID and reference
 * out of an MTN MoMo Pay or Airtel Money Merchant confirmation SMS.
 *
 * Example handled:
 * "RECEIVED. TID160268943390 UGX 500 from 758443666 referenceAPCUG220794100006272. BalUGX 500."
 */
export function parsePaymentSms(text: string): ParsedSms {
  const compact = text.replace(/\s+/g, " ").trim();

  // 1. Amount: handles UGX 500, UGX 50,000, UGX500, etc.
  const amtMatch = compact.replace(/,/g, "").match(/UGX\s*([0-9]+(?:\.[0-9]+)?)/i);
  const amount = amtMatch ? Math.floor(Number(amtMatch[1])) : null;

  // 2. Payer phone number: 2567XXXXXXXX, 07XXXXXXXX, or 7XXXXXXXX (9 digits)
  const phoneMatch =
    compact.match(/(?:from\s+|sender:\s*|\b)(?:\+?256|0)?(7\d{8})\b/i) ||
    compact.match(/\b(?:\+?256|0)?(7\d{8})\b/);
  const phone = phoneMatch ? `256${phoneMatch[1]}` : null;

  // 3. Transaction ID (TID)
  const tidMatch = compact.match(/\b(?:TID|TxId|Trans\s*ID|Id)[:\s]*([A-Za-z0-9]+)/i);
  const tid = tidMatch ? tidMatch[1] : null;

  // 4. Ticket code (e.g. TNK-ABCDEF12)
  const tagged = compact.toUpperCase().match(/TNK-?[A-Z0-9]{6,10}/);
  let code: string | null = null;
  if (tagged) {
    const raw = tagged[0].replace("TNK-", "").replace("TNK", "");
    code = `TNK-${raw}`;
  }

  // 5. Raw reference (e.g. referenceAPCUG220794100006272)
  const refMatch = compact.match(/reference\s*([A-Za-z0-9\-]+)/i);
  const ref = refMatch ? refMatch[1] : null;

  return { amount, phone, tid, code, ref };
}

export function smsMatchesOrder(
  sms: ParsedSms,
  order: { code: string; externalRef: string; amount: number; phone: string },
) {
  if (sms.amount == null || sms.amount < order.amount) return false;

  // Match by ticket code if present in SMS
  if (sms.code) {
    const ref = sms.code.replace(/-/g, "");
    const code = order.code.replace(/-/g, "");
    const ext = order.externalRef.replace(/-/g, "").toUpperCase();
    if (ref === code || ref === ext || code.endsWith(ref) || ext.endsWith(ref)) return true;
  }

  // Match by payer phone number
  if (sms.phone && sms.phone === order.phone) return true;

  // Match by raw reference if matches code/externalRef
  if (sms.ref) {
    const cleanRef = sms.ref.replace(/-/g, "").toUpperCase();
    const code = order.code.replace(/-/g, "");
    const ext = order.externalRef.replace(/-/g, "").toUpperCase();
    if (cleanRef === code || cleanRef === ext || code.includes(cleanRef) || cleanRef.includes(code)) return true;
  }

  return false;
}
