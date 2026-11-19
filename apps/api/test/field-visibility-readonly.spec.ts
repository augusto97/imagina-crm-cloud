import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { bulkOperationSchema, type BulkOperationInput, type CreateFieldInput, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { fields, lists, memberships, records, teamMembers, teams, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ImportService } from '../src/import/import.service';
import { readonlyFieldIdsFor } from '../src/lists/list-acl';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { BulkEditService } from '../src/records/bulk-edit.service';
import { BulkHistoryService } from '../src/records/bulk-history.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * v0.1.457 — A7 «Mostrar sólo si…» y C4 campos de sólo lectura por rol,
 * persona y equipo, contra Postgres real: lo que decide el SERVIDOR (no la
 * interfaz).
 */
const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };
const agent: Actor = { userId: 2, role: 'agent' };
const otherAgent: Actor = { userId: 3, role: 'agent' };
/** Lo que corre el sistema (automatizaciones, sincronizaciones). */
const system: Actor = { userId: 0, role: 'admin' };

async function rejectsWith(p: Promise<unknown>, status: 400 | 403, code: string): Promise<Record<string, unknown>> {
    try {
        await p;
    } catch (err) {
        expect(err).toBeInstanceOf(status === 400 ? BadRequestException : ForbiddenException);
        const body = (err as BadRequestException).getResponse() as Record<string, unknown>;
        expect(body.code).toBe(code);
        return body;
    }
    throw new Error(`Se esperaba ${status} ${code}`);
}

