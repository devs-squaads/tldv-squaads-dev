import { OnlineMeetingProvider } from '../OnlineMeetingProvider'
import Os from 'os'

export class AdmissionError extends Error {
  public readonly reason: 'timeout' | 'rejected';
  constructor(reason: 'timeout' | 'rejected', message: string) {
    super(message);
    this.name = 'AdmissionError';
    this.reason = reason;
  }
}

export class GoogleMeet extends OnlineMeetingProvider {
    private timesAlone: number = 0

    private isEnvTrue(name: string): boolean {
        return process.env[name]?.toLowerCase() === 'true';
    }

    private isLowProfileModeEnabled(): boolean {
        return process.env.BOT_LOW_PROFILE_MODE !== 'false';
    }

    private async applyLowProfileCompaction(): Promise<void> {
        if (!this.isLowProfileModeEnabled()) {
            return;
        }

        console.log('[GoogleMeet] Applying low-profile compaction...');

        for (let attempt = 0; attempt < 3; attempt++) {
            await this.page.evaluate(() => {
                const clickable = Array.from(document.querySelectorAll('button, div[role="button"]')) as HTMLElement[];
                const normalized = (value: string | null | undefined) => (value || '').trim().toLowerCase();
                const labels = (element: Element) => [
                    normalized(element.textContent),
                    normalized(element.getAttribute('aria-label')),
                    normalized(element.getAttribute('data-tooltip')),
                    normalized(element.getAttribute('title')),
                ].filter(Boolean);

                const clickFirst = (matcher: (values: string[]) => boolean) => {
                    const target = clickable.find((element) => matcher(labels(element)));
                    if (target) {
                        target.click();
                        return true;
                    }
                    return false;
                };

                // Close side panels / drawers if they are open.
                clickFirst((values) => values.some((value) =>
                    ['close panel', 'close side panel', 'cerrar panel', 'cerrar panel lateral', 'hide everyone', 'ocultar a todos', 'hide chat', 'ocultar chat']
                        .some((target) => value.includes(target))
                ));

                // Try to collapse/minimize self view.
                clickFirst((values) => values.some((value) =>
                    ['hide self view', 'ocultar tu vista', 'minimize self view', 'minimizar tu vista', 'hide my video', 'ocultar mi vídeo', 'ocultar mi video']
                        .some((target) => value.includes(target))
                ));

                // Prefer a tiled/compact local layout when such controls are visible.
                clickFirst((values) => values.some((value) =>
                    ['change layout', 'cambiar diseño', 'change the layout', 'cambiar el diseño']
                        .some((target) => value.includes(target))
                ));
                clickFirst((values) => values.some((value) =>
                    ['tiled', 'mosaico', 'tile', 'en mosaico', 'sidebar', 'barra lateral']
                        .some((target) => value === target || value.includes(target))
                ));

                // Best effort: unpin any focused tile if Meet exposes that control.
                clickFirst((values) => values.some((value) =>
                    ['unpin', 'desanclar', 'remove pin', 'quitar fijación', 'quitar fijacion']
                        .some((target) => value.includes(target))
                ));
            });

            await this.wait(1000);
        }
    }

    async login(username: string, password: string) {
        if (!username || !password) {
            console.log('No credentials provided, skipping Google login');
            return;
        }
        await this.page.goto('https://accounts.google.com', { waitUntil: 'networkidle2' })
        await this.page.waitForSelector('input[type="email"]')
        await this.page.type('input[type="email"]', username)
        await this.page.click('#identifierNext')
        await this.page.waitForSelector('input[type="password"]', { visible: true })
        await this.page.type('input[type="password"]', password)
        await this.page.click('#passwordNext')
        await this.page.waitForNavigation({ waitUntil: 'networkidle2' })
    }

