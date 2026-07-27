import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

export interface SessionCaller {
  id: string;
  role: "admin" | "member";
}

/**
 * Replaces the two duplicated `requireCallerId()` helpers in `app/actions/shares.ts` and
 * `grants.ts` — the role is already re-resolved on every request in `auth.ts`'s jwt callback,
 * so plumbing it here is a parameter, not a new mechanism (013/ADR-0008).
 */
export async function requireCaller(): Promise<SessionCaller> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.role) {
    throw new Error("Unauthorized");
  }
  return { id: session.user.id, role: session.user.role };
}
