import type { CalendarProvider } from "./CalendarProvider";
import { GoogleCalendarProvider } from "./providers/GoogleCalendarProvider";

const CALENDAR_PROVIDER_BUILDERS: Record<string, () => CalendarProvider> = {
  google: () => new GoogleCalendarProvider(),
  "google-calendar": () => new GoogleCalendarProvider(),
};

export function getCalendarProvider(name?: string): CalendarProvider {
  const normalized = (name || "").toLowerCase();
  const build = CALENDAR_PROVIDER_BUILDERS[normalized];
  if (!build) {
    const supported = Object.keys(CALENDAR_PROVIDER_BUILDERS).join(", ");
    throw new Error(`Unsupported calendar provider "${name}". Supported: ${supported}`);
  }
  return build();
}

export function getConfiguredCalendarProvider(): CalendarProvider {
  const configuredProvider = process.env.AUTO_JOIN_PROVIDER || "google";
  return getCalendarProvider(configuredProvider);
}
