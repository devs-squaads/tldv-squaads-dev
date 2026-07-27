/** Admin-only render gate for `PendingRequestsBell` (013/ADR-0008 "Admin notification surface"). */
export function shouldRenderPendingBell(role: string | null | undefined): boolean {
  return role === "admin";
}
