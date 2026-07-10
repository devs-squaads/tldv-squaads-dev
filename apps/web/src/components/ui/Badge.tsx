import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: "bg-[var(--primary)] text-[var(--primary-foreground)]",
    secondary: "bg-[var(--secondary)] text-[var(--secondary-foreground)]",
    outline: "text-[var(--foreground)] border border-[var(--glass-border)] backdrop-blur-sm",
    destructive: "bg-[var(--destructive)]/15 text-[var(--destructive)] border border-[var(--destructive)]/20",
    success: "bg-[#00F2FF]/12 text-[#00F2FF] border border-[#00F2FF]/20",
    warning: "bg-amber-500/12 text-amber-500 border border-amber-500/20",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-hidden focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
