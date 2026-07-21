export type MeetingProvider = "google-meet" | "microsoft-teams" | "zoom" | "unknown";

export function isKnownMeetingProvider(value: string | null | undefined): value is Exclude<MeetingProvider, "unknown"> {
  return value === "google-meet" || value === "microsoft-teams" || value === "zoom";
}

interface MeetingPlatformDefinition {
  provider: Exclude<MeetingProvider, "unknown">;
  label: string;
  urlMatchers: string[];
}

const MEETING_PLATFORM_DEFINITIONS: MeetingPlatformDefinition[] = [
  {
    provider: "google-meet",
    label: "Google Meet",
    urlMatchers: ["meet.google.com"],
  },
  {
    provider: "microsoft-teams",
    label: "Microsoft Teams",
    urlMatchers: ["teams.microsoft.com"],
  },
  {
    provider: "zoom",
    label: "Zoom",
    urlMatchers: ["zoom.us", ".zoom.com"],
  },
];

function normalizeUrl(url: string): string {
  return (url || "").toLowerCase();
}

function getDefinitionFromUrl(url: string): MeetingPlatformDefinition | null {
  const normalized = normalizeUrl(url);
  return (
    MEETING_PLATFORM_DEFINITIONS.find((definition) =>
      definition.urlMatchers.some((matcher) => normalized.includes(matcher))
    ) || null
  );
}

export function getMeetingProviderFromUrl(url: string): MeetingProvider {
  return getDefinitionFromUrl(url)?.provider || "unknown";
}

export function isSupportedMeetingUrl(url: string): boolean {
  return getMeetingProviderFromUrl(url) !== "unknown";
}

export function getMeetingPlatformLabel(input: { url?: string; provider?: string }): string {
  if (input.provider === "google-meet") return "Google Meet";
  if (input.provider === "microsoft-teams") return "Microsoft Teams";
  if (input.provider === "zoom") return "Zoom";
  if (input.url) {
    return getDefinitionFromUrl(input.url)?.label || "Unknown";
  }
  return "Unknown";
}

export function getMeetingPlatformOrigin(input: { url?: string; provider?: string }): string | null {
  const provider = input.provider || (input.url ? getMeetingProviderFromUrl(input.url) : "unknown");
  if (provider === "google-meet") return "https://meet.google.com";
  if (provider === "microsoft-teams") return "https://teams.microsoft.com";
  if (provider === "zoom") return "https://zoom.us";
  return null;
}

export function resolveMeetingProvider(meetingUrl: string, providerHint?: string): MeetingProvider {
  if (isKnownMeetingProvider(providerHint)) {
    return providerHint;
  }
  return getMeetingProviderFromUrl(meetingUrl);
}

function normalizeGoogleMeetUrl(url: URL): string {
  const match = url.href.match(/https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i);
  return match ? match[0].toLowerCase() : url.origin.toLowerCase() + url.pathname;
}

function normalizeMicrosoftTeamsUrl(url: URL): string {
  url.hash = "";
  const normalized = new URL(url.toString());
  normalized.protocol = "https:";
  normalized.hostname = normalized.hostname.toLowerCase();
  normalized.pathname = normalized.pathname.replace(/\/+$/, "");
  return normalized.toString();
}

function normalizeZoomUrl(url: URL): string {
  url.hash = "";
  const normalized = new URL(url.toString());
  normalized.protocol = "https:";
  normalized.hostname = normalized.hostname.toLowerCase();
  normalized.pathname = normalized.pathname.replace(/\/+$/, "");
  return normalized.toString();
}

export function normalizeMeetingUrl(meetingUrl: string, providerHint?: string): string {
  const trimmed = meetingUrl.trim();
  const provider = resolveMeetingProvider(trimmed, providerHint);

  try {
    const parsed = new URL(trimmed);

    switch (provider) {
      case "google-meet":
        return normalizeGoogleMeetUrl(parsed);
      case "microsoft-teams":
        return normalizeMicrosoftTeamsUrl(parsed);
      case "zoom":
        return normalizeZoomUrl(parsed);
      default:
        parsed.hash = "";
        parsed.hostname = parsed.hostname.toLowerCase();
        parsed.pathname = parsed.pathname.replace(/\/+$/, "");
        return parsed.toString();
    }
  } catch {
    return trimmed;
  }
}

export function buildRecordingStorageKey(meetingId: string, meetingUrl: string, providerHint?: string): string {
  const provider = resolveMeetingProvider(meetingUrl, providerHint);
  return `${provider}/${meetingId}.mp4`;
}

export function sanitizeMeetingNameForStorageKey(name: string | null | undefined): string {
  const sanitized = (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "meeting";
}

export function buildNamedRecordingStorageKey(
  meetingId: string,
  meetingName: string | null | undefined,
  recordedAt: Date,
  meetingUrl: string,
  providerHint?: string,
): string {
  const provider = resolveMeetingProvider(meetingUrl, providerHint);
  const date = recordedAt.toISOString().slice(0, 10);
  const safeName = sanitizeMeetingNameForStorageKey(meetingName);
  return `${provider}/${safeName}_${date}_${meetingId}.mp4`;
}
