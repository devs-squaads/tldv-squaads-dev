// Shared TTL menu for both restricted-email shares (MeetingShareService) and
// registered-user Access Grants (MeetingAccessGrantService) — spec requires
// the exact same menu (1h / 1d / 7d / no-expiry) in both places.
export const DEFAULT_SHARE_TTL_OPTIONS_MINUTES = [60, 1440, 10080];

export function getConfiguredTtlOptionsMinutes(): number[] {
  const raw = process.env.SHARE_TTL_OPTIONS_MINUTES;
  if (!raw?.trim()) {
    return DEFAULT_SHARE_TTL_OPTIONS_MINUTES;
  }

  const options = raw
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
    .map((value) => Math.floor(value));

  const normalized = Array.from(new Set(options)).sort((a, b) => a - b);
  return normalized.length > 0 ? normalized : DEFAULT_SHARE_TTL_OPTIONS_MINUTES;
}

export function resolveExpiresAt(ttlMinutes?: number, noExpiry?: boolean): Date | null {
  if (noExpiry) return null;
  if (ttlMinutes === undefined || ttlMinutes === null) return null;

  if (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0) {
    throw new Error("ttlMinutes must be greater than 0");
  }

  const ttlOptions = getConfiguredTtlOptionsMinutes();
  if (!ttlOptions.includes(ttlMinutes)) {
    throw new Error(`ttlMinutes must match one of configured options (${ttlOptions.join(",")})`);
  }

  return new Date(Date.now() + ttlMinutes * 60 * 1000);
}
