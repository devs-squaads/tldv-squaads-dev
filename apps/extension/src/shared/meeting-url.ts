import type { MeetingProvider } from "./types";

export function detectMeetingProvider(url: string): MeetingProvider | null {
  const lower = url.toLowerCase();
  if (lower.includes("meet.google.com")) return "google-meet";
  if (lower.includes("teams.microsoft.com")) return "microsoft-teams";
  if (lower.includes("zoom.us") || lower.includes(".zoom.com")) return "zoom";
  return null;
}

export function normalizeMeetingUrl(url: string, provider: MeetingProvider): string | null {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";

    if (provider === "google-meet") {
      const match = parsed.href.match(/https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i);
      return match ? match[0].toLowerCase() : null;
    }

    parsed.protocol = "https:";
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return null;
  }
}
