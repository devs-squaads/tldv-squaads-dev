import path from 'path'
import { Browser, ElementHandle, Page } from "puppeteer-core";
import fs from 'fs'
import Os from 'os'
import { spawn, ChildProcess } from 'child_process'

type ElementTextExtractor = (el: Element | null) => string | null;

interface AdmissionState {
    participantsCount: number;
    hasJoinRequestButton: boolean;
    waitingApprovalText: boolean;
}

interface WaitForAdmissionOptions {
    providerName: string;
    inspectState: () => Promise<AdmissionState>;
    retryJoinRequest?: () => Promise<boolean>;
    retryIntervalMs?: number;
    pollIntervalMs?: number;
    minParticipants?: number;
}

export const ADMISSION_TIMEOUT_ERROR_TAG = "ADMISSION_TIMEOUT";

export abstract class OnlineMeetingProvider {
    constructor(
        protected page: Page,
        protected browser: Browser,
    ) {

    }

    abstract login(username: string, password: string): Promise<void>;

    abstract joinMeeting(meetingUrl: string, botName: string): Promise<void>;
    abstract waitUntilMeetingStarts(): Promise<void>;
    abstract imAlone(): Promise<boolean>;

    protected getAdmissionTimeoutMs(): number {
        const raw =
            process.env.MEETING_ADMISSION_TIMEOUT_MS ||
            process.env.GOOGLE_MEET_ADMISSION_TIMEOUT_MS || // Backward-compatibility
            '';
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 20 * 60 * 1000;
    }

    protected async waitForAdmission(options: WaitForAdmissionOptions): Promise<void> {
        const timeoutMs = this.getAdmissionTimeoutMs();
        const startedAt = Date.now();
        let lastRetryAt = 0;

        const pollIntervalMs = options.pollIntervalMs ?? 1000;
        const retryIntervalMs = options.retryIntervalMs ?? 10_000;
        const minParticipants = options.minParticipants ?? 2;

        console.log(`[${options.providerName}] Waiting for admission/participants before recording...`);

        while (Date.now() - startedAt < timeoutMs) {
            const state = await options.inspectState();
            const inMeeting =
                state.participantsCount >= minParticipants &&
                !state.hasJoinRequestButton &&
                !state.waitingApprovalText;

            if (inMeeting) {
                console.log(`[${options.providerName}] Participants detected. Starting recording flow.`);
                await this.wait(500);
                return;
            }

            if (options.retryJoinRequest && state.hasJoinRequestButton && Date.now() - lastRetryAt >= retryIntervalMs) {
                const clicked = await options.retryJoinRequest();
                if (clicked) {
                    lastRetryAt = Date.now();
                    console.log(`[${options.providerName}] Re-sent join request while waiting for admission.`);
                }
            }

            await this.wait(pollIntervalMs);
        }

        const timeout = this.getAdmissionTimeoutSource();
        console.log(
            `[${options.providerName}] Timeout waiting for participants/admission. ` +
            `Exceeded ${timeout.name}=${timeout.value}ms`
        );
        throw new Error(
            `[${ADMISSION_TIMEOUT_ERROR_TAG}] Exceeded ${timeout.name}=${timeout.value}ms while waiting for admission`
        );
    }

    protected getAdmissionTimeoutSource(): { name: string; value: number } {
        const hasGlobal = Boolean(process.env.MEETING_ADMISSION_TIMEOUT_MS);
        const hasLegacy = Boolean(process.env.GOOGLE_MEET_ADMISSION_TIMEOUT_MS);
        const value = this.getAdmissionTimeoutMs();

        if (hasGlobal) {
            return { name: "MEETING_ADMISSION_TIMEOUT_MS", value };
        }
        if (hasLegacy) {
            return { name: "GOOGLE_MEET_ADMISSION_TIMEOUT_MS", value };
        }
        return { name: "MEETING_ADMISSION_TIMEOUT_MS", value };
    }

