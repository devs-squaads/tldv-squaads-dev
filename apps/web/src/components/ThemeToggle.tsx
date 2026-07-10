"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = stored === "dark" || (!stored && prefersDark);
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
    setMounted(true);
  }, []);

  const toggle = () => {
    if (animating) return;
    setAnimating(true);

    const next = !dark;
    setDark(next);

    // Smooth transition on all elements
    document.documentElement.style.setProperty("--theme-transition", "0.5s");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");

    setTimeout(() => {
      document.documentElement.style.removeProperty("--theme-transition");
      setAnimating(false);
    }, 500);
  };

  if (!mounted) {
    return <div className="w-10 h-10" />;
  }

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className="relative w-10 h-10 rounded-full border border-[#00F2FF]/30 hover:border-[#00F2FF]/60 transition-all flex items-center justify-center overflow-hidden group"
      style={{
        background: "var(--card)",
        backdropFilter: "blur(12px) saturate(1.4)",
        WebkitBackdropFilter: "blur(12px) saturate(1.4)",
      }}
    >
      {/* Sun */}
      <svg
        className={`absolute h-5 w-5 transition-all duration-500 ease-out ${
          dark
            ? "rotate-90 scale-0 opacity-0"
            : "rotate-0 scale-100 opacity-100"
        }`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>

      {/* Moon */}
      <svg
        className={`absolute h-5 w-5 transition-all duration-500 ease-out ${
          dark
            ? "rotate-0 scale-100 opacity-100"
            : "-rotate-90 scale-0 opacity-0"
        }`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>

      {/* Ripple effect on click */}
      {animating && (
        <span
          className={`absolute inset-0 rounded-full animate-ping ${
            dark ? "bg-indigo-500/20" : "bg-amber-500/20"
          }`}
          style={{ animationDuration: "0.5s", animationIterationCount: 1 }}
        />
      )}
    </button>
  );
}
