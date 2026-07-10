import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

import { MeetingProviderFactory } from './providers/MeetingProviderFactory'
import { ADMISSION_TIMEOUT_ERROR_TAG } from './providers/OnlineMeetingProvider'
import {
  getMeetingProviderFromUrl,
  getMeetingPlatformOrigin,
  type MeetingProvider
} from '@meeting-bot/shared/meetingProvider'

export interface BotOptions {
  meetingUrl: string;
  outputPath: string;
  username?: string;
  password?: string;
  duration: number; // in minutes
  botName: string;
  onPhaseChange?: (phase: "joining" | "waiting_admission" | "recording") => Promise<void> | void;
}

function isAdmissionTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const reason = (error as Error & { reason?: string }).reason;
  return error.message.includes(ADMISSION_TIMEOUT_ERROR_TAG) ||
    (error.name === 'AdmissionError' && reason === 'timeout');
}

function isEnvTrue(name: string): boolean {
  return process.env[name]?.toLowerCase() === 'true';
}

export async function startBot(options: BotOptions): Promise<{ success: boolean; error?: string; provider?: MeetingProvider }> {
  console.log('[startBot] Starting bot with options:', { ...options, password: options.password ? '***' : undefined });
  const { meetingUrl, outputPath, username = '', password = '', duration, botName, onPhaseChange } = options;

  const providerName = getMeetingProviderFromUrl(meetingUrl);
  const isDocker = process.env.IS_DOCKER === 'true';
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

  if (!isDocker) {
    return {
      success: false,
      error: 'Unsupported environment: recording is Docker-only. Set IS_DOCKER=true and run inside the container.',
      provider: providerName,
    };
  }

  if (!executablePath) {
    return {
      success: false,
      error: 'PUPPETEER_EXECUTABLE_PATH is required in Docker mode.',
      provider: providerName,
    };
  }

  try {
    puppeteer.use(StealthPlugin());
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown stealth plugin error";
    console.warn('[startBot] StealthPlugin already in use or failed to load:', message);
  }

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--allow-http-screen-capture',
    '--disable-infobars',
    '--window-size=1920,1080',
    '--start-maximized',
    '--kiosk', // Full screen without browser UI
    '--force-device-scale-factor=1',
  ];

  const allowCamera = isEnvTrue('BOT_ALLOW_CAMERA');
  const allowMicrophone = isEnvTrue('BOT_ALLOW_MICROPHONE');
  const useFakeMedia = isEnvTrue('BOT_USE_FAKE_MEDIA');
  const allowAnyMediaDevice = allowCamera || allowMicrophone;
  const enableFakeMedia = useFakeMedia && allowAnyMediaDevice;

  if (useFakeMedia && !allowAnyMediaDevice) {
    console.warn('[startBot] BOT_USE_FAKE_MEDIA=true ignored because BOT_ALLOW_CAMERA and BOT_ALLOW_MICROPHONE are both false');
  }

  if (enableFakeMedia) {
    args.push('--use-fake-ui-for-media-stream');
    args.push('--use-fake-device-for-media-stream');
  }

  args.push('--disable-gpu');

  if (providerName === "microsoft-teams" || providerName === "zoom") {
    args.push('--disable-notifications');
  }

  console.log(
    `[startBot] Media policy: allowCamera=${allowCamera} allowMicrophone=${allowMicrophone} useFakeMedia=${enableFakeMedia}`
  );
  console.log(`[startBot] Launching browser (Docker: ${isDocker})...`);

  try {
    const browser = await puppeteer.launch({
      executablePath,
      headless: false, // Display inside Xvfb (:99)
      defaultViewport: { width: 1920, height: 1080 },
      args,
      ignoreDefaultArgs: ['--mute-audio'],
      dumpio: true,
    });

    try {
      console.log('Browser launched');
      
      const pages = await browser.pages();
      // Browser usually has a blank page already
      const page = pages[0] || await browser.newPage();
      
      console.log('Page selected');
      await page.bringToFront(); // Explicitly focus the meeting tab
      await page.setViewport({ width: 1920, height: 1080 });
      console.log('Viewport set to 1920x1080');

      const meet = MeetingProviderFactory.from(meetingUrl, page, browser);
      console.log('MeetProvider created');

      const context = browser.defaultBrowserContext();
      const permissionOrigins = new Set<string>();
      const origin = getMeetingPlatformOrigin({ provider: providerName });
      if (origin) {
        permissionOrigins.add(origin);
      }
      try {
        permissionOrigins.add(new URL(meetingUrl).origin);
      } catch {
        // keep defaults when URL cannot be parsed
      }

      for (const permissionOrigin of permissionOrigins) {
        const permissions: Parameters<typeof context.overridePermissions>[1] = ['notifications'];
        if (allowCamera) permissions.push('camera');
        if (allowMicrophone) permissions.push('microphone');
        await context.overridePermissions(permissionOrigin, permissions);
      }

      await meet.login(username, password);
      console.log('Logged in');

      await onPhaseChange?.("joining");
      await meet.joinMeeting(meetingUrl, botName);
      console.log('Join flow executed, waiting for admission...');

      await onPhaseChange?.("waiting_admission");
      await meet.waitUntilMeetingStarts();
      console.log('Meeting started');

      await onPhaseChange?.("recording");
      await meet.record(outputPath, duration);
      console.log('Recording finished');

      return { success: true, provider: providerName };
    } finally {
      await browser.close();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown bot execution error';
    if (isAdmissionTimeoutError(error)) {
      const taggedMessage = message.includes(ADMISSION_TIMEOUT_ERROR_TAG)
        ? message
        : `[${ADMISSION_TIMEOUT_ERROR_TAG}] ${message}`;
      console.warn(`[startBot] Admission timeout reached (expected if host does not admit bot): ${message}`);
      return { success: false, error: taggedMessage, provider: providerName };
    } else {
      console.error('Failed executing the bot:', error);
      return { success: false, error: message, provider: providerName };
    }
  }
}
