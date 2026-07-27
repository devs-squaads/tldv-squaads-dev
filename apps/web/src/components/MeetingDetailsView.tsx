"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { getMeetingStatusLabel, type MeetingStatus } from "@meeting-bot/shared/domain/meetingStatus";
import { formatDate } from "@/lib/utils";
import { getMeetingPlatformLabel } from "@meeting-bot/shared/meetingProvider";
import {
  Loader2, FileText, Sparkles, Download, Video, Calendar,
  AlertCircle, ExternalLink, CheckCircle2, Trash2,
  Copy, Check, Share2, Play, MessageSquare, Send, X,
  ChevronDown, ChevronUp, ClipboardList
} from "lucide-react";
import Link from "next/link";
import { deleteMeetingAction, reprocessMeetingAction, refineSummaryAction, retryMeetingAction } from "@/app/actions/bot";
import { clearInactiveSharesAction, createShareAction, renewShareAccessAction, resendShareInviteAction, revokeShareAction } from "@/app/actions/shares";
import { createGrantAction, revokeGrantAction } from "@/app/actions/grants";
import { cancelShareRequestAction } from "@/app/actions/shareRequests";
import { resolveRecipientAction } from "@/app/actions/recipients";
import type { ShareRequestRecord, ShareRequestAccessType } from "@/services/shareRequestService";
import {
  DEFAULT_ACCESS_TYPE,
  DEFAULT_TEMPORARY_DAYS,
  canCancelShareRequest,
  getAvailableAccessTypes,
  resolveRecipients,
  validateAccessTypeSelection,
  type RecipientMode,
} from "./meetingSharing.logic";
import { useRouter } from "next/navigation";
import { ChapterVideoPlayer, type Chapter } from "./ChapterVideoPlayer";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import { ReportBugButton } from "@/components/bug-report/ReportBugButton";

