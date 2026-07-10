import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', style, ...props }, ref) => {
    const variants = {
      primary: "text-[var(--primary-foreground)] shadow-sm hover:shadow-md",
      secondary: "text-[var(--secondary-foreground)] hover:brightness-110",
      outline: "text-[var(--foreground)] hover:brightness-110",
      ghost: "hover:bg-[var(--accent)] text-[var(--foreground)]",
      destructive: "bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:opacity-90",
    };

    const sizes = {
      sm: "h-8 px-3 text-xs",
      md: "h-10 px-4 py-2 text-sm",
      lg: "h-12 px-8 text-base",
      icon: "h-10 w-10",
    };

    const glassStyle: React.CSSProperties =
      variant === "primary"
        ? {
            background: "var(--primary)",
            backdropFilter: "blur(12px) saturate(1.4)",
            WebkitBackdropFilter: "blur(12px) saturate(1.4)",
          }
        : variant === "secondary"
        ? {
            background: "var(--secondary)",
            backdropFilter: "blur(12px) saturate(1.4)",
            WebkitBackdropFilter: "blur(12px) saturate(1.4)",
            border: "1px solid var(--glass-border)",
          }
        : variant === "outline"
        ? {
            background: "var(--card)",
            backdropFilter: "blur(12px) saturate(1.4)",
            WebkitBackdropFilter: "blur(12px) saturate(1.4)",
            border: "1px solid var(--glass-border)",
          }
        : {};

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-[var(--radius)] font-medium transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97]",
          variants[variant],
          sizes[size],
          className
        )}
        style={{ ...glassStyle, ...style }}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
