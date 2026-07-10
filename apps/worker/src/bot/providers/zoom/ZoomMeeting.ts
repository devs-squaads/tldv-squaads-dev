import { OnlineMeetingProvider } from "../OnlineMeetingProvider";

export class ZoomMeeting extends OnlineMeetingProvider {
    private timesAlone: number = 0;

    async login(username: string, password: string) {
        void username;
        void password;
        // Zoom web flow can usually proceed without explicit auth for invited bot.
        return Promise.resolve();
    }

    async joinMeeting(meetingUrl: string, botName: string): Promise<void> {
        await this.page.goto(meetingUrl, { waitUntil: "networkidle2" });
        await this.wait(3000);

        // Zoom often shows "Join from Your Browser" first.
        await this.page.evaluate(() => {
            const links = Array.from(document.querySelectorAll("a, button"));
            const browserJoin = links.find((el) => {
                const txt = (el.textContent || "").toLowerCase();
                return txt.includes("join from your browser") || txt.includes("unirse desde su navegador");
            });
            if (browserJoin) (browserJoin as HTMLElement).click();
        });

        await this.wait(2500);

        // Fill display name if input is present.
        await this.page.evaluate((name: string) => {
            const input =
                (document.querySelector('input#input-for-name') as HTMLInputElement | null) ||
                (document.querySelector('input[name="inputname"]') as HTMLInputElement | null) ||
                (document.querySelector('input[placeholder*="name" i]') as HTMLInputElement | null) ||
                (document.querySelector('input[aria-label*="name" i]') as HTMLInputElement | null);

            if (!input) return;
            input.value = "";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.value = name;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }, botName);

        await this.wait(500);
        await this.turnOffCamera();
        await this.turnOffMicrophone();
        await this.wait(500);

        // Click Join button.
        for (let i = 0; i < 10; i++) {
            const clicked = await this.page.evaluate(() => {
                const candidates = Array.from(document.querySelectorAll("button, a"));
                const join = candidates.find((el) => {
                    const txt = (el.textContent || "").trim().toLowerCase();
                    return txt === "join" || txt.includes("join meeting") || txt.includes("unirse");
                });
                if (!join) return false;
                const btn = join as HTMLButtonElement;
                if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return false;
                btn.click();
                return true;
            });
            if (clicked) return;
            await this.wait(1200);
        }

        throw new Error("Failed to click Zoom join button.");
    }

    async waitUntilMeetingStarts(): Promise<void> {
        await this.waitForAdmission({
            providerName: "ZoomMeeting",
            inspectState: async () => {
                return this.page.evaluate(() => {
                    const text = (document.body.innerText || "").toLowerCase();
                    const participantsCount = document.querySelectorAll('[aria-label*="participants" i], .participants-item__name').length;
                    const hasJoinRequestButton = !!Array.from(document.querySelectorAll("button")).find((b) => {
                        const txt = (b.textContent || "").toLowerCase();
                        return txt === "join" || txt.includes("join meeting") || txt.includes("unirse");
                    });
                    const waitingApprovalText =
                        text.includes("waiting for host") ||
                        text.includes("wait for the host") ||
                        text.includes("esperando al anfitrion");

                    return {
                        participantsCount,
                        hasJoinRequestButton,
                        waitingApprovalText,
                    };
                });
            },
            minParticipants: 1,
            pollIntervalMs: 1000,
            retryIntervalMs: 10_000,
            retryJoinRequest: async () => {
                return this.page.evaluate(() => {
                    const join = Array.from(document.querySelectorAll("button")).find((b) => {
                        const txt = (b.textContent || "").toLowerCase();
                        return txt === "join" || txt.includes("join meeting") || txt.includes("unirse");
                    });
                    if (!join) return false;
                    const btn = join as HTMLButtonElement;
                    if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return false;
                    btn.click();
                    return true;
                });
            },
        });
    }

    async imAlone(): Promise<boolean> {
        const state = await this.page.evaluate(() => {
            const text = (document.body.innerText || "").toLowerCase();
            const participantsCount = document.querySelectorAll('[aria-label*="participants" i], .participants-item__name').length;
            const ended =
                text.includes("meeting has ended") ||
                text.includes("you have been removed") ||
                text.includes("la reunion ha finalizado") ||
                text.includes("te han eliminado");
            return { participantsCount, ended };
        });

        if (state.ended) return true;
        this.timesAlone = state.participantsCount <= 1 ? this.timesAlone + 1 : 0;
        return this.timesAlone >= 3;
    }

    protected async turnOffCamera() {
        await this.page.evaluate(() => {
            const controls = Array.from(document.querySelectorAll("button"));
            const cam = controls.find((b) => {
                const label = (b.getAttribute("aria-label") || b.textContent || "").toLowerCase();
                return label.includes("stop video") || label.includes("turn off video") || label.includes("detener video");
            });
            if (cam) (cam as HTMLElement).click();
        });
    }

    protected async turnOffMicrophone() {
        await this.page.evaluate(() => {
            const controls = Array.from(document.querySelectorAll("button"));
            const mic = controls.find((b) => {
                const label = (b.getAttribute("aria-label") || b.textContent || "").toLowerCase();
                return label.includes("mute") || label.includes("silenciar");
            });
            if (mic) (mic as HTMLElement).click();
        });
    }
}
