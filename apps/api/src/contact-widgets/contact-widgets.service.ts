import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
    WIDGET_ADVISOR_VAR,
    WIDGET_BUTTON_ID_RE,
    WIDGET_HOURS_LOOKAHEAD_DAYS,
    WIDGET_TOKEN_RE,
    addDaysYmd,
    brandingSchema,
    buildPublicWidgetButton,
    buildPublicWidgetHours,
    buildPublicWidgetMeta,
    contactWidgetConfigSchema,
    defaultContactWidgetConfig,
    newWidgetButtonId,
    holidayBlocksByDefault,
    pickWidgetAdvisor,
    readContactWidgetConfig,
    resolveTimeZone,
    tenantFormatSchema,
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
    type WidgetAdvisor,
    type WidgetButton,
    type WidgetFormOption,
    type WidgetRotation,
    type WidgetTargetRef,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type Redis from 'ioredis';
import { accessColumns, accessOf } from '../billing/tenant-access';
import { planModuleOff } from '../billing/plan-module-gate';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { BookingHolidaysService } from '../booking/booking-holidays';
import { attachments, bookingPages, contactWidgets, fields, forms, lists, memberships, tenants, users, type ContactWidgetRow } from '../db/schema';
import { FilesService } from '../files/files.service';
import { DomainsService } from '../domains/domains.service';
import { PlatformNetworkService } from '../network/platform-network.service';
import { staffRoleSql } from '../helpdesk/staff-roles';
import { REDIS } from '../redis/redis.module';
import { incrWithTtl } from '../redis/redis.util';
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
    /** v0.1.395 — Las personas que atienden (vacío = `phone`). */
    advisors: WidgetAdvisor[];
    rotation: WidgetRotation;
    /** v0.1.395 — El campo «Persona» de la lista del formulario donde queda quién atiende. */
    assignFieldId: number | null;
}

/** v0.1.395 — A quién le llega ESTA conversación (ya elegido). */
export interface WidgetWhatsappPick {
    phone: string;
    message: string;
    label: string;
    advisor: WidgetAdvisor | null;
    assignFieldId: number | null;
}

/** El contador de turnos de un botón vive un tiempo largo sin uso (se reinicia solo). */
const ROTATION_TTL_S = 90 * 86_400;

export interface WidgetPageInfo {
    tenantId: number;
    widgetId: number;
    /** v0.1.396 — La zona de la empresa (el día de las estadísticas). */
    timeZone: string;
    /** v0.1.396 — Los botones que hoy se ven en el sitio (un clic en otro no suma). */
    buttonIds: string[];
    title: string;
    meta: PublicWidgetMeta;
    allowedDomains: string[];
    whatsapp: Record<string, WhatsappTarget>;
    /** v0.1.409 — El logo que muestra el panel (lo único que sirve `/logo/:id`). */
    logoFileId: number | null;
}

/** Un logo listo para mandar (en memoria: el panel lo pide al abrirse). */
export interface WidgetLogo {
    bytes: Buffer;
    mime: string;
}

/**
 * v0.1.409 — Topes del logo del widget: hasta 3 MB se sirve (más grande no
 * es un logo); hasta 512 KB queda en memoria (con un total de 32 MB entre
 * todos) para no volver a la base ni al disco en cada visitante nuevo.
 */
