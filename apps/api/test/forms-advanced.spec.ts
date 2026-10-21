import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
    buildPublicFormItems,
    formConfigSchema,
    formPageVisible,
    newFormItemId,
    splitFormPages,
    type Field,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { loadEnv, type Env } from '../src/config/env';
import { attachments, formPendingSubmissions, forms, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { CaptchaService } from '../src/forms/captcha.service';
import { formConfirmEmail, formCopyEmail } from '../src/forms/form-email';
import { formPageCsp, renderFormNoticePage } from '../src/forms/form-page';
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
import type { Db } from '../src/db/client';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * v0.1.290 — Formularios: varias páginas, verificación anti-robots (con un
 * `siteverify` simulado) y confirmación del correo (doble opt-in) + copia.
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
    fail = false;
    send(message: MailMessage): Promise<void> {
        if (this.fail) return Promise.reject(new Error('SMTP caído'));
        this.sent.push(message);
        return Promise.resolve();
    }
}

/** `siteverify` simulado: aprueba sólo los tokens que empiezan con «ok-». */
class FakeCaptcha extends CaptchaService {
    readonly calls: Array<{ url: string; form: URLSearchParams }> = [];
    constructor(redis: IORedis, env: Env, db: Db) {
        super(redis as never, env, db);
    }
    protected override async post(url: string, form: string): Promise<{ status: number; body: string }> {
        const params = new URLSearchParams(form);
        this.calls.push({ url, form: params });
        const ok = (params.get('response') ?? '').startsWith('ok-');
        return { status: 200, body: JSON.stringify(ok ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] }) };
    }
}

const IP = '203.0.113.50';

