"use client";

import { useSession, signOut } from "next-auth/react";
import { useState, useRef, useEffect } from "react";
import { LogOut, User } from "lucide-react";

export function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!session?.user) return null;

  const user = session.user;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center w-10 h-10 rounded-full border border-[#00F2FF]/30 hover:border-[#00F2FF]/60 transition-all overflow-hidden"
        style={{
          background: "var(--card)",
          backdropFilter: "blur(12px) saturate(1.4)",
          WebkitBackdropFilter: "blur(12px) saturate(1.4)",
        }}
      >
        {user.image ? (
          <img
            src={user.image}
            alt={user.name || ""}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <User className="h-4 w-4 text-[var(--foreground)]" />
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-12 w-64 rounded-xl p-1 z-50"
          style={{
            background: "var(--card)",
            backdropFilter: "blur(20px) saturate(1.6)",
            WebkitBackdropFilter: "blur(20px) saturate(1.6)",
            border: "1px solid var(--glass-border)",
            boxShadow: "var(--glass-shadow)",
          }}
        >
          {/* User info */}
          <div className="px-3 py-3 border-b border-[var(--glass-border)]">
            <p className="text-sm font-medium truncate">{user.name}</p>
            <p className="text-xs text-[var(--muted-foreground)] truncate">{user.email}</p>
          </div>

          {/* Sign out */}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm rounded-lg hover:bg-[var(--accent)] transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <LogOut className="h-4 w-4" />
            Cerrar Sesión
          </button>
        </div>
      )}
    </div>
  );
}
