import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { fields, lists, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { parseDayLimits, parseSources } from '../src/records/records-calendar.controller';
import { RecordsCalendarService, type CalendarBundle, type CalendarBundleOpts } from '../src/records/records-calendar.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();

/**
 * B4 — Calendario completo: el rango visible en UNA request, con los eventos
 * de varias fuentes de fecha que se solapan con el rango (también los que
 * empiezan antes y los de varios días), los días en el reloj de la EMPRESA,
 * un tope por día con el conteo exacto («+N más») y el mismo filtro,
 * búsqueda, ACL, papelera y regla de subtareas que el listado.
 */
describe('Calendario completo — bundle del rango (B4)', () => {
    let pg: TestPg;
    let recs: RecordsService;
    let cal: RecordsCalendarService;
    let lists_: ListsService;
    let fields_: FieldsService;
    let tzs: TenantTimeZones;
    let tenantId: number;
    let admin: Actor;
    let ana: Actor;
    const f: Record<string, number> = {};
    const key = (slug: string): string => `f${f[slug]}`;
    const ids: Record<string, number> = {};

    const sources = (): CalendarBundleOpts['sources'] => [
        { key: 'main', startFieldId: f.inicio!, endFieldId: f.fin! },
        { key: 's2', startFieldId: f.vence!, endFieldId: null },
    ];
    const bundle = async (actor: Actor, opts: Partial<CalendarBundleOpts> = {}): Promise<CalendarBundle> =>
        cal.bundle(tenantId, actor, 'agenda', { from: '2026-10-01', to: '2026-10-31', sources: sources(), perDay: 3, dayLimits: {}, ...opts });
    const names = (b: CalendarBundle): string[] => b.records.map((r) => String((r.fields as Record<string, unknown>).nombre)).sort();

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        tzs = new TenantTimeZones(tenantDb);
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
            undefined,
            undefined,
            undefined,
            tzs,
        );
        cal = new RecordsCalendarService(recs);
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'acme', name: 'ACME', settings: { format: { timezone: 'America/Bogota' } } })
            .returning();
        tenantId = t!.id;
        const mkUser = async (email: string, name: string): Promise<number> =>
            (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        admin = { userId: await mkUser('admin@t.local', 'Admin'), role: 'admin' };
        ana = { userId: await mkUser('ana@t.local', 'Ana'), role: 'agent' };
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
        await lists_.create(tenantId, { name: 'Agenda' });
        const mk = async (slug: string, type: string, config?: Record<string, unknown>) => {
            f[slug] = (await fields_.create(tenantId, 'agenda', { label: slug, slug, type, ...(config ? { config } : {}) } as never)).id;
        };
        await mk('nombre', 'text');
        await mk('inicio', 'datetime');
        await mk('fin', 'datetime');
        await mk('vence', 'date');
        await mk('minutos', 'duration');
        await mk('estado', 'select', { options: [{ value: 'abierto', label: 'Abierto' }, { value: 'cerrado', label: 'Cerrado' }] });
        const rows: Array<[Actor, Record<string, unknown>]> = [
            // 03:30 UTC del 21 = 22:30 del 20 en Bogotá: cae el 20.
            [admin, { nombre: 'A', inicio: '2026-10-21T03:30:00.000Z', estado: 'abierto' }],
            // De varios días: 5, 6 y 7.
            [admin, { nombre: 'B', inicio: '2026-10-05T14:00:00.000Z', fin: '2026-10-07T15:00:00.000Z', estado: 'cerrado' }],
            // Empieza ANTES del rango y termina dentro.
            [admin, { nombre: 'C', inicio: '2026-09-28T15:00:00.000Z', fin: '2026-10-02T15:00:00.000Z' }],
            // De 00:00 del 10 a 00:00 del 11 (Bogotá): sólo ocupa el 10.
            [ana, { nombre: 'D', inicio: '2026-10-10T05:00:00.000Z', fin: '2026-10-11T05:00:00.000Z', estado: 'abierto' }],
            // Fecha sin hora: el 31 es el 31 en cualquier zona.
            [admin, { nombre: 'E', vence: '2026-10-31' }],
            // Fuera del rango.
            [admin, { nombre: 'Z', inicio: '2026-11-03T15:00:00.000Z', vence: '2026-09-30' }],
        ];
        // Siete vencimientos el 15 (para el tope por día).
        for (let i = 1; i <= 7; i++) rows.push([i <= 2 ? ana : admin, { nombre: `V${i}`, vence: '2026-10-15' }]);
        for (const [actor, row] of rows) {
            const data: Record<string, unknown> = {};
            for (const [slug, v] of Object.entries(row)) data[key(slug)] = v;
            ids[String(row.nombre)] = (await recs.create(tenantId, actor, 'agenda', { data })).id;
        }
    });

    it('días en el reloj de la empresa, eventos de varios días y los que empiezan antes del rango', async () => {
        const b = await bundle(admin);
        expect(b.meta.time_zone).toBe('America/Bogota');
        expect(b.meta.sources.every((s) => s.ok)).toBe(true);
        expect(b.days['2026-10-20']).toEqual({ n: 1, more: 0 });
        expect(b.days['2026-10-21']).toBeUndefined();
        for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) expect(b.days[d]!.n).toBe(1);
        expect(b.days['2026-10-01']!.n).toBe(1);
        expect(b.days['2026-10-02']!.n).toBe(1);
        expect(b.days['2026-10-03']).toBeUndefined();
        expect(b.days['2026-10-10']!.n).toBe(1);
        expect(b.days['2026-10-11']).toBeUndefined();
        expect(b.days['2026-10-31']!.n).toBe(1);
        // A, B, C, D, E y los 7 del 15 (tope 3 por día): Z no.
        expect(b.meta.total).toBe(12);
        expect(names(b)).not.toContain('Z');
        expect(b.records[0]!.fields).toHaveProperty('nombre');
        // Cuántos eventos tiene cada fuente en el rango (para los chips de la barra).
        expect(b.meta.sources.map((s) => [s.key, s.count])).toEqual([
            ['main', 4],
            ['s2', 8],
        ]);
    });

    it('con el tope por día, un evento de varios días va primero (la barra no se corta)', async () => {
        for (let i = 1; i <= 4; i++) {
            await recs.create(tenantId, admin, 'agenda', { data: { [key('nombre')]: `W${i}`, [key('vence')]: '2026-10-06' } });
        }
        const b = await bundle(admin);
        expect(b.days['2026-10-06']).toEqual({ n: 5, more: 2 });
        // B (del 5 al 7) entra en los 3 del 6 aunque los vencimientos sean «todo el día».
        expect(names(b)).toContain('B');
        expect(names(b).filter((n) => n.startsWith('W'))).toHaveLength(2);
    });

    it('tope por día con el conteo exacto («+N más») y un día desplegado', async () => {
        const b = await bundle(admin);
        expect(b.days['2026-10-15']).toEqual({ n: 7, more: 4 });
        expect(names(b).filter((n) => n.startsWith('V'))).toHaveLength(3);
        const open = await bundle(admin, { dayLimits: { '2026-10-15': 10 } });
        expect(open.days['2026-10-15']).toEqual({ n: 7, more: 0 });
        expect(names(open).filter((n) => n.startsWith('V'))).toHaveLength(7);
        // Un día suelto (el «+N más» de la vista mes pide sólo ese día).
        const day = await bundle(admin, { from: '2026-10-15', to: '2026-10-15', perDay: 50 });
        expect(day.meta.total).toBe(7);
        expect(day.records).toHaveLength(7);
    });

    it('fuentes apagadas, filtros, búsqueda, papelera y subtareas', async () => {
        const onlyMain = await bundle(admin, { sources: [sources()[0]!] });
        expect(onlyMain.meta.total).toBe(4);
        expect(onlyMain.days['2026-10-15']).toBeUndefined();
        const filtered = await bundle(admin, {
            filterTree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.estado!, op: 'eq', value: 'abierto' }] },
        });
        expect(names(filtered)).toEqual(['A', 'D']);
        const searched = await bundle(admin, { search: 'v3' });
        expect(names(searched)).toEqual(['V3']);
        await recs.remove(tenantId, admin, 'agenda', ids.A!);
        await recs.create(tenantId, admin, 'agenda', { data: { [key('nombre')]: 'Hija', [key('vence')]: '2026-10-20' }, parent_id: ids.B! });
        const after = await bundle(admin);
        expect(after.days['2026-10-20']).toBeUndefined();
        expect(names(after)).not.toContain('Hija');
    });

    it('ACL: «sólo lo suyo» acota los eventos; una fuente con un campo oculto se informa y no se pide', async () => {
        await lists_.updatePermissions(tenantId, 'agenda', {
            permissions: { agent: { view: 'own', create: true, edit: 'own', delete: 'none', fields_hidden: ['vence'] } },
        });
        const b = await bundle(ana);
        expect(names(b)).toEqual(['D']);
        expect(b.meta.sources.find((s) => s.key === 's2')).toMatchObject({ ok: false, reason: 'hidden' });
        expect(b.days['2026-10-15']).toBeUndefined();
    });

    it('fuentes inválidas y rangos: se informan o rebotan con 400', async () => {
        const b = await bundle(admin, {
            sources: [
                { key: 'main', startFieldId: f.nombre!, endFieldId: null },
                { key: 's2', startFieldId: f.vence!, endFieldId: f.fin! },
                { key: 's3', startFieldId: f.vence!, endFieldId: null },
            ],
        });
        expect(b.meta.sources.map((s) => [s.key, s.ok, s.reason])).toEqual([
            ['main', false, 'invalid_field'],
            ['s2', false, 'type_mismatch'],
            ['s3', true, undefined],
        ]);
        await expect(bundle(admin, { to: '2026-09-01' })).rejects.toBeInstanceOf(BadRequestException);
        await expect(bundle(admin, { to: '2027-03-01' })).rejects.toBeInstanceOf(BadRequestException);
        await expect(bundle(admin, { from: 'ayer' })).rejects.toBeInstanceOf(BadRequestException);
        await expect(bundle(admin, { sources: [] })).rejects.toBeInstanceOf(BadRequestException);
        // Parámetros del controller.
        expect(parseSources('[{"key":"main","start":3,"end":4},{"key":"main","start":5},{"key":"x y","start":6},{"key":"s2","start":7,"end":7}]')).toEqual([
            { key: 'main', startFieldId: 3, endFieldId: 4, durationFieldId: null },
            { key: 's2', startFieldId: 7, endFieldId: null, durationFieldId: null },
        ]);
        expect(parseSources('[{"key":"main","start":3,"dur":5},{"key":"s2","start":6,"end":7,"dur":5}]')).toEqual([
            { key: 'main', startFieldId: 3, endFieldId: null, durationFieldId: 5 },
            { key: 's2', startFieldId: 6, endFieldId: 7, durationFieldId: null },
        ]);
        expect(() => parseSources('no-json')).toThrow(BadRequestException);
        expect(parseDayLimits('{"2026-10-15": 40, "x": 3, "2026-10-16": -1}')).toEqual({ '2026-10-15': 40 });
    });

    it('sin fin, un campo Duración (minutos) estira el evento; con inicio sin hora no aplica', async () => {
        // 23:00 del 24 (Bogotá) + 120 min = 01:00 del 25: ocupa los dos días.
        await recs.create(tenantId, admin, 'agenda', { data: { [key('nombre')]: 'Cita', [key('inicio')]: '2026-10-25T04:00:00.000Z', [key('minutos')]: 120 } });
        const withDur = await bundle(admin, { sources: [{ key: 'main', startFieldId: f.inicio!, endFieldId: null, durationFieldId: f.minutos! }] });
        expect(withDur.days['2026-10-24']!.n).toBe(1);
        expect(withDur.days['2026-10-25']!.n).toBe(1);
        const without = await bundle(admin, { sources: [{ key: 'main', startFieldId: f.inicio!, endFieldId: null }] });
        expect(without.days['2026-10-25']).toBeUndefined();
        const bad = await bundle(admin, {
            sources: [
                { key: 'main', startFieldId: f.vence!, endFieldId: null, durationFieldId: f.minutos! },
                { key: 's2', startFieldId: f.inicio!, endFieldId: null, durationFieldId: f.nombre! },
            ],
        });
        expect(bad.meta.sources.map((x) => x.reason)).toEqual(['type_mismatch', 'invalid_field']);
    });

    it('el descarte por texto no pierde valores con otra zona (margen de 2 días)', async () => {
        // +14:00 → el texto dice 1/10 pero en Bogotá es el 30/9 a las 6:00.
        await recs.create(tenantId, admin, 'agenda', { data: { [key('nombre')]: 'Kiribati', [key('inicio')]: '2026-10-01T01:00:00+14:00' } });
        // −12:00 → el texto dice 28/9 pero en Bogotá es el 29/9 a las 6:00.
        await recs.create(tenantId, admin, 'agenda', { data: { [key('nombre')]: 'Baker', [key('inicio')]: '2026-09-28T23:00:00-12:00' } });
        const only = [{ key: 'main', startFieldId: f.inicio!, endFieldId: f.fin! }];
        const d30 = await bundle(admin, { from: '2026-09-30', to: '2026-09-30', sources: only });
        expect(names(d30)).toEqual(['C', 'Kiribati']);
        const d29 = await bundle(admin, { from: '2026-09-29', to: '2026-09-29', sources: only });
        expect(names(d29)).toEqual(['Baker', 'C']);
        // Una fecha sin hora no tiene margen: el 1/10 no entra en el 30/9.
        await recs.create(tenantId, admin, 'agenda', { data: { [key('nombre')]: 'Uno', [key('vence')]: '2026-10-01' } });
        const v30 = await bundle(admin, { from: '2026-09-30', to: '2026-09-30', sources: [{ key: 's2', startFieldId: f.vence!, endFieldId: null }] });
        expect(names(v30)).toEqual(['Z']);
    });

    it('una empresa sin zona usa la del navegador (y una inválida, UTC)', async () => {
        await pg.db.update(tenants).set({ settings: {} }).where(eq(tenants.id, tenantId));
        tzs.invalidate(tenantId);
        const madrid = await bundle(admin, { clientTimeZone: 'Europe/Madrid' });
        expect(madrid.meta.time_zone).toBe('Europe/Madrid');
        // 03:30 UTC del 21 = 05:30 del 21 en Madrid.
        expect(madrid.days['2026-10-21']!.n).toBe(1);
        const bad = await bundle(admin, { clientTimeZone: 'Marte/Olympus' });
        expect(bad.meta.time_zone).toBe('UTC');
        await pg.db.update(tenants).set({ settings: { format: { timezone: 'America/Bogota' } } }).where(eq(tenants.id, tenantId));
        tzs.invalidate(tenantId);
    });
});
