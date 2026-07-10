"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/Card";
import { Loader2, Video, Bot, Clock, CheckCircle2 } from "lucide-react";

import { startBotAction } from "@/app/actions/bot";
import { getMeetingProviderFromUrl } from "@meeting-bot/shared/meetingProvider";

export function NewMeetingForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ url: string; success: boolean; id?: string; error?: string }[]>([]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResults([]);

    const formData = new FormData(e.currentTarget);
    const rawUrls = formData.get("meetingUrls") as string;
    const botName = (formData.get("botName") as string) || "Squaads Assistant";
    const duration = parseInt(formData.get("duration") as string) || 60;

    // Parse URLs: split by comma, newline, or space, trim, filter empty/invalid
    const urls = rawUrls
      .split(/[,\n]+/)
      .map(u => u.trim())
      .filter(u => u.length > 0 && getMeetingProviderFromUrl(u) !== "unknown");

    if (urls.length === 0) {
      setError("Introduce al menos una URL valida de Google Meet, Microsoft Teams o Zoom.");
      setLoading(false);
      return;
    }

    const batchResults: typeof results = [];

    // Enqueue all meetings in parallel
    const promises = urls.map(async (url) => {
      try {
        const result = await startBotAction({ meetingUrl: url, botName, duration });
        batchResults.push({ url, success: result.success, id: result.id });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        batchResults.push({ url, success: false, error: message });
      }
    });

    await Promise.all(promises);
    setResults(batchResults);

    const allSuccess = batchResults.every(r => r.success);
    if (allSuccess) {
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 1500);
    }

    setLoading(false);
  }

  return (
    <Card className="mx-auto max-w-lg">
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle>Nueva Reunion</CardTitle>
          <CardDescription>
            Introduce una o varias URLs de reunion separadas por coma o salto de linea.
            El bot se unira a cada una de forma independiente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-2">
              {results.map((r, i) => (
                <div key={i} className={`rounded-md p-2.5 text-xs flex items-start gap-2 ${r.success ? "bg-[#00F2FF]/10 text-[#00F2FF]" : "bg-destructive/10 text-destructive"}`}>
                  {r.success
                    ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    : <Loader2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <span className="break-all">{r.url}</span>
                    {r.success && <span className="ml-1 opacity-70">- Encolada</span>}
                    {r.error && <span className="ml-1">- {r.error}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">
              Nombre del Bot
            </label>
            <div className="flex gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--glass-border)] bg-[var(--card)] shrink-0">
                <Bot className="h-5 w-5 opacity-50" />
              </div>
              <Input
                name="botName"
                placeholder="Ej. Asistente Squaads"
                defaultValue="Squaads Assistant"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">
              URLs de Reunion (Meet, Teams o Zoom)
            </label>
            <div className="flex gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--glass-border)] bg-[var(--card)] shrink-0 self-start mt-0.5">
                <Video className="h-5 w-5 opacity-50" />
              </div>
              <textarea
                name="meetingUrls"
                placeholder={"https://meet.google.com/abc-defg-hij\nhttps://teams.microsoft.com/l/meetup-join/...\nhttps://app.zoom.us/wc/123456789/join"}
                required
                rows={3}
                className="flex w-full rounded-[var(--radius)] px-3 py-2 text-sm placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F2FF]/50 disabled:cursor-not-allowed disabled:opacity-50 resize-y transition-all"
                style={{ background: "var(--card)", backdropFilter: "blur(12px) saturate(1.4)", WebkitBackdropFilter: "blur(12px) saturate(1.4)", border: "1px solid var(--glass-border)" }}
              />
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              Separa multiples URLs con coma o salto de linea. Cada URL generara una grabacion independiente.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">
              Duracion Maxima (minutos)
            </label>
            <div className="flex gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--glass-border)] bg-[var(--card)] shrink-0">
                <Clock className="h-5 w-5 opacity-50" />
              </div>
              <Input
                name="duration"
                type="number"
                defaultValue="60"
                min="1"
                max="240"
                required
              />
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Iniciando Bot...
              </>
            ) : (
              "Iniciar Grabacion"
            )}
          </Button>
          <p className="text-center text-xs text-[var(--muted-foreground)]">
            El bot solicitara unirse a cada reunion en unos segundos.
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
