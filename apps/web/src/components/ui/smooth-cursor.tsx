"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { scheduleNextAnimationFrame } from "./animationLoop";

interface Position {
  x: number;
  y: number;
}

const DESKTOP_POINTER_QUERY = "(any-hover: hover) and (any-pointer: fine)";

export function SmoothCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const currentPos = useRef<Position>({ x: -100, y: -100 });
  const targetPos = useRef<Position>({ x: -100, y: -100 });
  const velocity = useRef<Position>({ x: 0, y: 0 });
  const lastPos = useRef<Position>({ x: 0, y: 0 });
  const lastTime = useRef(0);
  const currentRotation = useRef(0);
  const targetRotation = useRef(0);
  const currentScale = useRef(1);
  const targetScale = useRef(1);
  const rafId = useRef(0);
  const animateRef = useRef<(() => void) | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const animate = useCallback(() => {
    // Smooth lerp for position
    const lerpFactor = 0.15;
    currentPos.current.x += (targetPos.current.x - currentPos.current.x) * lerpFactor;
    currentPos.current.y += (targetPos.current.y - currentPos.current.y) * lerpFactor;

    // Smooth lerp for rotation
    const rotLerp = 0.12;
    let rotDiff = targetRotation.current - currentRotation.current;
    if (rotDiff > 180) rotDiff -= 360;
    if (rotDiff < -180) rotDiff += 360;
    currentRotation.current += rotDiff * rotLerp;

    // Smooth lerp for scale
    currentScale.current += (targetScale.current - currentScale.current) * 0.2;

    if (cursorRef.current) {
      cursorRef.current.style.transform = `translate(${currentPos.current.x}px, ${currentPos.current.y}px) rotate(${currentRotation.current}deg) scale(${currentScale.current})`;
    }

    rafId.current = scheduleNextAnimationFrame(requestAnimationFrame, () => animateRef.current ?? (() => {}));
  }, []);

  useEffect(() => {
    animateRef.current = animate;
  }, [animate]);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_POINTER_QUERY);
    const update = () => {
      setIsEnabled(mq.matches);
      if (!mq.matches) setIsVisible(false);
    };
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isEnabled) return;

    let scaleTimeout: ReturnType<typeof setTimeout> | null = null;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      setIsVisible(true);

      const now = Date.now();
      if (lastTime.current === 0) lastTime.current = now;
      const dt = now - lastTime.current;

      if (dt > 0) {
        velocity.current.x = (e.clientX - lastPos.current.x) / dt;
        velocity.current.y = (e.clientY - lastPos.current.y) / dt;
      }

      lastTime.current = now;
      lastPos.current = { x: e.clientX, y: e.clientY };

      targetPos.current = { x: e.clientX, y: e.clientY };

      const speed = Math.sqrt(velocity.current.x ** 2 + velocity.current.y ** 2);

      if (speed > 0.1) {
        const angle = Math.atan2(velocity.current.y, velocity.current.x) * (180 / Math.PI) + 90;
        targetRotation.current = angle;
        targetScale.current = 0.92;

        if (scaleTimeout) clearTimeout(scaleTimeout);
        scaleTimeout = setTimeout(() => {
          targetScale.current = 1;
        }, 150);
      }
    };

    const onLeave = () => setIsVisible(false);
    const onEnter = () => setIsVisible(true);

    document.body.style.cursor = "none";
    // Also hide cursor on all interactive elements
    const style = document.createElement("style");
    style.id = "smooth-cursor-hide";
    style.textContent = "*, *::before, *::after { cursor: none !important; }";
    document.head.appendChild(style);

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("pointerenter", onEnter);

    rafId.current = requestAnimationFrame(animate);

    return () => {
      document.body.style.cursor = "auto";
      const s = document.getElementById("smooth-cursor-hide");
      if (s) s.remove();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("pointerenter", onEnter);
      cancelAnimationFrame(rafId.current);
      if (scaleTimeout) clearTimeout(scaleTimeout);
    };
  }, [isEnabled, animate]);

  if (!isEnabled) return null;

  return (
    <div
      ref={cursorRef}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        zIndex: 9999,
        pointerEvents: "none",
        willChange: "transform",
        opacity: isVisible ? 1 : 0,
        transition: "opacity 0.15s ease",
        marginLeft: "-11px",
        marginTop: "-11px",
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={22}
        height={24}
        viewBox="0 0 50 54"
        fill="none"
      >
        <g filter="url(#sc_glow)">
          <path
            d="M42.6817 41.1495L27.5103 6.79925C26.7269 5.02557 24.2082 5.02558 23.3927 6.79925L7.59814 41.1495C6.75833 42.9759 8.52712 44.8902 10.4125 44.1954L24.3757 39.0496C24.8829 38.8627 25.4385 38.8627 25.9422 39.0496L39.8121 44.1954C41.6849 44.8902 43.4884 42.9759 42.6817 41.1495Z"
            fill="#00F2FF"
          />
          <path
            d="M43.7146 40.6933L28.5431 6.34306C27.3556 3.65428 23.5772 3.69516 22.3668 6.32755L6.57226 40.6778C5.3134 43.4156 7.97238 46.298 10.803 45.2549L24.7662 40.109C25.0221 40.0147 25.2999 40.0156 25.5494 40.1082L39.4193 45.254C42.2261 46.2953 44.9254 43.4347 43.7146 40.6933Z"
            stroke="rgba(0, 242, 255, 0.5)"
            strokeWidth={2.25}
          />
        </g>
        <defs>
          <filter
            id="sc_glow"
            x={0}
            y={0}
            width={50}
            height={54}
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feFlood floodOpacity={0} result="bg" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
            <feOffset dy={2} />
            <feGaussianBlur stdDeviation={3} />
            <feComposite in2="hardAlpha" operator="out" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0.95 0 0 0 0 1 0 0 0 0.4 0"
            />
            <feBlend mode="normal" in2="bg" result="glow" />
            <feBlend mode="normal" in="SourceGraphic" in2="glow" result="shape" />
          </filter>
        </defs>
      </svg>
    </div>
  );
}
