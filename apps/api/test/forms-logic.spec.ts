import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formConfigSchema, newFormItemId, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { loadEnv } from '../src/config/env';
import { formPendingSubmissions, forms, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { FormsService, sanitizeConfig } from '../src/forms/forms.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * v0.1.356 — La lógica del formulario en el servidor: reglas Y/O, saltos
 * entre páginas (lo de una página saltada no se pide ni se guarda),
 * pantallas finales y recordar respuestas en la confirmación por correo.
 */

class CapturingDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

class CapturingMailTransport implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
}

const IP = '203.0.113.21';

describe('v0.1.356 — lógica de formularios (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let files: FilesService;
    let mailbox: CapturingMailTransport;
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
    const allData = async (): Promise<Array<Record<string, unknown>>> =>
        (await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)))).map((r) => r.data as Record<string, unknown>);

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
        const env = loadEnv({ FILES_SIGNING_SECRET: 'form-logic-secret', APP_BASE_URL: 'https://app.test' });
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-formlogic-'))), env);
        mailbox = new CapturingMailTransport();
        svc = new FormsService(
            pg.db,
            tenantDb,
            lists,
            fieldsSvc,
            recs,
            files,
            redis as never,
            dispatcher,
            env,
            undefined,
            undefined,
            undefined,
            undefined,
            new MailService(env, mailbox),
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'logica', name: 'Lógica', settings: { format: { number_format: 'dot_comma' } } }).returning();
        tenantId = t!.id;
        listId = (await lists.create(tenantId, { name: 'Solicitudes' })).id;
        const mk = async (slug: string, label: string, type: string, config?: Record<string, unknown>): Promise<void> => {
            f[slug] = await fieldsSvc.create(tenantId, 'solicitudes', { label, type, slug, ...(config ? { config } : {}) } as never);
        };
        await mk('nombre', 'Nombre', 'text');
        await mk('correo', 'Correo', 'email');
        await mk('tipo', 'Tipo', 'select', { options: [{ value: 'persona', label: 'Persona' }, { value: 'empresa', label: 'Empresa' }] });
        await mk('edad', 'Edad', 'number');
        await mk('nit', 'NIT', 'text');
        await mk('empleados', 'Empleados', 'number');
        await mk('comentario', 'Comentario', 'long_text');
        // v0.1.357 — donde se guarda el puntaje (el formulario no lo pregunta).
        await mk('nota', 'Nota', 'number');
        await mk('notas_internas', 'Notas internas', 'text');
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        mailbox.sent.length = 0;
        await redis.flushall();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(formPendingSubmissions).where(eq(formPendingSubmissions.tenantId, tenantId));
            await tx.delete(forms).where(eq(forms.tenantId, tenantId));
            await tx.delete(records).where(eq(records.listId, listId));
        });
    });

    const ids = { nombre: 'qnombre1', correo: 'qcorreo1', tipo: 'qtipo001', edad: 'qedad001', p2: 'pempresa', nit: 'qnit0001', emp: 'qemp0001', p3: 'pfinal01', com: 'qcoment1' };

    /** Página 1: nombre, tipo, edad · Página 2: NIT y empleados (obligatorios) · Página 3: comentario. */
    async function threePages(settings: Record<string, unknown> = {}, extra: { correo?: boolean } = {}): Promise<{ id: number; token: string }> {
        const items = [
            { id: ids.nombre, type: 'field', field_id: f.nombre!.id },
            ...(extra.correo ? [{ id: ids.correo, type: 'field', field_id: f.correo!.id }] : []),
            { id: ids.tipo, type: 'field', field_id: f.tipo!.id, required: true },
            { id: ids.edad, type: 'field', field_id: f.edad!.id },
            { id: ids.p2, type: 'page_break', title: 'Tu empresa' },
            { id: ids.nit, type: 'field', field_id: f.nit!.id, required: true },
            { id: ids.emp, type: 'field', field_id: f.empleados!.id, required: true },
            { id: ids.p3, type: 'page_break', title: 'Algo más' },
            { id: ids.com, type: 'field', field_id: f.comentario!.id, label: '{{nombre|Hola}}, ¿algo más?' },
        ];
        const dto = await svc.create(tenantId, 0, 'solicitudes', { name: 'Solicitud', config: formConfigSchema.parse({ items, settings: { title: 'Solicitud', ...settings } }) });
        await svc.update(tenantId, 'solicitudes', dto.id, { enabled: true });
        return { id: dto.id, token: await tokenOf(dto.id) };
    }

    it('un salto se saltea la página de la empresa: no la exige y no guarda lo que había escrito', async () => {
        const { id, token } = await threePages({
            jumps: [{ id: 'jmp00001', from: 'start', when: { field_id: f.tipo!.id, op: 'eq', value: 'persona' }, to: ids.p3 }],
        });
        // «Persona»: los obligatorios de la empresa no se piden; el NIT viejo no se guarda.
        const res = await svc.submit(token, IP, {
            values: { [f.nombre!.id]: 'Ana', [f.tipo!.id]: 'persona', [f.nit!.id]: '900123', [f.comentario!.id]: 'Nada' },
            uploads: {},
            stamp: stamp(id),
        });
        expect(res).toMatchObject({ ok: true, ending_id: null });
        expect(await allData()).toEqual([{ [`f${f.nombre!.id}`]: 'Ana', [`f${f.tipo!.id}`]: 'persona', [`f${f.comentario!.id}`]: 'Nada' }]);
        // «Empresa» pasa por la página 2: los obligatorios se piden.
        await expect(
            svc.submit(token, IP, { values: { [f.tipo!.id]: 'empresa' }, uploads: {}, stamp: stamp(id) }),
        ).rejects.toMatchObject({ response: { data: { errors: { [ids.nit]: 'Esta pregunta es obligatoria.', [ids.emp]: 'Esta pregunta es obligatoria.' } } } });
    });

    it('varias condiciones: la pregunta se pide sólo si se cumplen todas', async () => {
        const items = [
            { id: ids.tipo, type: 'field', field_id: f.tipo!.id },
            { id: ids.edad, type: 'field', field_id: f.edad!.id },
            {
                id: ids.nit,
                type: 'field',
                field_id: f.nit!.id,
                required: true,
                show_if: {
                    match: 'all',
                    rules: [
                        { field_id: f.tipo!.id, op: 'eq', value: 'empresa' },
                        { field_id: f.edad!.id, op: 'gt', value: 17 },
                    ],
                },
            },
        ];
        const dto = await svc.create(tenantId, 0, 'solicitudes', { name: 'Y', config: formConfigSchema.parse({ items, settings: {} }) });
        await svc.update(tenantId, 'solicitudes', dto.id, { enabled: true });
        const token = await tokenOf(dto.id);
        // Empresa pero menor: el NIT no se pide ni se guarda.
        await svc.submit(token, IP, { values: { [f.tipo!.id]: 'empresa', [f.edad!.id]: 15, [f.nit!.id]: 'x' }, uploads: {}, stamp: stamp(dto.id) });
        expect((await allData())[0]).toEqual({ [`f${f.tipo!.id}`]: 'empresa', [`f${f.edad!.id}`]: 15 });
        await expect(
            svc.submit(token, IP, { values: { [f.tipo!.id]: 'empresa', [f.edad!.id]: 30 }, uploads: {}, stamp: stamp(dto.id) }),
        ).rejects.toMatchObject({ response: { data: { errors: { [ids.nit]: 'Esta pregunta es obligatoria.' } } } });
    });

    it('pantallas finales: un salto termina antes; si no, gana la primera condición; su dirección manda', async () => {
        const { id, token } = await threePages({
            redirect_url: 'https://acme.test/gracias',
            jumps: [{ id: 'jmp00001', from: 'start', when: { field_id: f.edad!.id, op: 'lt', value: 18 }, to: 'ending:menores1' }],
            endings: [
                { id: 'menores1', name: 'Menores', title: 'Lo sentimos', message: 'Es sólo para mayores.', when: null },
                { id: 'grandes1', title: 'Te llamamos', message: '', redirect_url: 'https://acme.test/grandes', when: { field_id: f.empleados!.id, op: 'gt', value: 50 } },
            ],
        });
        // Menor de edad: termina en la página 1, sin pedir lo de la empresa.
        const a = await svc.submit(token, IP, { values: { [f.tipo!.id]: 'empresa', [f.edad!.id]: 15 }, uploads: {}, stamp: stamp(id) });
        expect(a).toEqual({ ok: true, ending_id: 'menores1', redirect_url: null });
        // Empresa grande: su pantalla, con su dirección.
        const b = await svc.submit(token, IP, {
            values: { [f.tipo!.id]: 'empresa', [f.edad!.id]: 40, [f.nit!.id]: '900', [f.empleados!.id]: 120 },
            uploads: {},
            stamp: stamp(id),
        });
        expect(b).toEqual({ ok: true, ending_id: 'grandes1', redirect_url: 'https://acme.test/grandes' });
        // Ninguna: el «¡Gracias!» de siempre, con la dirección del formulario.
        const c = await svc.submit(token, IP, {
            values: { [f.tipo!.id]: 'empresa', [f.edad!.id]: 40, [f.nit!.id]: '900', [f.empleados!.id]: 5 },
            uploads: {},
            stamp: stamp(id),
        });
        expect(c).toEqual({ ok: true, ending_id: null, redirect_url: 'https://acme.test/gracias' });
        // La página pública recibe los saltos, las pantallas y lo que se recuerda.
        const meta = await svc.meta(token);
        expect(meta.jumps).toEqual([{ from: 'start', when: { field_id: f.edad!.id, op: 'lt', value: 18 }, to: 'ending:menores1' }]);
        expect(meta.endings?.map((e) => e.id)).toEqual(['menores1', 'grandes1']);
        expect(meta.recall).toEqual({ nombre: String(f.nombre!.id) });
    });

    it('sanitizeConfig: sólo saltos hacia adelante, a páginas y pantallas que existen; nunca saltarse el correo a confirmar', () => {
        const fields = [f.nombre!, f.correo!, f.tipo!, f.edad!, f.nit!, f.empleados!, f.comentario!].map((x) => ({ id: x.id, type: x.type, config: x.config }));
        const cfg = formConfigSchema.parse({
            items: [
                { id: ids.tipo, type: 'field', field_id: f.tipo!.id },
                { id: ids.p2, type: 'page_break' },
                { id: ids.correo, type: 'field', field_id: f.correo!.id },
                { id: ids.p3, type: 'page_break' },
                { id: ids.com, type: 'field', field_id: f.comentario!.id },
            ],
            settings: {
                respondent_email_field_id: f.correo!.id,
                confirm_email: true,
                endings: [{ id: 'fin00001', title: 'Fin', when: { field_id: 999999, op: 'is_empty' } }],
                jumps: [
                    { id: 'jok00001', from: ids.p2, when: null, to: ids.p3 },
                    { id: 'jback001', from: ids.p3, when: null, to: ids.p2 },
                    { id: 'jgone001', from: 'start', when: null, to: 'pnoexist' },
                    { id: 'jend0001', from: 'start', when: { field_id: f.tipo!.id, op: 'eq', value: 'persona' }, to: 'end' },
                    { id: 'jskip001', from: 'start', when: { field_id: f.tipo!.id, op: 'eq', value: 'empresa' }, to: ids.p3 },
                    { id: 'jlost001', from: 'start', when: { field_id: 999999, op: 'eq', value: 'x' }, to: 'ending:fin00001' },
                    { id: 'jnoend01', from: ids.p2, when: null, to: 'ending:nada0001' },
                ],
            },
        });
        const out = sanitizeConfig(cfg, fields);
        // Hacia atrás, a una página que no existe, a una pantalla que no existe,
        // con una condición sobre un campo borrado, o saltándose el correo: fuera.
        expect(out.settings.jumps.map((j) => j.id)).toEqual(['jok00001']);
        // La pantalla queda, pero sin la condición rota (sólo se llega por un salto).
        expect(out.settings.endings).toMatchObject([{ id: 'fin00001', when: null }]);
    });

    it('confirmación por correo: guarda la pantalla final y la página de confirmación recuerda las respuestas', async () => {
        const { id, token } = await threePages(
            {
                respondent_email_field_id: f.correo!.id,
                confirm_email: true,
                endings: [
                    {
                        id: 'grandes1',
                        title: 'Te llamamos',
                        message: 'Gracias {{nombre}}: con {{empleados}} personas, te llamamos hoy. ({{tipo}})',
                        when: { field_id: f.empleados!.id, op: 'gt', value: 50 },
                    },
                ],
            },
            { correo: true },
        );
        const res = await svc.submit(token, IP, {
            values: { [f.nombre!.id]: 'Ana', [f.correo!.id]: 'ana@acme.co', [f.tipo!.id]: 'empresa', [f.nit!.id]: '900', [f.empleados!.id]: 1500 },
            uploads: {},
            stamp: stamp(id),
        });
        expect(res).toMatchObject({ pending_confirmation: true });
        const [pend] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(formPendingSubmissions));
        expect(pend!.endingId).toBe('grandes1');
        const ctoken = /\/confirm\/([A-Za-z0-9_-]+)/.exec(mailbox.sent[0]!.text ?? '')![1]!;
        const out = await svc.confirm(ctoken);
        expect(out).toMatchObject({
            status: 'confirmed',
            // El número con los separadores de la empresa y la etiqueta de la opción (no su valor).
            message: 'Gracias Ana: con 1.500 personas, te llamamos hoy. (Empresa)',
        });
    });

    // ─────────────── v0.1.357 — cálculos y puntaje ───────────────

    const scoreCalc = (extra: Record<string, unknown> = {}) => ({
        id: 'calc0001',
        key: 'puntaje',
        name: 'Puntaje',
        start: 0,
        parts: [
            { field_id: f.tipo!.id, points: { empresa: 10, persona: 2 } },
            { field_id: f.empleados!.id, multiplier: 0.1 },
        ],
        save_field_id: f.nota!.id,
        ...extra,
    });

    it('puntaje: suma lo del camino, elige la pantalla final, se guarda en su campo y no viaja a la página', async () => {
        const { id, token } = await threePages({
            calcs: [scoreCalc()],
            endings: [{ id: 'alto0001', title: 'Sacaste {{puntaje}}', message: '', when: { calc: 'puntaje', op: 'gt', value: 50 } }],
        });
        const a = await svc.submit(token, IP, {
            values: { [f.tipo!.id]: 'empresa', [f.nit!.id]: '900', [f.empleados!.id]: 500 },
            uploads: {},
            stamp: stamp(id),
        });
        expect(a).toMatchObject({ ok: true, ending_id: 'alto0001', calcs: { puntaje: 60 } });
        expect((await allData())[0]![`f${f.nota!.id}`]).toBe(60);
        const b = await svc.submit(token, IP, {
            values: { [f.tipo!.id]: 'persona', [f.nit!.id]: '1', [f.empleados!.id]: 5 },
            uploads: {},
            stamp: stamp(id),
        });
        expect(b).toMatchObject({ ok: true, ending_id: null, calcs: { puntaje: 2.5 } });
        // Sólo se usa al final: lo que vale cada respuesta no queda escrito en la página.
        const meta = await svc.meta(token);
        expect(meta.calcs).toEqual([{ key: 'puntaje', name: 'Puntaje', start: 0, parts: null }]);
        expect(meta.recall).toEqual({ nombre: String(f.nombre!.id), puntaje: 'calc:puntaje' });
    });

    it('puntaje: un salto lo mira mientras se responde, así que la página recibe lo que vale cada respuesta', async () => {
        const { id, token } = await threePages({
            calcs: [scoreCalc({ save_field_id: null })],
            jumps: [{ id: 'jmp00001', from: 'start', when: { calc: 'puntaje', op: 'lt', value: 5 }, to: ids.p3 }],
        });
        const meta = await svc.meta(token);
        expect(meta.calcs?.[0]?.parts).toEqual([
            { key: String(f.tipo!.id), points: { empresa: 10, persona: 2 }, multiplier: null },
            { key: String(f.empleados!.id), points: {}, multiplier: 0.1 },
        ]);
        // «Persona» suma 2 (< 5): salta la página de la empresa; sus obligatorios no se piden.
        const res = await svc.submit(token, IP, { values: { [f.tipo!.id]: 'persona' }, uploads: {}, stamp: stamp(id) });
        expect(res).toMatchObject({ ok: true, calcs: { puntaje: 2 } });
        // «Empresa» suma 10: pasa por la página 2 y se le piden.
        await expect(svc.submit(token, IP, { values: { [f.tipo!.id]: 'empresa' }, uploads: {}, stamp: stamp(id) })).rejects.toMatchObject({
            response: { data: { errors: { [ids.nit]: 'Esta pregunta es obligatoria.' } } },
        });
    });

    it('sanitizeConfig: cálculos sin choques de nombre, sólo sobre preguntas del formulario y guardados en un campo numérico que no se pregunta', () => {
        const fields = [f.nombre!, f.tipo!, f.edad!, f.nit!, f.nota!, f.notas_internas!].map((x) => ({ id: x.id, type: x.type, slug: x.slug, config: x.config }));
        const cfg = formConfigSchema.parse({
            items: [
                { id: ids.tipo, type: 'field', field_id: f.tipo!.id },
                { id: ids.edad, type: 'field', field_id: f.edad!.id, show_if: { calc: 'puntaje', op: 'gt', value: 1 } },
                { id: ids.p2, type: 'page_break' },
                { id: ids.nit, type: 'field', field_id: f.nit!.id },
            ],
            settings: {
                calcs: [
                    {
                        id: 'calc0001',
                        key: 'puntaje',
                        parts: [
                            { field_id: f.tipo!.id, points: { empresa: 1 }, multiplier: 3 },
                            { field_id: f.edad!.id, multiplier: 2 },
                            { field_id: f.nombre!.id, points: { x: 1 } },
                        ],
                        save_field_id: f.edad!.id,
                    },
                    { id: 'calc0002', key: 'nombre', parts: [] },
                    { id: 'calc0003', key: 'puntaje', parts: [] },
                    { id: 'calc0004', key: 'total', parts: [], save_field_id: f.notas_internas!.id },
                    { id: 'calc0005', key: 'nivel', parts: [], save_field_id: f.nota!.id },
                ],
                jumps: [
                    { id: 'jok00001', from: 'start', when: { calc: 'puntaje', op: 'gt', value: 3 }, to: 'end' },
                    { id: 'jgone001', from: 'start', when: { calc: 'nombre', op: 'gt', value: 3 }, to: 'end' },
                ],
            },
        });
        const out = sanitizeConfig(cfg, fields);
        // El nombre de un campo y un nombre repetido no se pueden usar.
        expect(out.settings.calcs.map((c) => c.key)).toEqual(['puntaje', 'total', 'nivel']);
        const [p, t, n] = out.settings.calcs;
        // El factor sólo en respuestas numéricas; una pregunta que no está en el formulario no suma.
        expect(p!.parts).toEqual([
            { field_id: f.tipo!.id, points: { empresa: 1 }, multiplier: null },
            { field_id: f.edad!.id, points: {}, multiplier: 2 },
        ]);
        // No se guarda en una pregunta del formulario ni en un campo de texto; sí en uno numérico libre.
        expect(p!.save_field_id).toBeNull();
        expect(t!.save_field_id).toBeNull();
        expect(n!.save_field_id).toBe(f.nota!.id);
        // En «Mostrar sólo si…» no se mira un cálculo; un salto sobre un cálculo que no existe se va.
        expect(out.items.find((i) => i.id === ids.edad)!.show_if).toBeNull();
        expect(out.settings.jumps.map((j) => j.id)).toEqual(['jok00001']);
    });

    it('confirmación por correo: la página de confirmación muestra el puntaje', async () => {
        const { id, token } = await threePages(
            {
                respondent_email_field_id: f.correo!.id,
                confirm_email: true,
                calcs: [scoreCalc({ save_field_id: null })],
                success_message: '{{nombre}}, tu puntaje es {{puntaje}}.',
            },
            { correo: true },
        );
        await svc.submit(token, IP, {
            values: { [f.nombre!.id]: 'Ana', [f.correo!.id]: 'ana@acme.co', [f.tipo!.id]: 'empresa', [f.nit!.id]: '900', [f.empleados!.id]: 1500 },
            uploads: {},
            stamp: stamp(id),
        });
        const ctoken = /\/confirm\/([A-Za-z0-9_-]+)/.exec(mailbox.sent[0]!.text ?? '')![1]!;
        expect(await svc.confirm(ctoken)).toMatchObject({ status: 'confirmed', message: 'Ana, tu puntaje es 160.' });
    });

    it('bienvenida y una pregunta por pantalla llegan a la página', async () => {
        const { token } = await threePages({ layout: 'conversational', welcome: { enabled: true, title: 'Hola {{nombre|}}', message: 'Son tres pasos.', show_time: true } });
        const meta = await svc.meta(token);
        expect(meta.layout).toBe('conversational');
        expect(meta.welcome).toEqual({ title: 'Hola {{nombre|}}', message: 'Son tres pasos.', button_label: 'Empezar', image_url: null, minutes: 1 });
    });
});

/** Un id corto para los ítems de los tests. */
void newFormItemId;
