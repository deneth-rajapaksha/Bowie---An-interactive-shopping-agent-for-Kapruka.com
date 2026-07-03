export function validateSriLankanPhone(phone: string): boolean {
  const clean = phone.replace(/[\s-]/g, "");
  const local = /^0[17]\d{8}$/.test(clean);
  const international = /^\+94\d{9}$/.test(clean);
  return local || international;
}

export function toE164(phone: string): string {
  const clean = phone.replace(/[\s-]/g, "");
  if (clean.startsWith("+94")) return clean;
  if (clean.startsWith("0")) return `+94${clean.slice(1)}`;
  return clean;
}

export function isIsoDateTodayOrFuture(date: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;

  const requested = new Date(`${date}T00:00:00+05:30`);
  const todayInColombo = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const today = new Date(`${todayInColombo}T00:00:00+05:30`);

  return requested >= today;
}
