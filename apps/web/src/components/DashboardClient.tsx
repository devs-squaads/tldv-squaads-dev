"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  ACTIVE_PROCESSING_STATUSES,
  getMeetingStatusLabel,
  type MeetingStatus,
} from "@meeting-bot/shared/domain/meetingStatus";
import { formatDate } from "@/lib/utils";
import { getMeetingPlatformLabel } from "@meeting-bot/shared/meetingProvider";
import {
  Video, Calendar, Clock, ChevronRight, Activity,
  Search, CheckCircle2, AlertCircle, Loader2, Filter
} from "lucide-react";

interface Meeting {
  id: string;
  botName: string | null;
  url: string;
  status: MeetingStatus;
  rawTranscription: string | null;
  summary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const STATUS_FILTERS = [
  { key: "all", label: "Todas", icon: Filter },
  { key: "completed", label: "Completadas", icon: CheckCircle2 },
  { key: "in_progress", label: "En Progreso", icon: Loader2 },
  { key: "error", label: "Con Error", icon: AlertCircle },
  { key: "rejected", label: "Rechazadas", icon: AlertCircle },
] as const;

function getStatusVariant(status: MeetingStatus) {
  switch (status) {
    case "completed": return "success";
    case "error": return "destructive";
    case "rejected": return "destructive";
    case "recording":
    case "transcribing":
    case "summarizing": return "warning";
    default: return "secondary";
  }
}

export function DashboardClient({ meetings }: { meetings: Meeting[] }) {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get("filter") ?? "all");
  const [dateFilter, setDateFilter] = useState<string>(searchParams.get("date") ?? "");
  const router = useRouter();

  useEffect(() => {
    queueMicrotask(() => {
      setSearch(searchParams.get("search") ?? "");
      setStatusFilter(searchParams.get("filter") ?? "all");
      setDateFilter(searchParams.get("date") ?? "");
    });
  }, [searchParams]);

  useEffect(() => {
    const hasActiveMeetings = meetings.some((meeting) => ACTIVE_PROCESSING_STATUSES.includes(meeting.status));
    if (!hasActiveMeetings) return;

    const interval = setInterval(() => {
      router.refresh();
    }, 3000);

    return () => clearInterval(interval);
  }, [meetings, router]);

