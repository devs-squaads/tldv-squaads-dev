"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { scheduleNextAnimationFrame } from "./animationLoop";

interface GlassProps {
  children?: React.ReactNode;
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  blur?: number;
  tintOpacity?: number;
  followMouse?: boolean;
  glowColor?: string;
  className?: string;
}

export function Glass({
  children,
  width = "auto",
  height = "auto",
  borderRadius = 16,
  blur = 12,
  tintOpacity = 0.1,
  followMouse = false,
  glowColor,
  className = "",
}: GlassProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: -200, y: -200 });
  const targetPos = useRef({ x: -200, y: -200 });
  const currentPos = useRef({ x: -200, y: -200 });
  const animRef = useRef<number>(0);
  const animateRef = useRef<(() => void) | null>(null);
  const isActive = useRef(false);

  const animate = useCallback(() => {
    const dx = targetPos.current.x - currentPos.current.x;
    const dy = targetPos.current.y - currentPos.current.y;

    // Smoother lerp — 0.08 for buttery movement
    currentPos.current.x += dx * 0.08;
    currentPos.current.y += dy * 0.08;

    setPos({ x: currentPos.current.x, y: currentPos.current.y });

    // Keep animating as long as there's movement
    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05 || isActive.current) {
      animRef.current = scheduleNextAnimationFrame(requestAnimationFrame, () => animateRef.current ?? (() => {}));
    }
  }, []);

  useEffect(() => {
    animateRef.current = animate;
  }, [animate]);

  useEffect(() => {
    if (!followMouse) return;

    const onMove = (e: MouseEvent) => {
      const parent = ref.current?.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const w = typeof width === "number" ? width : 40;
      const h = typeof height === "number" ? height : 40;
      targetPos.current = {
        x: e.clientX - rect.left - w / 2,
        y: e.clientY - rect.top - h / 2,
      };
      if (!isActive.current) {
        isActive.current = true;
        cancelAnimationFrame(animRef.current);
        animRef.current = requestAnimationFrame(animate);
      }
    };

    const onLeave = () => {
      isActive.current = false;
      targetPos.current = { x: -200, y: -200 };
      cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(animate);
    };

    const parent = ref.current?.parentElement;
    if (parent) {
      parent.addEventListener("mousemove", onMove);
      parent.addEventListener("mouseleave", onLeave);
    }

    return () => {
      isActive.current = false;
      cancelAnimationFrame(animRef.current);
      if (parent) {
        parent.removeEventListener("mousemove", onMove);
        parent.removeEventListener("mouseleave", onLeave);
      }
    };
  }, [followMouse, width, height, animate]);

  const style: React.CSSProperties = {
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
    borderRadius: `${borderRadius}px`,
    backdropFilter: `blur(${blur}px) saturate(1.4)`,
    WebkitBackdropFilter: `blur(${blur}px) saturate(1.4)`,
    backgroundColor: `rgba(255, 255, 255, ${tintOpacity})`,
    border: "1px solid rgba(255, 255, 255, 0.15)",
    boxShadow: glowColor
      ? `0 0 20px ${glowColor}22, 0 0 40px ${glowColor}11, inset 0 0 12px ${glowColor}08`
      : "0 4px 24px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
    ...(followMouse
      ? {
          position: "absolute" as const,
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          pointerEvents: "none" as const,
          zIndex: 50,
        }
      : {}),
  };

  return (
    <div ref={ref} style={style} className={className}>
      {children}
    </div>
  );
}