    async joinMeeting(meetingUrl: string, botName: string) {
        console.log(`[GoogleMeet] Joining ${meetingUrl} as ${botName}`);
        await this.page.goto(meetingUrl, { waitUntil: 'networkidle2' })
        await this.wait(5000)

        // 1. Dismiss initial "Got it" / "Entendido" tooltip if present
        console.log('[GoogleMeet] Dismissing tooltips...');
        await this.page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const closeBtn = buttons.find(b =>
                ['entendido', 'got it', 'dismiss', 'cerrar'].some(t => b.textContent?.toLowerCase().includes(t))
            );
            if (closeBtn) (closeBtn as HTMLElement).click();
        });

        // 2. Handle "Continue without microphone and camera" overlay
        console.log('[GoogleMeet] Handling mic/cam overlay...');
        await this.page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const skipBtn = buttons.find(b =>
                ['continuar sin micrófono', 'continue without microphone', 'dismiss'].some(t => b.textContent?.toLowerCase().includes(t))
            );
            if (skipBtn) (skipBtn as HTMLElement).click();
        });

        await this.wait(2000)
        const allowCamera = this.isEnvTrue('BOT_ALLOW_CAMERA');
        const allowMicrophone = this.isEnvTrue('BOT_ALLOW_MICROPHONE');
        if (allowCamera || allowMicrophone) {
            console.log(`[GoogleMeet] Media toggles enabled (allowCamera=${allowCamera}, allowMicrophone=${allowMicrophone})`);
            if (allowCamera) {
                await this.turnOffCamera();
            }
            if (allowMicrophone) {
                await this.turnOffMicrophone();
            }
            await this.wait(2000);
        } else {
            console.log('[GoogleMeet] Media toggles skipped (camera/microphone disabled by policy)');
        }

        // 3. Enter Bot Name
        console.log(`[GoogleMeet] Entering bot name: ${botName}`);
        try {
            const nameSet = await this.page.evaluate((name: string) => {
                const inputs = Array.from(document.querySelectorAll('input'));
                const nameInput = inputs.find(i => {
                    const label = (i.getAttribute('aria-label') || i.getAttribute('placeholder') || '').toLowerCase();
                    return label.includes('nombre') || label.includes('name');
                });
                if (nameInput) {
                    (nameInput as HTMLInputElement).value = name;
                    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
                return false;
            }, botName);

            if (nameSet) {
                console.log('[GoogleMeet] Bot name set successfully via evaluate');
            } else {
                console.warn('[GoogleMeet] Could not find name input field');
            }
        } catch (e) {
            console.error('[GoogleMeet] Error setting name:', e);
        }

        await this.wait(3000);

        // 4. Click Join Button
        console.log('[GoogleMeet] Attempting to click join button...');
        for (let attempt = 0; attempt < 15; attempt++) {
            const result = await this.page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const joinButton = buttons.find(b => {
                    const txt = (b.textContent || '').trim().toLowerCase();
                    return ['ask to join', 'join now', 'unirme ahora', 'solicitar unirse'].some(target => txt.includes(target));
                });

                if (joinButton) {
                    const btn = joinButton as HTMLButtonElement;
                    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
                        return 'disabled';
                    }
                    btn.click();
                    return 'clicked';
                }
                return 'not_found';
            });

            console.log(`[GoogleMeet] Join attempt ${attempt + 1}: ${result}`);

            if (result === 'clicked') {
                console.log('[GoogleMeet] Join request sent successfully');
                return;
            }

            await this.wait(2000);
        }

        throw new Error('Failed to join: Join button not found or remained disabled');
    }

    /**
     * Waits for the bot to be admitted into the meeting.
     * Uses MEETING_ADMISSION_TIMEOUT_MS (separate from participant timeout).
     *
     * Throws AdmissionError with reason:
     *  - 'rejected': host explicitly denied entry
     *  - 'timeout': nobody admitted the bot within the timeout
     */
    async waitForAdmission(): Promise<void> {
        const admissionTimeoutMs = Number(process.env.MEETING_ADMISSION_TIMEOUT_MS || 300000);
        const pollMs = 1000;
        const deadline = Date.now() + admissionTimeoutMs;

        console.log(`[GoogleMeet] Waiting for admission (timeout: ${admissionTimeoutMs / 1000}s)...`);

        while (Date.now() < deadline) {
            const state = await this.page.evaluate(() => {
                const bodyText = (document.body.innerText || '').toLowerCase();

                // Rejected signals
                const rejectedSignals = [
                    'you can\'t join this call',
                    'no puedes unirte a esta llamada',
                    'your request to join was denied',
                    'se ha denegado tu solicitud',
                    'the meeting host denied your request',
                    'el organizador ha denegado tu solicitud',
                    'not allowed to join',
                    'no tienes permiso para unirte',
                ];
                const isRejected = rejectedSignals.some(s => bodyText.includes(s));
                if (isRejected) return 'rejected';

                // Still waiting for admission
                const waitingSignals = [
                    'solicitaste unirte',
                    'asked to join',
                    'waiting to be admitted',
                    'esperando a que te admitan',
                    'asking to be let in',
                    'pidiendo que te dejen entrar',
                ];
                const isWaiting = waitingSignals.some(s => bodyText.includes(s));
                if (isWaiting) return 'waiting';

                // Check if we're inside the meeting (participants visible)
                const participantsCount = document.querySelectorAll('div[data-participant-id]').length;
                if (participantsCount >= 2) return 'admitted';

                // Check for join buttons still present (pre-join screen)
                const buttons = Array.from(document.querySelectorAll('button'));
                const hasJoinButton = buttons.some(b => {
                    const txt = (b.textContent || '').trim().toLowerCase();
                    return ['ask to join', 'join now', 'solicitar unirse', 'unirme ahora']
                        .some(t => txt.includes(t));
                });
                if (hasJoinButton) return 'pre_join';

                return 'unknown';
            });

            if (state === 'rejected') {
                console.log('[GoogleMeet] Host REJECTED the bot entry.');
                throw new AdmissionError('rejected', 'Meeting host denied bot entry.');
            }

            if (state === 'admitted') {
                console.log('[GoogleMeet] Bot admitted into the meeting.');
                return;
            }

            // 'waiting', 'pre_join', 'unknown' -> keep polling
            await this.wait(pollMs);
        }

        console.log('[GoogleMeet] Admission timeout expired. Nobody let the bot in.');
        throw new AdmissionError('timeout', 'Admission timeout: bot was not admitted in time.');
    }

    /**
     * Legacy method kept for compatibility. Now delegates to waitForAdmission
     * + a brief participant check.
     */
    async waitUntilMeetingStarts(): Promise<void> {
        // Phase 1: Wait for admission
        await this.waitForAdmission();
        await this.applyLowProfileCompaction();

        // Phase 2: Brief wait for participants after admission
        const participantTimeoutMs = Number(process.env.WAIT_FOR_PARTICIPANTS_TIMEOUT_MS || 300000);
        console.log(`[GoogleMeet] Admitted. Waiting for participants (timeout: ${participantTimeoutMs / 1000}s)...`);

        try {
            await this.page.waitForFunction(
                () => {
                    const participantsCount = document.querySelectorAll('div[data-participant-id]').length;
                    return participantsCount >= 2;
                },
                { timeout: participantTimeoutMs, polling: 1000 }
            );
            console.log('[GoogleMeet] Participants detected. Starting recording flow.');
            await this.applyLowProfileCompaction();
            await this.wait(500);
        } catch {
            console.log('[GoogleMeet] Participant wait timeout expired before the meeting was ready.');
            throw new AdmissionError('timeout', 'Admission timeout: participants did not appear in time.');
        }
    }

    async imAlone(): Promise<boolean> {
        const isOut = await this.page.evaluate(() => {
            const bodyText = document.body.innerText.toLowerCase();
            const rejoinBtn = !!Array.from(document.querySelectorAll('button, a')).find(b =>
                (b.textContent || '').toLowerCase().includes('volver a unirse') ||
                (b.textContent || '').toLowerCase().includes('rejoin')
            );

            const removedMsg = bodyText.includes('alguien te ha quitado') ||
                              bodyText.includes('someone removed you') ||
                              bodyText.includes('has abandonado la reunión') ||
                              bodyText.includes('you left the meeting');

            return rejoinBtn || removedMsg;
        });

        if (isOut) {
            console.log('[GoogleMeet] UI indicates we are OUT of the meeting. Stopping immediately.');
            return true;
        }

        const participants = await this.page.$$('div[data-participant-id]');
        const count = participants.length;

        console.log(`[GoogleMeet] Participants detected: ${count}`);

        if (count <= 1) {
            this.timesAlone++;
        } else {
            this.timesAlone = 0;
        }

        return this.timesAlone >= 2;
    }

    protected async turnOffCamera() {
        console.log('[GoogleMeet] Turning off camera...');
        try {
            await this.page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
                const camBtn = buttons.find(b => {
                    const label = (b.getAttribute('aria-label') || '').toLowerCase();
                    return (label.includes('cámara') || label.includes('camera')) &&
                        (label.includes('desactivar') || label.includes('turn off') || label.includes('ctrl+e') || label.includes('⌘+e'));
                });
                if (camBtn) (camBtn as HTMLElement).click();
            });
        } catch { }

        const key = Os.platform() === 'darwin' ? 'Meta' : 'Control'
        await this.page.keyboard.down(key)
        await this.page.keyboard.press('e')
        await this.page.keyboard.up(key)
    }

    protected async turnOffMicrophone() {
        console.log('[GoogleMeet] Turning off microphone...');
        try {
            await this.page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
                const micBtn = buttons.find(b => {
                    const label = (b.getAttribute('aria-label') || '').toLowerCase();
                    return (label.includes('micrófono') || label.includes('microphone')) &&
                        (label.includes('desactivar') || label.includes('turn off') || label.includes('ctrl+d') || label.includes('⌘+d'));
                });
                if (micBtn) (micBtn as HTMLElement).click();
            });
        } catch { }

        const key = Os.platform() === 'darwin' ? 'Meta' : 'Control'
        await this.page.keyboard.down(key)
        await this.page.keyboard.press('d')
        await this.page.keyboard.up(key)
    }
}
