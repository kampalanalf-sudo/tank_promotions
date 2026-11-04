/** Uganda phone number utilities */

/** Keep the user's leading 0 or +country code for DGateway. */
export function cleanPhone(input: string) {
  return input.trim().replace(/[\s().-]/g, "");
}

export function toMsisdn(input: string) {
  const d = input.replace(/\D/g, "");
  if (d.startsWith("256") && d.length >= 12) return d.slice(0, 12);
  if (d.startsWith("0") && d.length === 10) return `256${d.slice(1)}`;
  if (d.length === 9) return `256${d}`;
  return d;
}

export function isValidUgPhone(input: string) {
  const msisdn = toMsisdn(input);
  // Standard Uganda mobile: 2567XXXXXXXX (12 digits)
  if (/^2567\d{8}$/.test(msisdn)) return true;
  // DGateway sandbox test phone numbers
  if (["256111777771", "256111777991", "256111777881"].includes(msisdn)) return true;
  return false;
}

/** DGateway accepts leading-zero local numbers and +country numbers across UG/KE/TZ/RW. */
export function isValidGatewayPhone(input: string) {
  const phone = cleanPhone(input);
  return /^(?:0[17]\d{8}|\+?256[17]\d{8}|\+?2547\d{8}|\+?255[67]\d{8}|\+?2507[2389]\d{7}|0111777(?:77|99|88)\d|256111777(?:77|99|88)\d)$/.test(phone);
}

export function detectNetwork(msisdn: string): "MTN" | "Airtel" | "Other" {
  const normalized = toMsisdn(msisdn);
  if (normalized === "256111777771" || normalized === "256111777991") {
    return "MTN";
  }
  const n = normalized.slice(3, 5);
  if (["77", "78", "76", "79", "39"].includes(n)) return "MTN";
  if (["70", "75", "74"].includes(n)) return "Airtel";
  return "Other";
}
