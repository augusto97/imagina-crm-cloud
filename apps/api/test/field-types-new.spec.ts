import { jsonbKeyForField, type CreateFieldInput, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fields, lists, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RelationsRepository } from '../src/records/relations.repository';
import { ActivityService } from '../src/activity/activity.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * v0.1.158 — los cuatro tipos de campo que faltaban. Lo que importa probar
 * de verdad no es que se guarden (eso lo cubre el validador compartido),
 * sino que el MOTOR los trate como lo que son: `phone` es texto buscable y
 * `rating`/`percent`/`duration` son NÚMEROS (si el QueryBuilder los tratara
 * como texto, '9' saldría mayor que '10' y el filtro mentiría en silencio).
 */
const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };

describe('Tipos de campo nuevos: phone / rating / percent / duration', () => {
    let pg: TestPg;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let service: RecordsService;
    let tenantId: number;
    /** slug → clave JSONB `f{id}`: el service escribe/lee por ID (regla nº 1). */
    let k: Record<string, string>;
    /** slug → field id (los filtros y el sort viajan por ID, no por slug). */
    let id: Record<string, number>;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        service = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
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
        await listsService.create(tenantId, { name: 'Clientes' });
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Teléfono', type: 'phone', slug: 'telefono', config: { default_country: 'CO' } },
            { label: 'Satisfacción', type: 'rating', slug: 'satisfaccion', config: { max: 5 } },
            { label: 'Avance', type: 'percent', slug: 'avance' },
            { label: 'Tiempo', type: 'duration', slug: 'tiempo' },
        ];
        k = {};
        id = {};
        for (const d of defs) {
            const f: Field = await fieldsService.create(tenantId, 'clientes', d);
            k[f.slug] = jsonbKeyForField(f.id);
            id[f.slug] = f.id;
        }
    });

    it('el teléfono se guarda canónico aunque se escriba local o con puntuación', async () => {
        const a = await service.create(tenantId, admin, 'clientes', {
            data: { [k.nombre!]: 'Ana', [k.telefono!]: '300 111 2233' },
        });
        const b = await service.create(tenantId, admin, 'clientes', {
            data: { [k.nombre!]: 'Beto', [k.telefono!]: '+1 (202) 555-1234' },
        });
        expect(a.data[k.telefono!]).toBe('+573001112233');
        expect(b.data[k.telefono!]).toBe('+12025551234');
    });

    it('la búsqueda de la lista encuentra por teléfono (el caso de un CRM)', async () => {
        await service.create(tenantId, admin, 'clientes', {
            data: { [k.nombre!]: 'Ana', [k.telefono!]: '300 111 2233' },
        });
        await service.create(tenantId, admin, 'clientes', {
            data: { [k.nombre!]: 'Beto', [k.telefono!]: '+1 2025551234' },
        });
        const found = await service.list(tenantId, admin, 'clientes', { search: '1112233' });
        expect(found.data.map((r) => r.data[k.nombre!])).toEqual(['Ana']);
    });

    it('rating/percent/duration filtran y ordenan como NÚMEROS, no como texto', async () => {
        await service.create(tenantId, admin, 'clientes', {
            data: { [k.nombre!]: 'Nueve', [k.satisfaccion!]: 2, [k.avance!]: 9, [k.tiempo!]: '1h 30m' },
        });
        await service.create(tenantId, admin, 'clientes', {
            data: { [k.nombre!]: 'Diez', [k.satisfaccion!]: 5, [k.avance!]: 10, [k.tiempo!]: '45m' },
        });

        // La duración se guardó en minutos, no como el texto que se escribió.
        const all = await service.list(tenantId, admin, 'clientes', {});
        const tiempos = Object.fromEntries(
            all.data.map((r) => [r.data[k.nombre!], r.data[k.tiempo!]]),
        );
        expect(tiempos).toEqual({ Nueve: 90, Diez: 45 });

        // '9' > '10' en texto: si el filtro fuera textual, esto devolvería Nueve.
        const gt = await service.list(tenantId, admin, 'clientes', {
            filter_tree: {
                type: 'group',
                logic: 'and',
                children: [{ type: 'condition', field_id: id.avance!, op: 'gt', value: 9 }],
            } as never,
        });
        expect(gt.data.map((r) => r.data[k.nombre!])).toEqual(['Diez']);

        const bySat = await service.list(tenantId, admin, 'clientes', { sort: `field_${id.satisfaccion!}:desc` });
        expect(bySat.data.map((r) => r.data[k.nombre!])).toEqual(['Diez', 'Nueve']);
    });

    it('rechaza lo que no corresponde al tipo, con el mensaje del campo', async () => {
        await expect(
            service.create(tenantId, admin, 'clientes', { data: { [k.nombre!]: 'X', [k.satisfaccion!]: 9 } }),
        ).rejects.toThrow();
        await expect(
            service.create(tenantId, admin, 'clientes', { data: { [k.nombre!]: 'X', [k.avance!]: 140 } }),
        ).rejects.toThrow();
        await expect(
            service.create(tenantId, admin, 'clientes', { data: { [k.nombre!]: 'X', [k.telefono!]: 'no es un teléfono' } }),
        ).rejects.toThrow();
    });

    it('convertir teléfono/duración a texto escribe lo que la persona LEÍA', async () => {
        const rec = await service.create(tenantId, admin, 'clientes', {
            data: { [k.nombre!]: 'Ana', [k.telefono!]: '300 111 2233', [k.tiempo!]: 90 },
        });
        await fieldsService.update(tenantId, 'clientes', 'telefono', { type: 'text' });
        await fieldsService.update(tenantId, 'clientes', 'tiempo', { type: 'text' });

        const after = await service.get(tenantId, admin, 'clientes', rec.id);
        expect(after.data[k.telefono!]).toBe('+57 300 111 2233');
        expect(after.data[k.tiempo!]).toBe('1h 30m');
    });
});
