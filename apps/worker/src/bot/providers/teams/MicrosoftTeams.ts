import { OnlineMeetingProvider } from '../OnlineMeetingProvider'

export class MicrosoftTeams extends OnlineMeetingProvider {
    private timesAlone: number = 0

    private async inspectJoinState(): Promise<{
        participantsCount: number;
        hasJoinRequestButton: boolean;
        waitingApprovalText: boolean;
    }> {
        return this.page.evaluate(() => {
            const iframe = document.querySelector('.embedded-electron-webview') as HTMLIFrameElement | null;
            const iframeDocument = iframe?.contentWindow?.document || null;
            const participantsCount = iframeDocument
                ? iframeDocument.querySelectorAll('div[data-tid="participant-name-decorator-layer"]').length
                : 0;

            const joinButton = document.querySelector('[data-tid="prejoin-join-button"]') as HTMLButtonElement | null;
            const hasJoinRequestButton = Boolean(joinButton);

            const bodyText = (document.body.innerText || '').toLowerCase();
            const waitingApprovalText = [
                'waiting in the lobby',
                'esperando en el vestíbulo',
                'someone in the meeting should let you in',
            ].some((target) => bodyText.includes(target));

            return {
                participantsCount,
                hasJoinRequestButton,
                waitingApprovalText,
            };
        });
    }

    private async retryJoinIfNeeded(): Promise<boolean> {
        return this.page.evaluate(() => {
            const joinButton = document.querySelector('[data-tid="prejoin-join-button"]') as HTMLButtonElement | null;
            if (!joinButton) {
                return false;
            }

            if (joinButton.disabled || joinButton.getAttribute('aria-disabled') === 'true') {
                return false;
            }

            joinButton.click();
            return true;
        });
    }

    async login(username: string, password: string) {
        void username
        void password
        // no login needed
        return Promise.resolve()
    }

    async joinMeeting(meetingUrl: string, botName: string): Promise<void> {
        meetingUrl = this.buildMeetingUrl(meetingUrl)
        await this.page.goto(meetingUrl, { waitUntil: 'networkidle2' })
        await this.wait(5000)
        await this.tabFindAndClick(['joinOnWeb'], 30, (el: Element | null) => el?.getAttribute('data-tid') || null)
        await this.page.waitForFunction(
            () => document.querySelector('.embedded-electron-webview') !== null,
            {
                timeout: 20_000,
            }
        )
        await this.wait(5000)
        await this.turnOffCamera()
        await this.turnOffMicrophone()
        await this.wait(300)
        await this.tabFindAndType(['prejoin-display-name-input'], 30, botName, (el: Element | null) => el?.getAttribute('data-tid') || null)
        await this.wait(300)
        await this.tabFindAndClick(['prejoin-join-button'], 30, (el: Element | null) => el?.getAttribute('data-tid') || null)
    }

    async waitUntilMeetingStarts(): Promise<void> {
        await this.waitForAdmission({
            providerName: 'MicrosoftTeams',
            inspectState: () => this.inspectJoinState(),
            retryJoinRequest: () => this.retryJoinIfNeeded(),
            minParticipants: 1,
            pollIntervalMs: 1000,
            retryIntervalMs: 10_000,
        });
    }

    async imAlone(): Promise<boolean> {
        const iframe = await this.page.$('.embedded-electron-webview')
        const iframeDocument = await iframe?.contentFrame()
        if (!iframeDocument) {
            return false
        }

        const participants = await iframeDocument.$$('div[data-tid="participant-name-decorator-layer"]')
        console.log(participants.length)
        this.timesAlone = participants.length === 0 ? this.timesAlone + 1 : 0
        return this.timesAlone > 5
    }

    protected async turnOffCamera() {
        await this.tabFindAndClick(['toggle-video-true'], 30, (el: Element | null) => el?.getAttribute('data-cid') || null)
    }

    protected async turnOffMicrophone() {
        await this.tabFindAndClick(['toggle-mute-true'], 30, (el: Element | null) => el?.getAttribute('data-cid') || null)
    }

    private buildMeetingUrl(meetingUrl: string): string {
        let relativeUrl = meetingUrl.split('teams.microsoft.com')[1]
        if (!relativeUrl.startsWith('/#')) {
            relativeUrl = '/_#' + relativeUrl
        }

        meetingUrl = 'https://teams.microsoft.com/dl/launcher/launcher.html?url=' + encodeURIComponent(relativeUrl) + '&type=meetup-join&directDl=true&msLaunch=true&enableMobilePage=true&suppressPrompt=true'
        return meetingUrl
    }
}
