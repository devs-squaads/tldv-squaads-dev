import { UserRepository } from "@meeting-bot/shared/repositories/UserRepository";

export interface ParticipantSuggestion {
  email: string;
  /** Registered users.id, or null when the email has no matching account. */
  granteeUserId: string | null;
}

export class ParticipantSuggestionService {
  /**
   * Resolves calendar-captured participant emails (meetings.participantEmails,
   * calendar-sourced only per spec R6) into per-participant sharing suggestions:
   * a matched registered user routes to the Access Grant flow (granteeUserId set),
   * anyone else falls back to the restricted_email share mechanism (granteeUserId null).
   * Ad-hoc meetings (null/empty participantEmails) resolve to an empty list — the UI
   * degrades to manual email entry.
   */
  static async resolveSuggestions(
    participantEmails: string[] | null | undefined,
  ): Promise<ParticipantSuggestion[]> {
    if (!participantEmails || participantEmails.length === 0) {
      return [];
    }

    return Promise.all(
      participantEmails.map(async (email) => {
        const user = await UserRepository.findByEmail(email);
        return { email, granteeUserId: user?.id ?? null };
      }),
    );
  }
}
