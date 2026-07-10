import { detectMeetingProvider, normalizeMeetingUrl } from "./meeting-url";

export function normalizeOrigin(input: string): string {
  try {
    const parsed = new URL(input.trim());
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port;
    const isDefaultPort =
      (protocol === "https:" && port === "443") ||
      (protocol === "http:" && port === "80");
    const host = port && !isDefaultPort ? `${hostname}:${port}` : hostname;

    return `${protocol}//${host}`;
  } catch {
    return "";
  }
}

export function getOriginFromUrl(url?: string): string {
  if (!url) return "";
  return normalizeOrigin(url);
}

export function getConnectableSiteContext(url?: string): {
  origin: string;
  eligible: boolean;
  reason: string;
} {
  if (!url) {
    return {
      origin: "",
      eligible: false,
      reason: "Open the Squaads dashboard tab where you generated the token, then try again.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      origin: "",
      eligible: false,
      reason: "This tab cannot be used for connection. Open the Squaads dashboard first.",
    };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      origin: "",
      eligible: false,
      reason: "Only a Squaads web tab can finish connection. Browser internal pages are not supported.",
    };
  }

  const provider = detectMeetingProvider(url);
  if (provider && normalizeMeetingUrl(url, provider)) {
    return {
      origin: "",
      eligible: false,
      reason: "You are on a meeting tab. Return to the Squaads dashboard tab where you generated the token.",
    };
  }

  if (
    parsed.hostname === "chromewebstore.google.com" ||
    (parsed.hostname === "chrome.google.com" && parsed.pathname.startsWith("/webstore"))
  ) {
    return {
      origin: "",
      eligible: false,
      reason: "Return to the Squaads dashboard tab after visiting the Chrome Web Store.",
    };
  }

  const origin = normalizeOrigin(parsed.toString());
  return {
    origin,
    eligible: Boolean(origin),
    reason: origin ? `Current site ready: ${origin}` : "Open the Squaads dashboard tab before connecting.",
  };
}
