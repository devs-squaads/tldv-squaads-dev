"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { scheduleNextAnimationFrame } from "./animationLoop";

interface SensitiveTextProps {
  children: string;
  variant?: "compress" | "stretch";
  maxStretch?: number;
  sensitivity?: number;
  easing?: number;
  className?: string;
  hoverColor?: string;
}

export default function SensitiveText({
  children,
  variant = "compress",
  maxStretch = 0.8,
  sensitivity = 0.6,
  easing = 12,
  className = "",
  hoverColor,
}: SensitiveTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [letterScales, setLetterScales] = useState<number[]>(
    () => new Array(children.length).fill(1)
  );
  const [letterIntensities, setLetterIntensities] = useState<number[]>(
    () => new Array(children.length).fill(0)
  );
  const animFrameRef = useRef<number>(0);
  const animateRef = useRef<(() => void) | null>(null);
  const targetScalesRef = useRef<number[]>(new Array(children.length).fill(1));
  const currentScalesRef = useRef<number[]>(new Array(children.length).fill(1));
  const targetIntensitiesRef = useRef<number[]>(new Array(children.length).fill(0));
  const currentIntensitiesRef = useRef<number[]>(new Array(children.length).fill(0));
  const isHoveringRef = useRef(false);

  const letters = children.split("");

  const animate = useCallback(() => {
    const current = currentScalesRef.current;
    const target = targetScalesRef.current;
    const curInt = currentIntensitiesRef.current;
    const tarInt = targetIntensitiesRef.current;
    let needsUpdate = false;

    const next = current.map((c, i) => {
      const diff = target[i] - c;
      if (Math.abs(diff) < 0.001) return target[i];
      needsUpdate = true;
      return c + diff / easing;
    });

    const nextInt = curInt.map((c, i) => {
      const diff = tarInt[i] - c;
      if (Math.abs(diff) < 0.005) return tarInt[i];
      needsUpdate = true;
      return c + diff / easing;
    });

    currentScalesRef.current = next;
    currentIntensitiesRef.current = nextInt;
    setLetterScales([...next]);
    setLetterIntensities([...nextInt]);

    if (needsUpdate || isHoveringRef.current) {
      animFrameRef.current = scheduleNextAnimationFrame(requestAnimationFrame, () => animateRef.current ?? (() => {}));
    }
  }, [easing]);

  useEffect(() => {
    animateRef.current = animate;
  }, [animate]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const totalWidth = rect.width;

      const newTargets: number[] = [];
      const newIntensities: number[] = [];

      letters.forEach((_, i) => {
        const letterPos = (i / letters.length) * totalWidth + totalWidth / letters.length / 2;
        const distance = Math.abs(mouseX - letterPos);
        const maxDist = totalWidth * sensitivity;
        const normalizedDist = Math.min(distance / maxDist, 1);
        const proximity = 1 - normalizedDist;

        if (variant === "compress") {
          newTargets.push(1 - (1 - maxStretch) * proximity);
        } else {
          newTargets.push(1 + (maxStretch - 1) * proximity);
        }
        newIntensities.push(proximity);
      });

      targetScalesRef.current = newTargets;
      targetIntensitiesRef.current = newIntensities;
    },
    [letters, sensitivity, maxStretch, variant]
  );

  const handleMouseEnter = useCallback(() => {
    isHoveringRef.current = true;
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(animate);
  }, [animate]);

  const handleMouseLeave = useCallback(() => {
    isHoveringRef.current = false;
    targetScalesRef.current = new Array(letters.length).fill(1);
    targetIntensitiesRef.current = new Array(letters.length).fill(0);
  }, [letters.length]);

  useEffect(() => {
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  return (
    <span
      ref={containerRef}
      className={`inline-flex cursor-default select-none ${className}`}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {letters.map((letter, i) => {
        const intensity = letterIntensities[i] || 0;
        const colorStyle = hoverColor && intensity > 0
          ? { color: hoverColor, opacity: undefined, filter: undefined }
          : {};
        // Blend: mix between inherit and hoverColor based on intensity
        const blendStyle = hoverColor && intensity > 0
          ? `color-mix(in srgb, currentColor ${Math.round((1 - intensity) * 100)}%, ${hoverColor})`
          : undefined;

        return (
          <span
            key={i}
            className="inline-block origin-center will-change-transform"
            style={{
              transform: `scaleX(${letterScales[i]?.toFixed(3) || 1})`,
              whiteSpace: letter === " " ? "pre" : undefined,
              color: blendStyle || colorStyle.color,
              transition: "color 0s",
            }}
          >
            {letter === " " ? "\u00A0" : letter}
          </span>
        );
      })}
    </span>
  );
}
