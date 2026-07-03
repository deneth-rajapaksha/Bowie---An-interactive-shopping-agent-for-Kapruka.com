const HIGH_INTENT_PATTERNS = [
  /\bcheckout\b/i,
  /\border\b/i,
  /\bpayment\b/i,
  /\btrack\b/i,
  /\bdelivery\b/i,
  /\bcompare\b/i,
  /\bgift message\b/i
];

export function selectModelName(
  messageCount: number,
  latestUserText: string,
  fastModel: string,
  smartModel: string
): string {
  if (messageCount > 14) return smartModel;
  if (HIGH_INTENT_PATTERNS.some((pattern) => pattern.test(latestUserText))) {
    return smartModel;
  }
  return fastModel;
}