describe('v0.1.290 — formularios (puro)', () => {
    it('páginas: los saltos parten el formulario; al principio o seguidos no dejan páginas vacías', () => {
        const items = [
            { id: 'b0', type: 'page_break', title: 'Inicio' },
            { id: 'q1', type: 'field' },
            { id: 'b1', type: 'page_break', title: 'Empresa' },
            { id: 'b2', type: 'page_break', title: 'Repetido' },
            { id: 'q2', type: 'field' },
            { id: 'b3', type: 'page_break', title: '' },
        ];
        const pages = splitFormPages(items);
        expect(pages.map((p) => [p.break_id, p.title, p.items.map((i) => i.id)])).toEqual([
            ['b0', 'Inicio', ['q1']],
            ['b2', 'Repetido', ['q2']],
        ]);
        // Sin saltos: UNA página.
        expect(splitFormPages([{ id: 'x', type: 'field' }])).toHaveLength(1);
        expect(splitFormPages([])).toHaveLength(1);
    });

    it('páginas: una página cuyas preguntas están escondidas se salta', () => {
        const all = [
            { type: 'field', key: '1', show_if: null },
            { type: 'field', key: '2', show_if: { field_id: 1, op: 'eq' as const, value: 'empresa' } },
            { type: 'heading', show_if: null },
        ];
        const page = { items: [all[2]!, all[1]!] };
        expect(formPageVisible(page, all, { '1': 'persona' })).toBe(false);
        expect(formPageVisible(page, all, { '1': 'empresa' })).toBe(true);
        // Una página sólo de textos se muestra.
        expect(formPageVisible({ items: [all[2]!] }, all, {})).toBe(true);
        // Una página con sólo preguntas ocultas (por la dirección) se salta.
        expect(formPageVisible({ items: [{ type: 'field', key: '9', hidden: true, show_if: null }] }, all, {})).toBe(false);
    });

    it('sanitizeConfig: el salto no tiene condición; confirmar el correo fija esa pregunta visible y obligatoria', () => {
        const fields = [
            { id: 1, type: 'text' },
            { id: 2, type: 'email' },
            { id: 3, type: 'text' },
        ];
        const cfg = formConfigSchema.parse({
            items: [
                { id: 'aaaa1', type: 'field', field_id: 1 },
                { id: 'aaaa2', type: 'page_break', title: 'Dos', show_if: { field_id: 1, op: 'is_empty' } },
                { id: 'aaaa3', type: 'field', field_id: 2, hidden: true, show_if: { field_id: 1, op: 'is_not_empty' } },
            ],
            settings: { respondent_email_field_id: 2, confirm_email: true, send_copy: true },
        });
        const out = sanitizeConfig(cfg, fields);
        expect(out.items[1]).toMatchObject({ type: 'page_break', show_if: null });
        expect(out.items[2]).toMatchObject({ required: true, hidden: false, show_if: null });
        // Un campo que no es email no sirve de correo de quien responde.
        const bad = sanitizeConfig(formConfigSchema.parse({ ...cfg, settings: { respondent_email_field_id: 3, confirm_email: true, send_copy: true } }), fields);
        expect(bad.settings).toMatchObject({ respondent_email_field_id: null, confirm_email: false, send_copy: false });
        // Lo público lleva el salto con su título.
        const pub = buildPublicFormItems(out, fields.map((f) => ({ ...f, slug: `c${f.id}`, label: `C${f.id}`, config: {}, is_required: false })));
        expect(pub[1]).toEqual({ id: 'aaaa2', type: 'page_break', title: 'Dos', show_if: null });
    });

    it('CSP: sin captcha nada de afuera; con captcha SÓLO los dominios de ese proveedor', () => {
        const plain = formPageCsp('n', '*');
        expect(plain).not.toContain('frame-src');
        expect(plain).not.toContain('cloudflare');
        const ts = formPageCsp('n', '*', 'turnstile');
        expect(ts).toContain("script-src 'nonce-n' https://challenges.cloudflare.com");
        expect(ts).toContain('frame-src https://challenges.cloudflare.com');
        expect(ts).not.toContain('hcaptcha');
        expect(ts).not.toContain('google');
        const hc = formPageCsp('n', '*', 'hcaptcha');
        expect(hc).toContain('https://*.hcaptcha.com');
        expect(hc).not.toContain('cloudflare');
        const rc = formPageCsp('n', '*', 'recaptcha');
        expect(rc).toContain('https://www.gstatic.com/recaptcha/');
        expect(rc).toContain('frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/');
    });

    it('correos a quien responde: marca de la empresa y todo escapado', () => {
        const brand = { name: 'Acme <b>', color: '#0e7490', logoUrl: null };
        const c = formConfirmEmail(brand, 'https://x.test/api/v1/public/f/confirm/abc', { formTitle: 'Inscripción "2026"' });
        expect(c.subject).toBe('Confirma tu respuesta a «Inscripción "2026"»');
        expect(c.html).toContain('Confirmar mi correo');
        expect(c.html).toContain('Acme &lt;b&gt;');
        expect(c.html).not.toContain('Acme <b>');
        expect(c.text).toContain('https://x.test/api/v1/public/f/confirm/abc');
        const copy = formCopyEmail(brand, { formTitle: 'Inscripción', answers: [{ question: 'Nombre', answer: '<script>x</script>' }] });
        expect(copy.html).toContain('&lt;script&gt;x&lt;/script&gt;');
        expect(copy.html).not.toContain('<script>x');
        expect(copy.text).toContain('Nombre:\n<script>x</script>');
        // La página de confirmación: el GET no confirma, el formulario se envía por POST.
        const landing = renderFormNoticePage({ nonce: 'n', brand: { company: 'Acme', accent: '#ffffff', logoUrl: null }, title: 'T', message: 'M', tone: 'info', confirmAction: '/api/v1/public/f/confirm/abc' });
        expect(landing).toContain('<form method="post" action="/api/v1/public/f/confirm/abc"');
        expect(landing).toContain('<script nonce="n">');
        // Sobre un color claro la tinta es oscura.
        expect(landing).toContain('--accent-ink: #1d2330');
    });
});

