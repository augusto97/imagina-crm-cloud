import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { formConfigSchema, newFormItemId, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { loadEnv } from '../src/config/env';
import { forms, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { FormsService, sanitizeConfig } from '../src/forms/forms.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * v0.1.355 — Tipos de pregunta nuevos en el servidor: el envío se revisa con
 * las MISMAS preguntas públicas que ve el visitante (escala, deslizador,
 * «Sí / No», ordenar, «Otro», matriz y firma).
 */

class CapturingDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

const IP = '203.0.113.9';

describe('v0.1.355 — tipos de pregunta (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let files: FilesService;
    let svc: FormsService;
    let tenantId: number;
    let listId: number;
    const f: Record<string, Field> = {};

    const stamp = (formId: number): string => {
        const ts = Date.now() - 10_000;
        return `${ts}.${files.signParts('formstamp', formId, ts)}`;
    };
    const tokenOf = async (formId: number): Promise<string> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms).where(eq(forms.id, formId)));
        return row!.token;
    };
    /** Lo que guardó el último envío (sin la casilla, que la lista pone en «no» por defecto). */
    const lastData = async (): Promise<Record<string, unknown>> => {
        const rows = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
        const data = { ...((rows[rows.length - 1]?.data ?? {}) as Record<string, unknown>) };
        if (data[`f${f.acepta!.id}`] === false && !askedAcepta) delete data[`f${f.acepta!.id}`];
        return data;
    };
    let askedAcepta = false;

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const dispatcher = new CapturingDispatcher();
        const recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            dispatcher,
            new RelationsRepository(),
        );
        const env = loadEnv({ FILES_SIGNING_SECRET: 'form-q-secret' });
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-formq-'))), env);
        svc = new FormsService(pg.db, tenantDb, lists, fieldsSvc, recs, files, redis as never, dispatcher, env);

        const [t] = await pg.db.insert(tenants).values({ slug: 'encuestas', name: 'Encuestas' }).returning();
        tenantId = t!.id;
        listId = (await lists.create(tenantId, { name: 'Respuestas' })).id;
        const mk = async (slug: string, label: string, type: string, config?: Record<string, unknown>): Promise<void> => {
            f[slug] = await fieldsSvc.create(tenantId, 'respuestas', { label, type, slug, ...(config ? { config } : {}) } as never);
        };
        await mk('nps', 'Recomendación', 'number', { min: 0, max: 10 });
        await mk('presupuesto', 'Presupuesto', 'currency', { min: 0, max: 5_000_000 });
        await mk('acepta', '¿Acepta?', 'checkbox');
        await mk('canal', 'Canal', 'select', { options: [{ value: 'web', label: 'Web' }, { value: 'otro', label: 'Otro' }] });
        await mk('canal_otro', 'Canal (otro)', 'text');
        await mk('prioridades', 'Prioridades', 'long_text');
        await mk('temas', 'Temas', 'multi_select', { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }] });
        await mk('atencion', 'Atención', 'select', { options: [{ value: 'malo', label: 'Malo' }, { value: 'bueno', label: 'Bueno' }] });
        await mk('precio', 'Precio', 'select', { options: [{ value: 'malo', label: 'Malo' }, { value: 'bueno', label: 'Bueno' }] });
        await mk('firma', 'Firma', 'file');
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        askedAcepta = false;
        await redis.flushall();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(forms).where(eq(forms.tenantId, tenantId));
            await tx.delete(records).where(eq(records.listId, listId));
        });
    });

    async function survey(items: unknown[]): Promise<{ id: number; token: string }> {
        const dto = await svc.create(tenantId, 0, 'respuestas', { name: 'Encuesta', config: formConfigSchema.parse({ items, settings: { title: 'Encuesta' } }) });
        await svc.update(tenantId, 'respuestas', dto.id, { enabled: true });
        return { id: dto.id, token: await tokenOf(dto.id) };
    }

    it('escala, deslizador y «Sí / No»: guarda lo elegido y rechaza lo que la página no mostró', async () => {
        askedAcepta = true;
        const ids = { nps: newFormItemId(), pres: newFormItemId(), acepta: newFormItemId() };
        const { id, token } = await survey([
            { id: ids.nps, type: 'field', field_id: f.nps!.id, display: 'scale', range: { min: 0, max: 10 }, required: true },
            { id: ids.pres, type: 'field', field_id: f.presupuesto!.id, display: 'slider', range: { min: 0, max: 1_000_000, step: 50_000 } },
            { id: ids.acepta, type: 'field', field_id: f.acepta!.id, display: 'yes_no', required: true },
        ]);
        // Fuera de la escala, del deslizador y sin responder el «Sí / No».
        await expect(
            svc.submit(token, IP, { values: { [f.nps!.id]: 11, [f.presupuesto!.id]: 2_000_000 }, uploads: {}, stamp: stamp(id) }),
        ).rejects.toMatchObject({
            response: {
                data: {
                    errors: {
                        [ids.nps]: 'Elige uno de los valores de la escala.',
                        [ids.pres]: 'Ese valor está fuera del rango.',
                        [ids.acepta]: 'Esta pregunta es obligatoria.',
                    },
                },
            },
        });
        // «No» es una respuesta válida para una obligatoria.
        await svc.submit(token, IP, { values: { [f.nps!.id]: 9, [f.presupuesto!.id]: '350000', [f.acepta!.id]: false }, uploads: {}, stamp: stamp(id) });
        expect(await lastData()).toEqual({ [`f${f.nps!.id}`]: 9, [`f${f.presupuesto!.id}`]: 350000, [`f${f.acepta!.id}`]: false });
    });

    it('ordenar: en un texto queda «1. … · 2. …»; en varias opciones, el orden; sin todas, error', async () => {
        const ids = { prio: newFormItemId(), temas: newFormItemId() };
        const { id, token } = await survey([
            { id: ids.prio, type: 'field', field_id: f.prioridades!.id, display: 'ranking', ranking_options: ['Precio', 'Calidad', 'Atención'] },
            { id: ids.temas, type: 'field', field_id: f.temas!.id, display: 'ranking' },
        ]);
        await expect(
            svc.submit(token, IP, { values: { [f.prioridades!.id]: ['Precio', 'Calidad'], [f.temas!.id]: ['a', 'a', 'b'] }, uploads: {}, stamp: stamp(id) }),
        ).rejects.toMatchObject({ response: { data: { errors: { [ids.prio]: 'Ordena todas las opciones.', [ids.temas]: 'Ordena todas las opciones.' } } } });
        await svc.submit(token, IP, {
            values: { [f.prioridades!.id]: ['Calidad', 'Atención', 'Precio'], [f.temas!.id]: ['c', 'a', 'b'] },
            uploads: {},
            stamp: stamp(id),
        });
        const data = await lastData();
        expect(data[`f${f.prioridades!.id}`]).toBe('1. Calidad\n2. Atención\n3. Precio');
        expect(data[`f${f.temas!.id}`]).toEqual(['c', 'a', 'b']);
    });

    it('«Otro»: lo escrito va a su campo sólo si eligió esa opción; vacío, se pide', async () => {
        const item = newFormItemId();
        const { id, token } = await survey([{ id: item, type: 'field', field_id: f.canal!.id, other_option: 'otro', other_field_id: f.canal_otro!.id }]);
        await expect(svc.submit(token, IP, { values: { [f.canal!.id]: 'otro', [f.canal_otro!.id]: '  ' }, uploads: {}, stamp: stamp(id) })).rejects.toMatchObject({
            response: { data: { errors: { [item]: 'Escribe cuál.' } } },
        });
        await svc.submit(token, IP, { values: { [f.canal!.id]: 'otro', [f.canal_otro!.id]: ' Una feria ' }, uploads: {}, stamp: stamp(id) });
        expect(await lastData()).toEqual({ [`f${f.canal!.id}`]: 'otro', [`f${f.canal_otro!.id}`]: 'Una feria' });
        // Eligió «Web»: lo que haya en el texto del «Otro» no se guarda.
        await svc.submit(token, IP, { values: { [f.canal!.id]: 'web', [f.canal_otro!.id]: 'colado' }, uploads: {}, stamp: stamp(id) });
        expect(await lastData()).toEqual({ [`f${f.canal!.id}`]: 'web' });
    });

    it('matriz: una respuesta por fila, sólo las columnas que se mostraron; obligatoria = todas las filas', async () => {
        const m = newFormItemId();
        const { id, token } = await survey([
            {
                id: m,
                type: 'matrix',
                label: '¿Cómo nos fue?',
                required: true,
                rows: [{ field_id: f.atencion!.id }, { field_id: f.precio!.id }],
                columns: [
                    { value: 'Malo', label: 'Malo' },
                    { value: 'Bueno', label: 'Bueno' },
                ],
            },
        ]);
        const meta = await svc.meta(token);
        const matrix = meta.items.find((i) => i.type === 'matrix');
        expect(matrix && matrix.type === 'matrix' && matrix.rows.map((r) => r.values)).toEqual([
            ['malo', 'bueno'],
            ['malo', 'bueno'],
        ]);
        await expect(svc.submit(token, IP, { values: { [f.atencion!.id]: 'bueno' }, uploads: {}, stamp: stamp(id) })).rejects.toMatchObject({
            response: { data: { errors: { [m]: 'Responde todas las filas.' } } },
        });
        await expect(
            svc.submit(token, IP, { values: { [f.atencion!.id]: 'bueno', [f.precio!.id]: 'excelente' }, uploads: {}, stamp: stamp(id) }),
        ).rejects.toMatchObject({ response: { data: { errors: { [m]: 'Precio: esa respuesta no está en la tabla.' } } } });
        await svc.submit(token, IP, { values: { [f.atencion!.id]: 'bueno', [f.precio!.id]: 'malo' }, uploads: {}, stamp: stamp(id) });
        expect(await lastData()).toEqual({ [`f${f.atencion!.id}`]: 'bueno', [`f${f.precio!.id}`]: 'malo' });
    });

    it('firma: la pregunta sólo recibe imágenes y queda como archivo del registro', async () => {
        const item = newFormItemId();
        const { id, token } = await survey([{ id: item, type: 'field', field_id: f.firma!.id, display: 'signature', accept: 'any', required: true }]);
        const field = String(f.firma!.id);
        const file = (name: string, mimetype: string) => ({ filename: name, mimetype, file: Readable.from([Buffer.from('\x89PNG\r\n\x1a\nfirma')]) });
        await expect(svc.upload(token, IP, { stamp: stamp(id), field }, file('contrato.pdf', 'application/pdf'))).rejects.toMatchObject({
            response: { code: 'file_type_not_allowed' },
        });
        const up = await svc.upload(token, IP, { stamp: stamp(id), field }, file('firma.png', 'image/png'));
        await expect(svc.submit(token, IP, { values: {}, uploads: {}, stamp: stamp(id) })).rejects.toMatchObject({
            response: { data: { errors: { [item]: 'Esta pregunta es obligatoria.' } } },
        });
        await svc.submit(token, IP, { values: {}, uploads: { [field]: [up.token] }, stamp: stamp(id) });
        const data = await lastData();
        expect(Array.isArray(data[`f${f.firma!.id}`]) && (data[`f${f.firma!.id}`] as unknown[]).length).toBe(1);
    });

    it('sanitizeConfig: un campo se usa una vez (pregunta, fila o «Otro») y la forma tiene que ser del tipo', () => {
        const fields = Object.values(f).map((x) => ({ id: x.id, type: x.type, config: x.config as Record<string, unknown> }));
        const clean = sanitizeConfig(
            formConfigSchema.parse({
                items: [
                    { id: 'qqqq1', type: 'field', field_id: f.canal!.id, other_option: 'otro', other_field_id: f.canal_otro!.id },
                    // El texto del «Otro» preguntado aparte: gana la pregunta, el «Otro» se apaga.
                    { id: 'qqqq2', type: 'field', field_id: f.canal_otro!.id, display: 'signature' },
                    { id: 'qqqq3', type: 'matrix', rows: [{ field_id: f.atencion!.id }, { field_id: f.canal_otro!.id }, { field_id: f.atencion!.id }], columns: [{ value: 'Malo' }, { value: 'Malo' }, { value: 'Bueno' }] },
                    // La fila ya se preguntó en la matriz: esta pregunta sobra.
                    { id: 'qqqq4', type: 'field', field_id: f.atencion!.id },
                ],
                settings: {},
            }),
            fields,
        );
        const [canal, otroTexto, matrix] = clean.items;
        expect(clean.items).toHaveLength(3);
        expect(canal!.type === 'field' && canal!.other_field_id).toBeNull();
        expect(otroTexto!.type === 'field' && otroTexto!.display).toBe('auto');
        expect(matrix!.type === 'matrix' && matrix!.rows.map((r) => r.field_id)).toEqual([f.atencion!.id]);
        expect(matrix!.type === 'matrix' && matrix!.columns.map((c) => c.value)).toEqual(['Malo', 'Bueno']);
    });
});
