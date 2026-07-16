"use client";

import { useRef, useEffect, useCallback } from "react";
import { scheduleNextAnimationFrame } from "./animationLoop";

interface VenomBeamProps {
  children: React.ReactNode;
  className?: string;
  color?: string;
  beamCount?: number;
  particleCount?: number;
}

interface Beam {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  width: number;
  life: number;
  decay: number;
  angle: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  decay: number;
}

export default function VenomBeam({
  children,
  className = "",
  color = "#00F2FF",
  beamCount = 5,
  particleCount = 40,
}: VenomBeamProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const animateRef = useRef<(() => void) | null>(null);
  const beams = useRef<Beam[]>([]);
  const particles = useRef<Particle[]>([]);
  const time = useRef(0);

  const hexToRgb = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  };

  const spawnBeam = useCallback((w: number, h: number): Beam => {
    const edge = Math.floor(Math.random() * 4);
    let x: number, y: number, angle: number;

    switch (edge) {
      case 0: x = Math.random() * w; y = -20; angle = Math.PI * 0.3 + Math.random() * Math.PI * 0.4; break;
      case 1: x = w + 20; y = Math.random() * h; angle = Math.PI * 0.6 + Math.random() * Math.PI * 0.4; break;
      case 2: x = Math.random() * w; y = h + 20; angle = -Math.PI * 0.3 - Math.random() * Math.PI * 0.4; break;
      default: x = -20; y = Math.random() * h; angle = -Math.PI * 0.2 + Math.random() * Math.PI * 0.4; break;
    }

    const speed = 0.8 + Math.random() * 1.2;
    return {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      length: 80 + Math.random() * 180,
      width: 1 + Math.random() * 2,
      life: 1,
      decay: 0.002 + Math.random() * 0.003,
      angle,
    };
  }, []);

  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    time.current += 0.01;

    ctx.clearRect(0, 0, w, h);
    const rgb = hexToRgb(color);

    // Spawn beams
    while (beams.current.length < beamCount) {
      beams.current.push(spawnBeam(w, h));
    }

    // Spawn ambient particles
    if (particles.current.length < particleCount && Math.random() < 0.15) {
      particles.current.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: 0.5 + Math.random() * 1.5,
        life: 1,
        decay: 0.005 + Math.random() * 0.008,
      });
    }

    // Draw beams
    beams.current = beams.current.filter((b) => {
      b.x += b.vx;
      b.y += b.vy;
      b.life -= b.decay;
      if (b.life <= 0) return false;

      const alpha = b.life * 0.25;
      const tailX = b.x - Math.cos(b.angle) * b.length;
      const tailY = b.y - Math.sin(b.angle) * b.length;

      // Beam gradient
      const grad = ctx.createLinearGradient(tailX, tailY, b.x, b.y);
      grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
      grad.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha * 0.6})`);
      grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`);

      ctx.beginPath();
      ctx.strokeStyle = grad;
      ctx.lineWidth = b.width;
      ctx.lineCap = "round";
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      // Glow
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha * 0.15})`;
      ctx.lineWidth = b.width * 6;
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      // Spawn trail particles
      if (Math.random() < 0.3 && particles.current.length < particleCount) {
        particles.current.push({
          x: b.x + (Math.random() - 0.5) * 4,
          y: b.y + (Math.random() - 0.5) * 4,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          size: 0.5 + Math.random() * 1.2,
          life: 0.6 + Math.random() * 0.4,
          decay: 0.015 + Math.random() * 0.01,
        });
      }

      return true;
    });

    // Draw particles
    particles.current = particles.current.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) return false;

      const alpha = p.life * 0.6;

      // Outer glow
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha * 0.08})`;
      ctx.fill();

      // Core
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
      ctx.fill();

      return true;
    });

    animRef.current = scheduleNextAnimationFrame(requestAnimationFrame, () => animateRef.current ?? (() => {}));
  }, [color, beamCount, particleCount, spawnBeam]);

  useEffect(() => {
    animateRef.current = animate;
  }, [animate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener("resize", resize);
    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [animate]);

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none z-0"
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
