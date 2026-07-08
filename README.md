# Imagina Base

SaaS multi-tenant para construir **bases de datos flexibles**: listas
dinámicas, registros, vistas (tabla/Kanban/calendario/cards), dashboards y
automatizaciones — tipo Airtable / ClickUp / Notion-databases. NO es un CRM;
un CRM es apenas una de las plantillas que un cliente puede armar (ADR-S10).
Evolución del plugin WordPress `imagina-crm`.

> El repositorio en GitHub conserva el nombre histórico `imagina-crm-cloud`.
> El producto se llama **Imagina Base** y los packages usan el scope
> `@imagina-base/*`.

## Documentos clave (leer en este orden)

1. `CLAUDE.md` — reglas de trabajo y tracker de fases.
2. `STANDALONE.md` — arquitectura completa y ADRs.
3. `HANDOFF.md` — lecciones aprendidas del plugin (errores ya pagados).
4. `CONTRACT.md` — especificación funcional exacta a replicar.

## Estructura

- `apps/api/` — `@imagina-base/api`: backend NestJS (Fastify) + Drizzle.
- `apps/web/` — `@imagina-base/web`: frontend React heredado del plugin
  (se adapta en F1).
- `packages/shared/` — `@imagina-base/shared`: schemas Zod + tipos compartidos
  front↔back.
- `reference/plugin-backend/` — PHP del plugin, SOLO LECTURA (consulta de
  comportamiento exacto).
- `docker/` — Docker Compose (Postgres 16 + Redis 7).

## Desarrollo local

```bash
pnpm install
pnpm infra:up          # Postgres 16 + Redis 7 vía Docker Compose
pnpm db:migrate        # aplica migraciones (incluye RLS + rol imagina_app)
pnpm --filter @imagina-base/api dev    # backend en :3001

# Shell cloud (SPA propio, sin WordPress) — proxya /api al backend:
pnpm --filter @imagina-base/web dev:cloud   # → http://localhost:5174/cloud/index.html
```

Variables de entorno: copiar `.env.example` a `.env` (defaults de dev listos
para el compose incluido).

## Estado

- **F0 — Fundaciones**: ✅ monorepo, CI, Docker, esqueleto NestJS+Drizzle,
  auth por sesión, tenancy+RLS, primeros schemas Zod.
- **F1 — Core dominio**: 🚧 en curso (lists/fields/records/views/slugs,
  QueryBuilder JSONB, bootstrap, front conectado).

Detalle y fases siguientes en `CLAUDE.md §5`.