const LOGO_MAX_BYTES = 3 * 1024 * 1024;
const LOGO_MEMO_MAX_BYTES = 512 * 1024;
const LOGO_MEMO_TOTAL_BYTES = 32 * 1024 * 1024;
const LOGO_MEMO_TTL_MS = 60 * 60 * 1000;

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
    /** v0.1.409 — Logos en memoria (orden de uso: el primero es el más viejo). */
    private readonly logos = new Map<string, WidgetLogo & { at: number }>();
    private logosBytes = 0;
    private readonly logoLoads = new Map<string, Promise<WidgetLogo | null>>();

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly files: FilesService,
        @Optional() cache?: PublicCacheService,
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
        @Optional() private readonly holidays?: BookingHolidaysService,
        // v0.1.409 (ADR-S102) — de dónde sale el código para pegar.
        @Optional() private readonly network?: PlatformNetworkService,
        @Optional() private readonly domains?: DomainsService,
    ) {
        this.pcache = cache ?? NO_PUBLIC_CACHE;
    }

    /**
     * v0.1.409 (ADR-S102) — La dirección rápida (por Cloudflare) para el
     * código de pegar, salvo que la empresa comparta por su dominio propio.
     */
    private async embedOrigin(tenantId: number): Promise<string | null> {
        if (!this.network?.embedOrigin()) return null;
        const base = this.domains ? await this.domains.baseUrlFor(tenantId, 'app').catch(() => undefined) : undefined;
        return this.network.embedOriginFor(base);
    }

    // ─────────────────────────── Equipo ───────────────────────────

    async list(tenantId: number): Promise<ContactWidgetDto[]> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx.select().from(contactWidgets).where(eq(contactWidgets.tenantId, tenantId)).orderBy(asc(contactWidgets.id));
            const refs = await this.refs(tx, tenantId);
            return rows.map((r) => this.toDto(r, refs));
        }).then(async (dtos) => {
            const embed = await this.embedOrigin(tenantId);
            return dtos.map((d) => ({ ...d, embed_origin: embed }));
        });
    }

    /** v0.1.396 — El widget de la empresa (404 si no es suyo) con la zona del día de las estadísticas. */
    async statsTarget(tenantId: number, id: number): Promise<{ tenantId: number; widgetId: number; timeZone: string }> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            await this.load(tx, tenantId, id);
            const f = await this.format(tx, tenantId);
            return { tenantId, widgetId: id, timeZone: resolveTimeZone(null, f.timezone) };
        });
    }

    async get(tenantId: number, id: number): Promise<ContactWidgetDto> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.load(tx, tenantId, id);
            return this.toDto(row, await this.refs(tx, tenantId));
        }).then(async (d) => ({ ...d, embed_origin: await this.embedOrigin(tenantId) }));
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
        }).then(async (d) => ({ ...d, embed_origin: await this.embedOrigin(tenantId) }));
    }

    async update(tenantId: number, id: number, input: UpdateContactWidgetInput): Promise<{ dto: ContactWidgetDto; before: ContactWidgetRow }> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.load(tx, tenantId, id, true);
            const refs = await this.refs(tx, tenantId);
            const config = input.config !== undefined ? await this.cleanConfig(tx, tenantId, input.config, refs) : readContactWidgetConfig(row.config);
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
        }).then(async (r) => ({ ...r, dto: { ...r.dto, embed_origin: await this.embedOrigin(tenantId) } }));
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
        }).then(async (d) => ({ ...d, embed_origin: await this.embedOrigin(tenantId) }));
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
            const people = await this.staff(tx, tenantId);
            const personFields = await this.personFields(tx, tenantId, [...new Set(formsOut.map((f) => f.list_id))]);
            const format = await this.format(tx, tenantId);
            return {
                forms: formsOut.map((f) => ({ ...f, person_fields: personFields.get(f.list_id) ?? [] })),
                bookings: bookingsOut,
                brand_color: brand.accent,
                company: brand.company,
                logo_url: brand.logoUrl,
                members: people,
                timezone: format.timezone,
            };
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
        if (!info || !target) return null;
        const pick = await this.pick(info.widgetId, buttonId, target);
        return whatsappLink(pick.phone, widgetText(pick.message, (k) => (k === WIDGET_ADVISOR_VAR ? (pick.advisor?.name.trim() ?? '') : widgetPageVar(k, page))));
    }

    /**
     * v0.1.395 — Elige a quién le llega la conversación: por turnos (un
     * contador por botón en Redis, compartido entre servidores) o al azar.
     * Sin Redis, al azar (nunca falla un clic por eso).
     */
    private async pick(widgetId: number, buttonId: string, target: WhatsappTarget): Promise<WidgetWhatsappPick> {
        let turn = 0;
        if (target.advisors.length > 1 && target.rotation === 'round_robin') {
            if (this.redis) {
                turn = await incrWithTtl(this.redis, `widget:rr:${widgetId}:${buttonId}`, ROTATION_TTL_S).catch(() => Math.floor(Math.random() * 1000));
                turn -= 1;
            } else turn = Math.floor(Math.random() * 1000);
        }
        const advisor = pickWidgetAdvisor({ advisors: target.advisors, rotation: target.rotation }, turn);
        return { phone: advisor?.phone ?? target.phone, message: target.message, label: target.label, advisor, assignFieldId: target.assignFieldId };
    }

    /**
     * v0.1.394 — «WhatsApp con datos primero»: el envío de un formulario
     * abierto desde el botón de WhatsApp de un widget. Devuelve a qué número
     * y con qué mensaje (todavía con las variables) se abre WhatsApp, sólo si
     * el widget es de la MISMA empresa, está publicado y ESE botón pide ESE
     * formulario. Cualquier otra cosa: null (el envío sigue como siempre).
     */
    async captureTarget(tenantId: number, formId: number, ctx: { token: string; button: string }): Promise<WidgetWhatsappPick | null> {
        const info = await this.cachedPageInfo(ctx.token).catch(() => null);
        if (!info || info.tenantId !== tenantId) return null;
        const target = info.whatsapp[ctx.button];
        if (!target || target.captureFormId !== formId) return null;
        return this.pick(info.widgetId, ctx.button, target);
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
            // v0.1.409 — el logo por una dirección del propio widget que no
            // cambia (el id del archivo): el navegador y una CDN lo guardan un
            // año, y el panel recién lo pide al abrirse.
            const brand = brandOf(hit.tenantSettings, hit.tenantName, (id) => `/api/v1/public/w/${token}/logo/${id}`);
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
                    whatsapp[b.id] = {
                        phone: b.phone,
                        message: b.message,
                        label: widgetButtonLabel(b),
                        captureFormId: b.capture_form_id,
                        advisors: b.advisors,
                        rotation: b.rotation,
                        assignFieldId: b.capture_form_id !== null ? b.assign_field_id : null,
                    };
                }
            }
            // v0.1.395 — quien dejó el equipo ya no recibe registros asignados (su número sigue atendiendo).
            const advisorUsers = [...new Set(Object.values(whatsapp).flatMap((w) => w.advisors.map((a) => a.user_id).filter((x): x is number => x !== null)))];
            if (advisorUsers.length > 0) {
                const alive = new Set((await this.staff(tx, tenantId, advisorUsers)).map((m) => m.id));
                for (const w of Object.values(whatsapp)) w.advisors = w.advisors.map((a) => (a.user_id !== null && !alive.has(a.user_id) ? { ...a, user_id: null } : a));
            }
            const format = tenantFormatSchema.safeParse((hit.tenantSettings as Record<string, unknown> | null)?.format ?? {});
            const hours = await this.publicHours(config, format.success ? format.data.timezone : null, format.success ? format.data.time_format : 'h24');
            const meta: PublicWidgetMeta = buildPublicWidgetMeta(token, config, brand, buttons, hours);
            return {
                tenantId,
                widgetId: hit.widget.id,
                timeZone: resolveTimeZone(null, format.success ? format.data.timezone : null),
                buttonIds: buttons.map((b) => b.id),
                title: config.title || brand.company || 'Contacto',
                meta,
                allowedDomains: config.allowed_domains,
                whatsapp,
                logoFileId: config.show_logo ? brand.logoId : null,
            };
        });
    }

    /**
     * v0.1.409 — El logo del panel del widget. Sólo el que ESE widget muestra
     * hoy (nunca un archivo cualquiera de la empresa), leído una vez y
     * guardado en memoria.
     */
    async logo(token: string, fileId: number): Promise<WidgetLogo | null> {
        const info = await this.cachedPageInfo(token);
        if (!info || info.logoFileId === null || info.logoFileId !== fileId) return null;
        const key = `${info.tenantId}:${fileId}`;
        const hit = this.logos.get(key);
        if (hit && Date.now() - hit.at < LOGO_MEMO_TTL_MS) {
            this.logos.delete(key);
            this.logos.set(key, hit);
            return hit;
        }
        let load = this.logoLoads.get(key);
        if (!load) {
            load = this.loadLogo(info.tenantId, fileId).finally(() => this.logoLoads.delete(key));
            this.logoLoads.set(key, load);
        }
        const logo = await load;
        if (logo && logo.bytes.length <= LOGO_MEMO_MAX_BYTES && !this.logos.has(key)) {
            this.logos.set(key, { ...logo, at: Date.now() });
            this.logosBytes += logo.bytes.length;
            for (const [k, v] of this.logos) {
                if (this.logosBytes <= LOGO_MEMO_TOTAL_BYTES) break;
                this.logos.delete(k);
                this.logosBytes -= v.bytes.length;
            }
        }
        return logo;
    }

    private async loadLogo(tenantId: number, fileId: number): Promise<WidgetLogo | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ size: attachments.sizeBytes, storageKey: attachments.storageKey, storageConnectionId: attachments.storageConnectionId })
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, fileId)))
                .limit(1),
        );
        if (!row || row.size > LOGO_MAX_BYTES) return null;
        let bytes: Buffer | null;
        try {
            bytes = await readCapped(await this.files.readStream(tenantId, row), LOGO_MAX_BYTES);
        } catch {
            return null;
        }
        if (!bytes) return null;
        // El tipo sale de los BYTES (nunca del nombre ni de lo que dijo quien lo subió); nada de SVG.
        const mime = imageMimeOf(bytes);
        return mime ? { bytes, mime } : null;
    }

    /**
     * v0.1.395 — El horario para la página: los festivos de los próximos días
     * ya resueltos (la página no carga el calendario). Si no se sabe cuáles
     * son (Google no responde y no hay nada guardado), ningún día se cierra
     * por festivo: mejor mostrar el botón que esconderlo por error.
     */
    private async publicHours(config: ContactWidgetConfig, companyTz: string | null, timeFormat: 'h12' | 'h24'): Promise<ReturnType<typeof buildPublicWidgetHours>> {
        if (!config.hours.enabled) return null;
        const tz = resolveTimeZone(config.hours.timezone, companyTz);
        const closed: string[] = [];
        if (config.hours.holiday_country && this.holidays) {
            const items = await this.holidays.items(config.hours.holiday_country).catch(() => null);
            if (items) {
                const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
                const until = addDaysYmd(today, WIDGET_HOURS_LOOKAHEAD_DAYS);
                for (const h of items) if (h.date >= today && h.date <= until && holidayBlocksByDefault(h.kind)) closed.push(h.date);
            }
        }
        return buildPublicWidgetHours(config.hours, { tz, closedDates: [...new Set(closed)], timeFormat });
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
    private async cleanConfig(tx: Tx, tenantId: number, raw: unknown, refs: Refs): Promise<ContactWidgetConfig> {
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
        // v0.1.395 — las personas que atienden son del equipo (un id ajeno o
        // de un cliente se descarta) y el campo donde queda quién atiende es un
        // campo «Persona» de la lista del formulario de «datos primero».
        const userIds = [...new Set(buttons.flatMap((b) => b.advisors.map((a) => a.user_id).filter((x): x is number => x !== null)))];
        const staff = userIds.length ? new Set((await this.staff(tx, tenantId, userIds)).map((m) => m.id)) : new Set<number>();
        const lists_ = [...new Set(buttons.map((b) => (b.capture_form_id !== null ? refs.forms.get(b.capture_form_id)?.list_id : undefined)).filter((x): x is number => x !== undefined))];
        const personFields = await this.personFields(tx, tenantId, lists_);
        const cleaned = buttons.map((b) => {
            if (b.type !== 'whatsapp') return { ...b, advisors: [], assign_field_id: null };
            const advisors = b.advisors.map((a) => (a.user_id !== null && !staff.has(a.user_id) ? { ...a, user_id: null } : a));
            const listId = b.capture_form_id !== null ? refs.forms.get(b.capture_form_id)?.list_id : undefined;
            const okField = listId !== undefined && b.assign_field_id !== null && (personFields.get(listId) ?? []).some((f) => f.id === b.assign_field_id);
            return { ...b, advisors, assign_field_id: okField ? b.assign_field_id : null };
        });
        const tz = parsed.data.hours.timezone;
        const hours = { ...parsed.data.hours, timezone: tz && resolveTimeZone(tz) === tz ? tz : null };
        return { ...parsed.data, buttons: cleaned, hours };
    }

    /** v0.1.395 — Las personas del equipo (ni clientes del portal ni invitados), activas. */
    private async staff(tx: Tx, tenantId: number, only?: number[]): Promise<Array<{ id: number; name: string }>> {
        const where = [eq(memberships.tenantId, tenantId), staffRoleSql(), isNull(users.disabledAt)];
        if (only) where.push(inArray(memberships.userId, only));
        const rows = await tx
            .select({ id: users.id, name: users.name, email: users.email })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(...where))
            .orderBy(asc(users.name))
            .limit(500);
        return rows.map((r) => ({ id: r.id, name: (r.name ?? '').trim() || r.email }));
    }

    /** v0.1.395 — Los campos «Persona» de cada lista (donde puede quedar quién atiende). */
    private async personFields(tx: Tx, tenantId: number, listIds: number[]): Promise<Map<number, Array<{ id: number; label: string }>>> {
        const out = new Map<number, Array<{ id: number; label: string }>>();
        if (listIds.length === 0) return out;
        const rows = await tx
            .select({ id: fields.id, label: fields.label, listId: fields.listId })
            .from(fields)
            .where(and(eq(fields.tenantId, tenantId), inArray(fields.listId, listIds), eq(fields.type, 'user'), isNull(fields.deletedAt)))
            .orderBy(asc(fields.position));
        for (const r of rows) {
            const list = out.get(r.listId) ?? [];
            list.push({ id: r.id, label: r.label });
            out.set(r.listId, list);
        }
        return out;
    }

    private async format(tx: Tx, tenantId: number): Promise<{ timezone: string | null; time_format: 'h12' | 'h24' }> {
        const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const f = tenantFormatSchema.safeParse((t?.settings as Record<string, unknown> | null)?.format ?? {});
        return f.success ? { timezone: f.data.timezone, time_format: f.data.time_format } : { timezone: null, time_format: 'h24' };
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

function brandOf(
    settings: unknown,
    tenantName: string,
    sign: (id: number) => string,
): { accent: string; company: string; logoUrl: string | null; logoId: number | null } {
    const b = brandingSchema.safeParse((settings as Record<string, unknown> | null)?.branding ?? {});
    const accent = (b.success ? b.data.primary_color : null) ?? '#0e7490';
    const company = (b.success ? b.data.app_name : null) || tenantName;
    const logoId = b.success ? b.data.logo_file_id : null;
    return { accent, company, logoUrl: logoId ? sign(logoId) : null, logoId: logoId ?? null };
}

/** PNG, JPEG, GIF o WebP por su cabecera; cualquier otra cosa (SVG incluido) no es un logo que se sirva. */
export function imageMimeOf(b: Buffer): string | null {
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length > 6 && b.subarray(0, 6).toString('latin1').startsWith('GIF8')) return 'image/gif';
    if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    return null;
}

export async function readCapped(stream: Readable, max: number): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += b.length;
        if (size > max) {
            stream.destroy();
            return null;
        }
        chunks.push(b);
    }
    return Buffer.concat(chunks);
}
