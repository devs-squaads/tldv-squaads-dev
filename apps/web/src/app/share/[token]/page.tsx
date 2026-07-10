"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/utils";
import { CheckCircle2, Loader2, Lock, Mail, ShieldAlert, Video } from "lucide-react";

interface SharedMeeting {
  id: string;
  title: string | null;
  url: string;
  createdAt: Date;
  summary: string | null;
  rawTranscription: string | null;
  recordingUrl: string | null;
}

type PublicShareState =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "requires_email_verification" }
  | { status: "ok"; meeting: SharedMeeting };

export default function PublicSharePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [state, setState] = useState<PublicShareState>({ status: "loading" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const run = async () => {
      if (!token) return;
      try {
        const res = await fetch(`/api/v1/public/shares/${token}`, { cache: "no-store" });
        if (res.status === 404) {
          setState({ status: "not_found" });
          return;
        }
        const data = await res.json();
        if (data.status === "requires_email_verification") {
          setState({ status: "requires_email_verification" });
          return;
        }
        if (data.status === "ok") {
          setState({ status: "ok", meeting: data.meeting });
          return;
        }
        setState({ status: "not_found" });
      } catch {
        setState({ status: "not_found" });
      }
    };

    void run();
  }, [token]);

  const requestCode = async () => {
    if (!token || !email.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/public/shares/${token}/request-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "No se pudo solicitar el código.");
        return;
      }
      setCodeRequested(true);
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async () => {
    if (!token || !email.trim() || !code.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/public/shares/${token}/verify-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Código inválido.");
        return;
      }

      const data = await res.json();
      if (data.status === "ok") {
        setState({ status: "ok", meeting: data.meeting });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (state.status === "loading") {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (state.status === "not_found") {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <Card className="max-w-lg w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <ShieldAlert className="h-5 w-5" />
              Enlace no disponible
            </CardTitle>
            <CardDescription>
              Este enlace no existe, ha sido revocado o ha caducado.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (state.status === "requires_email_verification") {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <Card className="max-w-lg w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Acceso restringido por email
            </CardTitle>
            <CardDescription>
              Introduce el email destinatario y verifica con código OTP para abrir el contenido.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email
              </label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="usuario@dominio.com"
                className="w-full h-10 rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 text-sm"
              />
            </div>

            <Button onClick={requestCode} disabled={submitting || !email.trim()} className="w-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Solicitar código"}
            </Button>

            {codeRequested && (
              <>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  type="text"
                  placeholder="Código OTP"
                  className="w-full h-10 rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 text-sm"
                />
                <Button onClick={verifyCode} disabled={submitting || !code.trim()} className="w-full">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verificar acceso"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const meeting = state.meeting;
  const parsedSummary = (() => {
    if (!meeting.summary) return null;
    try {
      return JSON.parse(meeting.summary);
    } catch {
      return null;
    }
  })();

  return (
    <div className="min-h-screen bg-[var(--background)] p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{meeting.title || "Reunión compartida"}</CardTitle>
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Acceso verificado
              </Badge>
            </div>
            <CardDescription>
              {formatDate(meeting.createdAt)} · <a className="underline" href={meeting.url} target="_blank" rel="noreferrer">Link original</a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {meeting.recordingUrl && (
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <Video className="h-4 w-4" />
                  Grabación
                </h3>
                <video src={meeting.recordingUrl} controls className="w-full rounded-lg bg-black aspect-video" />
              </div>
            )}

            {parsedSummary?.summary && (
              <div className="space-y-2">
                <h3 className="font-semibold">Resumen</h3>
                <p className="text-sm whitespace-pre-line">{parsedSummary.summary}</p>
              </div>
            )}

            {meeting.rawTranscription && (
              <div className="space-y-2">
                <h3 className="font-semibold">Transcripción</h3>
                <div className="text-sm whitespace-pre-line rounded-lg border border-[var(--border)] p-3 max-h-[360px] overflow-auto">
                  {meeting.rawTranscription}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
