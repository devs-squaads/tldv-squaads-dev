export type SupportDiagnostic =
  | { kind: "meeting"; meetingId: string; status: string; errorMessage: string | null; sourceProvider: string | null; startsAt: Date | null; endsAt: Date | null }
  | { kind: "none" };

export interface SupportNotification {
  reporterId: string;
  message: string;
  diagnostic: SupportDiagnostic;
}

export interface SupportProvider {
  readonly name: string;
  deliver(notification: SupportNotification): Promise<void>;
}
