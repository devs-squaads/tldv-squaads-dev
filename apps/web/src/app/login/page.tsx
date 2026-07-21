"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { SquaadsLogo } from "@/components/SquaadsLogo";
import SensitiveText from "@/components/ui/sensitive-text";
import VenomBeam from "@/components/ui/venom-beam";
import { GlassCursor } from "@/components/GlassLayout";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Calendar, Shield, Sparkles, ArrowRight, Mic, Brain, FileText } from "lucide-react";
import { resolveLoginRedirect } from "@/lib/loginRedirect";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = resolveLoginRedirect(searchParams.get("callbackUrl"));

  useEffect(() => {
    queueMicrotask(() => setMounted(true));
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(redirectTarget);
    }
  }, [status, redirectTarget, router]);

  const handleGoogleLogin = () => {
    setLoading(true);
    signIn("google", { callbackUrl: redirectTarget });
  };

  // ponytail: flag-gated dev-only escape hatch, never present on Production (see isDevAuthBypassEnabled in auth.ts)
  const showDevBypass = process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true";
  const handleDevBypassLogin = () => {
    setLoading(true);
    signIn("dev-bypass", { callbackUrl: redirectTarget });
  };

  return (
    <div className="relative flex min-h-screen bg-[var(--background)] overflow-hidden">
      <GlassCursor />

      {/* Theme toggle */}
      <div className="fixed top-6 right-6 z-30">
        <ThemeToggle />
      </div>

      <VenomBeam className="flex-1">
        {/* Ambient glow orbs */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <div
            className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-[0.07] blur-[120px]"
            style={{ background: "#00F2FF" }}
          />
          <div
            className="absolute -bottom-48 -right-48 w-[500px] h-[500px] rounded-full opacity-[0.05] blur-[140px]"
            style={{ background: "#00F2FF" }}
          />
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-[0.03] blur-[160px]"
            style={{ background: "#00F2FF" }}
          />
        </div>

        <main className="relative z-10 flex min-h-screen">
          {/* Left side — Branding & Features */}
          <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-16 xl:px-24">
            <div
              className={`space-y-10 transition-all duration-1000 ${
                mounted ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8"
              }`}
            >
              {/* Logo */}
              <div className="flex items-center gap-4">
                <div
                  className="p-3 rounded-2xl"
                  style={{
                    background: "rgba(0, 242, 255, 0.08)",
                    border: "1px solid rgba(0, 242, 255, 0.15)",
                    boxShadow: "0 0 30px rgba(0, 242, 255, 0.1)",
                  }}
                >
                  <SquaadsLogo size={44} />
                </div>
                <div>
                  <div className="text-3xl font-bold tracking-tight">
                    <SensitiveText hoverColor="#00F2FF">Squaads Bot</SensitiveText>
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5 tracking-wide uppercase">
                    Meeting Intelligence Platform
                  </p>
                </div>
              </div>

              {/* Tagline */}
              <div className="space-y-4">
                <h1 className="text-4xl xl:text-5xl font-bold leading-tight tracking-tight">
                  Tus reuniones,{" "}
                  <span className="bg-gradient-to-r from-[#00F2FF] to-[#00c4cc] bg-clip-text text-transparent">
                    potenciadas
                  </span>{" "}
                  con IA
                </h1>
                <p className="text-lg text-[var(--muted-foreground)] leading-relaxed max-w-lg">
                  Graba, transcribe y genera resúmenes inteligentes de tus reuniones de forma automática. Sin configuración manual.
                </p>
              </div>

              {/* Feature pills */}
              <div className="space-y-3">
                {[
                  {
                    icon: Mic,
                    title: "Grabación automática",
                    desc: "Se une a tus reuniones sin que tengas que hacer nada",
                  },
                  {
                    icon: FileText,
                    title: "Transcripción precisa",
                    desc: "Powered by Groq — transcripción en tiempo real",
                  },
                  {
                    icon: Brain,
                    title: "Resúmenes con IA",
                    desc: "Gemini genera resúmenes, puntos clave y tareas pendientes",
                  },
                ].map(({ icon: Icon, title, desc }, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-4 p-4 rounded-xl transition-all duration-700 ${
                      mounted ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-6"
                    }`}
                    style={{
                      transitionDelay: `${400 + i * 150}ms`,
                      background: "var(--card)",
                      backdropFilter: "blur(var(--glass-blur)) saturate(1.6)",
                      WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(1.6)",
                      border: "1px solid var(--glass-border)",
                    }}
                  >
                    <div
                      className="p-2 rounded-lg shrink-0 mt-0.5"
                      style={{
                        background: "rgba(0, 242, 255, 0.1)",
                        border: "1px solid rgba(0, 242, 255, 0.2)",
                      }}
                    >
                      <Icon className="h-4 w-4 text-[#00F2FF]" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{title}</p>
                      <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right side — Login Card */}
          <div className="flex-1 flex items-center justify-center px-6 lg:px-16">
            <div
              className={`w-full max-w-md transition-all duration-1000 ${
                mounted ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-6 scale-[0.98]"
              }`}
              style={{ transitionDelay: "200ms" }}
            >
              {/* Mobile-only logo */}
              <div className="flex flex-col items-center gap-3 mb-8 lg:hidden">
                <div
                  className="p-3 rounded-2xl"
                  style={{
                    background: "rgba(0, 242, 255, 0.08)",
                    border: "1px solid rgba(0, 242, 255, 0.15)",
                    boxShadow: "0 0 30px rgba(0, 242, 255, 0.1)",
                  }}
                >
                  <SquaadsLogo size={40} />
                </div>
                <div className="text-2xl font-bold tracking-tight">
                  <SensitiveText hoverColor="#00F2FF">Squaads Bot</SensitiveText>
                </div>
                <p className="text-sm text-[var(--muted-foreground)] text-center max-w-xs">
                  Tu asistente inteligente para reuniones
                </p>
              </div>

              {/* Login Card */}
              <div
                className="rounded-2xl p-8 sm:p-10 space-y-7 relative overflow-hidden"
                style={{
                  background: "var(--card)",
                  backdropFilter: "blur(var(--glass-blur)) saturate(1.8)",
                  WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(1.8)",
                  border: "1px solid var(--glass-border)",
                  boxShadow: "var(--glass-shadow), 0 0 60px rgba(0, 242, 255, 0.04)",
                }}
              >
                {/* Subtle top glow line */}
                <div
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px"
                  style={{
                    background: "linear-gradient(90deg, transparent, rgba(0, 242, 255, 0.4), transparent)",
                  }}
                />

                {/* Header */}
                <div className="text-center space-y-2">
                  <h2 className="text-2xl font-bold tracking-tight">Bienvenido</h2>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Conecta tu cuenta de Google para empezar
                  </p>
                </div>

                {/* Google Sign In Button */}
                <button
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="group w-full flex items-center justify-center gap-3 h-14 rounded-xl font-semibold text-[15px] transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none relative overflow-hidden"
                  style={{
                    background: "linear-gradient(135deg, rgba(0, 242, 255, 0.12), rgba(0, 242, 255, 0.06))",
                    border: "1px solid rgba(0, 242, 255, 0.3)",
                    boxShadow: "0 0 30px rgba(0, 242, 255, 0.08), inset 0 1px 0 rgba(255,255,255,0.05)",
                  }}
                >
                  {/* Hover glow effect */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                    style={{
                      background: "linear-gradient(135deg, rgba(0, 242, 255, 0.2), rgba(0, 242, 255, 0.08))",
                      boxShadow: "inset 0 0 30px rgba(0, 242, 255, 0.1)",
                    }}
                  />

                  <div className="relative flex items-center gap-3">
                    {loading ? (
                      <div className="h-5 w-5 rounded-full border-2 border-[#00F2FF] border-t-transparent animate-spin" />
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                      </svg>
                    )}
                    <span>{loading ? "Conectando..." : "Continuar con Google"}</span>
                    {!loading && (
                      <ArrowRight className="h-4 w-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all duration-300" />
                    )}
                  </div>
                </button>

                {showDevBypass && (
                  <button
                    onClick={handleDevBypassLogin}
                    disabled={loading}
                    className="w-full h-10 rounded-xl text-xs font-medium border border-dashed border-[var(--muted-foreground)] text-[var(--muted-foreground)] hover:opacity-80 disabled:opacity-50"
                  >
                    Entrar sin Google (dev)
                  </button>
                )}

                {/* Divider */}
                <div className="flex items-center gap-4">
                  <div className="flex-1 h-px bg-[var(--glass-border)]" />
                  <span className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] font-medium">
                    Permisos
                  </span>
                  <div className="flex-1 h-px bg-[var(--glass-border)]" />
                </div>

                {/* Permissions */}
                <div className="space-y-2.5">
                  {[
                    { icon: Shield, text: "Perfil y email", desc: "Para identificar tu cuenta" },
                    { icon: Calendar, text: "Calendario (paso aparte)", desc: "Lo conectás vos cuando quieras, desde Ajustes" },
                    { icon: Sparkles, text: "Auto-Join inteligente", desc: "Se une automáticamente a tus meets" },
                  ].map(({ icon: Icon, text, desc }, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-3.5 p-3 rounded-xl transition-all duration-500 ${
                        mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
                      }`}
                      style={{
                        transitionDelay: `${600 + i * 100}ms`,
                        background: "rgba(0, 242, 255, 0.03)",
                        border: "1px solid rgba(0, 242, 255, 0.08)",
                      }}
                    >
                      <div
                        className="p-1.5 rounded-lg shrink-0"
                        style={{
                          background: "rgba(0, 242, 255, 0.1)",
                          boxShadow: "0 0 12px rgba(0, 242, 255, 0.08)",
                        }}
                      >
                        <Icon className="h-3.5 w-3.5 text-[#00F2FF]" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold leading-none">{text}</p>
                        <p className="text-[11px] text-[var(--muted-foreground)] mt-1 leading-none">{desc}</p>
                      </div>
                      <div className="ml-auto">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#00F2FF] opacity-40" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <p className="text-center text-[11px] text-[var(--muted-foreground)] mt-6 leading-relaxed px-4">
                Al continuar, solo compartís tu perfil y email. El acceso a Calendario para el auto-join se conecta
                aparte, desde Ajustes, cuando quieras.
              </p>
            </div>
          </div>
        </main>
      </VenomBeam>
    </div>
  );
}