    async record(outputPath: string, maxDurationInMinutes: number): Promise<{ success: boolean; path?: string; error?: string }> {
        console.log(`[OnlineMeetingProvider] Starting FFmpeg recording to ${outputPath}`);
        await this.wait(500)

        const uuid = Math.random().toString(36).substring(7)
        const tempFile = path.join(Os.tmpdir(), `meeting-${uuid}.mp4`);

        // Ensure directory exists
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const isLinux = process.platform === 'linux';
        const display = process.env.DISPLAY || ':99';

        if (!isLinux) {
            throw new Error(`Unsupported platform ${process.platform}. Recording is Docker/Linux-only.`);
        }

        const ffmpegArgs: string[] = [
            '-f', 'x11grab',
            '-video_size', '1920x1080',
            '-framerate', '30',
            '-i', display,
            '-f', 'pulse',
            '-name', 'ffmpeg-capture',
            '-i', 'SpeakerOutput.monitor',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-strict', 'experimental',
            '-y',
            tempFile
        ];

        const ffmpegPath = 'ffmpeg';

        console.log(`[OnlineMeetingProvider] Spawning FFmpeg (${process.platform}): ${ffmpegPath} ${ffmpegArgs.join(' ')}`);

        const ffmpegProcess: ChildProcess = spawn(ffmpegPath, ffmpegArgs, {
            env: {
                ...process.env,
                PULSE_SERVER: process.env.PULSE_SERVER || 'unix:/tmp/pulseaudio.socket',
                DISPLAY: display
            }
        });

        ffmpegProcess.stderr?.on('data', (data) => {
            const msg = data.toString();
            if (msg.includes('Err') || msg.includes('fail')) {
                console.error(`[OnlineMeetingProvider] FFmpeg Stderr: ${msg}`);
            }
        });

        let totalTime = 0
        const interval = 2_000
        const maxMeetingTime = maxDurationInMinutes * 60 * 1000

        return new Promise((resolve) => {
            let stopped = false;
            let pollInterval: ReturnType<typeof setInterval> | null = null;

            const handleExit = async (reason: string) => {
                await this.wait(500);
                if (fs.existsSync(tempFile)) {
                    try {
                        fs.copyFileSync(tempFile, outputPath);
                        fs.unlinkSync(tempFile);
                        console.log(`[OnlineMeetingProvider] Recording saved to ${outputPath}`);
                        resolve({ success: true, path: outputPath });
                    } catch (err: unknown) {
                        const message = err instanceof Error ? err.message : 'Unknown copy error';
                        console.error(`[OnlineMeetingProvider] Error copying file: ${message}`);
                        resolve({ success: false, error: `Error saving recording: ${message}` });
                    }
                } else {
                    console.error(`[OnlineMeetingProvider] No output file found after exit (${reason})`);
                    resolve({ success: false, error: `FFmpeg exited without creating output (${reason})` });
                }
            };

            const stopRecording = async () => {
                if (stopped) return;
                stopped = true;
                if (pollInterval) clearInterval(pollInterval);
                console.log('[OnlineMeetingProvider] Stopping FFmpeg process...');

                try {
                    ffmpegProcess.stdin?.write('q');
                } catch {
                    // stdin may already be closed if FFmpeg crashed
                }

                const killTimeout = setTimeout(() => {
                    console.log('[OnlineMeetingProvider] FFmpeg did not stop gracefully, killing...');
                    ffmpegProcess.kill('SIGKILL');
                }, 5000);

                ffmpegProcess.once('exit', async (code) => {
                    clearTimeout(killTimeout);
                    console.log(`[OnlineMeetingProvider] FFmpeg exited with code ${code}`);
                    await handleExit(`graceful stop, code=${code}`);
                });
            };

            // Handle FFmpeg crashing before stopRecording is called — this is what caused the hang
            ffmpegProcess.once('exit', async (code) => {
                if (stopped) return; // stopRecording already handled this
                stopped = true;
                if (pollInterval) clearInterval(pollInterval);
                console.error(`[OnlineMeetingProvider] FFmpeg exited unexpectedly with code ${code}`);
                await handleExit(`unexpected crash, code=${code}`);
            });

            // Handle spawn errors (e.g. ffmpeg binary not found)
            ffmpegProcess.on('error', (err) => {
                if (stopped) return;
                stopped = true;
                if (pollInterval) clearInterval(pollInterval);
                console.error(`[OnlineMeetingProvider] FFmpeg spawn error: ${err.message}`);
                resolve({ success: false, error: `FFmpeg spawn error: ${err.message}` });
            });

            pollInterval = setInterval(async () => {
                totalTime += interval

                // Skip checks for the first 15 seconds to allow UI to load
                if (totalTime < 15_000) {
                    return;
                }

                if (await this.imAlone()) {
                    console.log('[OnlineMeetingProvider] I am alone, stopping recording')
                    await stopRecording();
                    return
                }

                if (totalTime > maxMeetingTime) {
                    console.log('[OnlineMeetingProvider] Max time reached')
                    await stopRecording();
                    return
                }
            }, interval)
        })
    }

