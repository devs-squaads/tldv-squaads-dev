"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/utils";
import { approveShareRequestAction, rejectShareRequestAction } from "@/app/actions/shareRequests";
import type { ShareRequestListItem, ShareRequestAccessType } from "@/services/shareRequestService";

const accessTypeLabels: Record<ShareRequestAccessType, string> = {
  single_use: "un solo uso",
  temporary: "temporal",
  permanent: "permanente",
};

/**
 * 013 admin feedback: pending-request cards showed raw ids ("Usuario 106929991040359390199")
 * and "Reunión meeting-<uuid>" instead of real, actionable information. Batch-resolved
 * server-side (page.tsx: `UserRepository.findByIds` + `MeetingRepository.findById`) — this view
 * only renders the already-enriched fields, no client-side per-row fetching.
 */
export interface AdminShareRequestListItem extends ShareRequestListItem {
  /** Registered-recipient path only; unregistered stays on `recipientEmail`. */
  granteeEmail?: string;
  /** Falls back to `Usuario {requesterId}` server-side if the requester's user row is gone. */
  requesterEmail: string;
  /** Never the raw meeting id — see `resolveMeetingDisplayName` (adminShareRequests.logic.ts). */
  meetingName: string;
}

type ResolveAction = (requestId: string) => Promise<{ success: boolean; error?: string }>;

export function AdminShareRequestsView({ initialRequests }: { initialRequests: AdminShareRequestListItem[] }) {
  const [requests, setRequests] = useState(initialRequests);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const resolve = (id: string, action: ResolveAction) => {
    setActiveId(id);
    setError(null);
    startTransition(async () => {
      const result = await action(id);
      if (result.success) {
        setRequests((prev) => prev.filter((request) => request.id !== id));
      } else {
        setError(result.error ?? "Error al resolver la solicitud");
      }
      setActiveId(null);
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Solicitudes de compartición pendientes</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {requests.length} {requests.length === 1 ? "solicitud pendiente" : "solicitudes pendientes"}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 p-3 text-sm text-[var(--destructive)]">
          {error}
        </div>
      )}

      {requests.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-[var(--muted-foreground)]">
            No hay solicitudes pendientes.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((request) => {
            const isBusy = isPending && activeId === request.id;
            return (
              <Card key={request.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">
                      Acceso para:{" "}
                      {request.granteeUserId ? (request.granteeEmail ?? `Usuario ${request.granteeUserId}`) : request.recipientEmail}
                    </CardTitle>
                    <Badge variant="outline">
                      {accessTypeLabels[request.accessType]}
                      {request.accessType === "temporary" && request.expiresInDays
                        ? ` · ${request.expiresInDays} días`
                        : ""}
                    </Badge>
                  </div>
                  {/* CardDescription renders a <p> — this needs block children (the meeting Link),
                      so it's a plain div styled to match instead of nesting <div> inside <p>. */}
                  <div className="space-y-0.5 text-sm text-[var(--muted-foreground)]">
                    <div>Solicitado por: {request.requesterEmail}</div>
                    <div>
                      Reunión:{" "}
                      <Link
                        href={`/meeting/${request.meetingId}`}
                        className="font-medium text-[var(--foreground)] hover:underline"
                      >
                        {request.meetingName}
                      </Link>
                    </div>
                    <div className="text-xs">Solicitada: {formatDate(request.createdAt)}</div>
                  </div>
                </CardHeader>
                <CardContent className="flex items-center gap-2 pt-0">
                  <Button size="sm" onClick={() => resolve(request.id, approveShareRequestAction)} disabled={isBusy}>
                    {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Aprobar"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resolve(request.id, rejectShareRequestAction)}
                    disabled={isBusy}
                  >
                    Rechazar
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
