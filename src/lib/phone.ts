/** Ugandan Mobile Money phone number utilities (MTN Uganda & Airtel Money) */

export function cleanPhone(input: string) {
  return input.trim().replace(/[\s().-]/g, "");
}

/** Formats a Ugandan phone number into ZengaPay's 12-digit MSISDN format without '+', e.g. 256775203801. */
export function toMsisdn(input: string) {
  const d = input.replace(/\D/g, "");
  if (d.startsWith("256") && d.length === 12) return d;
  if (d.startsWith("0") && d.length === 10) return `256${d.slice(1)}`;
  if (d.length === 9 && /^[732]/.test(d)) return `256${d}`;
  return d;
}

export function isValidUgPhone(input: string) {
  const msisdn = toMsisdn(input);
  return /^256(?:7\d{8}|39\d{7}|20\d{7})$/.test(msisdn);
}

/** ZengaPay supports MTN Uganda and Airtel Money Uganda numbers. */
export function isValidGatewayPhone(input: string) {
  return isValidUgPhone(input);
}

export function detectNetwork(msisdn: string): "MTN" | "Airtel" | "Other" {
  const normalized = toMsisdn(msisdn);
  const n = normalized.slice(3, 5);
  if (["77", "78", "76", "79", "39"].includes(n)) return "MTN";
  if (["70", "75", "74", "20"].includes(n)) return "Airtel";
  return "Other";
}