describe('v0.1.290 — formularios avanzados (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let files: FilesService;
    let dispatcher: CapturingDispatcher;
    let mailbox: CapturingMailTransport;
    let captcha: FakeCaptcha;
    let svc: FormsService;
    let tenantId: number;
    let otherTenant: number;
    let listId: number;
    let f: Record<string, Field>;

    const oldStamp = (formId: number): string => {
        const ts = Date.now() - 10_000;
        return `${ts}.${files.signParts('formstamp', formId, ts)}`;
    };
    const tokenOf = async (formId: number): Promise<string> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms).where(eq(forms.id, formId)));
        return row!.token;
    };
    const countRecords = async (): Promise<number> =>
        (await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)))).length;
    const confirmTokenOf = (m: MailMessage): string => /\/confirm\/([A-Za-z0-9_-]+)/.exec(m.text ?? '')![1]!;

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        dispatcher = new CapturingDispatcher();
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
        const env = loadEnv({ FILES_SIGNING_SECRET: 'form-secret', SECRETS_KEY: 'clave-de-test-para-captcha-32b', APP_BASE_URL: 'https://app.test' });
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-forms290-'))), env);
        mailbox = new CapturingMailTransport();
        captcha = new FakeCaptcha(redis, env, pg.db);
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
            captcha,
            new MailService(env, mailbox),
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme290', name: 'Acme' }).returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra290', name: 'Otra' }).returning();
        otherTenant = o!.id;
        listId = (await lists.create(tenantId, { name: 'Inscripciones' })).id;
        f = {};
        f.nombre = await fieldsSvc.create(tenantId, 'inscripciones', { label: 'Nombre', type: 'text', slug: 'nombre' });
        f.email = await fieldsSvc.create(tenantId, 'inscripciones', { label: 'Correo', type: 'email', slug: 'correo' });
        f.tipo = await fieldsSvc.create(tenantId, 'inscripciones', {
            label: 'Tipo',
            type: 'select',
            slug: 'tipo',
            config: { options: [{ value: 'persona', label: 'Persona' }, { value: 'empresa', label: 'Empresa' }] },
        });
        f.nit = await fieldsSvc.create(tenantId, 'inscripciones', { label: 'NIT', type: 'text', slug: 'nit' });
        f.adjunto = await fieldsSvc.create(tenantId, 'inscripciones', { label: 'Adjunto', type: 'file', slug: 'adjunto' });
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        dispatcher.events.length = 0;
        mailbox.sent.length = 0;
        mailbox.fail = false;
        captcha.calls.length = 0;
        await redis.flushall();
        await captcha.clearTenant(tenantId);
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(formPendingSubmissions).where(eq(formPendingSubmissions.tenantId, tenantId));
            await tx.delete(forms).where(eq(forms.tenantId, tenantId));
            await tx.delete(records).where(eq(records.listId, listId));
        });
    });

    /** Formulario de 3 páginas: nombre · tipo · NIT (sólo si es empresa) + correo. */
    async function pagedForm(settings: Record<string, unknown> = {}): Promise<{ id: number; token: string; ids: Record<'nombre' | 'email' | 'tipo' | 'nit' | 'adjunto', string> }> {
        const ids = { nombre: newFormItemId(), email: newFormItemId(), tipo: newFormItemId(), nit: newFormItemId(), adjunto: newFormItemId() };
        const dto = await svc.create(tenantId, 0, 'inscripciones', {
            name: 'Inscripción',
            config: formConfigSchema.parse({
                items: [
                    { id: ids.nombre, type: 'field', field_id: f.nombre!.id, required: true },
                    { id: ids.email, type: 'field', field_id: f.email!.id },
                    { id: newFormItemId(), type: 'page_break', title: 'Tu organización' },
                    { id: ids.tipo, type: 'field', field_id: f.tipo!.id, required: true },
                    { id: ids.adjunto, type: 'field', field_id: f.adjunto!.id },
                    { id: newFormItemId(), type: 'page_break', title: 'Datos fiscales' },
                    { id: ids.nit, type: 'field', field_id: f.nit!.id, required: true, show_if: { field_id: f.tipo!.id, op: 'eq', value: 'empresa' } },
                ],
                settings: { title: 'Inscripción 2026', ...settings },
            }),
        });
        await svc.update(tenantId, 'inscripciones', dto.id, { enabled: true });
        return { id: dto.id, token: await tokenOf(dto.id), ids };
    }

    it('varias páginas: el servidor valida TODO aunque el navegador se salte pasos', async () => {
        const { id, token, ids } = await pagedForm();
        const meta = await svc.meta(token);
        expect(meta.items.filter((i) => i.type === 'page_break').map((i) => (i as { title: string }).title)).toEqual(['Tu organización', 'Datos fiscales']);
        // Saltándose la página 3 siendo empresa: el NIT es obligatorio igual.
        await expect(
            svc.submit(token, IP, { values: { [f.nombre!.id]: 'Ana', [f.tipo!.id]: 'empresa' }, uploads: {}, stamp: oldStamp(id) }),
        ).rejects.toMatchObject({ response: { code: 'form_invalid', data: { errors: { [ids.nit]: 'Esta pregunta es obligatoria.' } } } });
        // Y la página 2 tampoco se puede saltar.
        await expect(svc.submit(token, IP, { values: { [f.nombre!.id]: 'Ana' }, uploads: {}, stamp: oldStamp(id) })).rejects.toMatchObject({
            response: { data: { errors: { [ids.tipo]: 'Esta pregunta es obligatoria.' } } },
        });
        expect(await countRecords()).toBe(0);
        // Siendo persona la página 3 no aplica: entra sin NIT.
        await svc.submit(token, IP, { values: { [f.nombre!.id]: 'Ana', [f.tipo!.id]: 'persona', [f.nit!.id]: 'ignorado' }, uploads: {}, stamp: oldStamp(id) });
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
        expect(rec!.data).toEqual({ [`f${f.nombre!.id}`]: 'Ana', [`f${f.tipo!.id}`]: 'persona' });
    });

    describe('verificación anti-robots', () => {
        it('llaves: el secreto nunca vuelve; la empresa gana sobre la plataforma', async () => {
            expect((await captcha.availability(tenantId, 'admin')).provider).toBeNull();
            const st = await captcha.setPlatform({ provider: 'turnstile', site_key: '0x4AAAAAAplataforma', secret: '0x4AAAAsecreto-plataforma' });
            expect(st).toMatchObject({ configured: true, provider: 'turnstile', site_key: '0x4AAAAAAplataforma', secret_hint: '••••orma' });
            expect(JSON.stringify(st)).not.toContain('secreto-plataforma');
            // Cifrado en Redis.
            expect(await redis.get('platform:captcha')).not.toContain('secreto-plataforma');
            expect(await captcha.availability(tenantId, 'manager')).toEqual({ provider: 'turnstile', source: 'platform', can_configure: false });
            await captcha.setTenant(tenantId, { provider: 'hcaptcha', site_key: '10000000-ffff-ffff-ffff-000000000001', secret: '0xSECRETOEMPRESA' });
            const [row] = await pg.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
            expect(JSON.stringify(row!.settings)).not.toContain('SECRETOEMPRESA');
            expect(await captcha.availability(tenantId, 'admin')).toEqual({ provider: 'hcaptcha', source: 'tenant', can_configure: true });
            // Otra empresa sigue con la de la plataforma.
            expect((await captcha.availability(otherTenant, 'admin')).source).toBe('platform');
            // Re-guardar con el secreto vacío conserva el anterior.
            await captcha.setTenant(tenantId, { provider: 'hcaptcha', site_key: '10000000-ffff-ffff-ffff-000000000001', secret: '' });
            expect((await captcha.resolve(tenantId))?.secret).toBe('0xSECRETOEMPRESA');
            // Cambiar de proveedor sin secreto no se puede.
            await expect(captcha.setTenant(tenantId, { provider: 'recaptcha', site_key: '6LeIxAcTAAAAAJcZ', secret: '' })).rejects.toThrow(/llave secreta/);
            await captcha.clearPlatform();
        });

        it('el envío pide un token válido, se valida UNA vez y va al siteverify del proveedor de la empresa', async () => {
            await captcha.setPlatform({ provider: 'turnstile', site_key: '0x4AAAAAAplataforma', secret: 'secreto-plat' });
            const { id, token } = await pagedForm({ captcha: true });
            const meta = await svc.meta(token);
            expect(meta.captcha).toEqual({ provider: 'turnstile', site_key: '0x4AAAAAAplataforma' });
            const values = { [f.nombre!.id]: 'Ana', [f.tipo!.id]: 'persona' };
            await expect(svc.submit(token, IP, { values, uploads: {}, stamp: oldStamp(id) })).rejects.toMatchObject({
                response: { code: 'captcha_failed', message: 'Completa la verificación para enviar.' },
            });
            await expect(svc.submit(token, IP, { values, uploads: {}, stamp: oldStamp(id), captcha: 'malo-123' })).rejects.toMatchObject({
                response: { code: 'captcha_failed' },
            });
            expect(captcha.calls.at(-1)!.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
            expect(captcha.calls.at(-1)!.form.get('secret')).toBe('secreto-plat');
            expect(captcha.calls.at(-1)!.form.get('remoteip')).toBe(IP);
            expect(await countRecords()).toBe(0);
            await svc.submit(token, IP, { values, uploads: {}, stamp: oldStamp(id), captcha: 'ok-token-1' });
            expect(await countRecords()).toBe(1);
            // El mismo token por segunda vez: rechazado SIN preguntar al proveedor.
            const calls = captcha.calls.length;
            await expect(svc.submit(token, IP, { values, uploads: {}, stamp: oldStamp(id), captcha: 'ok-token-1' })).rejects.toMatchObject({
                response: { code: 'captcha_failed', message: expect.stringMatching(/ya se usó/) },
            });
            expect(captcha.calls.length).toBe(calls);
            expect(await countRecords()).toBe(1);
            // Un dato inválido no quema el token: se revisa antes.
            await expect(svc.submit(token, IP, { values: { [f.nombre!.id]: '' }, uploads: {}, stamp: oldStamp(id), captcha: 'ok-token-2' })).rejects.toMatchObject({
                response: { code: 'form_invalid' },
            });
            await svc.submit(token, IP, { values, uploads: {}, stamp: oldStamp(id), captcha: 'ok-token-2' });
            expect(await countRecords()).toBe(2);

            // Con llaves propias manda la empresa (y su secreto).
            await captcha.setTenant(tenantId, { provider: 'recaptcha', site_key: '6LeIxAcTAAAAAJcZVRqyHh71', secret: 'secreto-empresa' });
            expect((await svc.meta(token)).captcha).toEqual({ provider: 'recaptcha', site_key: '6LeIxAcTAAAAAJcZVRqyHh71' });
            expect((await svc.pageInfo(token))!.captcha?.provider).toBe('recaptcha');
            await svc.submit(token, IP, { values, uploads: {}, stamp: oldStamp(id), captcha: 'ok-token-3' });
            expect(captcha.calls.at(-1)!.url).toBe('https://www.google.com/recaptcha/api/siteverify');
            expect(captcha.calls.at(-1)!.form.get('secret')).toBe('secreto-empresa');
            await captcha.clearPlatform();
        });

        it('sin llaves en ningún lado: no se pide y el formulario sigue recibiendo', async () => {
            const { id, token } = await pagedForm({ captcha: true });
            expect((await svc.meta(token)).captcha).toBeNull();
            expect((await svc.pageInfo(token))!.captcha).toBeNull();
            await svc.submit(token, IP, { values: { [f.nombre!.id]: 'Sin llaves', [f.tipo!.id]: 'persona' }, uploads: {}, stamp: oldStamp(id) });
            expect(await countRecords()).toBe(1);
        });
    });

    describe('confirmación del correo (doble opt-in)', () => {
        it('queda pendiente sin registro → el enlace lo crea y dispara → reusar no duplica', async () => {
            const { id, token } = await pagedForm({ respondent_email_field_id: f.email!.id, confirm_email: true });
            const res = await svc.submit(token, IP, {
                values: { [f.nombre!.id]: 'Ana', [f.email!.id]: 'Ana@Acme.co', [f.tipo!.id]: 'persona' },
                uploads: {},
                stamp: oldStamp(id),
            });
            expect(res).toEqual({ ok: true, redirect_url: null, pending_confirmation: true, email_hint: 'an***@acme.co' });
            expect(await countRecords()).toBe(0);
            expect(dispatcher.events).toEqual([]);
            const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms).where(eq(forms.id, id)));
            expect(row!.submissionsCount).toBe(0);
            // El correo, con la marca y el enlace.
            expect(mailbox.sent).toHaveLength(1);
            const mail = mailbox.sent[0]!;
            expect(mail).toMatchObject({ to: 'ana@acme.co', tenantId, subject: 'Confirma tu respuesta a «Inscripción 2026»', fromName: 'Acme' });
            const ctoken = confirmTokenOf(mail);
            expect(mail.text).toContain(`https://app.test/api/v1/public/f/confirm/${ctoken}`);
            // Lo guardado es el hash, nunca el token.
            const pend = await withTenant(pg.db, tenantId, (tx) => tx.select().from(formPendingSubmissions));
            expect(pend).toHaveLength(1);
            expect(pend[0]!.tokenHash).not.toBe(ctoken);
            expect(JSON.stringify(pend)).not.toContain(ctoken);

            expect((await svc.peekConfirmation(ctoken)).ok).toBe(true);
            const out = await svc.confirm(ctoken);
            expect(out).toMatchObject({ status: 'confirmed', title: '¡Listo! Tu respuesta quedó confirmada', brand: { company: 'Acme' } });
            expect(await countRecords()).toBe(1);
            expect(dispatcher.events.map((e) => e.trigger)).toEqual(['record_created', 'form_submitted']);
            const [after] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms).where(eq(forms.id, id)));
            expect(after!.submissionsCount).toBe(1);

            // Un solo uso: abrirlo otra vez no crea otro.
            expect((await svc.confirm(ctoken)).status).toBe('invalid');
            expect((await svc.peekConfirmation(ctoken)).ok).toBe(false);
            expect(await countRecords()).toBe(1);
            // Dos clics a la vez sobre un enlace nuevo: uno solo crea.
            const again = await svc.submit(token, '198.51.100.1', {
                values: { [f.nombre!.id]: 'Beto', [f.email!.id]: 'beto@acme.co', [f.tipo!.id]: 'persona' },
                uploads: {},
                stamp: oldStamp(id),
            });
            expect(again.pending_confirmation).toBe(true);
            const t2 = confirmTokenOf(mailbox.sent.at(-1)!);
            const both = await Promise.all([svc.confirm(t2), svc.confirm(t2)]);
            expect(both.map((o) => o.status).sort()).toEqual(['confirmed', 'invalid']);
            expect(await countRecords()).toBe(2);
        });

        it('sin correo no se puede: la pregunta queda obligatoria', async () => {
            const { id, token, ids } = await pagedForm({ respondent_email_field_id: f.email!.id, confirm_email: true });
            await expect(
                svc.submit(token, IP, { values: { [f.nombre!.id]: 'Ana', [f.tipo!.id]: 'persona' }, uploads: {}, stamp: oldStamp(id) }),
            ).rejects.toMatchObject({ response: { data: { errors: { [ids.email]: 'Esta pregunta es obligatoria.' } } } });
            expect(mailbox.sent).toHaveLength(0);
        });

        it('vencido: no confirma y el barrido se lleva la respuesta y sus archivos', async () => {
            const { id, token } = await pagedForm({ respondent_email_field_id: f.email!.id, confirm_email: true });
            const up = await svc.upload(
                token,
                IP,
                { stamp: oldStamp(id), field: String(f.adjunto!.id) },
                { filename: 'cv.pdf', mimetype: 'application/pdf', file: Readable.from([Buffer.from('%PDF-1.4')]) },
            );
            const attId = Number(up.token.split('.')[0]);
            await svc.submit(token, IP, {
                values: { [f.nombre!.id]: 'Ana', [f.email!.id]: 'ana@acme.co', [f.tipo!.id]: 'persona' },
                uploads: { [f.adjunto!.id]: [up.token] },
                stamp: oldStamp(id),
            });
            // El archivo sale del barrido de huérfanos (24 h): espera con la respuesta (48 h).
            expect(await svc.sweepOrphanUploads(Date.now() + 25 * 3600 * 1000)).toBe(0);
            const ctoken = confirmTokenOf(mailbox.sent.at(-1)!);
            await withTenant(pg.db, tenantId, (tx) => tx.update(formPendingSubmissions).set({ expiresAt: new Date(Date.now() - 1000) }));
            expect((await svc.confirm(ctoken)).status).toBe('invalid');
            expect(await countRecords()).toBe(0);
            expect(await svc.sweepExpiredPending()).toBe(1);
            const left = await withTenant(pg.db, tenantId, (tx) => tx.select({ id: attachments.id }).from(attachments).where(eq(attachments.id, attId)));
            expect(left).toHaveLength(0);
        });

        it('confirmar con el formulario lleno: no entra y lo dice', async () => {
            const { id, token } = await pagedForm({ respondent_email_field_id: f.email!.id, confirm_email: true, max_submissions: 1 });
            const send = async (n: string, mail: string, ip: string): Promise<string> => {
                await svc.submit(token, ip, { values: { [f.nombre!.id]: n, [f.email!.id]: mail, [f.tipo!.id]: 'persona' }, uploads: {}, stamp: oldStamp(id) });
                return confirmTokenOf(mailbox.sent.at(-1)!);
            };
            const a = await send('A', 'a@acme.co', '192.0.2.1');
            const b = await send('B', 'b@acme.co', '192.0.2.2');
            expect((await svc.confirm(a)).status).toBe('confirmed');
            const late = await svc.confirm(b);
            expect(late).toMatchObject({ status: 'closed', message: 'Este formulario ya no está recibiendo respuestas.' });
            expect(await countRecords()).toBe(1);
        });

        it('si el correo no sale, la respuesta no queda pendiente y se dice', async () => {
            const { id, token } = await pagedForm({ respondent_email_field_id: f.email!.id, confirm_email: true });
            mailbox.fail = true;
            await expect(
                svc.submit(token, IP, { values: { [f.nombre!.id]: 'Ana', [f.email!.id]: 'ana@acme.co', [f.tipo!.id]: 'persona' }, uploads: {}, stamp: oldStamp(id) }),
            ).rejects.toMatchObject({ status: 503 });
            expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(formPendingSubmissions))).toHaveLength(0);
        });

        it('freno: no más de 3 correos por hora a la misma dirección', async () => {
            const { id, token } = await pagedForm({ respondent_email_field_id: f.email!.id, confirm_email: true });
            for (let i = 0; i < 3; i++) {
                await svc.submit(token, `192.0.2.${10 + i}`, {
                    values: { [f.nombre!.id]: `R${i}`, [f.email!.id]: 'victima@acme.co', [f.tipo!.id]: 'persona' },
                    uploads: {},
                    stamp: oldStamp(id),
                });
            }
            await expect(
                svc.submit(token, '192.0.2.99', {
                    values: { [f.nombre!.id]: 'R4', [f.email!.id]: 'victima@acme.co', [f.tipo!.id]: 'persona' },
                    uploads: {},
                    stamp: oldStamp(id),
                }),
            ).rejects.toMatchObject({ status: 429 });
            expect(mailbox.sent).toHaveLength(3);
        });

        it('copia de las respuestas: legible (etiqueta de la opción) y sólo si se pidió', async () => {
            const { id, token } = await pagedForm({ respondent_email_field_id: f.email!.id, send_copy: true });
            await svc.submit(token, IP, {
                values: { [f.nombre!.id]: 'Ana <b>', [f.email!.id]: 'ana@acme.co', [f.tipo!.id]: 'empresa', [f.nit!.id]: '900123' },
                uploads: {},
                stamp: oldStamp(id),
            });
            expect(await countRecords()).toBe(1);
            await vi.waitFor(() => expect(mailbox.sent).toHaveLength(1));
            const copy = mailbox.sent[0]!;
            expect(copy.subject).toBe('Copia de tu respuesta a «Inscripción 2026»');
            expect(copy.text).toContain('Tipo:\nEmpresa');
            expect(copy.text).toContain('NIT:\n900123');
            expect(copy.html).toContain('Ana &lt;b&gt;');
        });

        it('RLS: las respuestas pendientes de una empresa no se ven desde otra', async () => {
            const { id, token } = await pagedForm({ respondent_email_field_id: f.email!.id, confirm_email: true });
            await svc.submit(token, IP, { values: { [f.nombre!.id]: 'Ana', [f.email!.id]: 'ana@acme.co', [f.tipo!.id]: 'persona' }, uploads: {}, stamp: oldStamp(id) });
            expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(formPendingSubmissions))).toHaveLength(1);
            expect(await withTenant(pg.db, otherTenant, (tx) => tx.select().from(formPendingSubmissions))).toHaveLength(0);
        });
    });
});