    protected abstract turnOffCamera(): Promise<void>;
    protected abstract turnOffMicrophone(): Promise<void>;

    wait(ms: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    protected async tabFindAndType(texts: string[], maxTimes: number, textToType: string, getTextFunction: ElementTextExtractor | null = null): Promise<boolean> {
        return this.findElementAnd(texts, maxTimes, async (focusedElement) => {
            await focusedElement.click()
            await this.page.keyboard.type(textToType)
        }, getTextFunction)
    }

    protected async tabFindAndClick(texts: string[], maxTimes: number, getTextFunction: ElementTextExtractor | null = null): Promise<boolean> {
        return this.findElementAnd(texts, maxTimes, async () => {
            await this.page.keyboard.press('Enter')
        }, getTextFunction)
    }

    private async findElementAnd(
        texts: string[],
        maxTimes: number,
        action: (focusedElement: ElementHandle<Element>) => Promise<void>,
        getTextFunction: ElementTextExtractor | null = null
    ) {
        getTextFunction ??= (el: Element | null) => {
            if (!el) return '';
            const t = (el.textContent || '').trim();
            const a = (el.getAttribute('aria-label') || '').trim();
            const p = (el.getAttribute('placeholder') || '').trim();
            const v = 'value' in el ? String((el as HTMLInputElement).value || '').trim() : '';
            const l = (el.getAttribute('label') || '').trim();
            return `${t}|${a}|${p}|${v}|${l}`;
        };

        const targetTexts = texts.map(t => t.toLowerCase());

        for (let i = 0; i < maxTimes; i++) {
            const focusedHandle = await this.page.evaluateHandle(() => {
                let focusedElement: Element | null = document.activeElement;
                while (focusedElement?.tagName === 'IFRAME') {
                    try {
                        const next = (focusedElement as HTMLIFrameElement).contentWindow?.document?.activeElement || null;
                        if (!next || next === focusedElement) break;
                        focusedElement = next;
                    } catch {
                        break; // Cross-origin iframe
                    }
                }
                return focusedElement;
            })

            const focusedElement = focusedHandle.asElement() as ElementHandle<Element> | null;
            if (!focusedElement) {
                await focusedHandle.dispose();
                continue
            }

            const metadata: string = (await this.page.evaluate(getTextFunction, focusedElement)) || '';
            const pieces = metadata.split('|').map(p => p.toLowerCase());

            const match = pieces.find(p => p && targetTexts.some(target => p.includes(target)));

            if (match) {
                console.log(`[OnlineMeetingProvider] Found element matching "${match}" (from ${texts.join(',')})`);
                await action(focusedElement);
                await focusedElement.dispose();
                return true;
            }

            await this.page.keyboard.press('Tab');
            await this.wait(50); // Small wait for focus transition
            await focusedElement.dispose();
        }

        return false
    }
}
