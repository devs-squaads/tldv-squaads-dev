# Skills del proyecto — índice

Fuente única de skills de tldv-squaads. Versionadas en git con rutas **relativas** (portables, sin datos
de máquina). El manifiesto reproducible (origen + hash de cada skill) está en `../../skills-lock.json`.

## Protocolo de carga (importante)

**No cargues las skills todas a la vez.** El flujo es:

1. Mirá la columna **"Cuándo usarla"** y matcheala contra la tarea actual y los archivos que vas a tocar.
2. Cargá **solo** la(s) `SKILL.md` cuyo trigger coincide.
3. Si ninguna matchea, seguí sin inyectar skill del proyecto.

Cada `SKILL.md` es la fuente de verdad: leé el archivo completo, no resúmenes.

## Índice

| Skill | Cuándo usarla | Ruta |
|---|---|---|
| `accessibility` | Accesibilidad web / WCAG 2.2: a11y audit, screen readers, navegación por teclado, "hacer accesible". | [`./accessibility/SKILL.md`](./accessibility/SKILL.md) |
| `bash-defensive-patterns` | Scripts shell robustos: entrypoints, CI/CD, utilidades de sistema con tolerancia a fallos. | [`./bash-defensive-patterns/SKILL.md`](./bash-defensive-patterns/SKILL.md) |
| `bun` | Tooling Bun: correr scripts, dependencias, bundling, tests con la herramienta unificada. | [`./bun/SKILL.md`](./bun/SKILL.md) |
| `chrome-extension-development` | Extensión Chrome (Manifest V3): seguridad, performance, buenas prácticas. | [`./chrome-extension-development/SKILL.md`](./chrome-extension-development/SKILL.md) |
| `composition-patterns` | Patrones de composición React: compound components, render props, context, refactor de props booleanas. | [`./composition-patterns/SKILL.md`](./composition-patterns/SKILL.md) |
| `drizzle` | Drizzle ORM: schema, queries type-safe, migraciones. | [`./drizzle/SKILL.md`](./drizzle/SKILL.md) |
| `frontend-design` | Construir UI distintiva y pulida: componentes, páginas, landings, dashboards; estilar/mejorar una UI. | [`./frontend-design/SKILL.md`](./frontend-design/SKILL.md) |
| `next-best-practices` | Next.js: file conventions, RSC, data patterns, async APIs, metadata, route handlers, optimización. | [`./next-best-practices/SKILL.md`](./next-best-practices/SKILL.md) |
| `next-cache-components` | Next.js 16 Cache Components: PPR, `use cache`, `cacheLife`, `cacheTag`, `updateTag`. | [`./next-cache-components/SKILL.md`](./next-cache-components/SKILL.md) |
| `next-upgrade` | Actualizar Next.js a la última versión (guías de migración + codemods). | [`./next-upgrade/SKILL.md`](./next-upgrade/SKILL.md) |
| `react-best-practices` | Performance React/Next: escribir, revisar o refactorizar componentes, data fetching, bundle. | [`./react-best-practices/SKILL.md`](./react-best-practices/SKILL.md) |
| `seo` | SEO: meta tags, structured data, sitemap, visibilidad en buscadores. | [`./seo/SKILL.md`](./seo/SKILL.md) |
| `tailwind-css-patterns` | Tailwind: utilidades, responsive, flexbox/grid, spacing, tipografía, design systems. | [`./tailwind-css-patterns/SKILL.md`](./tailwind-css-patterns/SKILL.md) |
| `typescript-advanced-types` | Tipos avanzados TS: generics, conditional/mapped types, template literals, utility types. | [`./typescript-advanced-types/SKILL.md`](./typescript-advanced-types/SKILL.md) |

> Para regenerar/sincronizar estas skills desde sus fuentes upstream, ver `../../skills-lock.json` (lockfile
> de autoskills). Este índice se mantiene en paralelo a las carpetas; si agregás o quitás una skill, actualizá
> la tabla.
