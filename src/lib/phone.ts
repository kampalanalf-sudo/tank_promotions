export function toMsisdn(input: string) {
  const d = input.replace(/\D/g, "");
  if (d.startsWith("256") && d.length >= 12) return d.slice(0, 12);
  if (d.startsWith("0") && d.length === 10) return `256${d.slice(1)}`;
  if (d.length === 9) return `256${d}`;
  return d;
}

export function isValidUgPhone(input: string) {
  return /^2567\d{8}$/.test(toMsisdn(input));
}

export function detectNetwork(msisdn: string): "MTN" | "Airtel" | "Other" {
  const n = toMsisdn(msisdn).slice(3, 5);
  if (["77", "78", "76", "79"].includes(n)) return "MTN";
  if (["70", "75", "74"].includes(n)) return "Airtel";
  return "Other";
}
