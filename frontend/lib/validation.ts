export function validateSriLankanPhone(phone: string): boolean {
  const clean = phone.replace(/[\s-]/g, "");
  const local = /^0[17]\d{8}$/.test(clean);
  const intl = /^\+94\d{9}$/.test(clean);
  return local || intl;
}

export function toE164(phone: string): string {
  const clean = phone.replace(/[\s-]/g, "");
  if (clean.startsWith("+94")) return clean;
  if (clean.startsWith("0")) return `+94${clean.slice(1)}`;
  return clean;
}
