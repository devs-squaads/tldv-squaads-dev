import { db } from "@meeting-bot/shared/db";
import { authorizedAccounts } from "@meeting-bot/shared/db/schema";
import { eq } from "drizzle-orm";

export type AuthorizedAccountRole = "admin" | "member";

export class AuthorizedAccountRepository {
  static async findByEmail(email: string) {
    const [account] = await db
      .select()
      .from(authorizedAccounts)
      .where(eq(authorizedAccounts.email, email))
      .limit(1);
    return account || null;
  }

  static async findAll() {
    return db.select().from(authorizedAccounts);
  }

  static async upsert(input: {
    email: string;
    role: AuthorizedAccountRole;
    isActive: boolean;
    invitedBy?: string | null;
  }) {
    const now = new Date();
    const existing = await this.findByEmail(input.email);

    if (existing) {
      const updateData: Record<string, unknown> = {
        role: input.role,
        isActive: input.isActive,
        updatedAt: now,
      };
      if (input.invitedBy !== undefined) {
        updateData.invitedBy = input.invitedBy;
      }

      await db.update(authorizedAccounts).set(updateData).where(eq(authorizedAccounts.email, input.email));
      return { ...existing, ...updateData };
    }

    const newAccount = {
      id: crypto.randomUUID(),
      email: input.email,
      role: input.role,
      isActive: input.isActive,
      invitedBy: input.invitedBy ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(authorizedAccounts).values(newAccount);
    return newAccount;
  }

  static async setActive(email: string, isActive: boolean) {
    await db
      .update(authorizedAccounts)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(authorizedAccounts.email, email));
  }

  static async setRole(email: string, role: AuthorizedAccountRole) {
    await db
      .update(authorizedAccounts)
      .set({ role, updatedAt: new Date() })
      .where(eq(authorizedAccounts.email, email));
  }

  // No FK to `users` — a hard delete here doesn't cascade, so re-adding the
  // email later doesn't lose meeting/login history tied to the user row.
  static async remove(email: string) {
    await db.delete(authorizedAccounts).where(eq(authorizedAccounts.email, email));
  }
}
