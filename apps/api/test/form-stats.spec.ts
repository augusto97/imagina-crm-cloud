import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formConfigSchema, zonedToday, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { loadEnv } from '../src/config/env';
import { formDrafts, formStats, forms, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { FormStatsService } from '../src/forms/form-stats.service';
import { FormsService } from '../src/forms/forms.service';
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

/** Los frenos usan ventanas fijas de un minuto: una prueba que cruza el cambio de minuto vería dos ventanas. */
async function awayFromMinuteEdge(): Promise<void> {
    const left = 60_000 - (Date.now() % 60_000);
    if (left < 5_000) await new Promise((r) => setTimeout(r, left + 100));
}

/**
 * v0.1.358 — Estadísticas de los formularios (eventos → Redis → form_stats)
 * y «Guardar y seguir después» (form_drafts + correo con el enlace).
 */

class NoopDispatcher extends AutomationDispatcher {
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

const IP = '203.0.113.58';
const TZ = 'America/Bogota';

describe('v0.1.358 — estadísticas y avances guardados (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let files: FilesService;
    let mailbox: CapturingMailTransport;
    let stats: FormStatsService;
    let svc: FormsService;
    let tenantId: number;
    let otherTenant: number;
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

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const dispatcher = new NoopDispatcher();
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
        const env = loadEnv({ FILES_SIGNING_SECRET: 'form-stats-secret', APP_BASE_URL: 'https://app.test' });
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-formstats-'))), env);
        mailbox = new CapturingMailTransport();
        stats = new FormStatsService(tenantDb, redis as never);
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
            undefined,
            undefined,
            undefined,
            undefined,
            stats,
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'medir', name: 'Medir', settings: { format: { timezone: TZ } } }).returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra-medir', name: 'Otra' }).returning();
        otherTenant = o!.id;
        listId = (await lists.create(tenantId, { name: 'Contactos' })).id;
        const mk = async (slug: string, label: string, type: string, config?: Record<string, unknown>): Promise<void> => {
            f[slug] = await fieldsSvc.create(tenantId, 'contactos', { label, type, slug, ...(config ? { config } : {}) } as never);
        };
        await mk('nombre', 'Nombre', 'text');
        await mk('correo', 'Correo', 'email');
        await mk('archivo', 'Archivo', 'file');
        await mk('mensaje', 'Mensaje', 'long_text');
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        mailbox.sent.length = 0;
        await redis.flushall();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(formDrafts).where(eq(formDrafts.tenantId, tenantId));
            await tx.delete(formStats).where(eq(formStats.tenantId, tenantId));
            await tx.delete(forms).where(eq(forms.tenantId, tenantId));
            await tx.delete(records).where(eq(records.listId, listId));
        });
    });

    async function contactForm(settings: Record<string, unknown> = {}): Promise<{ id: number; token: string }> {
        const items = [
            { id: 'qnombre1', type: 'field', field_id: f.nombre!.id },
            { id: 'qcorreo1', type: 'field', field_id: f.correo!.id },
            { id: 'qarchiv1', type: 'field', field_id: f.archivo!.id },
            { id: 'qmensaj1', type: 'field', field_id: f.mensaje!.id },
        ];
        const dto = await svc.create(tenantId, 0, 'contactos', { name: 'Contacto', config: formConfigSchema.parse({ items, settings: { title: 'Contacto', ...settings } }) });
        await svc.update(tenantId, 'contactos', dto.id, { enabled: true });
        return { id: dto.id, token: await tokenOf(dto.id) };
    }

    it('los eventos suman en Redis, el resumen los ve al instante y el volcado los pasa a la base sin contarlos dos veces', async () => {
        const { id, token } = await contactForm();
        await svc.recordEvents(token, IP, {
            events: [
                { kind: 'view', src: 'h:google.com', dev: 'mobile' },
                { kind: 'start' },
                { kind: 'step', step: 1 },
            ],
        });
        await svc.recordEvents(token, '203.0.113.59', { events: [{ kind: 'view', dev: 'desktop' }, { kind: 'leave', item: 'qcorreo1' }] });
        await svc.submit(token, IP, { values: { [f.nombre!.id]: 'Ana' }, uploads: {}, stamp: stamp(id), elapsed_ms: 42_000 });

        // Antes de volcar: lo vivo de Redis.
        let out = await svc.statsFor(tenantId, 'contactos', id, 30);
        expect(out.totals).toMatchObject({ views: 2, starts: 1, submits: 1, avg_seconds: 42, completion_rate: 1, start_rate: 0.5 });
        expect(out.sources).toEqual([
            { key: 'd', count: 1 },
            { key: 'h:google.com', count: 1 },
        ]);
        expect(out.devices).toEqual({ mobile: 1, tablet: 0, desktop: 1 });
        expect(out.leaves).toEqual([{ item: 'qcorreo1', count: 1 }]);
        expect(out.days).toHaveLength(30);
        expect(out.days.at(-1)).toEqual({ day: zonedToday(TZ), views: 2, starts: 1, submits: 1 });
        expect(out.all_time_submits).toBe(1);

        // Volcado: el hash se vacía y la base suma lo mismo.
        expect(await stats.flush()).toBe(1);
        expect(await redis.exists(`fst:${tenantId}:${id}:${zonedToday(TZ)}`)).toBe(0);
        out = await svc.statsFor(tenantId, 'contactos', id, 30);
        expect(out.totals).toMatchObject({ views: 2, starts: 1, submits: 1 });

        // Más eventos después y otro volcado: se SUMAN a lo de la base.
        await svc.recordEvents(token, IP, { events: [{ kind: 'view', src: 'h:google.com', dev: 'mobile' }] });
        await stats.flush();
        const rows = await stats.rawDays(tenantId, id);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.counts).toMatchObject({ v: 3, 'src:h:google.com': 2, s: 1, sub: 1, tsum: 42, tn: 1 });

        // RLS: otra empresa no ve estas filas.
        expect(await withTenant(pg.db, otherTenant, (tx) => tx.select().from(formStats))).toEqual([]);
    });

    it('dos volcados del mismo día a la vez suman (no se pisan)', async () => {
        const { id } = await contactForm();
        const day = zonedToday(TZ);
        const k = `fst:${tenantId}:${id}:${day}`;
        await redis.hset(k, { v: '3' });
        await redis.sadd('fst:dirty', k);
        await stats.flush();
        await redis.hset(k, { v: '4', s: '1' });
        await redis.sadd('fst:dirty', k);
        await Promise.all([stats.flush(), stats.flush()]);
        const rows = await stats.rawDays(tenantId, id);
        expect(rows[0]!.counts).toEqual({ v: 7, s: 1 });
    });

    it('un token desconocido no cuenta nada; demasiados lotes de una IP se ignoran; los orígenes de más van a «Otros»', async () => {
        const { id, token } = await contactForm();
        await svc.recordEvents('A'.repeat(24), IP, { events: [{ kind: 'view' }] });
        expect(await redis.scard('fst:dirty')).toBe(0);

        await awayFromMinuteEdge();
        for (let i = 0; i < 65; i++) await svc.recordEvents(token, '198.51.100.7', { events: [{ kind: 'start' }] });
        let out = await svc.statsFor(tenantId, 'contactos', id, 7);
        expect(out.totals.starts).toBe(60);

        for (let i = 0; i < 420; i++) await stats.record({ tenantId, formId: id, timeZone: TZ }, `10.0.${Math.floor(i / 50)}.${i % 50}`, [{ kind: 'view', src: `h:sitio${i}.com` }]);
        const hlen = await redis.hlen(`fst:${tenantId}:${id}:${zonedToday(TZ)}`);
        expect(hlen).toBeLessThanOrEqual(402);
        out = await svc.statsFor(tenantId, 'contactos', id, 7);
        expect(out.totals.views).toBe(420);
        expect(out.sources.length).toBeLessThanOrEqual(11);
        expect(out.sources.find((x) => x.key === 'o')!.count).toBeGreaterThan(0);
    });

    it('«Guardar y seguir después»: guarda sin archivos, manda el enlace, lo retoma, actualiza el mismo y se borra al enviar', async () => {
        const { id, token } = await contactForm({ save_progress: { device: true, email: true } });
        const meta = await svc.meta(token);
        expect(meta.save_progress).toEqual({ device: true, email: true });

        const saved = await svc.saveDraft(token, IP, {
            stamp: stamp(id),
            email: 'ana@cliente.test',
            values: { [f.nombre!.id]: 'Ana', [f.archivo!.id]: ['x'], '999999': 'no es del formulario' },
            page: 0,
        });
        expect(saved).toMatchObject({ ok: true, email_sent: true });
        expect(mailbox.sent).toHaveLength(1);
        expect(mailbox.sent[0]!.subject).toBe('Sigue con «Contacto» cuando quieras');
        expect(mailbox.sent[0]!.text).toContain(`https://app.test/api/v1/public/f/${token}?seguir=${saved.code}`);

        const loaded = await svc.loadDraft(token, saved.code);
        expect(loaded.values).toEqual({ [f.nombre!.id]: 'Ana' });
        // El código se guarda hasheado: en la fila no está.
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(formDrafts));
        expect(row!.tokenHash).not.toBe(saved.code);
        expect(JSON.stringify(row)).not.toContain(saved.code);

        // Con el código: se actualiza el MISMO, sin otro correo.
        const again = await svc.saveDraft(token, IP, { stamp: stamp(id), email: 'ana@cliente.test', values: { [f.nombre!.id]: 'Ana María', [f.mensaje!.id]: 'Hola' }, page: 0, code: saved.code });
        expect(again).toMatchObject({ code: saved.code, email_sent: false });
        expect(mailbox.sent).toHaveLength(1);
        expect((await svc.loadDraft(token, saved.code)).values).toEqual({ [f.nombre!.id]: 'Ana María', [f.mensaje!.id]: 'Hola' });

        // Al enviar con el avance, ya no hace falta.
        await svc.submit(token, IP, { values: { [f.nombre!.id]: 'Ana María' }, uploads: {}, stamp: stamp(id), draft: saved.code });
        await new Promise((r) => setTimeout(r, 50));
        await expect(svc.loadDraft(token, saved.code)).rejects.toMatchObject({ status: 404 });
    });

    it('avances: apagado → 403; código ajeno o vencido → 404; trampa → nada; textos de más; barrido', async () => {
        const off = await contactForm();
        await expect(svc.saveDraft(off.token, IP, { stamp: stamp(off.id), email: 'a@b.test', values: {}, page: 0 })).rejects.toMatchObject({
            response: { code: 'draft_disabled' },
        });
        await expect(svc.loadDraft(off.token, 'x'.repeat(43))).rejects.toMatchObject({ status: 404 });

        const { id, token } = await contactForm({ save_progress: { device: false, email: true } });
        // Campo trampa lleno: "ok" sin guardar ni mandar nada.
        const trap = await svc.saveDraft(token, IP, { stamp: stamp(id), hp: 'spam', email: 'bot@spam.test', values: { [f.nombre!.id]: 'x' }, page: 0 });
        expect(trap.ok).toBe(true);
        expect(mailbox.sent).toHaveLength(0);
        expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(formDrafts))).toHaveLength(0);
        // Sin sello válido no se guarda.
        await expect(svc.saveDraft(token, IP, { stamp: 'roto', email: 'a@b.test', values: {}, page: 0 })).rejects.toBeTruthy();
        // Un texto de más de 10.000 caracteres no se guarda (lo demás sí).
        const long = await svc.saveDraft(token, IP, { stamp: stamp(id), email: 'a@b.test', values: { [f.mensaje!.id]: 'x'.repeat(10_001), [f.nombre!.id]: 'Eva' }, page: 2 });
        expect(await svc.loadDraft(token, long.code)).toMatchObject({ values: { [f.nombre!.id]: 'Eva' }, page: 2 });

        const saved = await svc.saveDraft(token, IP, { stamp: stamp(id), email: 'luis@cliente.test', values: { [f.nombre!.id]: 'Luis' }, page: 0 });
        // Vencido: 404 y el barrido lo borra.
        await withTenant(pg.db, tenantId, (tx) => tx.update(formDrafts).set({ expiresAt: new Date(Date.now() - 1000) }));
        await expect(svc.loadDraft(token, saved.code)).rejects.toMatchObject({ status: 404 });
        expect(await svc.sweepExpiredDrafts()).toBe(2);
        expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(formDrafts))).toHaveLength(0);
    });
});