  const filtered = meetings.filter((m) => {
    const matchesSearch =
      !search ||
      (m.botName || "").toLowerCase().includes(search.toLowerCase()) ||
      m.url.toLowerCase().includes(search.toLowerCase());

    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "completed" && m.status === "completed") ||
      (statusFilter === "in_progress" && ACTIVE_PROCESSING_STATUSES.includes(m.status)) ||
      (statusFilter === "error" && m.status === "error") ||
      (statusFilter === "rejected" && m.status === "rejected");

    const matchesDate =
      !dateFilter ||
      new Date(m.createdAt).toISOString().startsWith(dateFilter);

    return matchesSearch && matchesStatus && matchesDate;
  });

  const completedCount = meetings.filter((m) => m.status === "completed").length;
  const inProgressCount = meetings.filter((m) => ACTIVE_PROCESSING_STATUSES.includes(m.status)).length;
  const errorCount = meetings.filter((m) => m.status === "error").length;
  const withSummary = meetings.filter((m) => m.summary).length;

  return (
    <div className="flex flex-col gap-8">
      {/* Welcome */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-[var(--muted-foreground)]">
          Gestiona tus reuniones y visualiza los insights generados por IA.
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="hover:shadow-sm transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
            <Video className="h-4 w-4 text-[#00F2FF]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#00F2FF]">{meetings.length}</div>
            <p className="text-xs text-[var(--muted-foreground)]">reuniones grabadas</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-sm transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Completadas</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-[#00F2FF]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#00F2FF]">{completedCount}</div>
            <p className="text-xs text-[var(--muted-foreground)]">{withSummary} con resumen IA</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-sm transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">En Progreso</CardTitle>
            <Clock className="h-4 w-4 text-[#00F2FF]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#00F2FF]">{inProgressCount}</div>
            <p className="text-xs text-[var(--muted-foreground)]">procesando ahora</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-sm transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Errores</CardTitle>
            <AlertCircle className="h-4 w-4 text-[#00F2FF]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#00F2FF]">{errorCount}</div>
            <p className="text-xs text-[var(--muted-foreground)]">requieren atencion</p>
          </CardContent>
        </Card>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o URL..."
            className="w-full h-10 rounded-[var(--radius)] pl-9 pr-4 text-sm placeholder:text-[var(--muted-foreground)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#00F2FF]/50 transition-all"
            style={{
              background: "var(--card)",
              backdropFilter: "blur(12px) saturate(1.4)",
              WebkitBackdropFilter: "blur(12px) saturate(1.4)",
              border: "1px solid var(--glass-border)",
            }}
          />
        </div>
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: "var(--card)", backdropFilter: "blur(12px) saturate(1.4)", WebkitBackdropFilter: "blur(12px) saturate(1.4)", border: "1px solid var(--glass-border)" }}>
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.key}
              variant={statusFilter === f.key ? "primary" : "ghost"}
              size="sm"
              className={`h-8 text-xs gap-1.5 ${statusFilter === f.key ? "" : "text-[var(--muted-foreground)]"}`}
              onClick={() => setStatusFilter(f.key)}
            >
              <f.icon className={`h-3 w-3 ${f.key === "in_progress" && statusFilter === f.key ? "animate-spin" : ""}`} />
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Meetings List */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold">
            {statusFilter === "all" ? "Todas las Reuniones" : STATUS_FILTERS.find((f) => f.key === statusFilter)?.label}
            <span className="text-[var(--muted-foreground)] font-normal ml-2 text-sm">({filtered.length})</span>
          </h2>
          {dateFilter && (
            <button
              type="button"
              onClick={() => setDateFilter("")}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all hover:brightness-110"
              style={{ background: "rgba(0,242,255,0.10)", border: "1px solid rgba(0,242,255,0.30)", color: "#00F2FF" }}
            >
              <Calendar className="h-3 w-3" />
              {dateFilter}
              <span className="opacity-60 ml-1">✕</span>
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center" style={{ background: "var(--card)", backdropFilter: "blur(var(--glass-blur)) saturate(1.6)", WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(1.6)", borderColor: "var(--glass-border)" }}>
            <Video className="mb-4 h-10 w-10 text-[var(--muted-foreground)] opacity-20" />
            <h3 className="text-base font-medium">
              {search ? "Sin resultados" : "No hay reuniones"}
            </h3>
            <p className="mb-4 text-sm text-[var(--muted-foreground)]">
              {search
                ? `No se encontraron reuniones para "${search}"`
                : "Comienza grabando tu primera reunion."}
            </p>
            {!search && (
              <Link href="/new">
                <Button variant="outline" size="sm">Crear Nueva</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map((meeting) => (
              <Link key={meeting.id} href={`/meeting/${meeting.id}`}>
                <Card className="group overflow-hidden transition-all hover:border-[#00F2FF]/40 hover:shadow-[0_0_12px_rgba(0,242,255,0.08)]">
                  <CardContent className="flex items-center p-4">
                    <div className="mr-4 hidden h-10 w-10 items-center justify-center rounded-full bg-[var(--secondary)] text-[var(--secondary-foreground)] group-hover:bg-[#00F2FF]/15 group-hover:text-[#00F2FF] transition-colors sm:flex shrink-0">
                      <Video className="h-5 w-5" />
                    </div>
                    <div className="flex flex-1 flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold">{meeting.botName || "Reunion sin nombre"}</h3>
                        <Badge variant={getStatusVariant(meeting.status)} className="capitalize text-[10px] shrink-0">
                          {getMeetingStatusLabel(meeting.status)}
                        </Badge>
                        {meeting.summary && (
                          <Badge variant="outline" className="text-[10px] shrink-0 gap-1">
                            <Activity className="h-2.5 w-2.5" />
                            Resumen IA
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-[var(--muted-foreground)]">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(meeting.createdAt)}
                        </span>
                        <span className="hidden sm:flex items-center gap-1 truncate max-w-[250px]">
                          {getMeetingPlatformLabel({ url: meeting.url })}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="ml-3 h-4 w-4 text-[var(--muted-foreground)] group-hover:text-[#00F2FF] transition-all group-hover:translate-x-1 shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