interface Meeting {
  id: string;
  botName: string | null;
  url: string;
  status: MeetingStatus;
  rawTranscription: string | null;
  summary: string | null;
  recordingFilePath: string | null;
  recordingDownloadUrl?: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MeetingShare {
  id: string;
  meetingId: string;
  shareType: "restricted_email";
  status: "active" | "expired" | "revoked";
  recipientEmail: string | null;
  shareUrl: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

/** Calendar-sourced participant suggestion (spec R6) — resolved server-side by ParticipantSuggestionService.
 *  Structurally identical to `RecipientCandidate` (meetingSharing.logic) — used interchangeably. */
interface ParticipantSuggestion {
  email: string;
  /** Set when the email matches a registered user — routes to the Access Grant flow. */
  granteeUserId: string | null;
}

/** Minimal client-side shape of an `Access Grant` row — 013 "Solicitudes y accesos" passive-discovery section. */
interface MeetingGrant {
  id: string;
  granteeUserId: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const accessTypeLabels: Record<ShareRequestAccessType, string> = {
  single_use: "un solo uso",
  temporary: "temporal",
  permanent: "permanente",
};

const shareRequestStatusLabels: Record<ShareRequestRecord["status"], string> = {
  pending: "pendiente",
  approved: "aprobada",
  rejected: "rechazada",
  cancelled: "cancelada",
};

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={handleCopy}>
      {copied ? <Check className="h-3 w-3 text-[#00F2FF]" /> : <Copy className="h-3 w-3" />}
      {label || (copied ? "Copiado" : "Copiar")}
    </Button>
  );
}

export function MeetingDetailsView({
  initialMeeting,
  initialShares,
  ttlOptionsMinutes,
  participantSuggestions,
  initialGrants,
  initialShareRequests,
}: {
  initialMeeting: Meeting;
  initialShares: MeetingShare[];
  ttlOptionsMinutes: number[];
  /** Empty for ad-hoc meetings (no calendar source) — UI degrades to manual email entry. */
  participantSuggestions: ParticipantSuggestion[];
  /** Empty for a non-owner viewer (own Access Grant) — the section below is Owner-only data. */
  initialGrants: MeetingGrant[];
  initialShareRequests: ShareRequestRecord[];
}) {
  const configuredTtlOptions = ttlOptionsMinutes.length > 0 ? ttlOptionsMinutes : [60];
  const defaultTtlMinutes = configuredTtlOptions[0];
  const defaultRenewOptionValue = String(defaultTtlMinutes);

  const { data: session } = useSession();
  const [meeting, setMeeting] = useState<Meeting>(initialMeeting);
  const [shares, setShares] = useState<MeetingShare[]>(initialShares);
  const [grants, setGrants] = useState<MeetingGrant[]>(initialGrants);
  const [shareRequests, setShareRequests] = useState<ShareRequestRecord[]>(initialShareRequests);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [showFullTranscription, setShowFullTranscription] = useState(false);
  const [showRefineInput, setShowRefineInput] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [showSharing, setShowSharing] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientMode, setRecipientMode] = useState<RecipientMode>(
    participantSuggestions.length > 0 ? "subset" : "email"
  );
  const [selectedParticipantEmails, setSelectedParticipantEmails] = useState<string[]>([]);
  const [manualRecipientGranteeUserId, setManualRecipientGranteeUserId] = useState<string | null>(null);
  const [accessType, setAccessType] = useState<ShareRequestAccessType>(DEFAULT_ACCESS_TYPE);
  const [expiresInDays, setExpiresInDays] = useState(DEFAULT_TEMPORARY_DAYS);
  const [shareFormError, setShareFormError] = useState<string | null>(null);
  const [participantActionState, setParticipantActionState] = useState<
    Record<string, "loading" | "done" | "pending" | "error">
  >({});
  const [isCreatingShare, setIsCreatingShare] = useState(false);
  const [isClearingInactive, setIsClearingInactive] = useState(false);
  const [activeShareActionId, setActiveShareActionId] = useState<string | null>(null);
  const [activeGrantActionId, setActiveGrantActionId] = useState<string | null>(null);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);
  const [latestShareUrl, setLatestShareUrl] = useState<string | null>(null);
  const [renewOptionsByShareId, setRenewOptionsByShareId] = useState<Record<string, string>>({});
  const [activeChapterIdx, setActiveChapterIdx] = useState(0);
  const seekToTimeRef = useRef<((time: number) => void) | null>(null);
  const router = useRouter();

  const canReprocess =
    (meeting.status === "completed" || meeting.status === "transcription_error") &&
    meeting.recordingFilePath &&
    (!meeting.rawTranscription || !meeting.summary);

  const handleReprocess = async () => {
    const priorStatus = meeting.status; // captured before the optimistic set below, restored on failure
    setIsReprocessing(true);
    setMeeting((m) => ({ ...m, status: "transcribing" }));
    try {
      const result = await reprocessMeetingAction(meeting.id);
      if (!result.success) {
        alert("Error al reprocesar: " + result.error);
        setMeeting((m) => ({ ...m, status: priorStatus }));
      }
    } catch (err) {
      console.error(err);
      setMeeting((m) => ({ ...m, status: priorStatus }));
    } finally {
      setIsReprocessing(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const result = await deleteMeetingAction(meeting.id);
      if (result.success) {
        router.push("/");
        router.refresh();
      } else {
        alert("Error al eliminar: " + result.error);
        setIsDeleting(false);
        setShowConfirmDelete(false);
      }
    } catch (err) {
      console.error(err);
      setIsDeleting(false);
      setShowConfirmDelete(false);
    }
  };

  const handleRefine = async () => {
    if (!refinePrompt.trim()) return;
    setIsRefining(true);
    try {
      const result = await refineSummaryAction(meeting.id, refinePrompt.trim());
      if (result.success && result.summary) {
        setMeeting((m) => ({ ...m, summary: JSON.stringify(result.summary), status: "completed" }));
        setRefinePrompt("");
        setShowRefineInput(false);
      } else {
        alert("Error: " + result.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRefining(false);
    }
  };

  // 013 Phase 6.6: unified recipient-selection submit — replaces the old per-participant-only
  // flow with the 3 recipient-selection modes (spec: "Recipient-selection modes"). Routes each
  // resolved recipient through the existing per-recipient action (createGrantAction for a
  // registered recipient, createShareAction otherwise) — both already role-branch internally
  // (member Owner → pending Share Request via ShareRequestService, admin Owner → direct), so no
  // role logic lives here. "all" mode fans out into one call per Participant, never a bundled
  // record (spec: "Share with all participants expands per recipient").
  const currentRecipients = resolveRecipients({
    mode: recipientMode,
    participants: participantSuggestions,
    selectedEmails: selectedParticipantEmails,
    manualRecipient:
      recipientMode === "email" && recipientEmail.trim()
        ? { email: recipientEmail.trim(), granteeUserId: manualRecipientGranteeUserId }
        : null,
  });
  const availableAccessTypes = getAvailableAccessTypes(currentRecipients);
  const effectiveAccessType = availableAccessTypes.includes(accessType) ? accessType : availableAccessTypes[0];

  const handleResolveManualRecipient = async () => {
    const email = recipientEmail.trim();
    if (!email) return;
    const result = await resolveRecipientAction(email);
    setManualRecipientGranteeUserId(result.success ? result.granteeUserId : null);
  };

  const handleSubmitShare = async () => {
    setShareFormError(null);
    const validationError = validateAccessTypeSelection({
      accessType: effectiveAccessType,
      recipients: currentRecipients,
      expiresInDays: effectiveAccessType === "temporary" ? expiresInDays : null,
    });
    if (validationError) {
      setShareFormError(validationError);
      return;
    }

    setIsCreatingShare(true);
    try {
      for (const recipient of currentRecipients) {
        setParticipantActionState((prev) => ({ ...prev, [recipient.email]: "loading" }));
        try {
          if (recipient.granteeUserId) {
            const result = await createGrantAction({
              meetingId: meeting.id,
              granteeUserId: recipient.granteeUserId,
              accessType: effectiveAccessType,
              expiresInDays: effectiveAccessType === "temporary" ? expiresInDays : undefined,
            });
            if (!result.success) {
              alert(`Error al procesar a ${recipient.email}: ${result.error}`);
              setParticipantActionState((prev) => ({ ...prev, [recipient.email]: "error" }));
              continue;
            }
            if ("shareRequest" in result && result.shareRequest) {
              setShareRequests((prev) => [result.shareRequest, ...prev]);
              setParticipantActionState((prev) => ({ ...prev, [recipient.email]: "pending" }));
            } else if ("grant" in result && result.grant) {
              const now = new Date();
              setGrants((prev) => [
                {
                  id: result.grant.id,
                  granteeUserId: recipient.granteeUserId as string,
                  expiresAt: result.grant.expiresAt,
                  revokedAt: null,
                  createdAt: now,
                },
                ...prev,
              ]);
              setParticipantActionState((prev) => ({ ...prev, [recipient.email]: "done" }));
            }
          } else {
            const result = await createShareAction({
              meetingId: meeting.id,
              shareType: "restricted_email",
              recipientEmail: recipient.email,
              noExpiry: true,
              singleUse: effectiveAccessType === "single_use",
              accessType: effectiveAccessType,
              expiresInDays: effectiveAccessType === "temporary" ? expiresInDays : undefined,
            });
            if (!result.success) {
              alert(`Error al procesar a ${recipient.email}: ${result.error}`);
              setParticipantActionState((prev) => ({ ...prev, [recipient.email]: "error" }));
              continue;
            }
            if ("shareRequest" in result && result.shareRequest) {
              setShareRequests((prev) => [result.shareRequest, ...prev]);
              setParticipantActionState((prev) => ({ ...prev, [recipient.email]: "pending" }));
            } else if ("share" in result && result.share) {
              const now = new Date();
              const newShare: MeetingShare = {
                id: result.share.id,
                meetingId: meeting.id,
                shareType: result.share.shareType,
                status: "active",
                recipientEmail: result.share.recipientEmail,
                shareUrl: result.share.shareUrl,
                expiresAt: result.share.expiresAt ? new Date(result.share.expiresAt) : null,
                revokedAt: null,
                createdAt: now,
                updatedAt: now,
                isActive: true,
              };
              setShares((prev) => [newShare, ...prev]);
              setLatestShareUrl(result.share.shareUrl);
              setParticipantActionState((prev) => ({ ...prev, [recipient.email]: "done" }));
            }
          }
        } catch (err) {
          console.error(err);
          setParticipantActionState((prev) => ({ ...prev, [recipient.email]: "error" }));
        }
      }

      if (recipientMode === "email") {
        setRecipientEmail("");
        setManualRecipientGranteeUserId(null);
      } else if (recipientMode === "subset") {
        setSelectedParticipantEmails([]);
      }
    } finally {
      setIsCreatingShare(false);
    }
  };

  const handleCancelShareRequest = async (requestId: string) => {
    setCancellingRequestId(requestId);
    try {
      const result = await cancelShareRequestAction(requestId);
      if (!result.success) {
        alert(`Error al cancelar la solicitud: ${result.error}`);
        return;
      }
      const now = new Date();
      setShareRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, status: "cancelled", resolvedAt: now, updatedAt: now } : r))
      );
    } finally {
      setCancellingRequestId(null);
    }
  };

  const handleRevokeGrant = async (grant: MeetingGrant) => {
    setActiveGrantActionId(grant.id);
    try {
      const result = await revokeGrantAction(grant.id);
      if (!result.success) {
        alert(`Error al revocar acceso: ${result.error}`);
        return;
      }
      const now = new Date();
      setGrants((prev) => prev.map((g) => (g.id === grant.id ? { ...g, revokedAt: now } : g)));
    } finally {
      setActiveGrantActionId(null);
    }
  };

  const handleRevokeShare = async (share: MeetingShare) => {
    setActiveShareActionId(share.id);
    try {
      const result = await revokeShareAction(share.id);
      if (!result.success) {
        alert(`Error al revocar enlace: ${result.error}`);
        return;
      }

      const now = new Date();
      setShares((prev) =>
        prev.map((item) =>
          item.id === share.id ? { ...item, status: "revoked", isActive: false, revokedAt: now, updatedAt: now } : item
        )
      );
    } finally {
      setActiveShareActionId(null);
    }
  };

  const handleResendShare = async (share: MeetingShare) => {
    const recipientSuffix = share.recipientEmail ? ` a ${share.recipientEmail}` : "";
    const confirmed = window.confirm(
      `Se enviará un nuevo enlace de acceso${recipientSuffix}. El enlace anterior quedará invalidado. ¿Deseas continuar?`
    );
    if (!confirmed) return;

    setActiveShareActionId(share.id);
    try {
      const result = await resendShareInviteAction(share.id);
      if (!result.success) {
        alert(`Error al reenviar: ${result.error}`);
        return;
      }
      if ("shareUrl" in result && result.shareUrl) {
        setLatestShareUrl(result.shareUrl);
        setShares((prev) =>
          prev.map((item) => (item.id === share.id ? { ...item, shareUrl: result.shareUrl } : item))
        );
      }
    } finally {
      setActiveShareActionId(null);
    }
  };

  const handleRenewShare = async (share: MeetingShare) => {
    const selected = renewOptionsByShareId[share.id] ?? defaultRenewOptionValue;
    const noExpiry = selected === "none";
    const parsedTtl = Number(selected);
    if (!noExpiry && (!Number.isInteger(parsedTtl) || !configuredTtlOptions.includes(parsedTtl))) {
      alert("Selecciona un TTL válido para renovar el acceso.");
      return;
    }

    const confirmMessage = noExpiry
      ? "Se renovará este acceso sin caducidad. La URL actual se conservará. ¿Deseas continuar?"
      : `Se renovará este acceso durante ${formatTtlLabel(parsedTtl)}. La URL actual se conservará. ¿Deseas continuar?`;
    if (!window.confirm(confirmMessage)) return;

    setActiveShareActionId(share.id);
    try {
      const result = await renewShareAccessAction({
        shareId: share.id,
        noExpiry,
        ttlMinutes: noExpiry ? undefined : parsedTtl,
      });

      if (!result.success || !("shareUrl" in result)) {
        alert(`Error al renovar acceso: ${result.error}`);
        return;
      }

      const now = new Date();
      const renewedExpiresAt = result.expiresAt ? new Date(result.expiresAt) : null;
      setShares((prev) =>
        prev.map((item) =>
          item.id === share.id
            ? {
                ...item,
                status: "active",
                isActive: true,
                revokedAt: null,
                expiresAt: renewedExpiresAt,
                updatedAt: now,
                shareUrl: result.shareUrl || item.shareUrl,
              }
            : item
        )
      );
      if (result.shareUrl) {
        setLatestShareUrl(result.shareUrl);
      }
    } finally {
      setActiveShareActionId(null);
    }
  };

  const handleClearInactiveShares = async () => {
    const confirmed = window.confirm(
      "Se eliminarán los registros de todos los enlaces revocados y caducados. Esta acción es irreversible. ¿Deseas continuar?"
    );
    if (!confirmed) return;

    setIsClearingInactive(true);
    try {
      const result = await clearInactiveSharesAction(meeting.id);
      if (!result.success || !("deletedCount" in result)) {
        alert(`Error al limpiar enlaces inactivos: ${result.error}`);
        return;
      }

      setShares((prev) => prev.filter((share) => share.status === "active"));
      if (result.deletedCount === 0) {
        alert("No había enlaces inactivos para limpiar.");
      }
    } finally {
      setIsClearingInactive(false);
    }
  };

  const exportMarkdown = () => {
    if (!parsedSummary) return;
    const lines = [
      `# ${meeting.botName || "Reunión"} - Resumen`,
      `**Fecha:** ${formatDate(meeting.createdAt)}`,
      `**Plataforma:** ${getMeetingPlatformLabel({ url: meeting.url })}`,
      `**URL:** ${meeting.url}`,
      "",
      "## Resumen",
      parsedSummary.summary || "",
      "",
    ];
    if (parsedSummary.keyMoments?.length) {
      lines.push("## Capitulos / Momentos Clave");
      parsedSummary.keyMoments.forEach((m: { timeSeconds?: number; title?: string; description?: string } | string, i: number) => {
        if (typeof m === "string") {
          lines.push(`${i + 1}. ${m}`);
        } else {
          const mins = Math.floor((m.timeSeconds || 0) / 60);
          const secs = Math.floor((m.timeSeconds || 0) % 60);
          const ts = `${mins}:${String(secs).padStart(2, "0")}`;
          lines.push(`${i + 1}. **[${ts}] ${m.title || ""}** — ${m.description || ""}`);
        }
      });
      lines.push("");
    }
    if (parsedSummary.actionItems?.length) {
      lines.push("## Action Items");
      parsedSummary.actionItems.forEach((a: string) => lines.push(`- [ ] ${a}`));
      lines.push("");
    }
    if (meeting.rawTranscription) {
      lines.push("## Transcripción Completa", meeting.rawTranscription);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${meeting.botName || "reunion"}-resumen.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Poll for updates
  useEffect(() => {
    if (meeting.status === "completed" || meeting.status === "error") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/meetings/${meeting.id}`);
        if (res.ok) setMeeting(await res.json());
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [meeting.id, meeting.status]);

  const parsedSummary = (() => {
    if (!meeting.summary) return null;
    try { return JSON.parse(meeting.summary); } catch { return null; }
  })();

  const wordCount = meeting.rawTranscription ? meeting.rawTranscription.split(/\s+/).length : 0;
  const formatTtlLabel = (ttlMinutes: number): string => {
    const toDisplayValue = (value: number): string => {
      if (Number.isInteger(value)) return String(value);
      return value.toFixed(1).replace(/\.0$/, "");
    };

    if (ttlMinutes >= 1440) {
      const days = ttlMinutes / 1440;
      return `${toDisplayValue(days)} ${days === 1 ? "día" : "días"}`;
    }

    if (ttlMinutes >= 60) {
      const hours = ttlMinutes / 60;
      return `${toDisplayValue(hours)} ${hours === 1 ? "hora" : "horas"}`;
    }

    return `${ttlMinutes} ${ttlMinutes === 1 ? "minuto" : "minutos"}`;
  };

  const restrictedShares = shares.filter((share) => share.shareType === "restricted_email");
  const inactiveSharesCount = shares.filter((share) => share.status !== "active").length;

  const renderShareRow = (share: MeetingShare) => (
    <div key={share.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge
            variant={
              share.status === "active"
                ? "success"
                : share.status === "expired"
                  ? "warning"
                  : "destructive"
            }
          >
            {share.status === "active" ? "activo" : share.status === "expired" ? "caducado" : "revocado"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {share.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => handleResendShare(share)}
              disabled={activeShareActionId === share.id}
            >
              {activeShareActionId === share.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Reenviar
            </Button>
          )}
          {share.status === "expired" && (
            <>
              <select
                value={renewOptionsByShareId[share.id] ?? defaultRenewOptionValue}
                onChange={(e) =>
                  setRenewOptionsByShareId((prev) => ({
                    ...prev,
                    [share.id]: e.target.value,
                  }))
                }
                className="h-7 rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-2 text-xs"
                disabled={activeShareActionId === share.id}
              >
                {configuredTtlOptions.map((ttlMinutes) => (
                  <option key={ttlMinutes} value={ttlMinutes}>
                    {formatTtlLabel(ttlMinutes)}
                  </option>
                ))}
                <option value="none">Sin caducidad</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => handleRenewShare(share)}
                disabled={activeShareActionId === share.id}
              >
                {activeShareActionId === share.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Renovar acceso
              </Button>
            </>
          )}
          {share.status !== "revoked" && (
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleRevokeShare(share)}
              disabled={activeShareActionId === share.id}
            >
              Revocar
            </Button>
          )}
        </div>
      </div>
      <div className="text-xs text-[var(--muted-foreground)] flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {share.expiresAt ? `Caduca: ${formatDate(share.expiresAt)}` : "Sin caducidad"}
          {share.recipientEmail ? ` · Destino: ${share.recipientEmail}` : ""}
        </span>
        <span className="sm:text-right">{`Creado: ${formatDate(share.createdAt)}`}</span>
      </div>
    </div>
  );

  const shareRequestStatusVariant = (status: ShareRequestRecord["status"]) => {
    if (status === "approved") return "success" as const;
    if (status === "pending") return "warning" as const;
    if (status === "rejected") return "destructive" as const;
    return "outline" as const; // cancelled
  };

  // 013 "Solicitudes y accesos": all-statuses Share Request row — the registered-recipient
  // passive-discovery surface (spec: "Silent rejection with passive discovery"). The requester
  // may cancel their own still-pending request; nobody else gets that action.
  const renderShareRequestRow = (request: ShareRequestRecord) => (
    <div key={request.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">
          {request.granteeUserId ? `Usuario ${request.granteeUserId}` : request.recipientEmail}
        </span>
        <div className="flex items-center gap-2">
          <Badge variant={shareRequestStatusVariant(request.status)}>{shareRequestStatusLabels[request.status]}</Badge>
          {canCancelShareRequest(request, session?.user?.id) && (
            <Button
              variant="destructive"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => handleCancelShareRequest(request.id)}
              disabled={cancellingRequestId === request.id}
            >
              {cancellingRequestId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Cancelar"}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">
        {accessTypeLabels[request.accessType]}
        {request.accessType === "temporary" && request.expiresInDays ? ` · ${request.expiresInDays} días` : ""}
        {` · Creada: ${formatDate(request.createdAt)}`}
      </p>
    </div>
  );

  // 013 "Solicitudes y accesos": minimal Access Grant row (explore.md's gap — grants had no
  // render surface) — mirrors renderShareRow's status/revoke shape for the registered-recipient
  // path (design: "member Owner revokes directly").
  const renderGrantRow = (grant: MeetingGrant) => {
    const isRevoked = Boolean(grant.revokedAt);
    const isExpired = !isRevoked && grant.expiresAt !== null && grant.expiresAt.getTime() <= Date.now();
    const statusLabel = isRevoked ? "revocado" : isExpired ? "caducado" : "activo";
    return (
      <div key={grant.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">Usuario {grant.granteeUserId}</span>
          <div className="flex items-center gap-2">
            <Badge variant={statusLabel === "activo" ? "success" : statusLabel === "caducado" ? "warning" : "destructive"}>
              {statusLabel}
            </Badge>
            {!isRevoked && (
              <Button
                variant="destructive"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => handleRevokeGrant(grant)}
                disabled={activeGrantActionId === grant.id}
              >
                {activeGrantActionId === grant.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Revocar"}
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">
          {grant.expiresAt ? `Caduca: ${formatDate(grant.expiresAt)}` : "Sin caducidad"}
          {` · Creado: ${formatDate(grant.createdAt)}`}
        </p>
      </div>
    );
  };

  // Build chapters for the video player from key moments
  const videoChapters: Chapter[] = (() => {
    if (!parsedSummary?.keyMoments?.length) return [];
    return parsedSummary.keyMoments.map((m: { timeSeconds?: number; title?: string; description?: string } | string) => {
      if (typeof m === "string") return { timeSeconds: 0, title: "", description: m };
      return {
        timeSeconds: m.timeSeconds || 0,
        title: m.title || "",
        description: m.description || "",
      };
    }).filter((ch: Chapter) => ch.title);
  })();

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Link href="/">
            <InteractiveHoverButton direction="left" className="text-sm">
              Volver al Dashboard
            </InteractiveHoverButton>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">{meeting.botName || "Reunion"}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--muted-foreground)]">
            <Badge variant={meeting.status === "completed" ? "success" : meeting.status === "error" ? "destructive" : "warning"} className="capitalize">
              {getMeetingStatusLabel(meeting.status)}
            </Badge>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(meeting.createdAt)}
            </span>
            {wordCount > 0 && (
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {wordCount.toLocaleString()} palabras
              </span>
            )}
            <a href={meeting.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
              <ExternalLink className="h-3 w-3" />
              Link Original
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Export */}
          {parsedSummary && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportMarkdown}>
              <Download className="h-3.5 w-3.5" />
              Exportar MD
            </Button>
          )}

          {/* Copy Summary */}
          {parsedSummary && (
            <CopyButton
              text={`${parsedSummary.summary}\n\nCapitulos:\n${(parsedSummary.keyMoments || []).map((m: { timeSeconds?: number; title?: string; description?: string } | string, i: number) => {
                if (typeof m === "string") return `${i + 1}. ${m}`;
                const mins = Math.floor((m.timeSeconds || 0) / 60);
                const secs = Math.floor((m.timeSeconds || 0) % 60);
                return `${i + 1}. [${mins}:${String(secs).padStart(2, "0")}] ${m.title || ""} - ${m.description || ""}`;
              }).join("\n")}\n\nAction Items:\n${(parsedSummary.actionItems || []).map((a: string) => `- ${a}`).join("\n")}`}
              label="Copiar Resumen"
            />
          )}

          {/* Reprocess */}
          {canReprocess && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleReprocess} disabled={isReprocessing}>
              {isReprocessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {isReprocessing ? "Procesando..." : "Transcribir y Resumir"}
            </Button>
          )}

          {/* Retry rejected/error meeting */}
          {(meeting.status === "rejected" || meeting.status === "error") && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
              const result = await retryMeetingAction(meeting.id);
              if (result.success) {
                setMeeting((m) => ({ ...m, status: "pending", errorMessage: null }));
              } else {
                alert("Error al reintentar: " + result.error);
              }
            }}>
              <Play className="h-3.5 w-3.5" />
              Reintentar
            </Button>
          )}

          {/* Download — gated on the file existing, not on status (spec 010: a transcription_error
              meeting still has a good recording, so the video must stay visible/downloadable) */}
          {(meeting.recordingDownloadUrl || meeting.recordingFilePath) && (
            <a href={meeting.recordingDownloadUrl || meeting.recordingFilePath!} download={`${meeting.botName || meeting.id}.mp4`}
              className="inline-flex items-center justify-center rounded-[var(--radius)] font-medium transition-all border border-[var(--border)] bg-transparent hover:bg-[var(--accent)] text-[var(--foreground)] h-8 px-3 text-xs gap-1.5">
              <Download className="h-3.5 w-3.5" />
              MP4
            </a>
          )}

          {/* Delete */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: "var(--card)", backdropFilter: "blur(12px) saturate(1.4)", border: "1px solid var(--glass-border)" }}>
            {showConfirmDelete && !isDeleting && (
              <Button variant="ghost" size="sm" onClick={() => setShowConfirmDelete(false)} className="h-7 text-xs px-2">
                Cancelar
              </Button>
            )}
            <Button
              variant={showConfirmDelete ? "destructive" : "ghost"} size="sm"
              className={`gap-1 h-7 text-xs ${showConfirmDelete ? "px-3" : "px-2"}`}
              onClick={() => showConfirmDelete ? handleDelete() : setShowConfirmDelete(true)}
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              {isDeleting ? "..." : showConfirmDelete ? "Confirmar" : ""}
            </Button>
          </div>
        </div>
      </div>

      {/* Error */}
      {meeting.status === "error" && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Error en el procesamiento
            </CardTitle>
            <CardDescription className="text-destructive/80 font-medium">
              {meeting.errorMessage || "Ocurrio un error inesperado."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReportBugButton meetingId={meeting.id} />
          </CardContent>
        </Card>
      )}

      {/* Video Player with Chapters — same recordingFilePath gating as the download link above */}
      {meeting.recordingFilePath && (
        <Card className="overflow-hidden">
          <CardHeader className="cursor-pointer" onClick={() => setShowVideo(!showVideo)}>
            <CardTitle className="flex items-center justify-between text-lg">
              <span className="flex items-center gap-2">
                <Play className="h-5 w-5 text-[#00F2FF]" />
                Grabacion de la Reunion
                {videoChapters.length > 0 && (
                  <span className="text-xs font-normal text-[var(--muted-foreground)]">
                    ({videoChapters.length} capitulos)
                  </span>
                )}
              </span>
              {showVideo ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </CardTitle>
          </CardHeader>
          {showVideo && (
            <CardContent className="pt-0">
              <ChapterVideoPlayer
                src={meeting.recordingFilePath}
                chapters={videoChapters}
                durationSeconds={parsedSummary?.durationSeconds}
                onChapterChange={(_ch, idx) => setActiveChapterIdx(idx)}
                onSeekReady={(fn) => { seekToTimeRef.current = fn; }}
              />
            </CardContent>
          )}
        </Card>
      )}

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Summary */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <Sparkles className="h-5 w-5 text-[#00F2FF]" />
                    Resumen Inteligente
                  </CardTitle>
                  <CardDescription>Generado automaticamente por IA</CardDescription>
                </div>
                {meeting.status === "completed" && meeting.rawTranscription && (
                  <Button variant="outline" size="sm" className="gap-1.5"
                    onClick={() => setShowRefineInput(!showRefineInput)}>
                    <MessageSquare className="h-3.5 w-3.5" />
                    Editar con IA
                  </Button>
                )}
              </div>

              {/* AI Refine Input */}
              {showRefineInput && (
                <div className="mt-4 flex gap-2">
                  <input
                    type="text"
                    value={refinePrompt}
                    onChange={(e) => setRefinePrompt(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleRefine()}
                    placeholder="Ej: Hazlo mas detallado, enfocate en las decisiones tecnicas..."
                    className="flex-1 h-9 rounded-[var(--radius)] px-3 text-sm placeholder:text-[var(--muted-foreground)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#00F2FF]/50 transition-all"
                    style={{ background: "var(--card)", backdropFilter: "blur(12px) saturate(1.4)", WebkitBackdropFilter: "blur(12px) saturate(1.4)", border: "1px solid var(--glass-border)" }}
                    disabled={isRefining}
                  />
                  <Button size="sm" className="h-9 gap-1.5" onClick={handleRefine} disabled={isRefining || !refinePrompt.trim()}>
                    {isRefining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {isRefining ? "Generando..." : "Enviar"}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => { setShowRefineInput(false); setRefinePrompt(""); }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </CardHeader>

            <CardContent className="space-y-6">
              {meeting.status === "completed" && parsedSummary ? (
                <>
                  {/* Summary Text */}
                  <div className="prose prose-zinc dark:prose-invert max-w-none">
                    <p className="text-base leading-relaxed text-[var(--foreground)]/90 whitespace-pre-line">
                      {parsedSummary.summary}
                    </p>
                  </div>

                  {/* Key Moments / Chapters */}
                  {parsedSummary.keyMoments?.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="font-semibold text-base flex items-center gap-2">
                        <ClipboardList className="h-4 w-4 text-[#00F2FF]" />
                        Capitulos ({parsedSummary.keyMoments.length})
                      </h4>
                      <ul className="space-y-2">
                        {parsedSummary.keyMoments.map((moment: { timeSeconds?: number; title?: string; description?: string } | string, i: number) => {
                          const isObj = typeof moment !== "string";
                          const timeSeconds = isObj ? (moment.timeSeconds || 0) : 0;
                          const title = isObj ? (moment.title || "") : "";
                          const description = isObj ? (moment.description || "") : String(moment);
                          const isActive = i === activeChapterIdx;
                          const hasTimestamp = isObj && typeof moment.timeSeconds === "number";

                          const handleClick = () => {
                            if (hasTimestamp) {
                              setShowVideo(true);
                              setTimeout(() => {
                                if (seekToTimeRef.current) seekToTimeRef.current(timeSeconds);
                              }, 100);
                            }
                          };

                          const formatTs = (s: number) => {
                            const m = Math.floor(s / 60);
                            const sec = Math.floor(s % 60);
                            return `${m}:${String(sec).padStart(2, "0")}`;
                          };

                          return (
                            <li
                              key={i}
                              onClick={handleClick}
                              className={`group flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                                hasTimestamp ? "cursor-pointer" : ""
                              } ${
                                isActive
                                  ? "bg-[#00F2FF]/10 border-[#00F2FF]/30 ring-1 ring-[#00F2FF]/20"
                                  : "bg-[#00F2FF]/5 border-[#00F2FF]/15 hover:bg-[#00F2FF]/10"
                              }`}
                            >
                              {hasTimestamp ? (
                                <span className="flex h-6 shrink-0 items-center justify-center rounded-md bg-[#00F2FF]/15 text-[11px] font-mono font-bold text-[#00F2FF] px-1.5 mt-0.5">
                                  {formatTs(timeSeconds)}
                                </span>
                              ) : (
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#00F2FF] text-[10px] font-bold text-white mt-0.5">
                                  {i + 1}
                                </span>
                              )}
                              <div className="flex-1 min-w-0">
                                {title && <span className="text-sm font-semibold block">{title}</span>}
                                <span className="text-sm leading-relaxed text-[var(--muted-foreground)]">{description}</span>
                              </div>
                              {hasTimestamp && (
                                <Play className="h-3.5 w-3.5 text-[#00F2FF] shrink-0 mt-1 opacity-0 group-hover:opacity-100" />
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {/* Action Items */}
                  {parsedSummary.actionItems?.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="font-semibold text-base flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-[#00F2FF]" />
                        Action Items ({parsedSummary.actionItems.length})
                      </h4>
                      <ul className="space-y-2">
                        {parsedSummary.actionItems.map((item: string, i: number) => (
                          <li key={i} className="flex items-start gap-3 p-3 rounded-lg bg-[#00F2FF]/5 border border-[#00F2FF]/15 transition-colors hover:bg-[#00F2FF]/10">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#00F2FF] text-[10px] font-bold text-white mt-0.5">
                              {i + 1}
                            </span>
                            <span className="text-sm leading-relaxed">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-3 opacity-50">
                  {meeting.status === "error" ? (
                    <AlertCircle className="h-10 w-10 text-destructive" />
                  ) : meeting.status === "completed" ? (
                    <FileText className="h-10 w-10 text-[var(--muted-foreground)]" />
                  ) : (
                    <Loader2 className="h-10 w-10 animate-spin text-[var(--primary)]" />
                  )}
                  <p className="font-medium text-sm">
                    {meeting.status === "error"
                      ? "Resumen no disponible"
                      : meeting.status === "completed"
                      ? "No se genero resumen. Usa el boton 'Transcribir y Resumir'."
                      : "Generando resumen..."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Meeting Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Video className="h-5 w-5" />
                Info Grabacion
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-[var(--border)]/50">
                <span className="text-[var(--muted-foreground)]">Plataforma</span>
                <span className="font-medium">{getMeetingPlatformLabel({ url: meeting.url })}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-[var(--border)]/50">
                <span className="text-[var(--muted-foreground)]">Creado</span>
                <span className="font-medium">{formatDate(meeting.createdAt)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-[var(--border)]/50">
                <span className="text-[var(--muted-foreground)]">Estado</span>
                <Badge variant={meeting.status === "completed" ? "success" : (meeting.status === "error" || meeting.status === "rejected") ? "destructive" : "warning"} className="capitalize text-[10px]">
                  {getMeetingStatusLabel(meeting.status)}
                </Badge>
              </div>
              {wordCount > 0 && (
                <div className="flex justify-between py-2 border-b border-[var(--border)]/50">
                  <span className="text-[var(--muted-foreground)]">Palabras</span>
                  <span className="font-medium">{wordCount.toLocaleString()}</span>
                </div>
              )}
              {meeting.recordingFilePath && (
                <div className="flex justify-between py-2">
                  <span className="text-[var(--muted-foreground)]">Video</span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 px-2" onClick={() => setShowVideo(true)}>
                    <Play className="h-3 w-3" /> Reproducir
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Transcription */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Transcripcion
                </CardTitle>
                {meeting.rawTranscription && (
                  <CopyButton text={meeting.rawTranscription} />
                )}
              </div>
            </CardHeader>
          <CardContent>
              {meeting.rawTranscription ? (
                <div>
                  <div className={`relative text-sm text-[var(--muted-foreground)] leading-relaxed whitespace-pre-line ${!showFullTranscription ? "max-h-[300px] overflow-hidden" : "max-h-[600px] overflow-y-auto"}`}>
                    {meeting.rawTranscription}
                    {!showFullTranscription && (
                      <div className="absolute bottom-0 left-0 h-20 w-full bg-gradient-to-t from-[var(--card)] to-transparent" />
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    className="w-full mt-2 text-xs font-medium gap-1.5"
                    onClick={() => setShowFullTranscription(!showFullTranscription)}
                  >
                    {showFullTranscription ? (
                      <><ChevronUp className="h-3 w-3" /> Colapsar</>
                    ) : (
                      <><ChevronDown className="h-3 w-3" /> Ver transcripcion completa</>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-[var(--muted-foreground)] italic">
                  {meeting.status === "error" ? "No se pudo transcribir" : "Procesando audio..."}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="cursor-pointer" onClick={() => setShowSharing(!showSharing)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              Compartir reunión
            </CardTitle>
            {showSharing ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </CardHeader>
        {showSharing && (
          <CardContent className="space-y-6">
            <p className="text-sm text-[var(--muted-foreground)]">
              Otorga acceso a esta reunión. Si tu cuenta es <strong>member</strong>, cada solicitud queda
              pendiente de aprobación de un admin.
            </p>

            {/* Recipient-selection modes (spec: "Recipient-selection modes") — (a) all Participants,
                (b) a chosen subset, (c) an email not present in the meeting. */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">Destinatarios</label>
              <div className="flex flex-wrap gap-2">
                {participantSuggestions.length > 0 && (
                  <>
                    <Button
                      type="button"
                      variant={recipientMode === "all" ? "primary" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setRecipientMode("all")}
                    >
                      Todos los participantes ({participantSuggestions.length})
                    </Button>
                    <Button
                      type="button"
                      variant={recipientMode === "subset" ? "primary" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setRecipientMode("subset")}
                    >
                      Elegir participantes
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  variant={recipientMode === "email" ? "primary" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setRecipientMode("email")}
                >
                  Otro email
                </Button>
              </div>
            </div>

            {recipientMode === "all" && (
              participantSuggestions.length > 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">
                  Se compartirá individualmente con los {participantSuggestions.length} participantes
                  detectados: {participantSuggestions.map((p) => p.email).join(", ")}
                </p>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">
                  Sin participantes detectados desde el calendario.
                </p>
              )
            )}

            {recipientMode === "subset" && (
              <div className="space-y-2">
                {participantSuggestions.map((suggestion) => {
                  const actionState = participantActionState[suggestion.email];
                  const checked = selectedParticipantEmails.includes(suggestion.email);
                  return (
                    <label
                      key={suggestion.email}
                      className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setSelectedParticipantEmails((prev) =>
                            e.target.checked
                              ? [...prev, suggestion.email]
                              : prev.filter((email) => email !== suggestion.email)
                          )
                        }
                      />
                      <span className="flex-1">{suggestion.email}</span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {suggestion.granteeUserId ? "Usuario registrado" : "Sin cuenta"}
                      </span>
                      {actionState === "pending" && <Badge variant="warning">solicitud enviada</Badge>}
                      {actionState === "done" && <Badge variant="success">otorgado</Badge>}
                      {actionState === "error" && <Badge variant="destructive">error</Badge>}
                    </label>
                  );
                })}
              </div>
            )}

            {recipientMode === "email" && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">Email destinatario</label>
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => {
                      setRecipientEmail(e.target.value);
                      setManualRecipientGranteeUserId(null);
                    }}
                    onBlur={handleResolveManualRecipient}
                    placeholder="usuario@dominio.com"
                    className="w-full h-9 rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 text-sm"
                  />
                </div>
              </div>
            )}

            {/* Access type + defaults (spec: "Access types and defaults") — single_use only offered
                when every resolved recipient is unregistered; temporary pre-fills 15 editable days;
                permanent is the default. */}
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={effectiveAccessType}
                onChange={(e) => setAccessType(e.target.value as ShareRequestAccessType)}
                className="h-9 rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 text-sm"
              >
                {availableAccessTypes.map((type) => (
                  <option key={type} value={type}>
                    {accessTypeLabels[type]}
                  </option>
                ))}
              </select>
              {effectiveAccessType === "temporary" && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(Number(e.target.value))}
                    className="h-9 w-20 rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-2 text-sm"
                  />
                  <span className="text-xs text-[var(--muted-foreground)]">días</span>
                </div>
              )}
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleSubmitShare}
                disabled={isCreatingShare || currentRecipients.length === 0}
              >
                {isCreatingShare ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                {isCreatingShare ? "Enviando..." : "Compartir"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleClearInactiveShares}
                disabled={isClearingInactive || inactiveSharesCount === 0}
              >
                {isClearingInactive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {isClearingInactive ? "Limpiando..." : `Limpiar enlaces inactivos (${inactiveSharesCount})`}
              </Button>
            </div>
            {shareFormError && <p className="text-xs text-[var(--destructive)]">{shareFormError}</p>}

            {latestShareUrl && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 flex items-center justify-between gap-2">
                <span className="text-xs text-[var(--muted-foreground)] truncate">{latestShareUrl}</span>
                <CopyButton text={latestShareUrl} label="Copiar enlace" />
              </div>
            )}

            <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-black-700 dark:text-blue-300">Enlaces de acceso restringido</h4>
              {restrictedShares.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">No hay enlaces restringidos por email.</p>
              ) : (
                restrictedShares.map(renderShareRow)
              )}
            </div>

            {/* "Solicitudes y accesos" (spec: "Silent rejection with passive discovery" — the
                registered-recipient variant; unregistered rejections already surface above via the
                existing restricted_email share list). All-statuses Share Request list + a minimal
                Access Grants list, per sdd-design's resolution. */}
            <div className="rounded-xl border border-purple-500/25 bg-purple-500/5 p-4 space-y-3">
              <h4 className="text-sm font-semibold">Solicitudes y accesos</h4>
              {shareRequests.length === 0 && grants.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">
                  No hay solicitudes ni accesos otorgados a usuarios registrados.
                </p>
              ) : (
                <>
                  {shareRequests.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-[var(--muted-foreground)]">Solicitudes de compartición</p>
                      {shareRequests.map(renderShareRequestRow)}
                    </div>
                  )}
                  {grants.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-[var(--muted-foreground)]">
                        Accesos otorgados a usuarios registrados
                      </p>
                      {grants.map(renderGrantRow)}
                    </div>
                  )}
                </>
              )}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
