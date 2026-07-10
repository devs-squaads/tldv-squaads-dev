# spec/ — Spec Driven Development (tldv-squaads)

> Desarrollo dirigido por especificación (SDD): primero se escribe la spec, luego el plan, luego las
> tareas, y solo entonces se toca el código. Esta carpeta es la fuente de verdad **versionada y
> tool-agnóstica** del proyecto: sirve igual con cualquier CLI o editor.

## Estructura

```
spec/
├── constitution/            ← reglas estables del proyecto (cambian poco)
│   ├── mission.md           ← qué construimos y para quién
│   ├── tech-stack.md        ← tecnologías, convenciones y límites (LA LEY)
│   └── roadmap.md           ← orden y estado de las features
└── features/                ← una carpeta por feature
    ├── NNN-nombre-feature/  ← plantilla a copiar (placeholders <…>)
    │   ├── spec.md          ← qué hace + criterios de aceptación
    │   ├── plan.md          ← cómo se implementa
    │   └── tasks.md         ← checklist de tareas
    └── 001-extension-rollout/  ← ejemplo real (pendientes de Fase 8)
```

## Flujo para una feature nueva

1. Copiar `features/NNN-nombre-feature/` con el siguiente número libre (`002`, `003`, …) y nombre claro.
2. Escribir `spec.md`: qué hace, por qué y criterios de aceptación medibles.
3. Escribir `plan.md`: enfoque técnico y decisiones, respetando `constitution/tech-stack.md`.
4. Desglosar en `tasks.md` y marcar el progreso.
5. Implementar y validar con los comandos del proyecto:
   `bun run typecheck` · `bun test apps/__tests__` · `bun run lint` · `bun run build:web`.
6. Actualizar `constitution/roadmap.md` (mover la feature a "Hecho").

> La constitución manda: si una feature choca con `mission.md` o `tech-stack.md`, se replantea la
> feature, no la constitución. El cerebro operativo para agentes/devs es `../AGENTS.md`.