describe('v0.1.457 — campos condicionales y de sólo lectura (Postgres real)', () => {
    let pg: TestPg;
    let lists_: ListsService;
    let fields_: FieldsService;
    let recs: RecordsService;
    let bulk: BulkEditService;
    let importer: ImportService;
    let tenantId: number;
    let teamA: number;
    let teamB: number;
    let f: Record<string, Field>;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        lists_ = new ListsService(tenantDb, new ListsRepository(), rt);
        fields_ = new FieldsService(tenantDb, new FieldsRepository(), lists_, rt);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists_,
            fields_,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists_),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        bulk = new BulkEditService(recs, rt, new BulkHistoryService(tenantDb, lists_, recs, rt, new AuditService(tenantDb)));
        const plans = new PlansService(pg.db);
        importer = new ImportService(
            tenantDb,
            lists_,
            fields_,
            new RecordsRepository(),
            new BillingService(
                tenantDb,
                plans,
                new EmailQuotaService(pg.db, plans),
                new TenantSmtpService(pg.db, loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' })),
            ),
            rt,
        );
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME', plan: 'enterprise' }).returning();
        tenantId = t!.id;
        for (const a of [admin, agent, otherAgent]) {
            const [u] = await pg.db.insert(users).values({ email: `u${a.userId}@acme.test`, name: `U${a.userId}`, passwordHash: 'x' }).returning();
            expect(u!.id).toBe(a.userId);
            await pg.db.insert(memberships).values({ tenantId, userId: u!.id, role: a.role });
        }
        const [ta] = await pg.db.insert(teams).values({ tenantId, name: 'Ventas' }).returning();
        const [tb] = await pg.db.insert(teams).values({ tenantId, name: 'Soporte' }).returning();
        teamA = ta!.id;
        teamB = tb!.id;
        await pg.db.insert(teamMembers).values([
            { tenantId, teamId: teamA, userId: otherAgent.userId },
            { tenantId, teamId: teamB, userId: otherAgent.userId },
        ]);
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await lists_.create(tenantId, { name: 'Clientes' });
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            {
                label: 'Tipo de cliente',
                type: 'select',
                slug: 'tipo',
                config: {
                    options: [
                        { value: 'empresa', label: 'Empresa' },
                        { value: 'persona', label: 'Persona' },
                    ],
                },
            },
            { label: 'Monto', type: 'currency', slug: 'monto' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: {
                    options: [
                        { value: 'nuevo', label: 'Nuevo' },
                        { value: 'ganado', label: 'Ganado' },
                    ],
                    default_value: { kind: 'value', value: 'nuevo' },
                },
            },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fields_.create(tenantId, 'clientes', d);
        f.nit = await fields_.create(tenantId, 'clientes', {
            label: 'NIT',
            type: 'text',
            slug: 'nit',
            is_required: true,
            config: { show_if: { logic: 'and', conditions: [{ field_id: f.tipo!.id, op: 'eq', value: 'empresa' }] } },
        });
    });

    const key = (s: string) => `f${f[s]!.id}`;
    const ops = (list: BulkOperationInput[]) => list.map((o) => bulkOperationSchema.parse(o));
    const agentCanEdit = { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [] } as const;

    describe('A7 — Mostrar sólo si…', () => {
        it('un obligatorio oculto por su condición no se exige; visible, sí', async () => {
            const persona = await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'Ana', [key('tipo')]: 'persona' } });
            expect(persona.data[key('nit')]).toBeUndefined();
            const body = await rejectsWith(
                recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'Acme', [key('tipo')]: 'empresa' } }),
                400,
                'validation_failed',
            );
            expect((body.data as { errors: Record<string, string> }).errors.nit).toBe('Este campo es obligatorio.');
            // Sin tipo (la condición no se cumple) tampoco se pide.
            await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'Sin tipo' } });

            // Edición: vaciar el NIT de una persona vale; de una empresa, no.
            const empresa = await recs.create(tenantId, admin, 'clientes', {
                data: { [key('nombre')]: 'Globex', [key('tipo')]: 'empresa', [key('nit')]: '900123456' },
            });
            await rejectsWith(recs.update(tenantId, admin, 'clientes', empresa.id, { data: { [key('nit')]: null } }), 400, 'validation_failed');
            // Pasarla a persona Y vaciar el NIT en el mismo cambio: la condición se evalúa con lo nuevo.
            const now = await recs.update(tenantId, admin, 'clientes', empresa.id, { data: { [key('tipo')]: 'persona', [key('nit')]: null } });
            expect(now.data[key('nit')] ?? null).toBeNull();
        });

        it('el valor guardado se conserva aunque la condición deje de cumplirse', async () => {
            const r = await recs.create(tenantId, admin, 'clientes', {
                data: { [key('nombre')]: 'Initech', [key('tipo')]: 'empresa', [key('nit')]: '800111222' },
            });
            const after = await recs.update(tenantId, admin, 'clientes', r.id, { data: { [key('tipo')]: 'persona' } });
            expect(after.data[key('nit')]).toBe('800111222');
        });

        it('«obligatorio si…» no se exige en un campo oculto por su condición', async () => {
            const razon = await fields_.create(tenantId, 'clientes', {
                label: 'Razón social',
                type: 'text',
                slug: 'razon',
                config: {
                    show_if: { logic: 'and', conditions: [{ field_id: f.tipo!.id, op: 'eq', value: 'empresa' }] },
                    validation: { required_if: { field_id: f.monto!.id, op: 'not_empty' } },
                },
            });
            // Hay monto (la regla pediría la razón social), pero es una persona: no aplica.
            await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'Ana', [key('tipo')]: 'persona', [key('monto')]: 10 } });
            const body = await rejectsWith(
                recs.create(tenantId, admin, 'clientes', {
                    data: { [key('nombre')]: 'Acme', [key('tipo')]: 'empresa', [key('nit')]: '900', [key('monto')]: 10 },
                }),
                400,
                'validation_failed',
            );
            expect(Object.keys((body.data as { errors: Record<string, string> }).errors)).toContain(razon.slug);
        });

        it('en cascada: lo que depende de un campo oculto también se oculta', async () => {
            await fields_.create(tenantId, 'clientes', {
                label: 'Dígito de verificación',
                type: 'text',
                slug: 'dv',
                is_required: true,
                config: { show_if: { logic: 'and', conditions: [{ field_id: f.nit!.id, op: 'is_not_null' }] } },
            });
            // Persona con un NIT viejo guardado: el NIT no se ve, así que el DV tampoco se pide.
            await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'Ana', [key('tipo')]: 'persona', [key('nit')]: '123' } });
        });

        it('rechaza los ciclos y lo que no es una condición válida', async () => {
            const body = await rejectsWith(
                fields_.update(tenantId, 'clientes', String(f.tipo!.id), {
                    config: {
                        options: [
                            { value: 'empresa', label: 'Empresa' },
                            { value: 'persona', label: 'Persona' },
                        ],
                        show_if: { logic: 'and', conditions: [{ field_id: f.nit!.id, op: 'is_not_null' }] },
                    },
                }),
                400,
                'show_if_cycle',
            );
            expect(String(body.message)).toContain('«NIT»');
            // De sí mismo, de otra lista o con un operador que no aplica: 400.
            await expect(
                fields_.update(tenantId, 'clientes', String(f.monto!.id), {
                    config: { show_if: { logic: 'and', conditions: [{ field_id: f.monto!.id, op: 'gt', value: 1 }] } },
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
            await expect(
                fields_.update(tenantId, 'clientes', String(f.monto!.id), {
                    config: { show_if: { logic: 'and', conditions: [{ field_id: 999999, op: 'is_not_null' }] } },
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('si el campo de la condición va a la papelera, la condición deja de aplicar (y la regla se conserva)', async () => {
            await fields_.remove(tenantId, 'clientes', String(f.tipo!.id));
            // El NIT ahora se muestra siempre: vuelve a ser obligatorio.
            await rejectsWith(recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'Sin tipo' } }), 400, 'validation_failed');
            await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'Con NIT', [key('nit')]: '900' } });
            // La regla sigue guardada (vuelve a aplicar si se recupera el campo)…
            const nit = (await fields_.listByListId(tenantId, f.nit!.list_id)).find((x) => x.id === f.nit!.id)!;
            expect((nit.config as { show_if?: { conditions: Array<{ field_id: number }> } }).show_if?.conditions[0]!.field_id).toBe(f.tipo!.id);
            // …y re-guardar el campo con esa regla no falla.
            await fields_.update(tenantId, 'clientes', String(f.nit!.id), { label: 'NIT o cédula', config: nit.config });
        });
    });

    describe('C4 — campos de sólo lectura', () => {
        it('por rol: alta, edición, edición masiva, importación y pegar', async () => {
            await lists_.updatePermissions(tenantId, 'clientes', {
                permissions: { agent: { ...agentCanEdit, fields_hidden: [], readonly_field_ids: [f.monto!.id, f.estado!.id] } },
            });
            const list = await lists_.get(tenantId, 'clientes');
            expect([...readonlyFieldIdsFor(list.settings, agent)].sort()).toEqual([f.monto!.id, f.estado!.id].sort());
            expect(readonlyFieldIdsFor(list.settings, admin).size).toBe(0);

            // Alta: no puede poner el monto; sin ponerlo, vale el valor por defecto (estado = nuevo).
            const body = await rejectsWith(
                recs.create(tenantId, agent, 'clientes', { data: { [key('nombre')]: 'X', [key('tipo')]: 'persona', [key('monto')]: 500 } }),
                403,
                'field_readonly',
            );
            expect(String(body.message)).toContain('«Monto»');
            const mine = await recs.create(tenantId, agent, 'clientes', {
                // El alta del navegador siembra el valor por defecto: mandarlo tal cual no es elegirlo.
                data: { [key('nombre')]: 'Mío', [key('tipo')]: 'persona', [key('estado')]: 'nuevo' },
            });
            expect(mine.data[key('estado')]).toBe('nuevo');
            await rejectsWith(
                recs.create(tenantId, agent, 'clientes', { data: { [key('nombre')]: 'Y', [key('tipo')]: 'persona', [key('estado')]: 'ganado' } }),
                403,
                'field_readonly',
            );

            // Edición: otro valor → 403; el MISMO valor (formulario que reenvía todo) → pasa.
            const r = await recs.create(tenantId, admin, 'clientes', {
                data: { [key('nombre')]: 'Acme', [key('tipo')]: 'persona', [key('monto')]: 100 },
            });
            await rejectsWith(recs.update(tenantId, agent, 'clientes', r.id, { data: { [key('monto')]: 200 } }), 403, 'field_readonly');
            const same = await recs.update(tenantId, agent, 'clientes', r.id, { data: { [key('monto')]: 100, [key('nombre')]: 'Acme SA' } });
            expect(same.data[key('nombre')]).toBe('Acme SA');
            expect(same.data[key('monto')]).toBe(100);

            // Edición masiva: la operación sobre el campo se rechaza con el motivo.
            await expect(bulk.preview(tenantId, agent, 'clientes', { ids: [r.id] }, ops([{ op: 'set', field_id: f.monto!.id, value: 9 }]))).rejects.toThrow(
                /no te deja cambiarlo/,
            );
            await expect(bulk.apply(tenantId, agent, 'clientes', [r.id], ops([{ op: 'set', field_id: f.monto!.id, value: 9 }]))).rejects.toThrow(
                /no te deja cambiarlo/,
            );
            const nameOk = await bulk.apply(tenantId, agent, 'clientes', [r.id], ops([{ op: 'set', field_id: f.nombre!.id, value: 'Acme Corp' }]));
            expect(nameOk.succeeded).toHaveLength(1);

            // Importación: la columna se ignora con aviso; el resto entra.
            const imp = await importer.importRows(tenantId, agent, 'clientes', {
                mapping: { Nombre: f.nombre!.id, Tipo: f.tipo!.id, Importe: f.monto!.id },
                rows: [{ Nombre: 'Importado', Tipo: 'persona', Importe: '777' }],
            });
            expect(imp.imported).toBe(1);
            expect(imp.errors.map((e) => e.message).join(' ')).toContain('«Importe» apunta a «Monto»');
            const imported = (await recs.list(tenantId, admin, 'clientes', { limit: 50, sort_dir: 'asc' })).data.find(
                (x) => x.data[key('nombre')] === 'Importado',
            )!;
            expect(imported.data[key('monto')]).toBeUndefined();

            // Pegar (varias celdas): la del monto falla con el motivo, la del nombre se guarda.
            const paste = await recs.batchUpdate(tenantId, agent, 'clientes', [{ id: r.id, data: { [key('monto')]: 5, [key('nombre')]: 'Pegado' } }]);
            expect(paste.updated.map((u) => u.data[key('nombre')])).toEqual(['Pegado']);
            expect(paste.cell_errors).toEqual([
                { id: r.id, key: key('monto'), message: 'Puedes ver «Monto», pero tu acceso a esta lista no te deja cambiarlo.' },
            ]);
        });

        it('el admin y el sistema (automatizaciones, sincronizaciones) no se ven afectados', async () => {
            await lists_.updatePermissions(tenantId, 'clientes', {
                permissions: { agent: { ...agentCanEdit, fields_hidden: [], readonly_field_ids: [f.monto!.id] } },
            });
            const r = await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'A', [key('tipo')]: 'persona', [key('monto')]: 1 } });
            const byAdmin = await recs.update(tenantId, admin, 'clientes', r.id, { data: { [key('monto')]: 2 } });
            expect(byAdmin.data[key('monto')]).toBe(2);
            const bySystem = await recs.update(tenantId, system, 'clientes', r.id, { data: { [key('monto')]: 3 } });
            expect(bySystem.data[key('monto')]).toBe(3);
            const viaBulk = await bulk.apply(tenantId, system, 'clientes', [r.id], ops([{ op: 'add', field_id: f.monto!.id, amount: 1 }]));
            expect(viaBulk.succeeded).toHaveLength(1);
        });

        it('por persona: pisa al rol (para más o para menos)', async () => {
            await lists_.updatePermissions(tenantId, 'clientes', {
                permissions: { agent: { ...agentCanEdit, fields_hidden: [], readonly_field_ids: [f.monto!.id] } },
                // El agente 2 tiene su propio acceso: el monto sí lo cambia, el nombre no.
                users: { [String(agent.userId)]: { ...agentCanEdit, fields_hidden: [], readonly_field_ids: [f.nombre!.id] } },
            });
            const r = await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'A', [key('tipo')]: 'persona', [key('monto')]: 1 } });
            const ok = await recs.update(tenantId, agent, 'clientes', r.id, { data: { [key('monto')]: 5 } });
            expect(ok.data[key('monto')]).toBe(5);
            await rejectsWith(recs.update(tenantId, agent, 'clientes', r.id, { data: { [key('nombre')]: 'B' } }), 403, 'field_readonly');
            // El otro agente sigue con la regla de su rol.
            await rejectsWith(recs.update(tenantId, otherAgent, 'clientes', r.id, { data: { [key('monto')]: 6 } }), 403, 'field_readonly');
        });

        it('por equipo: con varios equipos, sólo lectura si TODOS lo marcan', async () => {
            const inTeams: Actor = { ...otherAgent, teamIds: [teamA, teamB] };
            await lists_.updatePermissions(tenantId, 'clientes', {
                teams: {
                    [String(teamA)]: { ...agentCanEdit, fields_hidden: [], readonly_field_ids: [f.monto!.id, f.nombre!.id] },
                    [String(teamB)]: { ...agentCanEdit, fields_hidden: [], readonly_field_ids: [f.monto!.id] },
                },
            });
            const list = await lists_.get(tenantId, 'clientes');
            expect([...readonlyFieldIdsFor(list.settings, inTeams)]).toEqual([f.monto!.id]);
            const r = await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'A', [key('tipo')]: 'persona', [key('monto')]: 1 } });
            await rejectsWith(recs.update(tenantId, inTeams, 'clientes', r.id, { data: { [key('monto')]: 2 } }), 403, 'field_readonly');
            const ok = await recs.update(tenantId, inTeams, 'clientes', r.id, { data: { [key('nombre')]: 'B' } });
            expect(ok.data[key('nombre')]).toBe('B');
            // Sólo en el equipo A: el nombre también es de sólo lectura.
            const onlyA: Actor = { ...otherAgent, teamIds: [teamA] };
            await rejectsWith(recs.update(tenantId, onlyA, 'clientes', r.id, { data: { [key('nombre')]: 'C' } }), 403, 'field_readonly');
        });

        it('guardar permisos descarta ids de campos que no son de la lista', async () => {
            await lists_.updatePermissions(tenantId, 'clientes', {
                permissions: { agent: { ...agentCanEdit, fields_hidden: [], readonly_field_ids: [f.monto!.id, 987654] } },
            });
            const list = await lists_.get(tenantId, 'clientes');
            expect([...readonlyFieldIdsFor(list.settings, agent)]).toEqual([f.monto!.id]);
        });
    });
});
