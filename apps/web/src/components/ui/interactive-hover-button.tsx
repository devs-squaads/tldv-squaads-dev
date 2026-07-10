import { ArrowRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface InteractiveHoverButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  direction?: "right" | "left";
}

export function InteractiveHoverButton({
  children,
  className,
  direction = "right",
  ...props
}: InteractiveHoverButtonProps) {
  const isLeft = direction === "left";

  return (
    <button
      className={cn(
        "group relative w-auto cursor-pointer overflow-hidden rounded-full border border-[#00F2FF]/30 p-2 px-6 text-center font-semibold transition-all hover:border-[#00F2FF]/60",
        className
      )}
      style={{
        background: "var(--card)",
        backdropFilter: "blur(12px) saturate(1.4)",
        WebkitBackdropFilter: "blur(12px) saturate(1.4)",
      }}
      {...props}
    >
      <div className="flex items-center justify-center gap-2">
        {isLeft && (
          <div className="h-2 w-2 rounded-full bg-[#00F2FF] transition-all duration-300 group-hover:scale-[100.8]" />
        )}
        <span
          className={cn(
            "inline-block transition-all duration-300 group-hover:opacity-0",
            isLeft ? "group-hover:-translate-x-8" : "group-hover:translate-x-8"
          )}
        >
          {children}
        </span>
        {!isLeft && (
          <div className="h-2 w-2 rounded-full bg-[#00F2FF] transition-all duration-300 group-hover:scale-[100.8]" />
        )}
      </div>
      <div
        className={cn(
          "absolute inset-0 z-10 flex h-full w-full items-center justify-center gap-2 text-white opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100",
          isLeft ? "-translate-x-full" : "translate-x-full"
        )}
      >
        {isLeft && <ArrowLeft className="h-4 w-4" />}
        <span>{children}</span>
        {!isLeft && <ArrowRight className="h-4 w-4" />}
      </div>
    </button>
  );
}
