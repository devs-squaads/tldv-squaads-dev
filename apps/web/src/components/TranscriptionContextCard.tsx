"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  Loader2, Save, AlertCircle, CheckCircle2,
  Sparkles, BookOpen, Hash,
} from "lucide-react";

const MAX_CONTEXT_LENGTH = 4000;

interface TranscriptionSettingsResponse {
  context: string;
  dictionary: string;
  dictionaryTerms: string[];
}

export default function TranscriptionContextCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [context, setContext] = useState("");
  const [dictionary, setDictionary] = useState("");
  const [dictionaryTerms, setDictionaryTerms] = useState<string[]>([]);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/transcription")
      .then((r) => r.json() as Promise<TranscriptionSettingsResponse>)
      .then((data) => {
        if (cancelled) return;
        setContext(data.context ?? "");
        setDictionary(data.dictionary ?? "");
        setDictionaryTerms(Array.isArray(data.dictionaryTerms) ? data.dictionaryTerms : []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/transcription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, dictionary }),
      });
      const data = (await res.json()) as TranscriptionSettingsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || "Error al guardar el contexto");
      setContext(data.context ?? "");
      setDictionary(data.dictionary ?? "");
      setDictionaryTerms(Array.isArray(data.dictionaryTerms) ? data.dictionaryTerms : []);
      setMessage({ type: "success", text: "Contexto guardado correctamente." });
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : "Error al guardar el contexto";
      setMessage({ type: "error", text });
    } finally {
      setSaving(false);
    }
  }

  const contextLength = context.length;
  const contextOverLimit = contextLength > MAX_CONTEXT_LENGTH;

  return (
    <div className="space-y-6">
      {/* Context card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#00F2FF]" />
            Contexto de la reunión
          </CardTitle>
          <CardDescription>
            Instrucciones en lenguaje natural que se aplican al refinado de transcripción y al resumen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {message && (
            <div
              className={`rounded-md p-3 text-sm flex items-center gap-2 ${
                message.type === "success"
                  ? "bg-[#00F2FF]/15 text-[#00F2FF]"
                  : "bg-destructive/15 text-destructive"
              }`}
            >
              {message.type === "success" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              {message.text}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Contexto global</label>
              <span
                className={`text-xs ${
                  contextOverLimit ? "text-destructive" : "text-[var(--muted-foreground)]"
                }`}
              >
                {contextLength} / {MAX_CONTEXT_LENGTH}
              </span>
            </div>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Ej: Somos Squaads, una empresa que desarrolla un bot de grabación de reuniones. En estas reuniones solemos hablar con clientes sobre integraciones, SLAs y roadmap de producto..."
              rows={8}
              disabled={loading}
              className="w-full rounded-[var(--radius)] px-3 py-2 text-sm placeholder:text-[var(--muted-foreground)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#00F2FF]/50 resize-y transition-all disabled:opacity-50"
              style={{
                background: "var(--card)",
                backdropFilter: "blur(12px) saturate(1.4)",
                WebkitBackdropFilter: "blur(12px) saturate(1.4)",
                border: contextOverLimit
                  ? "1px solid rgba(239, 68, 68, 0.5)"
                  : "1px solid var(--glass-border)",
              }}
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              Máximo {MAX_CONTEXT_LENGTH} caracteres.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Dictionary card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-[#00F2FF]" />
            Diccionario de términos
          </CardTitle>
          <CardDescription>
            Palabras clave, nombres propios, siglas o jerga técnica para mejorar precisión. También correcciones
            <code className="font-mono"> errónea =&gt; correcta </code>
            (una por línea).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Términos (uno por línea o separados por comas)</label>
            <textarea
              value={dictionary}
              onChange={(e) => setDictionary(e.target.value)}
              placeholder={"Squaads\nKubernetes\nDeepgram\nSLA\nMVP\n\"tldv\" => \"tl·dv\"\n\"squads\" => \"SQUAADS\"\n..."}
              rows={6}
              disabled={loading}
              className="w-full rounded-[var(--radius)] px-3 py-2 text-sm font-mono placeholder:text-[var(--muted-foreground)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#00F2FF]/50 resize-y transition-all disabled:opacity-50"
              style={{
                background: "var(--card)",
                backdropFilter: "blur(12px) saturate(1.4)",
                WebkitBackdropFilter: "blur(12px) saturate(1.4)",
                border: "1px solid var(--glass-border)",
              }}
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              Acepta saltos de línea, comas o punto y coma. También JSON: <code className="font-mono">[&quot;Squaads&quot;, &quot;SLA&quot;]</code> y correcciones <code className="font-mono">&quot;errónea&quot; =&gt; &quot;correcta&quot;</code> (se aplican siempre al refinar).
            </p>
          </div>

          {dictionaryTerms.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <Hash className="h-3.5 w-3.5" />
                {dictionaryTerms.length} término{dictionaryTerms.length === 1 ? "" : "s"} reconocido
                {dictionaryTerms.length === 1 ? "" : "s"}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dictionaryTerms.map((term) => (
                  <Badge key={term} variant="secondary" className="text-xs">
                    {term}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="border-t border-[var(--glass-border)] pt-6">
          <Button
            onClick={handleSave}
            disabled={loading || saving || contextOverLimit}
            className="ml-auto gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar contexto
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
