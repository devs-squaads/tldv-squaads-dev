"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/Card";
import {
  Loader2, ShieldCheck, Mail, Save, AlertCircle,
  KeyRound, CheckCircle2, Trash2, FileJson, Upload,
  Calendar, ToggleLeft, ToggleRight, Users, UserPlus,
  SlidersHorizontal, Sparkles,
} from "lucide-react";
import TranscriptionContextCard from "@/components/TranscriptionContextCard";

type SettingsTab = "general" | "ai-context" | "equipo";

interface CredentialPreview {
  type: string;
  project_id: string;
  client_email: string;
  client_id: string;
}

interface AuthorizedAccount {
  email: string;
  role: "admin" | "member";
  isActive: boolean;
}

export default function SettingsView({ initialSettings }: { initialSettings: Record<string, string> }) {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Calendar auto-join state
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [hasRefreshToken, setHasRefreshToken] = useState(false);

  // Google credentials state (legacy/advanced)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [credJson, setCredJson] = useState("");
  const [credLoading, setCredLoading] = useState(false);
  const [credMessage, setCredMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [credPreview, setCredPreview] = useState<CredentialPreview | null>(null);
  const [credExists, setCredExists] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Team / authorized accounts state (admin only)
  const isAdmin = session?.user?.role === "admin";
  const [accounts, setAccounts] = useState<AuthorizedAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [newAccountEmail, setNewAccountEmail] = useState("");
  const [teamMessage, setTeamMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [confirmDeleteEmail, setConfirmDeleteEmail] = useState<string | null>(null);

  // Load calendar toggle state
  useEffect(() => {
    fetch("/api/settings/calendar-toggle")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.calendarEnabled === "boolean") {
          setCalendarEnabled(data.calendarEnabled);
          setHasRefreshToken(!!data.hasRefreshToken);
        }
      })
      .catch(() => {})
      .finally(() => setCalendarLoading(false));
  }, []);

  // Load existing credentials on mount
  useEffect(() => {
    fetch("/api/settings/google-credentials")
      .then((r) => r.json())
      .then((data) => {
        if (data.exists) {
          setCredExists(true);
          setCredPreview(data.preview || null);
        }
      })
      .catch(() => {});
  }, []);

  function loadAccounts() {
    setAccountsLoading(true);
    fetch("/api/admin/authorized-accounts")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.accounts)) setAccounts(data.accounts);
      })
      .catch(() => {})
      .finally(() => setAccountsLoading(false));
  }

  // Load the authorized accounts list for admins only
  useEffect(() => {
    if (isAdmin) loadAccounts();
  }, [isAdmin]);

  async function handleAddAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = newAccountEmail.trim();
    if (!email) return;

    setTeamMessage(null);
    try {
      const res = await fetch("/api/admin/authorized-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Error al agregar el email");
      setNewAccountEmail("");
      setTeamMessage({ type: 'success', text: `${email} agregado a la allowlist.` });
      loadAccounts();
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : "Error al agregar el email";
      setTeamMessage({ type: 'error', text });
    }
  }

  async function handleToggleAccountActive(email: string, isActive: boolean) {
    setAccounts((prev) => prev.map((a) => (a.email === email ? { ...a, isActive } : a)));
    try {
      const res = await fetch(`/api/admin/authorized-accounts/${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Error al actualizar el estado");
    } catch {
      loadAccounts();
    }
  }

  async function handleChangeRole(email: string, nextRole: "admin" | "member") {
    setAccounts((prev) => prev.map((a) => (a.email === email ? { ...a, role: nextRole } : a)));
    try {
      const res = await fetch(`/api/admin/authorized-accounts/${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setTeamMessage({ type: 'error', text: data.error || "Error al actualizar el rol" });
        loadAccounts();
      }
    } catch {
      setTeamMessage({ type: 'error', text: "Error al actualizar el rol" });
      loadAccounts();
    }
  }

  async function handleDeleteAccount(email: string) {
    try {
      const res = await fetch(`/api/admin/authorized-accounts/${encodeURIComponent(email)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setTeamMessage({ type: 'error', text: data.error || "Error al eliminar la cuenta" });
      } else {
        loadAccounts();
      }
    } catch {
      setTeamMessage({ type: 'error', text: "Error al eliminar la cuenta" });
    } finally {
      setConfirmDeleteEmail(null);
    }
  }

  const jsonValid = (() => {
    if (!credJson.trim()) return null;
    try {
      const p = JSON.parse(credJson);
      return p.type && p.project_id && p.private_key ? true : false;
    } catch {
      return false;
    }
  })();

  async function handleToggleCalendar() {
    const next = !calendarEnabled;
    setCalendarEnabled(next);
    try {
      const res = await fetch("/api/settings/calendar-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        setCalendarEnabled(!next); // revert
      }
    } catch {
      setCalendarEnabled(!next); // revert
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const formData = new FormData(e.currentTarget);
    const data = { monitor_email: formData.get("monitor_email") };

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Error al guardar la configuración");
      setMessage({ type: 'success', text: "Configuración guardada correctamente." });
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : "Error al guardar la configuración";
      setMessage({ type: 'error', text });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveCredentials() {
    if (!credJson.trim() || jsonValid !== true) return;
    setCredLoading(true);
    setCredMessage(null);
    try {
      const res = await fetch("/api/settings/google-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: credJson }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al guardar credenciales");
      setCredExists(true);
      setCredPreview(data.preview || null);
      setCredJson("");
      setCredMessage({ type: 'success', text: "Credenciales de Google guardadas correctamente." });
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : "Error al guardar credenciales";
      setCredMessage({ type: 'error', text });
    } finally {
      setCredLoading(false);
    }
  }

  async function handleDeleteCredentials() {
    setCredLoading(true);
    try {
      const res = await fetch("/api/settings/google-credentials", { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar credenciales");
      setCredExists(false);
      setCredPreview(null);
      setShowDeleteConfirm(false);
      setCredMessage({ type: 'success', text: "Credenciales eliminadas." });
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : "Error al eliminar";
      setCredMessage({ type: 'error', text });
    } finally {
      setCredLoading(false);
    }
  }

  const tabs: { id: SettingsTab; label: string; icon: typeof SlidersHorizontal }[] = [
    { id: "general", label: "General", icon: SlidersHorizontal },
    { id: "ai-context", label: "Contexto IA", icon: Sparkles },
    ...(isAdmin ? [{ id: "equipo" as const, label: "Equipo", icon: Users }] : []),
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Configuración</h1>
        <p className="text-[var(--muted-foreground)]">
          Gestiona tu cuenta, el Auto-Join y el contexto que se envía a los modelos de IA.
        </p>
      </div>

      <div
        className="flex items-center gap-1 p-1 rounded-[var(--radius)]"
        style={{
          background: "var(--card)",
          backdropFilter: "blur(12px) saturate(1.4)",
          WebkitBackdropFilter: "blur(12px) saturate(1.4)",
          border: "1px solid var(--glass-border)",
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-[calc(var(--radius)-2px)] transition-all ${
                isActive
                  ? "text-[#00F2FF]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
              style={
                isActive
                  ? {
                      background: "rgba(0, 242, 255, 0.08)",
                      border: "1px solid rgba(0, 242, 255, 0.3)",
                    }
                  : undefined
              }
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "ai-context" && <TranscriptionContextCard />}

      {activeTab === "general" && (
        <>

      {/* Auto-Join Calendar Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-[#00F2FF]" />
            Auto-Join de Reuniones
          </CardTitle>
          <CardDescription>
            Squaads Bot se unirá automáticamente a las reuniones de tu calendario de Google.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* User info */}
          {session?.user && (
            <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: "rgba(0, 242, 255, 0.04)", border: "1px solid rgba(0, 242, 255, 0.1)" }}>
              {session.user.image && (
                <img
                  src={session.user.image}
                  alt=""
                  className="w-10 h-10 rounded-full border border-[#00F2FF]/30"
                  referrerPolicy="no-referrer"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{session.user.name}</p>
                <p className="text-xs text-[var(--muted-foreground)] truncate">{session.user.email}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#00F2FF]" />
                <span className="text-xs text-[#00F2FF] font-medium">Conectado</span>
              </div>
            </div>
          )}

          {/* Calendar toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg" style={{ background: "var(--card)", border: "1px solid var(--glass-border)" }}>
            <div className="space-y-1">
              <p className="text-sm font-medium">Auto-Join activado</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {calendarEnabled
                  ? "El bot detectará y se unirá a tus reuniones automáticamente"
                  : "Activa para que el bot se una a tus reuniones"}
              </p>
            </div>
            {calendarLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
            ) : (
              <button
                onClick={handleToggleCalendar}
                className="transition-all hover:scale-110 active:scale-95"
                disabled={!hasRefreshToken}
              >
                {calendarEnabled ? (
                  <ToggleRight className="h-8 w-8 text-[#00F2FF]" />
                ) : (
                  <ToggleLeft className="h-8 w-8 text-[var(--muted-foreground)]" />
                )}
              </button>
            )}
          </div>

          {!hasRefreshToken && !calendarLoading && (
            <div className="space-y-2">
              <div className="rounded-md p-3 text-xs flex items-center gap-2 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                Todavía no conectaste tu Calendario de Google.
              </div>
              <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed px-1">
                Google va a mostrar un aviso de "app no verificada" — es esperado, no es un error.
                Hacé clic en "Avanzado" y después en "Ir a Squaads Bot (no seguro)" para continuar.
              </p>
              <a href="/api/settings/calendar-connect">
                <Button className="w-full gap-2" size="sm">
                  <Calendar className="h-4 w-4" />
                  Conectar Calendario
                </Button>
              </a>
            </div>
          )}

          {/* Permissions summary */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: "rgba(0, 242, 255, 0.04)", border: "1px solid rgba(0, 242, 255, 0.08)" }}>
              <ShieldCheck className="h-3.5 w-3.5 text-[#00F2FF]" />
              <span className="text-[var(--muted-foreground)]">Perfil y email</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: "rgba(0, 242, 255, 0.04)", border: "1px solid rgba(0, 242, 255, 0.08)" }}>
              <Calendar className="h-3.5 w-3.5 text-[#00F2FF]" />
              <span className="text-[var(--muted-foreground)]">Calendario (lectura)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Email config */}
      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-[#00F2FF]" />
              Email de Monitoreo
            </CardTitle>
            <CardDescription>
              Email adicional cuyo calendario se monitorizará (opcional si ya tienes Auto-Join).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {message && (
              <div className={`rounded-md p-3 text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-[#00F2FF]/15 text-[#00F2FF]' : 'bg-destructive/15 text-destructive'}`}>
                {message.type === 'error' && <AlertCircle className="h-4 w-4" />}
                {message.text}
              </div>
            )}
            <Input
              name="monitor_email"
              placeholder="usuario@tu-dominio.com"
              defaultValue={initialSettings.monitor_email}
            />
          </CardContent>
          <CardFooter className="border-t border-[var(--glass-border)] pt-6">
            <Button type="submit" disabled={loading} className="ml-auto gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar
            </Button>
          </CardFooter>
        </Card>
      </form>

      {/* Advanced: Service Account (collapsible) */}
      <div>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors flex items-center gap-1.5"
        >
          <KeyRound className="h-3 w-3" />
          {showAdvanced ? "Ocultar configuración avanzada" : "Configuración avanzada (Service Account)"}
        </button>

        {showAdvanced && (
          <Card className="mt-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4 text-[var(--muted-foreground)]" />
                Cuenta de servicio de Google (avanzado)
              </CardTitle>
              <CardDescription>
                Opcional. Permite que el bot se una automáticamente a reuniones de un calendario
                compartido, sin que cada persona conecte su cuenta de Google individualmente.
                Necesitás un archivo de credenciales (JSON) que genera un administrador desde
                Google Cloud Console. Si no sabés qué es esto, probablemente no lo necesites —
                usá &quot;Conectar Calendario&quot; más arriba en su lugar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {credMessage && (
                <div className={`rounded-md p-3 text-sm flex items-center gap-2 ${credMessage.type === 'success' ? 'bg-[#00F2FF]/15 text-[#00F2FF]' : 'bg-destructive/15 text-destructive'}`}>
                  {credMessage.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                  {credMessage.text}
                </div>
              )}

              {credExists && credPreview && (
                <div className="rounded-lg border border-[#00F2FF]/30 bg-[#00F2FF]/5 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-[#00F2FF]">
                    <CheckCircle2 className="h-4 w-4" />
                    Credenciales configuradas
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-[var(--muted-foreground)]">
                    <div><span className="font-medium text-[var(--foreground)]">Proyecto:</span> {credPreview.project_id}</div>
                    <div><span className="font-medium text-[var(--foreground)]">Tipo:</span> {credPreview.type}</div>
                    <div className="col-span-2"><span className="font-medium text-[var(--foreground)]">Email:</span> {credPreview.client_email}</div>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    {showDeleteConfirm ? (
                      <>
                        <Button variant="destructive" size="sm" className="gap-1.5 text-xs" onClick={handleDeleteCredentials} disabled={credLoading}>
                          {credLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          Confirmar
                        </Button>
                        <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowDeleteConfirm(false)}>Cancelar</Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-destructive hover:text-destructive" onClick={() => setShowDeleteConfirm(true)}>
                        <Trash2 className="h-3 w-3" />
                        Eliminar credenciales
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <FileJson className="h-4 w-4 opacity-50" />
                  {credExists ? "Reemplazar credenciales" : "Pegar el archivo de credenciales (JSON)"}
                </label>
                <div className="relative">
                  <textarea
                    value={credJson}
                    onChange={(e) => setCredJson(e.target.value)}
                    placeholder='{"type": "service_account", "project_id": "...", "private_key": "...", ...}'
                    rows={6}
                    className="w-full rounded-[var(--radius)] px-3 py-2 text-xs font-mono placeholder:text-[var(--muted-foreground)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#00F2FF]/50 resize-y transition-all"
                    style={{
                      background: "var(--card)",
                      backdropFilter: "blur(12px) saturate(1.4)",
                      WebkitBackdropFilter: "blur(12px) saturate(1.4)",
                      border: jsonValid === true
                        ? "1px solid rgba(0, 242, 255, 0.5)"
                        : jsonValid === false
                        ? "1px solid rgba(239, 68, 68, 0.5)"
                        : "1px solid var(--glass-border)",
                    }}
                  />
                  {jsonValid !== null && (
                    <div className={`absolute top-2 right-2 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                      jsonValid ? "bg-[#00F2FF]/15 text-[#00F2FF]" : "bg-destructive/15 text-destructive"
                    }`}>
                      {jsonValid ? "JSON válido" : "JSON inválido"}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter className="border-t border-[var(--glass-border)] pt-6">
              <Button onClick={handleSaveCredentials} disabled={credLoading || jsonValid !== true} className="ml-auto gap-2">
                {credLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Guardar Credenciales
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>

        </>
      )}

      {activeTab === "equipo" && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-[#00F2FF]" />
              Equipo
            </CardTitle>
            <CardDescription>
              Emails autorizados para iniciar sesión en Squaads Bot.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {teamMessage && (
              <div className={`rounded-md p-3 text-sm flex items-center gap-2 ${teamMessage.type === 'success' ? 'bg-[#00F2FF]/15 text-[#00F2FF]' : 'bg-destructive/15 text-destructive'}`}>
                {teamMessage.type === 'error' && <AlertCircle className="h-4 w-4" />}
                {teamMessage.text}
              </div>
            )}

            <form onSubmit={handleAddAccount} className="flex gap-2">
              <Input
                type="email"
                placeholder="nuevo@tu-dominio.com"
                value={newAccountEmail}
                onChange={(e) => setNewAccountEmail(e.target.value)}
              />
              <Button type="submit" className="gap-2 shrink-0">
                <UserPlus className="h-4 w-4" />
                Agregar
              </Button>
            </form>

            {accountsLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)] mx-auto" />
            ) : (
              <div className="space-y-2">
                {accounts.map((account) => {
                  const isSelf = account.email === session?.user?.email;
                  return (
                    <div
                      key={account.email}
                      className="flex items-center justify-between p-3 rounded-lg"
                      style={{ background: "var(--card)", border: "1px solid var(--glass-border)" }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{account.email}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {account.role === "admin" ? "Administrador" : "Miembro"}
                        </p>
                      </div>
                      {confirmDeleteEmail === account.email ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="destructive"
                            size="sm"
                            className="gap-1.5 text-xs"
                            onClick={() => handleDeleteAccount(account.email)}
                          >
                            Confirmar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs"
                            onClick={() => setConfirmDeleteEmail(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleChangeRole(account.email, account.role === "admin" ? "member" : "admin")}
                            disabled={isSelf}
                            title={
                              account.role === "admin"
                                ? "Quitar rol de administrador (dejará de poder gestionar el equipo)"
                                : "Hacer administrador (podrá gestionar cuentas y roles del equipo)"
                            }
                            aria-label={
                              account.role === "admin"
                                ? "Quitar rol de administrador (dejará de poder gestionar el equipo)"
                                : "Hacer administrador (podrá gestionar cuentas y roles del equipo)"
                            }
                            className="h-7 w-7 flex items-center justify-center transition-all hover:scale-110 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
                          >
                            <ShieldCheck
                              className={`h-5 w-5 ${account.role === "admin" ? "text-[#00F2FF]" : "text-[var(--muted-foreground)]"}`}
                            />
                          </button>
                          <button
                            onClick={() => handleToggleAccountActive(account.email, !account.isActive)}
                            title={
                              account.isActive
                                ? "Desactivar cuenta (no podrá iniciar sesión hasta reactivarla)"
                                : "Activar cuenta (podrá volver a iniciar sesión)"
                            }
                            aria-label={
                              account.isActive
                                ? "Desactivar cuenta (no podrá iniciar sesión hasta reactivarla)"
                                : "Activar cuenta (podrá volver a iniciar sesión)"
                            }
                            className="transition-all hover:scale-110 active:scale-95"
                          >
                            {account.isActive ? (
                              <ToggleRight className="h-7 w-7 text-[#00F2FF]" />
                            ) : (
                              <ToggleLeft className="h-7 w-7 text-[var(--muted-foreground)]" />
                            )}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteEmail(account.email)}
                            disabled={isSelf}
                            title="Eliminar cuenta (pide confirmación, no se puede deshacer)"
                            aria-label="Eliminar cuenta (pide confirmación, no se puede deshacer)"
                            className="h-7 w-7 flex items-center justify-center text-destructive transition-all hover:scale-110 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
