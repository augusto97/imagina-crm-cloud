import { randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
    WIDGET_BUTTON_ID_RE,
    WIDGET_TOKEN_RE,
    brandingSchema,
    buildPublicWidgetButton,
    buildPublicWidgetMeta,
    contactWidgetConfigSchema,
    defaultContactWidgetConfig,
    newWidgetButtonId,
    readContactWidgetConfig,
    widgetButtonLabel,
    widgetPageVar,
    widgetProblems,
    widgetText,
    widgetButtonSchema,
    whatsappLink,
    type ContactWidgetConfig,
    type ContactWidgetDto,
    type ContactWidgetOptions,
    type CreateContactWidgetInput,
    type PublicWidgetButton,
    type PublicWidgetMeta,
    type UpdateContactWidgetInput,
    type WidgetButton,
    type WidgetFormOption,
    type WidgetTargetRef,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { accessColumns, accessOf } from '../billing/tenant-access';
import { planModuleOff } from '../billing/plan-module-gate';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { bookingPages, contactWidgets, fields, forms, lists, tenants, type ContactWidgetRow } from '../db/schema';
import { FilesService } from '../files/files.service';
import { NO_PUBLIC_CACHE, type PublicCacheLike } from '../public-cache/public-cache';
import { PublicCacheService } from '../public-cache/public-cache.service';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * v0.1.394 (ADR-S99) — Widgets de contacto de la empresa.
 *
 * Lo público (la página del widget y la redirección a WhatsApp) sale de la
 * caché pública (ADR-S95): un sitio con miles de visitas no consulta la base
 * en cada una. Los números de WhatsApp NO viajan a la página: el botón apunta
 * a `/public/w/<token>/go/<botón>`, que redirige a `wa.me` (así, más adelante,
 * el servidor puede repartir entre varios asesores sin que nadie vea la
 * lista).
 */

const PAGE_CACHE_TTL_MS = 30_000;
const MISSING_CACHE_TTL_MS = 15_000;
const LOGO_TTL_S = 3600;
const cacheKey = (token: string): string => `widget:${token}`;

/** Lo privado de un botón de WhatsApp (nunca va a la página). */
interface WhatsappTarget {
    phone: string;
    message: string;
    label: string;
    /** Con datos primero: el formulario que se llena antes. */
    captureFormId: number | null;
}

export interface WidgetPageInfo {
    tenantId: number;
    widgetId: number;
    title: string;
    meta: PublicWidgetMeta;
    allowedDomains: string[];
    whatsapp: Record<string, WhatsappTarget>;
}

interface Refs {
    forms: Map<
        number,
        WidgetTargetRef & { token: string; list_id: number; list_name: string; asks_phone: boolean; answer_slugs: Array<{ slug: string; label: string }> }
    >;
    bookings: Map<number, WidgetTargetRef & { token: string; list_id: number; list_name: string }>;
}

export class WidgetNotReadyError extends BadRequestException {}

@Injectable()
export class ContactWidgetsService {
    private readonly pcache: PublicCacheLike;

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly files: FilesService,
        @Optional() cache?: PublicCacheService,
    ) {
        this.pcache = cache ?? NO_PUBLIC_CACHE;
    }

    // ─────────────────────────── Equipo ───────────────────────────

    async list(tenantId: number): Promise<ContactWidgetDto[]> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx.select().from(contactWidgets).where(eq(contactWidgets.tenantId, tenantId)).orderBy(asc(contactWidgets.id));
            const refs = await this.refs(tx, tenantId);
            return rows.map((r) => this.toDto(r, refs));
        });
    }

    async get(tenantId: number, id: number): Promise<ContactWidgetDto> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.load(tx, tenantId, id);
            return this.toDto(row, await this.refs(tx, tenantId));
        });
    }

    async create(tenantId: number, userId: number, input: CreateContactWidgetInput): Promise<ContactWidgetDto> {
        const config = defaultContactWidgetConfig();
        const ids: string[] = [];
        const add = (b: Partial<WidgetButton> & Pick<WidgetButton, 'type'>): void => {
            const id = newWidgetButtonId(ids);
            ids.push(id);
            config.buttons.push(widgetButtonSchema.parse({ id, ...b }));
        };
        const phone = input.whatsapp_phone?.trim() ?? '';
        // Arranca con lo más común: WhatsApp (si ya se sabe el número o viene
        // con un formulario) y el formulario elegido.
        if (input.form_id !== undefined) {
            add({ type: 'whatsapp', phone, message: 'Hola, vengo de {{pagina}}.' });
            add({ type: 'form', form_id: input.form_id, description: 'Déjanos tus datos y te contactamos.' });
        } else {
            add({ type: 'whatsapp', phone, message: 'Hola, vengo de {{pagina}}.', description: 'Respondemos en minutos.' });
        }
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            if (input.form_id !== undefined) await this.assertForm(tx, tenantId, input.form_id);
            const [row] = await tx
                .insert(contactWidgets)
                .values({ tenantId, name: input.name, token: newToken(), enabled: false, config, createdBy: userId })
                .returning();
            return this.toDto(row!, await this.refs(tx, tenantId));
        });
    }

    async update(tenantId: number, id: number, input: UpdateContactWidgetInput): Promise<{ dto: ContactWidgetDto; before: ContactWidgetRow }> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.load(tx, tenantId, id, true);
            const refs = await this.refs(tx, tenantId);
            const config = input.config !== undefined ? this.cleanConfig(input.config, refs) : readContactWidgetConfig(row.config);
            const enabled = input.enabled ?? row.enabled;
            if (enabled) {
                const problems = widgetProblems(config, refs);
                if (problems.length > 0) {
                    throw new WidgetNotReadyError({
                        code: 'widget_not_ready',
                        message: `Antes de publicarlo: ${problems[0]!.message}`,
                        data: { status: 400, problems },
                    });
                }
            }
            const [next] = await tx
                .update(contactWidgets)
                .set({ name: input.name ?? row.name, enabled, config, updatedAt: new Date() })
                .where(and(eq(contactWidgets.id, id), eq(contactWidgets.tenantId, tenantId)))
                .returning();
            this.pcache.invalidate(cacheKey(row.token));
            return { dto: this.toDto(next!, refs), before: row };
        });
    }

    /** Una dirección nueva: la anterior deja de funcionar al instante (hay que pegar el código otra vez). */
    async regenerate(tenantId: number, id: number): Promise<ContactWidgetDto> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.load(tx, tenantId, id, true);
            const [next] = await tx
                .update(contactWidgets)
                .set({ token: newToken(), updatedAt: new Date() })
                .where(and(eq(contactWidgets.id, id), eq(contactWidgets.tenantId, tenantId)))
                .returning();
            this.pcache.invalidate(cacheKey(row.token));
            return this.toDto(next!, await this.refs(tx, tenantId));
        });
    }

    async remove(tenantId: number, id: number): Promise<ContactWidgetRow> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.load(tx, tenantId, id, true);
            await tx.delete(contactWidgets).where(and(eq(contactWidgets.id, id), eq(contactWidgets.tenantId, tenantId)));
            this.pcache.invalidate(cacheKey(row.token));
            return row;
        });
    }

    /** Lo que el editor necesita para armar los botones (un solo pedido, regla de oro nº 8). */
    async options(tenantId: number): Promise<ContactWidgetOptions> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const refs = await this.refs(tx, tenantId);
            const brand = await this.brand(tx, tenantId);
            const formsOut: WidgetFormOption[] = [...refs.forms.values()].map((f) => ({
                id: f.id,
                name: f.name,
                enabled: f.enabled,
                list_id: f.list_id,
                list_name: f.list_name,
                asks_phone: f.asks_phone,
                public_path: `/api/v1/public/f/${f.token}`,
                answer_slugs: f.answer_slugs,
            }));
            const bookingsOut = [...refs.bookings.values()].map((b) => ({
                id: b.id,
                name: b.name,
                enabled: b.enabled,
                list_id: b.list_id,
                list_name: b.list_name,
                public_path: `/api/v1/public/b/${b.token}`,
            }));
            return { forms: formsOut, bookings: bookingsOut, brand_color: brand.accent, company: brand.company, logo_url: brand.logoUrl };
        });
    }

    // ─────────────────────────── Público ───────────────────────────

    /** La página del widget (de la caché: una visita no consulta la base). */
    cachedPageInfo(token: string): Promise<WidgetPageInfo | null> {
        if (!WIDGET_TOKEN_RE.test(token)) return Promise.resolve(null);
        return this.pcache.get(cacheKey(token), PAGE_CACHE_TTL_MS, () => this.pageInfo(token), MISSING_CACHE_TTL_MS);
    }

    /**
     * Adónde lleva el botón de WhatsApp (con el mensaje armado). null = el
     * widget o el botón no existen (la ruta responde 404).
     */
    async whatsappUrl(token: string, buttonId: string, page: { url: string | null; title: string | null }): Promise<string | null> {
        if (!WIDGET_BUTTON_ID_RE.test(buttonId)) return null;
        const info = await this.cachedPageInfo(token);
        const target = info?.whatsapp[buttonId];
        if (!target) return null;
        return whatsappLink(target.phone, widgetText(target.message, (k) => widgetPageVar(k, page)));
    }

    /**
     * v0.1.394 — «WhatsApp con datos primero»: el envío de un formulario
     * abierto desde el botón de WhatsApp de un widget. Devuelve a qué número
     * y con qué mensaje (todavía con las variables) se abre WhatsApp, sólo si
     * el widget es de la MISMA empresa, está publicado y ESE botón pide ESE
     * formulario. Cualquier otra cosa: null (el envío sigue como siempre).
     */
    async captureTarget(tenantId: number, formId: number, ctx: { token: string; button: string }): Promise<WhatsappTarget | null> {
        const info = await this.cachedPageInfo(ctx.token).catch(() => null);
        if (!info || info.tenantId !== tenantId) return null;
        const target = info.whatsapp[ctx.button];
        if (!target || target.captureFormId !== formId) return null;
        return target;
    }

    private async pageInfo(token: string): Promise<WidgetPageInfo | null> {
        const [hit] = await this.db
            .select({ widget: contactWidgets, ...accessColumns, tenantSettings: tenants.settings, tenantName: tenants.name })
            .from(contactWidgets)
            .innerJoin(tenants, eq(tenants.id, contactWidgets.tenantId))
            .where(eq(contactWidgets.token, token))
            .limit(1);
        if (!hit || !hit.widget.enabled || hit.archivedAt !== null) return null;
        // ADR-S87 — una cuenta pausada no sirve lo público; un plan sin
        // formularios públicos tampoco muestra el widget (vuelve al cambiar de plan).
        if (accessOf(hit).state === 'locked') return null;
        if (await planModuleOff(this.db, hit.widget.tenantId, 'forms')) return null;
        const tenantId = hit.widget.tenantId;
        const saved = readContactWidgetConfig(hit.widget.config);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const refs = await this.refs(tx, tenantId);
            // Si el formulario de «datos primero» se despublicó, el botón sigue
            // abriendo WhatsApp directo (mejor que desaparecer del sitio).
            const config: ContactWidgetConfig = {
                ...saved,
                buttons: saved.buttons.map((b) =>
                    b.type === 'whatsapp' && b.capture_form_id !== null && !refs.forms.get(b.capture_form_id)?.enabled ? { ...b, capture_form_id: null } : b,
                ),
            };
            const brand = brandOf(hit.tenantSettings, hit.tenantName, (id) => this.files.signedUrl(tenantId, id, LOGO_TTL_S));
            const accent = config.color ?? brand.accent;
            const buttons: PublicWidgetButton[] = [];
            const whatsapp: Record<string, WhatsappTarget> = {};
            // Sólo los botones que funcionan: un formulario despublicado o un
            // número mal escrito no se muestran en el sitio.
            const ok = new Set(config.buttons.map((b) => b.id));
            for (const p of widgetProblems(config, refs)) if (p.button_id) ok.delete(p.button_id);
            const ctx = {
                accent,
                goPath: (id: string) => `/api/v1/public/w/${token}/go/${id}`,
                formPath: (id: number) => {
                    const f = refs.forms.get(id);
                    return f?.enabled ? `/api/v1/public/f/${f.token}` : null;
                },
                bookingPath: (id: number) => {
                    const p = refs.bookings.get(id);
                    return p?.enabled ? `/api/v1/public/b/${p.token}` : null;
                },
            };
            for (const b of config.buttons) {
                if (!ok.has(b.id)) continue;
                const pub = buildPublicWidgetButton(b, ctx);
                if (!pub) continue;
                buttons.push(pub);
                if (b.type === 'whatsapp') {
                    whatsapp[b.id] = { phone: b.phone, message: b.message, label: widgetButtonLabel(b), captureFormId: b.capture_form_id };
                }
            }
            const meta: PublicWidgetMeta = buildPublicWidgetMeta(token, config, brand, buttons);
            return { tenantId, widgetId: hit.widget.id, title: config.title || brand.company || 'Contacto', meta, allowedDomains: config.allowed_domains, whatsapp };
        });
    }

    // ─────────────────────────── Interno ───────────────────────────

    private async load(tx: Tx, tenantId: number, id: number, lock = false): Promise<ContactWidgetRow> {
        const q = tx.select().from(contactWidgets).where(and(eq(contactWidgets.id, id), eq(contactWidgets.tenantId, tenantId))).limit(1);
        const [row] = await (lock ? q.for('update') : q);
        if (!row) throw new NotFoundException({ code: 'widget_not_found', message: 'Ese widget ya no existe.', data: { status: 404 } });
        return row;
    }

    private async assertForm(tx: Tx, tenantId: number, formId: number): Promise<void> {
        const [f] = await tx.select({ id: forms.id }).from(forms).where(and(eq(forms.id, formId), eq(forms.tenantId, tenantId))).limit(1);
        if (!f) throw new BadRequestException({ code: 'invalid_widget', message: 'Ese formulario no existe.', data: { status: 400 } });
    }

    /**
     * Lo que llega del editor, limpio: la forma del widget y sólo referencias a
     * formularios y agendas de ESTA empresa (un id ajeno se descarta).
     */
    private cleanConfig(raw: unknown, refs: Refs): ContactWidgetConfig {
        const parsed = contactWidgetConfigSchema.safeParse(raw);
        if (!parsed.success) {
            throw new BadRequestException({ code: 'invalid_widget', message: 'El widget tiene datos que no se entienden.', data: { status: 400, issues: parsed.error.issues.slice(0, 5) } });
        }
        const seen = new Set<string>();
        const buttons = parsed.data.buttons
            .filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)))
            .map((b) => ({
                ...b,
                capture_form_id: b.capture_form_id !== null && refs.forms.has(b.capture_form_id) ? b.capture_form_id : null,
                form_id: b.form_id !== null && refs.forms.has(b.form_id) ? b.form_id : null,
                booking_page_id: b.booking_page_id !== null && refs.bookings.has(b.booking_page_id) ? b.booking_page_id : null,
            }));
        return { ...parsed.data, buttons };
    }

    /** Formularios y agendas de la empresa (sin los de listas en la papelera). */
    private async refs(tx: Tx, tenantId: number): Promise<Refs> {
        const formRows = await tx
            .select({ id: forms.id, name: forms.name, enabled: forms.enabled, token: forms.token, config: forms.config, listId: forms.listId, listName: lists.name })
            .from(forms)
            .innerJoin(lists, and(eq(lists.id, forms.listId), isNull(lists.deletedAt)))
            .where(eq(forms.tenantId, tenantId))
            .orderBy(asc(forms.id));
        const bookingRows = await tx
            .select({ id: bookingPages.id, name: bookingPages.name, enabled: bookingPages.enabled, token: bookingPages.token, listId: bookingPages.listId, listName: lists.name })
            .from(bookingPages)
            .innerJoin(lists, and(eq(lists.id, bookingPages.listId), isNull(lists.deletedAt)))
            .where(eq(bookingPages.tenantId, tenantId))
            .orderBy(asc(bookingPages.id));
        // ¿Qué formularios preguntan un celular? (para sugerirlos en «datos primero»).
        const asked = new Map<number, number[]>();
        for (const f of formRows) asked.set(f.id, askedFieldIds(f.config));
        const allIds = [...new Set([...asked.values()].flat())];
        const phoneIds = new Set<number>();
        const fieldInfo = new Map<number, { slug: string; label: string }>();
        if (allIds.length > 0) {
            const rows = await tx
                .select({ id: fields.id, type: fields.type, slug: fields.slug, label: fields.label })
                .from(fields)
                .where(and(eq(fields.tenantId, tenantId), inArray(fields.id, allIds), isNull(fields.deletedAt)));
            for (const r of rows) {
                if (r.type === 'phone') phoneIds.add(r.id);
                fieldInfo.set(r.id, { slug: r.slug, label: r.label });
            }
        }
        const out: Refs = { forms: new Map(), bookings: new Map() };
        for (const f of formRows) {
            out.forms.set(f.id, {
                id: f.id,
                name: f.name,
                enabled: f.enabled,
                token: f.token,
                list_id: f.listId,
                list_name: f.listName,
                asks_phone: (asked.get(f.id) ?? []).some((id) => phoneIds.has(id)),
                answer_slugs: (asked.get(f.id) ?? []).map((id) => fieldInfo.get(id)).filter((x): x is { slug: string; label: string } => !!x),
            });
        }
        for (const b of bookingRows) {
            out.bookings.set(b.id, { id: b.id, name: b.name, enabled: b.enabled, token: b.token, list_id: b.listId, list_name: b.listName });
        }
        return out;
    }

    private async brand(tx: Tx, tenantId: number): Promise<{ accent: string; company: string; logoUrl: string | null }> {
        const [t] = await tx.select({ settings: tenants.settings, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        return brandOf(t?.settings ?? {}, t?.name ?? '', (id) => this.files.signedUrl(tenantId, id, LOGO_TTL_S));
    }

    private toDto(row: ContactWidgetRow, refs: Refs): ContactWidgetDto {
        const config = readContactWidgetConfig(row.config);
        return {
            id: row.id,
            name: row.name,
            enabled: row.enabled,
            config,
            public_path: `/api/v1/public/w/${row.token}`,
            problems: widgetProblems(config, refs),
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
        };
    }
}

function newToken(): string {
    return randomBytes(18).toString('base64url');
}

/** Los ids de los campos que pregunta un formulario (preguntas y filas de matriz). */
function askedFieldIds(config: unknown): number[] {
    const items = (config as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) return [];
    const out: number[] = [];
    for (const i of items) {
        if (!i || typeof i !== 'object') continue;
        const it = i as { type?: unknown; field_id?: unknown };
        if (it.type === 'field' && typeof it.field_id === 'number') out.push(it.field_id);
    }
    return out;
}

function brandOf(settings: unknown, tenantName: string, sign: (id: number) => string): { accent: string; company: string; logoUrl: string | null } {
    const b = brandingSchema.safeParse((settings as Record<string, unknown> | null)?.branding ?? {});
    const accent = (b.success ? b.data.primary_color : null) ?? '#0e7490';
    const company = (b.success ? b.data.app_name : null) || tenantName;
    const logoId = b.success ? b.data.logo_file_id : null;
    return { accent, company, logoUrl: logoId ? sign(logoId) : null };
}
