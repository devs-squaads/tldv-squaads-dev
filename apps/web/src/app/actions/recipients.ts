"use server";

import { requireCaller } from "@/lib/sessionCaller";
import { UserRepository } from "@meeting-bot/shared/repositories/UserRepository";

/**
 * Resolves a manually-typed email to a registered user, so the "email not in the meeting"
 * recipient mode can route to the Access Grant flow (registered) or the meeting_shares flow
 * (unregistered) — the same resolution rule feature 009 already applies via
 * ParticipantSuggestionService for calendar-sourced participants (013 spec: "Email not in the
 * meeting").
 */
export async function resolveRecipientAction(email: string) {
  try {
    await requireCaller();
    const user = await UserRepository.findByEmail(email.trim());
    return { success: true as const, granteeUserId: user?.id ?? null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error resolving recipient";
    return { success: false as const, error: message };
  }
}
