# Imagina CRM Cloud

SaaS multi-tenant de listas dinámicas, registros y automatizaciones.
Evolución del plugin WordPress `imagina-crm`.

## Documentos clave (leer en este orden)

1. `CLAUDE.md` — reglas de trabajo y tracker de fases.
2. `STANDALONE.md` — arquitectura completa y ADRs.
3. `HANDOFF.md` — lecciones aprendidas del plugin (errores ya pagados).
4. `CONTRACT.md` — especificación funcional exacta a replicar.

## Estructura

- `apps/web/` — frontend React heredado del plugin (se adapta en F1).
- `reference/plugin-backend/` — PHP del plugin, SOLO LECTURA (consulta
  de comportamiento exacto).
- `apps/api/`, `packages/shared/` — se crean en la fase F0.

## Primera sesión de Claude Code

> Lee CLAUDE.md, STANDALONE.md, HANDOFF.md y CONTRACT.md completos.
> Después arranca la fase F0 del roadmap: monorepo pnpm+Turborepo,
> esqueleto NestJS+Drizzle, Docker Compose (Postgres 16 + Redis 7),
> tenancy con RLS funcionando y el package shared/ con los primeros
> schemas Zod. Marca F0 en el CLAUDE.md cuando termines.
