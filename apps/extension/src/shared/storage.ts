import { DEFAULT_SETTINGS } from "./constants";
import type { ExtensionSettings, WidgetPosition } from "./types";

const WIDGET_POSITION_KEY = "widgetPosition";

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.sync.get([
    "apiBaseUrl",
    "apiToken",
    "connectionToken",
    "extensionAccessToken",
    "extensionAccessTokenExpiresAt",
    "linkedAccountEmail",
    "connectedAt",
    "defaultBotName",
    "defaultDurationMinutes",
  ]);

  return {
    apiBaseUrl: (result.apiBaseUrl as string) || DEFAULT_SETTINGS.apiBaseUrl,
    apiToken: (result.apiToken as string) || DEFAULT_SETTINGS.apiToken,
    connectionToken: (result.connectionToken as string) || DEFAULT_SETTINGS.connectionToken,
    extensionAccessToken: (result.extensionAccessToken as string) || DEFAULT_SETTINGS.extensionAccessToken,
    extensionAccessTokenExpiresAt:
      (result.extensionAccessTokenExpiresAt as string) || DEFAULT_SETTINGS.extensionAccessTokenExpiresAt,
    linkedAccountEmail: (result.linkedAccountEmail as string) || DEFAULT_SETTINGS.linkedAccountEmail,
    connectedAt: (result.connectedAt as string) || DEFAULT_SETTINGS.connectedAt,
    defaultBotName: (result.defaultBotName as string) || DEFAULT_SETTINGS.defaultBotName,
    defaultDurationMinutes:
      (result.defaultDurationMinutes as number) || DEFAULT_SETTINGS.defaultDurationMinutes,
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.sync.set({
    apiBaseUrl: settings.apiBaseUrl.trim().replace(/\/$/, ""),
    apiToken: settings.apiToken.trim(),
    connectionToken: settings.connectionToken.trim(),
    extensionAccessToken: settings.extensionAccessToken.trim(),
    extensionAccessTokenExpiresAt: settings.extensionAccessTokenExpiresAt,
    linkedAccountEmail: settings.linkedAccountEmail.trim(),
    connectedAt: settings.connectedAt,
    defaultBotName: settings.defaultBotName.trim() || DEFAULT_SETTINGS.defaultBotName,
    defaultDurationMinutes: settings.defaultDurationMinutes || DEFAULT_SETTINGS.defaultDurationMinutes,
  });
}

export async function getWidgetPosition(): Promise<WidgetPosition | null> {
  const result = await chrome.storage.local.get(WIDGET_POSITION_KEY);
  const stored = result[WIDGET_POSITION_KEY] as WidgetPosition | undefined;

  if (!stored || typeof stored.x !== "number" || typeof stored.y !== "number") {
    return null;
  }

  return stored;
}

export async function saveWidgetPosition(position: WidgetPosition): Promise<void> {
  await chrome.storage.local.set({
    [WIDGET_POSITION_KEY]: position,
  });
}
