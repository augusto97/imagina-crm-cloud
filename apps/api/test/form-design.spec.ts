import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formConfigSchema, newFormItemId, publicThemePresets, publicThemeSchema, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { loadEnv } from '../src/config/env';
import { attachments, forms, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { renderFormNoticePage, renderFormPage } from '../src/forms/form-page';
import { FormsService } from '../src/forms/forms.service';
import { PublicThemesService } from '../src/forms/public-themes.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { remapJson, remapTenantSettingsFiles, type IdMaps } from '../src/platform/tenant-transfer.remap';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

class QuietDispatcher extends AutomationDispatcher {
    constructor() {
        super(null as never);
    }
    override async dispatch(_ev: TriggerEvent): Promise<void> {}
}

const ADMIN = { isAdmin: true };
const AGENT = { isAdmin: false };

describe('v0.1.351 — diseño de los formularios (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let files: FilesService;
    let svc: FormsService;
    let themes: PublicThemesService;
    let tenantId: number;
    let otherTenant: number;
    let f: Record<string, Field>;
    let png: number;
    let svg: number;
    let foreignPng: number;

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const dispatcher = new QuietDispatcher();
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
        const env = loadEnv({ FILES_SIGNING_SECRET: 'form-design-secret' });
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-fdesign-'))), env);
        svc = new FormsService(pg.db, tenantDb, lists, fieldsSvc, recs, files, redis as never, dispatcher, env);
        themes = new PublicThemesService(tenantDb, svc);

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-d', name: 'Acme' }).returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra-d', name: 'Otra' }).returning();
        otherTenant = o!.id;
        await lists.create(tenantId, { name: 'Contactos' });
        f = {};
        f.nombre = await fieldsSvc.create(tenantId, 'contactos', { label: 'Nombre', type: 'text', slug: 'nombre' });
        f.plan = await fieldsSvc.create(tenantId, 'contactos', {
            label: 'Plan',
            type: 'select',
            slug: 'plan',
            config: { options: [{ value: 'basico', label: 'Básico' }, { value: 'pro', label: 'Pro' }] },
        });
        const insert = (tid: number, filename: string, mime: string) =>
            withTenant(pg.db, tid, (tx) => tx.insert(attachments).values({ tenantId: tid, filename, mime, sizeBytes: 10, storageKey: `k/${filename}` }).returning());
        png = (await insert(tenantId, 'portada.png', 'image/png'))[0]!.id;
        svg = (await insert(tenantId, 'logo.svg', 'image/svg+xml'))[0]!.id;
        foreignPng = (await insert(otherTenant, 'ajena.png', 'image/png'))[0]!.id;
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        await redis.flushall();
        await withTenant(pg.db, tenantId, (tx) => tx.delete(forms).where(eq(forms.tenantId, tenantId)));
        await pg.db.update(tenants).set({ settings: {} }).where(eq(tenants.id, tenantId));
    });

    async function designedForm(theme: Record<string, unknown>, extraItems: unknown[] = []): Promise<{ id: number; token: string }> {
        const dto = await svc.create(
            tenantId,
            0,
            'contactos',
            {
                name: 'Diseñado',
                config: formConfigSchema.parse({
                    items: [
                        { id: newFormItemId(), type: 'field', field_id: f.nombre!.id, width: 'half' },
                        { id: newFormItemId(), type: 'field', field_id: f.plan!.id, display: 'cards', option_images: { pro: png } },
                        ...extraItems,
                    ],
                    settings: { title: 'Inscripción', theme },
                }),
            },
            ADMIN,
        );
        await svc.update(tenantId, 'contactos', dto.id, { enabled: true });
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms).where(eq(forms.id, dto.id)));
        return { id: dto.id, token: row!.token };
    }

    it('la página trae el tema: variables, clases, fuente precargada e imágenes firmadas', async () => {
        const preset = publicThemePresets('#e11d48').find((p) => p.id === 'pills')!.theme;
        const { token } = await designedForm({ ...preset, typography: { ...preset.typography, font: 'inter' }, cover: { enabled: true, file_id: png } });
        const info = await svc.pageInfo(token);
        expect(info).not.toBeNull();
        expect(info!.theme_css).toContain('--ib-input-radius:999px');
        expect(info!.theme_css).toMatch(/\.ib-cover\{background:url\("\/api\/v1\/files\/\d+\/signed\?tenant=\d+&exp=\d+&sig=[^"]+"\)/);
        expect(info!.body_classes).toEqual(expect.arrayContaining(['ib-input-pill', 'ib-labels-floating', 'ib-btn-full']));
        expect(info!.preload_font).toBe('/email-fonts/inter-400-normal.woff2');
        const meta = info!.meta;
        expect(meta.theme?.cover).toBe(true);
        expect(meta.theme?.label_position).toBe('floating');
        const plan = meta.items.find((i) => i.type === 'field' && i.slug === 'plan') as { choice_style?: string; options?: Array<{ value: string; image_url?: string | null }> };
        expect(plan.choice_style).toBe('cards');
        expect(plan.options?.find((o) => o.value === 'pro')?.image_url).toMatch(/^\/api\/v1\/files\/\d+\/signed\?/);
        expect(plan.options?.find((o) => o.value === 'basico')?.image_url).toBeUndefined();
        const html = renderFormPage({
            nonce: 'n',
            title: info!.title,
            meta,
            token,
            themeCss: info!.theme_css,
            bodyClasses: info!.body_classes,
            preloadFont: info!.preload_font,
            client: 'void 0',
        });
        expect(html).toContain('class="ib-body ');
        expect(html).toContain('ib-input-pill');
        expect(html).toContain('<style id="ib-theme">');
    });

    it('un formulario guardado antes (sin tema) se ve con el clásico y el color del formulario', async () => {
        const dto = await svc.create(tenantId, 0, 'contactos', { name: 'Viejo', config: formConfigSchema.parse({ items: [{ id: newFormItemId(), type: 'field', field_id: f.nombre!.id }], settings: { accent_color: '#123456' } }) });
        await svc.update(tenantId, 'contactos', dto.id, { enabled: true });
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms).where(eq(forms.id, dto.id)));
        const info = (await svc.pageInfo(row!.token))!;
        expect(info.theme_css).toContain('--ib-accent:#123456');
        expect(info.theme_css).toContain('--ib-width:660px');
        expect(info.body_classes).toContain('ib-container-card');
        expect(info.preload_font).toBeNull();
    });

    it('CSS propio: sólo un admin lo cambia; queda guardado limpio', async () => {
        const dto = await svc.create(tenantId, 0, 'contactos', { name: 'CSS' }, ADMIN);
        const base = publicThemeSchema.parse({});
        await expect(
            svc.update(tenantId, 'contactos', dto.id, { config: formConfigSchema.parse({ items: [], settings: { theme: { ...base, custom_css: '.ib-title{color:red}' } } }) }, AGENT),
        ).rejects.toMatchObject({ status: 403 });
        const saved = await svc.update(
            tenantId,
            'contactos',
            dto.id,
            { config: formConfigSchema.parse({ items: [], settings: { theme: { ...base, custom_css: '@import url(https://x.test/a.css); .ib-title{color:red;background:url(https://x.test/p.png)}' } } }) },
            ADMIN,
        );
        expect(saved.config.settings.theme?.custom_css).toBe('.ib-title{color:red;background:none}');
        // Un agente puede cambiar OTRA cosa del diseño sin tocar el CSS que ya estaba.
        const theme = saved.config.settings.theme!;
        const again = await svc.update(
            tenantId,
            'contactos',
            dto.id,
            { config: formConfigSchema.parse({ items: [], settings: { theme: { ...theme, layout: { ...theme.layout, width: 800 } } } }) },
            AGENT,
        );
        expect(again.config.settings.theme?.layout.width).toBe(800);
        expect(again.config.settings.theme?.custom_css).toBe(theme.custom_css);
    });

    it('imágenes: sólo archivos de la empresa y nada de SVG', async () => {
        const dto = await svc.create(tenantId, 0, 'contactos', { name: 'Imgs' }, ADMIN);
        const withCover = (id: number) =>
            svc.update(tenantId, 'contactos', dto.id, { config: formConfigSchema.parse({ items: [], settings: { theme: { cover: { enabled: true, file_id: id } } } }) }, ADMIN);
        await expect(withCover(foreignPng)).rejects.toMatchObject({ status: 400 });
        await expect(withCover(svg)).rejects.toMatchObject({ status: 400 });
        await expect(withCover(png)).resolves.toMatchObject({ id: dto.id });
        // Una imagen entre las preguntas, también.
        await expect(
            svc.update(tenantId, 'contactos', dto.id, { config: formConfigSchema.parse({ items: [{ id: newFormItemId(), type: 'image', file_id: foreignPng }] }) }, ADMIN),
        ).rejects.toMatchObject({ status: 400 });
    });

    it('«Mis temas»: guardar, cambiar, el por defecto para los formularios nuevos y borrar', async () => {
        const vibrant = publicThemePresets('#0e7490').find((p) => p.id === 'vibrant')!.theme;
        const saved = await themes.create(tenantId, { name: 'Marca 2026', theme: vibrant }, AGENT);
        expect(saved.theme.preset).toBeNull();
        expect((await themes.list(tenantId)).themes.map((t) => t.name)).toEqual(['Marca 2026']);
        // La otra empresa no lo ve.
        expect((await themes.list(otherTenant)).themes).toEqual([]);
        // El CSS propio en un tema también es de admin.
        await expect(themes.update(tenantId, saved.id, { theme: { ...vibrant, custom_css: '.ib-btn{border-radius:0}' } }, AGENT)).rejects.toMatchObject({ status: 403 });
        const withCss = await themes.update(tenantId, saved.id, { name: 'Marca', theme: { ...vibrant, custom_css: '.ib-btn{border-radius:0}' } }, ADMIN);
        expect(withCss.name).toBe('Marca');
        // Imagen ajena en un tema: no.
        await expect(themes.create(tenantId, { name: 'Malo', theme: { ...vibrant, cover: { ...vibrant.cover, enabled: true, file_id: foreignPng } } }, ADMIN)).rejects.toMatchObject({ status: 400 });

        const dto = await themes.setDefault(tenantId, saved.id);
        expect(dto.default_id).toBe(saved.id);
        // Un formulario nuevo nace con ese tema (con su CSS, aunque lo cree un agente).
        const form = await svc.create(tenantId, 0, 'contactos', { name: 'Nuevo' }, AGENT);
        expect(form.config.settings.theme?.background.kind).toBe('gradient');
        expect(form.config.settings.theme?.custom_css).toBe('.ib-btn{border-radius:0}');
        // Aplicar a otro formulario el tema de un admin lo puede cualquiera.
        const other = await svc.create(tenantId, 0, 'contactos', { name: 'Otro', config: formConfigSchema.parse({ items: [] }) }, ADMIN);
        await svc.update(tenantId, 'contactos', other.id, { config: formConfigSchema.parse({ items: [], settings: { theme: withCss.theme } }) }, AGENT);

        await themes.remove(tenantId, saved.id);
        const after = await themes.list(tenantId);
        expect(after.themes).toEqual([]);
        expect(after.default_id).toBeNull();
    });

    it('la página de confirmación del correo usa el diseño del formulario', async () => {
        const html = renderFormNoticePage({
            nonce: 'n',
            brand: { company: 'Acme', accent: '#0e7490', logoUrl: null, themeCss: ':root{--ib-card-radius:24px}', bodyClasses: ['ib-input-pill'] },
            title: 'Listo',
            message: 'Confirmado',
            tone: 'ok',
        });
        expect(html).toContain('--ib-card-radius:24px');
        expect(html).toContain('class="ib-body ib-input-pill"');
    });

    it('v0.1.369 — el logo del formulario: el de la empresa, uno propio o ninguno (y sólo imágenes de la empresa)', async () => {
        const own = (await withTenant(pg.db, tenantId, (tx) => tx.insert(attachments).values({ tenantId, filename: 'logo-form.png', mime: 'image/png', sizeBytes: 10, storageKey: 'k/logo-form.png' }).returning()))[0]!.id;
        await pg.db.update(tenants).set({ settings: { branding: { logo_file_id: png } } }).where(eq(tenants.id, tenantId));
        const dto = await svc.create(tenantId, 0, 'contactos', { name: 'Logo', config: formConfigSchema.parse({ items: [{ id: newFormItemId(), type: 'field', field_id: f.nombre!.id }] }) }, ADMIN);
        await svc.update(tenantId, 'contactos', dto.id, { enabled: true });
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms).where(eq(forms.id, dto.id)));
        const logoOf = async () => (await svc.pageInfo(row!.token))!.meta.logo_url;
        const save = (settings: Record<string, unknown>) =>
            svc.update(tenantId, 'contactos', dto.id, { config: formConfigSchema.parse({ items: [{ id: newFormItemId(), type: 'field', field_id: f.nombre!.id }], settings }) }, ADMIN);
        // Por defecto: el logo de la empresa.
        expect(await logoOf()).toMatch(new RegExp(`^/api/v1/files/${png}/signed\\?`));
        // Uno propio para este formulario.
        await save({ show_logo: true, logo_file_id: own });
        expect(await logoOf()).toMatch(new RegExp(`^/api/v1/files/${own}/signed\\?`));
        // Ninguno: aunque quede guardado el propio, no se muestra.
        await save({ show_logo: false, logo_file_id: own });
        expect(await logoOf()).toBeNull();
        // Sólo imágenes de la empresa, nunca SVG.
        await expect(save({ show_logo: true, logo_file_id: svg })).rejects.toMatchObject({ status: 400 });
        await expect(save({ show_logo: true, logo_file_id: foreignPng })).rejects.toMatchObject({ status: 400 });
        // Volver a «El de la empresa» suelta el propio.
        await save({ show_logo: true, logo_file_id: null });
        expect(await logoOf()).toMatch(new RegExp(`^/api/v1/files/${png}/signed\\?`));
    });

    it('v0.1.369 — «Sin marco»: la página marca el tema para quitar fondo y espacio sólo insertado', async () => {
        const { token } = await designedForm({ layout: { embed_style: 'bare' } });
        const info = (await svc.pageInfo(token))!;
        expect(info.meta.theme?.embed_bare).toBe(true);
        // Las reglas están en el CSS fijo de la página: no hace falta otra petición.
        const html = renderFormPage({ nonce: 'n', title: info.title, meta: info.meta, token, themeCss: info.theme_css, bodyClasses: info.body_classes, preloadFont: info.preload_font, client: 'void 0' });
        expect(html).toContain('body.ib-embedded.ib-embed-bare .ib-inner{padding:0}');
        // El enlace directo sigue con su diseño: las clases de la variante las pone el navegador sólo insertado.
        expect(info.body_classes).not.toContain('ib-embed-bare');
        const plain = await designedForm({});
        expect((await svc.pageInfo(plain.token))!.meta.theme?.embed_bare).toBe(false);
    });

    it('migrar la empresa: imágenes del diseño, de las opciones, el logo y «Mis temas» con sus ids nuevos', () => {
        const maps = { attachment: new Map([[10, 110], [11, 111], [12, 112]]), field: new Map([[5, 55]]) } as unknown as IdMaps;
        for (const k of ['user', 'list', 'view', 'automation', 'form', 'document', 'recordTemplate', 'team', 'bookingPage', 'agent', 'approval_flow', 'connection']) {
            (maps as unknown as Record<string, Map<number, number>>)[k] ??= new Map();
        }
        const config = remapJson(
            {
                items: [
                    { id: 'aaaa1111', type: 'field', field_id: 5, option_images: { pro: 10, gratis: 99 } },
                    { id: 'bbbb2222', type: 'image', file_id: 11 },
                ],
                settings: { logo_file_id: 10, theme: { cover: { enabled: true, file_id: 12 }, background: { file_id: null } } },
            },
            maps,
        ) as { items: Array<Record<string, unknown>>; settings: { logo_file_id: number; theme: { cover: { file_id: number }; background: { file_id: null } } } };
        // v0.1.369 — el logo propio del formulario.
        expect(config.settings.logo_file_id).toBe(110);
        expect(config.items[0]).toMatchObject({ field_id: 55, option_images: { pro: 110 } });
        expect((config.items[0]!.option_images as Record<string, number>).gratis).toBeUndefined();
        expect(config.items[1]).toMatchObject({ file_id: 111 });
        expect(config.settings.theme.cover.file_id).toBe(112);
        expect(config.settings.theme.background.file_id).toBeNull();
        const settings = remapTenantSettingsFiles(
            { branding: { logo_file_id: 10, primary_color: '#000000' }, public_themes: [{ id: 'abc123', name: 'T', theme: { split: { file_id: 11 } } }] },
            maps,
        ) as { branding: { logo_file_id: number }; public_themes: Array<{ theme: { split: { file_id: number } } }> };
        expect(settings.branding.logo_file_id).toBe(110);
        expect(settings.public_themes[0]!.theme.split.file_id).toBe(111);
    });
});
