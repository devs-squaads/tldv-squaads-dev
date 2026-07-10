"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Loader2,
  ShieldCheck,
  MonitorSmartphone,
  Copy,
  CheckCircle2,
  Chrome,
  Puzzle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EXTENSION_INSTALL_MODAL_OPEN_EVENT } from "@/modules/extension-install/modalBridge";

const CHROME_WEB_STORE_URL: string | null = null;
const INTERNAL_EXTENSION_DOWNLOAD_URL = "/downloads/squaads-extension-internal.zip";

type BrowserFlavor = "chrome" | "edge" | "brave" | "chromium" | "unsupported";

function detectBrowser(): BrowserFlavor {
  if (typeof navigator === "undefined") return "unsupported";

  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("edg/")) return "edge";
  if ((navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } }).brave) return "brave";
  if (ua.includes("chrome/")) return "chrome";
  if (ua.includes("chromium")) return "chromium";
  return "unsupported";
}

function getBrowserLabel(browser: BrowserFlavor): string {
  switch (browser) {
    case "edge":
      return "Microsoft Edge";
    case "brave":
      return "Brave";
    case "chromium":
      return "Chromium";
    case "chrome":
      return "Google Chrome";
    default:
      return "Navegador no soportado";
  }
}

export function ExtensionInstallModalHost() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [browser, setBrowser] = useState<BrowserFlavor>("unsupported");
  const [loadingToken, setLoadingToken] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "done">("idle");
  const [error, setError] = useState("");
  const [linkToken, setLinkToken] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [linkedEmail, setLinkedEmail] = useState("");

  useEffect(() => {
    setMounted(true);
    setBrowser(detectBrowser());
  }, []);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(EXTENSION_INSTALL_MODAL_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(EXTENSION_INSTALL_MODAL_OPEN_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!mounted || !open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted, open]);

  const installLabel = useMemo(() => getBrowserLabel(browser), [browser]);

  async function generateToken() {
    setLoadingToken(true);
    setError("");

    try {
      const response = await fetch("/api/v1/extension/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "No pudimos generar el token de conexión.");
      }

      const data = (await response.json()) as {
        linkToken: string;
        expiresAt: string;
        email: string;
      };

      setLinkToken(data.linkToken);
      setExpiresAt(data.expiresAt);
      setLinkedEmail(data.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos generar el token de conexión.");
    } finally {
      setLoadingToken(false);
    }
  }

  async function copyToken() {
    if (!linkToken) return;

    try {
      await navigator.clipboard.writeText(linkToken);
      setCopyState("done");
      window.setTimeout(() => setCopyState("idle"), 1800);
      setError("");
    } catch {
      setError("No pudimos copiar el token automaticamente. Copialo manualmente desde el bloque inferior.");
    }
  }

  const tokenPanel = linkToken ? (
    <div className="mt-4 space-y-3 rounded-3xl border border-[#00F2FF]/20 bg-[#07151d] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Token listo para {linkedEmail}</p>
          <p className="text-xs text-[var(--muted-foreground)]">Vence: {new Date(expiresAt).toLocaleString()}</p>
        </div>
        <Button variant="secondary" size="sm" className="gap-2" onClick={() => void copyToken()}>
          {copyState === "done" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copyState === "done" ? "Copiado" : "Copiar token"}
        </Button>
      </div>
      <code className="block overflow-x-auto rounded-2xl border border-white/8 bg-black/30 p-3 text-xs leading-6 text-[#d8fbff]">
        {linkToken}
      </code>
    </div>
  ) : (
    <div className="mt-4 flex min-h-40 flex-col justify-between rounded-3xl border border-dashed border-white/10 bg-black/20 p-4">
      <div>
        <p className="text-sm font-semibold text-white">Esperando token</p>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Cuando lo generes desde esta pantalla, va a aparecer aca listo para copiar. Asi evitamos saltos raros de layout y el usuario entiende que el siguiente paso todavia no ocurrio.
        </p>
      </div>
      <div className="mt-4 rounded-2xl border border-white/8 bg-black/25 px-3 py-2 text-xs text-[var(--muted-foreground)]">
        Estado actual: sin token generado.
      </div>
    </div>
  );

  const modal = open ? (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-[rgba(3,5,10,0.82)] p-3 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Cerrar modal"
        className="absolute inset-0 cursor-default"
        onClick={() => setOpen(false)}
      />
      <div className="relative z-10 w-full max-w-5xl overflow-hidden rounded-[32px] border border-white/10 bg-[#090b12] text-white shadow-[0_32px_120px_rgba(0,0,0,0.55)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#00F2FF]/50 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,242,255,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.14),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_32%)]" />

        <div className="relative flex max-h-[90vh] flex-col overflow-hidden">
          <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-5 sm:px-7">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#00F2FF]/20 bg-[#00F2FF]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8cecff]">
                <ShieldCheck className="h-3.5 w-3.5" />
                Onboarding extension
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white sm:text-2xl">Instala la extension interna y conectala en minutos</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-300 sm:text-[15px]">
                  Estas en <strong className="text-white">{installLabel}</strong>. Por ahora la instalacion es interna: descarga el ZIP, descomprimilo, cargalo con <strong className="text-white">Load unpacked</strong> y despues conectalo desde el dashboard.
                </p>
              </div>
            </div>

            <Button variant="ghost" size="icon" aria-label="Cerrar modal" className="text-white hover:bg-white/8" onClick={() => setOpen(false)}>
              ×
            </Button>
          </div>

          <div className="grid gap-5 overflow-y-auto px-5 py-5 sm:grid-cols-[minmax(0,1.15fr)_340px] sm:px-7 sm:py-6">
            <section className="space-y-5">
              <article className="rounded-[28px] border border-white/8 bg-[rgba(9,13,23,0.92)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#00F2FF]/10 text-[#67e8f9] ring-1 ring-[#00F2FF]/15">
                    <Chrome className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-white">Paso 1 - Instalacion interna</h3>
                    <p className="text-sm text-slate-400">Hoy el canal real es una descarga interna guiada. Chrome Web Store queda como etapa futura.</p>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="rounded-3xl border border-white/8 bg-[#111522] p-4">
                    <p className="text-sm font-semibold text-white">Descarga interna actual</p>
                    <p className="mt-1 text-sm text-slate-400">Descarga <code className="rounded bg-black/20 px-1 py-0.5">squaads-extension-internal.zip</code>, descomprimilo y cargalo manualmente en Chrome o Brave.</p>
                    <a
                      href={INTERNAL_EXTENSION_DOWNLOAD_URL}
                      className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] shadow-sm transition-all hover:shadow-md"
                    >
                      Descargar extension ZIP
                    </a>
                    <p className="mt-2 text-xs text-slate-400">Importante: primero descomprimi el ZIP. Despues usa <strong>Load unpacked</strong> sobre la carpeta extraida.</p>
                  </div>

                  <div className="rounded-3xl border border-dashed border-white/10 bg-black/15 p-4">
                    <p className="text-sm font-semibold text-white">Guia paso a paso</p>
                    <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-300">
                      <li>Descarga el ZIP interno</li>
                      <li>Descomprimi el archivo en tu computadora</li>
                      <li>Abri <code className="rounded bg-black/20 px-1 py-0.5">chrome://extensions</code> o <code className="rounded bg-black/20 px-1 py-0.5">brave://extensions</code></li>
                      <li>Activa <strong>Developer mode</strong></li>
                      <li>Toca <strong>Load unpacked</strong></li>
                      <li>Selecciona la carpeta extraida, no el ZIP</li>
                    </ol>
                  </div>

                  <div className="rounded-3xl border border-white/8 bg-[#111522] p-4">
                    <p className="text-sm font-semibold text-white">Chrome Web Store mas adelante</p>
                    <p className="mt-1 text-sm text-slate-400">La instalacion desde Store sigue siendo el destino final, pero hoy no es el camino activo del equipo.</p>
                    {CHROME_WEB_STORE_URL ? (
                      <a
                        href={CHROME_WEB_STORE_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] shadow-sm transition-all hover:shadow-md"
                      >
                        Abrir Chrome Web Store
                      </a>
                    ) : (
                      <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
                        La ficha publica todavia no esta disponible. Por ahora usa la descarga interna de arriba.
                      </div>
                    )}
                  </div>
                </div>
              </article>

              <article className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(16,22,34,0.96),rgba(10,14,22,0.98))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#7c3aed]/15 text-[#c4b5fd] ring-1 ring-[#8b5cf6]/20">
                    <MonitorSmartphone className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-white">Paso 2 - Vinculacion segura</h3>
                    <p className="text-sm text-slate-400">Genera el token efimero aca, copialo y pegalo en la extension. Ese es el camino oficial: corto, manual y seguro.</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 rounded-3xl border border-white/8 bg-black/15 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-white">Una vez instalada, volve a esta pantalla</p>
                    <p className="text-sm text-slate-400">Genera el token aca y despues abri el popup desde esta misma pestana para pegarlo en <strong>Configuration</strong>.</p>
                  </div>
                  <Button onClick={() => void generateToken()} disabled={loadingToken} className="gap-2 sm:w-auto">
                    {loadingToken ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    {loadingToken ? "Generando..." : "Generar token"}
                  </Button>
                </div>

                {tokenPanel}

                {error ? (
                  <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
                    {error}
                  </div>
                ) : null}
              </article>
            </section>

            <aside className="space-y-5">
              <article className="rounded-[28px] border border-white/8 bg-[rgba(10,14,22,0.92)] p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/6 text-white">
                    <Puzzle className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-white">Resumen rapido</h3>
                    <p className="text-sm text-slate-400">Tres cosas y listo.</p>
                  </div>
                </div>

                <ul className="mt-4 space-y-3 text-sm text-slate-300">
                  <li className="rounded-2xl border border-white/8 bg-black/15 px-3 py-3">1. Descarga y descomprime el ZIP interno.</li>
                  <li className="rounded-2xl border border-white/8 bg-black/15 px-3 py-3">2. Carga la carpeta con <strong>Load unpacked</strong>.</li>
                  <li className="rounded-2xl border border-white/8 bg-black/15 px-3 py-3">3. Genera el token aca y pegalo en el popup.</li>
                </ul>
              </article>
            </aside>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return mounted ? createPortal(modal, document.body) : null;
}
