# Imagina CRM Cloud — Instrucciones de trabajo

> Este es el documento de trabajo del repositorio `imagina-crm-cloud`
> (la app SaaS). Leélo SIEMPRE antes de cualquier tarea, junto con:
>
> - **`STANDALONE.md`** — la arquitectura completa y los ADRs. Es la fuente
>   de verdad de TODAS las decisiones técnicas. No contradecirlo sin
>   proponer un ADR nuevo.
> - **`HANDOFF.md`** — lecciones aprendidas durante el desarrollo del plugin
>   WordPress hermano (bugs reales que costaron días). Evitan repetir
>   errores ya pagados.
> - **`CONTRACT.md`** — especificación funcional exacta heredada del plugin:
>   operadores de filtros, reglas de slugs, capabilities, tipos de campo,
>   shapes de vistas/automatizaciones/portal. Ante dudas más finas:
>   `reference/plugin-backend/` (el PHP original, solo lectura).

---

## 1. Qué es este proyecto

Imagina CRM Cloud: SaaS multi-tenant de gestión de listas dinámicas,
registros, vistas y automatizaciones (tipo ClickUp/Airtable). Evolución del
plugin WordPress `imagina-crm` — comparte el diseño de dominio y el frontend
React, pero con backend propio.

**Origen del frontend**: el directorio `apps/web/` es un fork del `app/` del
plugin. Todo el trabajo de UX ya invertido ahí (editor de plantillas,
dashboards, Kanban, tabla, portal) se conserva y evoluciona acá.

## 2. Stack (resumen — detalle en STANDALONE.md)

- **Backend**: Node 22 + TypeScript estricto + NestJS (Fastify) + Drizzle ORM.
- **DB**: PostgreSQL 16. Datos dinámicos en JSONB con claves `"f{field_id}"`
  inmutables. RLS activo en toda tabla con `tenant_id`.
- **Cache/colas**: Redis 7 + BullMQ.
- **Validación**: Zod en `packages/shared/` — LOS MISMOS schemas para front
  y back. Nunca definir un shape dos veces.
- **Frontend**: React 18 + TanStack Query/Table + Zustand + shadcn/Tailwind.
- **Monorepo**: pnpm workspaces + Turborepo (`apps/api`, `apps/web`,
  `packages/shared`).

## 3. Reglas de oro (no negociables)

1. **El slug es etiqueta humana editable; el ID es la verdad.** Claves JSONB
   por `f{field_id}`, referencias internas por ID, slug solo entrada/salida.
   (Herencia directa del plugin — ADR-008 / ADR-S02.)
2. **Todo shape pasa por `packages/shared/`** (Zod). El backend valida con el
   mismo schema que tipa al frontend.
3. **`tenant_id` + RLS en toda tabla de datos.** Toda query corre dentro de
   una transacción con `SET LOCAL app.tenant_id`.
4. **QueryBuilder con whitelist estricta**: slug → field → expresión JSONB
   tipada. Jamás interpolar input del usuario en SQL.
5. **Presupuestos de performance como contrato** (STANDALONE.md §13). Si una
   feature los toca, el PR incluye benchmark.
6. **Monolito modular.** Prohibido proponer microservicios (ADR-S05).
7. **Un solo identificador canónico en queryKeys de TanStack**: el ID
   numérico. El slug se resuelve ANTES de armar la key. (Lección cara del
   plugin — ver HANDOFF.md §2.)
8. **Batch endpoints por diseño**: si una vista necesita N recursos, se crea
   un endpoint bundle. N+1 y waterfalls prohibidos.
9. **Los datos del cliente nunca se secuestran** (ADR-S09): impago =
   solo-lectura + export.

## 4. Estándares de código

### TypeScript (back y front)
- `strict: true`, `noUncheckedIndexedAccess: true`. No `any` salvo justificado.
- Backend: módulos NestJS por dominio (`lists/`, `fields/`, `records/`,
  `views/`, `automations/`, `tenancy/`, `auth/`, `billing/`). Controller
  delgado → Service → Repository (Drizzle). Nunca lógica en controllers.
- Frontend: mismas convenciones que el plugin (`PascalCase.tsx`,
  `useCamelCase.ts`, un componente por archivo, TanStack Query para server
  state).

### Commits
- Conventional commits. `feat(records): ...`, `fix(tenancy): ...`.

### Tests
- Backend: Vitest + Testcontainers (Postgres real, no mocks de DB) ≥ 70% en
  services. Los tests de RLS son obligatorios para toda tabla nueva.
- Frontend: Vitest ≥ 60% en hooks/lógica.
- Benchmarks de los contratos §13 en CI contra seed de 100k records.

## 5. Estado de fases (actualizar al avanzar)

- [ ] **F0 — Fundaciones**: monorepo, CI, Docker, esqueleto NestJS+Drizzle,
      auth básica, tenancy+RLS, primeros schemas en shared/.
- [ ] **F1 — Core dominio**: lists/fields/records/views/slugs, QueryBuilder
      JSONB, endpoint bootstrap, front conectado.
- [ ] **F2 — Vistas + realtime**: Kanban/Cards/Calendar, dashboards,
      comments/activity, invalidación push.
- [ ] **F3 — Automatizaciones + portal**: motor BullMQ, editor visual,
      portal cliente, editor de plantillas.
- [ ] **F4 — Comercial**: Stripe, onboarding, límites por plan, panel admin.
- [ ] **F5 — Hardening**: backups+restore drill, monitoreo, benchmarks, beta.

## 6. Cómo trabajar con Claude Code en este repo

1. Leer este archivo + `STANDALONE.md` + `HANDOFF.md` antes de cualquier tarea.
2. Antes de implementar algo no cubierto por STANDALONE.md: proponerlo y
   actualizar el documento (ADR nuevo si es decisión de arquitectura).
3. Cada feature: schema Zod en shared → migración Drizzle (si aplica) →
   service+repo con tests → endpoint → frontend. En ese orden.
4. Marcar las fases del §5 al completarlas.
