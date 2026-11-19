import { z } from 'zod';
import type { PublicWidgetHours } from './widget-hours';
import {
    WIDGET_DEVICES,
    WIDGET_GREETING_MAX,
    WIDGET_MAX_DELAY_S,
    WIDGET_MAX_GREETING_RULES,
    WIDGET_MAX_SCROLL_PCT,
    WIDGET_PAGE_MODES,
    WIDGET_STAT_BUTTON_RE,
    type PublicWidgetDisplay,
    type PublicWidgetGreeting,
} from './widget-display';

// El navegador y node lo tienen; shared no carga las librerías del DOM.
declare const URL: { new (input: string): { protocol: string; href: string } };

/**
 * v0.1.394 (ADR-S99) — Widget de contacto: el botón (o la barra) que una
 * empresa pega en su sitio con un solo código. Junta en un lugar lo que antes
 * eran piezas sueltas: WhatsApp con el mensaje armado, un formulario de la app
 * abierto en un panel tipo chat (también los de varios pasos), la agenda de
 * citas, llamar, escribir un correo y cualquier enlace.
 *
 * Es de la EMPRESA, no de una lista: un mismo widget abre el formulario de
 * «Clientes» y la agenda de «Citas». Los formularios y las agendas se
 * referencian por ID (regla de oro nº 1).
 *
 * «WhatsApp con datos primero»: el botón de WhatsApp puede pedir antes un
 * formulario (nombre y celular, por ejemplo). Al enviarlo se crea el registro
 * y recién ahí se abre WhatsApp con el mensaje armado con esas respuestas:
 * aunque la persona no llegue a escribir, el contacto queda guardado.
 *
 * Todo lo de aquí es PURO: lo usan el servidor (la página pública, la
 * redirección a WhatsApp, el envío del formulario) y el editor.
 */

/** v0.1.419 — `shop`: abre la tienda de la empresa (ADR-S103) dentro del panel. */
export const WIDGET_BUTTON_TYPES = ['whatsapp', 'form', 'booking', 'call', 'email', 'link', 'shop'] as const;
export type WidgetButtonType = (typeof WIDGET_BUTTON_TYPES)[number];

export const WIDGET_ICONS = ['whatsapp', 'chat', 'form', 'calendar', 'phone', 'mail', 'link', 'help', 'cart', 'info', 'star', 'pin'] as const;
export type WidgetIcon = (typeof WIDGET_ICONS)[number];

/** Cuántos botones puede tener un widget (más de esto ya no ayuda: abruma). */
export const WIDGET_MAX_BUTTONS = 8;

export const WIDGET_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const WIDGET_BUTTON_ID_RE = /^[a-z0-9]{1,16}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
/** Teléfono en formato internacional (E.164): `+573001112233`. */
export const WIDGET_PHONE_RE = /^\+[1-9]\d{6,14}$/;

const hex = z.string().regex(HEX_RE);
const refId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** v0.1.395 — Cuántas personas pueden atender un mismo botón de WhatsApp. */
export const WIDGET_MAX_ADVISORS = 10;

/**
 * v0.1.395 — Una persona que atiende el WhatsApp de un botón. Con varias, el
 * servidor reparte las conversaciones (por turnos o al azar) y nadie ve la
 * lista de números en el sitio. `user_id` (opcional) es la persona del
 * equipo: con «datos primero», el registro queda asignado a ella.
 */
export const widgetAdvisorSchema = z.object({
    id: z.string().regex(WIDGET_BUTTON_ID_RE),
    name: z.string().trim().max(60).catch('').default(''),
    phone: z.string().trim().max(40).catch('').default(''),
    user_id: refId.nullable().catch(null).default(null),
});
export type WidgetAdvisor = z.infer<typeof widgetAdvisorSchema>;

export const WIDGET_ROTATIONS = ['round_robin', 'random'] as const;
export type WidgetRotation = (typeof WIDGET_ROTATIONS)[number];

/** v0.1.395 — Cuándo se ve un botón, con el horario de atención activo. */
export const WIDGET_WHEN = ['always', 'open', 'closed'] as const;
export type WidgetWhen = (typeof WIDGET_WHEN)[number];

/** Una lista que tolera lo roto: lo que no se entiende se descarta y el resto queda. */
function tolerantList<T extends z.ZodTypeAny>(item: T, max: number) {
    return z.preprocess((raw) => {
        if (!Array.isArray(raw)) return [];
        const out: unknown[] = [];
        const seen = new Set<string>();
        for (const x of raw) {
            const p = item.safeParse(x);
            if (!p.success) continue;
            const id = (p.data as { id?: unknown }).id;
            if (typeof id === 'string') {
                if (seen.has(id)) continue;
                seen.add(id);
            }
            out.push(p.data);
            if (out.length >= max) break;
        }
        return out;
    }, z.array(item).max(max));
}

export const widgetButtonSchema = z.object({
    id: z.string().regex(WIDGET_BUTTON_ID_RE),
    type: z.enum(WIDGET_BUTTON_TYPES),
    /** Vacío = el nombre por defecto del tipo («WhatsApp», «Agendar una cita»…). */
    label: z.string().trim().max(60).catch('').default(''),
    /** Una línea debajo del nombre en el panel («Respondemos en minutos»). */
    description: z.string().trim().max(140).catch('').default(''),
    /** null = el ícono del tipo. */
    icon: z.enum(WIDGET_ICONS).nullable().catch(null).default(null),
    /** null = el del widget (el de WhatsApp va en verde). */
    color: hex.nullable().catch(null).default(null),
    /** WhatsApp y llamar: el número en formato internacional. */
    phone: z.string().trim().max(40).catch('').default(''),
    /** WhatsApp: el mensaje que ya va escrito (admite `{{pagina}}` y, con datos primero, las respuestas). */
    message: z.string().max(1000).catch('').default(''),
    /** WhatsApp con datos primero: el formulario que se llena antes de abrir WhatsApp. */
    capture_form_id: refId.nullable().catch(null).default(null),
    /** Formulario: cuál se abre en el panel. */
    form_id: refId.nullable().catch(null).default(null),
    /** Agenda: cuál página de citas se abre en el panel. */
    booking_page_id: refId.nullable().catch(null).default(null),
    /** v0.1.419 — Tienda: cuál tienda se abre en el panel. */
    shop_id: refId.nullable().catch(null).default(null),
    /** Correo: a quién y con qué asunto. */
    email: z.string().trim().max(200).catch('').default(''),
    subject: z.string().trim().max(200).catch('').default(''),
    /** Enlace: adónde lleva (sólo https). */
    url: z.string().trim().max(1000).catch('').default(''),
    /** Enlace: en otra pestaña (si no, en la misma). */
    new_tab: z.boolean().catch(true).default(true),
    /**
     * v0.1.395 — WhatsApp: varias personas atienden (vacío = el número del
     * botón). El servidor elige a quién le llega cada conversación.
     */
    advisors: tolerantList(widgetAdvisorSchema, WIDGET_MAX_ADVISORS).catch([]).default([]),
    rotation: z.enum(WIDGET_ROTATIONS).catch('round_robin').default('round_robin'),
    /**
     * v0.1.395 — Con «datos primero» y varias personas: el campo «Persona» de
     * la lista del formulario donde queda quién atiende (null = no se asigna).
     */
    assign_field_id: refId.nullable().catch(null).default(null),
    /** v0.1.395 — El formulario (o el de «datos primero») se abre como un chat: una pregunta por burbuja. */
    as_chat: z.boolean().catch(true).default(true),
    /** v0.1.395 — Con horario: siempre, sólo en horario o sólo fuera de horario. */
    when: z.enum(WIDGET_WHEN).catch('always').default('always'),
});
export type WidgetButton = z.infer<typeof widgetButtonSchema>;

// ─────────────────────── Horario de atención (v0.1.395) ───────────────────────

const HHMM_RE = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
export const WIDGET_MAX_INTERVALS_PER_DAY = 6;

export interface WidgetInterval {
    start: string;
    end: string;
}

function hhmmMinutes(v: string): number {
    const [h, m] = v.split(':').map(Number) as [number, number];
    return h * 60 + m;
}

/** Lunes a viernes de 8 a 18 y el sábado de 9 a 13: el punto de partida. */
export function defaultWidgetWeek(): WidgetInterval[][] {
    const weekday = (): WidgetInterval[] => [{ start: '08:00', end: '18:00' }];
    return [[], weekday(), weekday(), weekday(), weekday(), weekday(), [{ start: '09:00', end: '13:00' }]];
}

/** 7 días (0 = domingo) con sus tramos válidos, ordenados y sin solaparse. */
function cleanWeek(raw: unknown): WidgetInterval[][] {
    if (!Array.isArray(raw) || raw.length !== 7) return defaultWidgetWeek();
    return raw.map((day) => {
        if (!Array.isArray(day)) return [];
        const list = day
            .filter((i): i is WidgetInterval => !!i && typeof i === 'object' && HHMM_RE.test(String((i as WidgetInterval).start)) && HHMM_RE.test(String((i as WidgetInterval).end)))
            .map((i) => ({ start: String(i.start), end: String(i.end) }))
            .filter((i) => hhmmMinutes(i.end) > hhmmMinutes(i.start))
            .sort((a, b) => hhmmMinutes(a.start) - hhmmMinutes(b.start));
        const out: WidgetInterval[] = [];
        for (const i of list) {
            const last = out[out.length - 1];
            if (last && hhmmMinutes(i.start) < hhmmMinutes(last.end)) continue;
            out.push(i);
            if (out.length >= WIDGET_MAX_INTERVALS_PER_DAY) break;
        }
        return out;
    });
}

export const WIDGET_DEFAULT_CLOSED_MESSAGE = 'Ahora estamos fuera de horario. Déjanos tus datos y te escribimos apenas abramos.';
export const WIDGET_DEFAULT_ONLINE_LABEL = 'En línea';

export const widgetHoursSchema = z.object({
    enabled: z.boolean().catch(false).default(false),
    /** null = la zona de la empresa (ADR-S33). */
    timezone: z.string().trim().max(64).nullable().catch(null).default(null),
    week: z.preprocess(cleanWeek, z.array(z.array(z.object({ start: z.string(), end: z.string() })).max(WIDGET_MAX_INTERVALS_PER_DAY)).length(7)),
    /** Festivos de un país cierran el día (null = no). Mismo catálogo que la agenda. */
    holiday_country: z.string().regex(/^[A-Z]{2}$/).nullable().catch(null).default(null),
    /** «● En línea» / «Fuera de horario» en el saludo del panel. */
    show_status: z.boolean().catch(true).default(true),
    online_label: z.string().trim().max(40).catch(WIDGET_DEFAULT_ONLINE_LABEL).prefault(WIDGET_DEFAULT_ONLINE_LABEL),
    /** Lo que dice el panel fuera de horario. */
    closed_message: z.string().trim().max(200).catch(WIDGET_DEFAULT_CLOSED_MESSAGE).prefault(WIDGET_DEFAULT_CLOSED_MESSAGE),
});
export type WidgetHours = z.infer<typeof widgetHoursSchema>;

export function defaultWidgetHours(): WidgetHours {
    return widgetHoursSchema.parse({});
}

/** ¿El horario tiene al menos un tramo? */
export function widgetHoursHasDays(h: Pick<WidgetHours, 'week'>): boolean {
    return h.week.some((d) => d.length > 0);
}

/**
 * Lo público del horario. Los días cerrados (festivos de los próximos días)
 * los resuelve el servidor: la página no carga el calendario de festivos.
 */
export function buildPublicWidgetHours(h: WidgetHours, ctx: { tz: string; closedDates: string[]; timeFormat: 'h12' | 'h24' }): PublicWidgetHours | null {
    if (!h.enabled || !widgetHoursHasDays(h)) return null;
    return {
        tz: ctx.tz,
        week: h.week.map((d) => d.map((i): [number, number] => [hhmmMinutes(i.start), hhmmMinutes(i.end)])),
        closed_dates: [...ctx.closedDates].sort(),
        show_status: h.show_status,
        online_label: h.online_label || WIDGET_DEFAULT_ONLINE_LABEL,
        closed_message: h.closed_message,
        time_format: ctx.timeFormat,
    };
}

// ─────────────────────────── Dónde aparece y saludo (v0.1.396) ───────────────────────────

/** En qué páginas y dispositivos se ve, y cuándo aparece. */
export const widgetDisplaySchema = z.object({
    pages: z.enum(WIDGET_PAGE_MODES).catch('all').default('all'),
    /** Palabras de la dirección, separadas por coma («planes, cotizacion»). */
    page_terms: z.string().trim().max(500).catch('').default(''),
    devices: z.enum(WIDGET_DEVICES).catch('all').default('all'),
    delay_s: z.number().int().min(0).max(WIDGET_MAX_DELAY_S).catch(0).default(0),
    scroll_pct: z.number().int().min(0).max(WIDGET_MAX_SCROLL_PCT).catch(0).default(0),
});
export type WidgetDisplay = z.infer<typeof widgetDisplaySchema>;

export function defaultWidgetDisplay(): WidgetDisplay {
    return widgetDisplaySchema.parse({});
}

const greetingRuleSchema = z.object({
    contains: z.string().trim().max(200),
    text: z.string().trim().max(WIDGET_GREETING_MAX),
});

/** El mensaje que se adelanta junto al botón («¿Te ayudamos con tu cotización?»). */
export const widgetGreetingSchema = z.object({
    enabled: z.boolean().catch(false).default(false),
    text: z.string().trim().max(WIDGET_GREETING_MAX).catch('').default(''),
    /** Un saludo distinto por página: gana el primero cuya dirección contiene las palabras. */
    rules: z
        .preprocess(
            (v) => (Array.isArray(v) ? v.filter((r) => greetingRuleSchema.safeParse(r).success).slice(0, WIDGET_MAX_GREETING_RULES) : []),
            z.array(greetingRuleSchema),
        )
        .catch([])
        .default([]),
    delay_s: z.number().int().min(0).max(WIDGET_MAX_DELAY_S).catch(5).default(5),
    mobile: z.boolean().catch(false).default(false),
});
export type WidgetGreeting = z.infer<typeof widgetGreetingSchema>;

export function defaultWidgetGreeting(): WidgetGreeting {
    return widgetGreetingSchema.parse({});
}

/** Lo que viaja a la página (sin el saludo apagado ni reglas vacías). */
export function buildPublicWidgetDisplay(d: WidgetDisplay): PublicWidgetDisplay {
    return { pages: d.pages, page_terms: d.page_terms, devices: d.devices, delay_s: d.delay_s, scroll_pct: d.scroll_pct };
}

export function buildPublicWidgetGreeting(g: WidgetGreeting): PublicWidgetGreeting | null {
    if (!g.enabled) return null;
    const rules = g.rules.filter((r) => r.contains.trim() && r.text.trim());
    if (!g.text.trim() && rules.length === 0) return null;
    return { text: g.text, rules, delay_s: g.delay_s, mobile: g.mobile };
}

/** v0.1.396 — Lo que manda la página del widget para las estadísticas. */
export const widgetStatEventsSchema = z.object({
    events: z
        .array(
            z.object({
                kind: z.enum(['view', 'open', 'click', 'greet', 'greet_click', 'lead']),
                button: z.string().regex(WIDGET_STAT_BUTTON_RE).optional(),
                dev: z.enum(['mobile', 'desktop']).optional(),
            }),
        )
        .min(1)
        .max(12),
});
export type WidgetStatEventsInput = z.infer<typeof widgetStatEventsSchema>;

export const WIDGET_DEFAULT_TITLE = '¡Hola! ¿En qué te ayudamos?';
export const WIDGET_DEFAULT_SUBTITLE = 'Elige cómo prefieres hablar con nosotros.';

export const contactWidgetConfigSchema = z.object({
    /**
     * Cómo se ve al tocar el botón:
     * - `card`: un panel tipo chat con el saludo y los botones; un formulario
     *   o la agenda se abren ahí mismo.
     * - `menu`: los botones salen apilados sobre el botón redondo.
     */
    layout: z.enum(['card', 'menu']).catch('card').default('card'),
    /** De qué lado de la pantalla va. */
    position: z.enum(['right', 'left']).catch('right').default('right'),
    /** Separación del borde de la pantalla, en píxeles. */
    offset_x: z.number().int().min(0).max(200).catch(20).default(20),
    offset_y: z.number().int().min(0).max(200).catch(20).default(20),
    /** null = el color de la marca. */
    color: hex.nullable().catch(null).default(null),
    launcher_icon: z.enum(WIDGET_ICONS).catch('chat').default('chat'),
    /** Texto al lado del ícono del botón redondo (vacío = sólo el ícono). */
    launcher_label: z.string().trim().max(40).catch('').default(''),
    /** El saludo del panel. */
    title: z.string().trim().max(80).catch(WIDGET_DEFAULT_TITLE).prefault(WIDGET_DEFAULT_TITLE),
    subtitle: z.string().trim().max(200).catch(WIDGET_DEFAULT_SUBTITLE).prefault(WIDGET_DEFAULT_SUBTITLE),
    /** El logo de la marca en el panel. */
    show_logo: z.boolean().catch(true).default(true),
    /** En el celular: una barra fija abajo con los botones, en vez del botón redondo. */
    mobile_bar: z.boolean().catch(false).default(false),
    buttons: z.array(widgetButtonSchema).max(WIDGET_MAX_BUTTONS).default([]),
    /** Los sitios que pueden mostrarlo (vacío = cualquiera). */
    allowed_domains: z.array(z.string().trim().max(200)).max(20).catch([]).default([]),
    /** v0.1.395 — Horario de atención: qué botones se ven y el aviso fuera de horario. */
    hours: widgetHoursSchema.catch(defaultWidgetHours).prefault(defaultWidgetHours),
    /** v0.1.396 — En qué páginas y dispositivos aparece, y cuándo. */
    display: widgetDisplaySchema.catch(defaultWidgetDisplay).prefault(defaultWidgetDisplay),
    /** v0.1.396 — El saludo que se adelanta junto al botón. */
    greeting: widgetGreetingSchema.catch(defaultWidgetGreeting).prefault(defaultWidgetGreeting),
});
export type ContactWidgetConfig = z.infer<typeof contactWidgetConfigSchema>;

/**
 * Lectura TOLERANTE de lo guardado: lo que no se entiende toma su valor por
 * defecto y un botón roto se descarta, en vez de tirar todo el widget.
 */
export function readContactWidgetConfig(raw: unknown): ContactWidgetConfig {
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const rawButtons = Array.isArray(obj.buttons) ? obj.buttons : [];
    const seen = new Set<string>();
    const buttons: WidgetButton[] = [];
    for (const b of rawButtons) {
        const parsed = widgetButtonSchema.safeParse(b);
        if (!parsed.success || seen.has(parsed.data.id)) continue;
        seen.add(parsed.data.id);
        buttons.push(parsed.data);
        if (buttons.length >= WIDGET_MAX_BUTTONS) break;
    }
    const base = contactWidgetConfigSchema.safeParse({ ...obj, buttons: [] });
    const config = base.success ? base.data : contactWidgetConfigSchema.parse({});
    return { ...config, buttons };
}

export function defaultContactWidgetConfig(): ContactWidgetConfig {
    return contactWidgetConfigSchema.parse({});
}

/** Un id nuevo para un botón (corto, legible en el código). */
export function newWidgetButtonId(taken: Iterable<string> = []): string {
    const used = new Set(taken);
    for (let i = 0; i < 50; i++) {
        const id = Math.random().toString(36).slice(2, 8);
        if (WIDGET_BUTTON_ID_RE.test(id) && !used.has(id)) return id;
    }
    return `b${Date.now().toString(36)}`.slice(0, 16);
}

export const WIDGET_TYPE_INFO: Record<WidgetButtonType, { label: string; icon: WidgetIcon; color: string | null; hint: string }> = {
    whatsapp: { label: 'WhatsApp', icon: 'whatsapp', color: '#25D366', hint: 'Abre WhatsApp con tu número y un mensaje ya escrito.' },
    form: { label: 'Escríbenos', icon: 'form', color: null, hint: 'Abre uno de tus formularios dentro del panel.' },
    booking: { label: 'Agendar una cita', icon: 'calendar', color: null, hint: 'Abre tu agenda de citas dentro del panel.' },
    call: { label: 'Llamar', icon: 'phone', color: null, hint: 'Llama a tu número (en el celular, directo).' },
    email: { label: 'Correo', icon: 'mail', color: null, hint: 'Abre el correo de la persona con tu dirección.' },
    link: { label: 'Abrir', icon: 'link', color: null, hint: 'Lleva a cualquier página (catálogo, preguntas, tu blog).' },
    shop: { label: 'Ver la tienda', icon: 'cart', color: null, hint: 'Abre tu tienda dentro del panel: los productos, el carrito y el pago.' },
};

export function widgetButtonLabel(b: Pick<WidgetButton, 'type' | 'label'>): string {
    return b.label.trim() || WIDGET_TYPE_INFO[b.type].label;
}

export function widgetButtonIcon(b: Pick<WidgetButton, 'type' | 'icon'>): WidgetIcon {
    return b.icon ?? WIDGET_TYPE_INFO[b.type].icon;
}

/** Sólo los dígitos de un número internacional válido (lo que pide `wa.me`), o null. */
export function widgetWhatsappDigits(phone: string): string | null {
    const compact = phone.replace(/[\s().-]/g, '');
    return WIDGET_PHONE_RE.test(compact) ? compact.slice(1) : null;
}

/** `https://wa.me/573001112233?text=…` (sin `text` si no hay mensaje). */
export function whatsappLink(phone: string, text: string): string | null {
    const digits = widgetWhatsappDigits(phone);
    if (!digits) return null;
    const msg = text.trim().slice(0, 1500);
    return msg ? `https://wa.me/${digits}?text=${encodeURIComponent(msg)}` : `https://wa.me/${digits}`;
}

const TEXT_VAR_RE = /\{\{\s*([a-z0-9_.]{1,60})\s*\}\}/gi;

/**
 * Resuelve las variables de un mensaje (`{{pagina}}`, `{{nombre}}`…). Lo que
 * no se conoce queda vacío (nunca la llave a la vista). Los espacios dobles
 * que deja una variable vacía se juntan.
 */
export function widgetText(template: string, resolve: (key: string) => string | null | undefined): string {
    if (!template.includes('{{')) return template;
    return template
        .replace(TEXT_VAR_RE, (_m, key: string) => {
            const v = resolve(key.toLowerCase());
            return v === null || v === undefined ? '' : String(v).slice(0, 300);
        })
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

/** Las variables que entiende el mensaje de WhatsApp SIN formulario. */
export const WIDGET_PAGE_VARS = ['pagina', 'url'] as const;
/** v0.1.395 — Con varias personas atendiendo: `{{asesor}}` = el nombre de quien atiende. */
export const WIDGET_ADVISOR_VAR = 'asesor';

/** `{{pagina}}` = el título de la página (o su dirección); `{{url}}` = la dirección. */
export function widgetPageVar(key: string, page: { url: string | null; title: string | null }): string | null {
    if (key === 'url') return page.url;
    if (key === 'pagina') return page.title?.trim() || page.url;
    return null;
}

/** Tinta legible sobre un color (la misma regla que el botón flotante de embed.js). */
export function widgetInk(color: string): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(color);
    if (!m) return '#ffffff';
    const n = parseInt(m[1]!, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#111827' : '#ffffff';
}

/** El enlace de un botón «Abrir»: sólo https (nunca `javascript:` ni nada raro). */
export function widgetLinkUrl(raw: string): string | null {
    try {
        const u = new URL(raw.trim());
        return u.protocol === 'https:' ? u.href : null;
    } catch {
        return null;
    }
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function widgetMailto(email: string, subject: string): string | null {
    const to = email.trim();
    if (!EMAIL_RE.test(to)) return null;
    const s = subject.trim();
    return s ? `mailto:${to}?subject=${encodeURIComponent(s)}` : `mailto:${to}`;
}

export function widgetTel(phone: string): string | null {
    const compact = phone.replace(/[\s().-]/g, '');
    return WIDGET_PHONE_RE.test(compact) ? `tel:${compact}` : null;
}

/** Lo que el editor sabe de los formularios y agendas de la empresa. */
export interface WidgetTargetRef {
    id: number;
    name: string;
    enabled: boolean;
}

export interface WidgetProblem {
    /** null = del widget entero. */
    button_id: string | null;
    message: string;
}

/**
 * Lo que impide publicar (o que un botón se vea en el sitio). Lo usan el
 * editor (para avisar) y el servidor (que no publica con problemas y, en la
 * página pública, sólo muestra los botones que funcionan).
 */
export function widgetProblems(
    config: ContactWidgetConfig,
    refs: { forms: ReadonlyMap<number, WidgetTargetRef>; bookings: ReadonlyMap<number, WidgetTargetRef>; shops?: ReadonlyMap<number, WidgetTargetRef> },
): WidgetProblem[] {
    const out: WidgetProblem[] = [];
    if (config.buttons.length === 0) out.push({ button_id: null, message: 'Agrega al menos un botón.' });
    // v0.1.395 — con el horario activo, siempre tiene que quedar algo a la vista.
    if (config.hours.enabled) {
        if (!widgetHoursHasDays(config.hours)) out.push({ button_id: null, message: 'Horario de atención: marca al menos un día con horario.' });
        else if (config.buttons.length > 0) {
            if (config.buttons.every((b) => b.when === 'open')) {
                out.push({ button_id: null, message: 'Fuera de horario no quedaría ningún botón: deja alguno «Siempre» o «Sólo fuera de horario».' });
            } else if (config.buttons.every((b) => b.when === 'closed')) {
                out.push({ button_id: null, message: 'En horario no quedaría ningún botón: deja alguno «Siempre» o «Sólo en horario».' });
            }
        }
    }
    for (const b of config.buttons) {
        const name = `«${widgetButtonLabel(b)}»`;
        const p = (message: string): void => {
            out.push({ button_id: b.id, message });
        };
        switch (b.type) {
            case 'whatsapp':
                if (b.advisors.length === 0) {
                    if (!widgetWhatsappDigits(b.phone)) p(`${name}: escribe el número de WhatsApp con el indicativo del país.`);
                } else {
                    // v0.1.395 — con varias personas, cada una con su número.
                    b.advisors.forEach((a, i) => {
                        const who = a.name.trim() ? `«${a.name.trim()}»` : `la persona ${i + 1}`;
                        if (!widgetWhatsappDigits(a.phone)) p(`${name}: escribe el número de WhatsApp de ${who} con el indicativo del país.`);
                    });
                }
                if (b.capture_form_id !== null) formProblem(b.capture_form_id, refs.forms, name, p);
                break;
            case 'form':
                if (b.form_id === null) p(`${name}: elige el formulario que se abre.`);
                else formProblem(b.form_id, refs.forms, name, p);
                break;
            case 'booking': {
                if (b.booking_page_id === null) {
                    p(`${name}: elige la agenda que se abre.`);
                    break;
                }
                const ref = refs.bookings.get(b.booking_page_id);
                if (!ref) p(`${name}: la agenda ya no existe.`);
                else if (!ref.enabled) p(`${name}: la agenda «${ref.name}» no está publicada.`);
                break;
            }
            case 'call':
                if (!widgetTel(b.phone)) p(`${name}: escribe el número con el indicativo del país.`);
                break;
            case 'email':
                if (!widgetMailto(b.email, b.subject)) p(`${name}: escribe un correo válido.`);
                break;
            case 'link':
                if (!widgetLinkUrl(b.url)) p(`${name}: el enlace tiene que empezar con https://.`);
                break;
            case 'shop': {
                if (b.shop_id === null) {
                    p(`${name}: elige la tienda que se abre.`);
                    break;
                }
                const ref = refs.shops?.get(b.shop_id);
                if (!ref) p(`${name}: la tienda ya no existe.`);
                else if (!ref.enabled) p(`${name}: la tienda «${ref.name}» no está publicada.`);
                break;
            }
        }
    }
    return out;
}

function formProblem(id: number, forms: ReadonlyMap<number, WidgetTargetRef>, name: string, p: (m: string) => void): void {
    const ref = forms.get(id);
    if (!ref) p(`${name}: el formulario ya no existe.`);
    else if (!ref.enabled) p(`${name}: el formulario «${ref.name}» no está publicado.`);
}

// ─────────────────────────── API ───────────────────────────

export const createContactWidgetSchema = z.object({
    name: z.string().trim().min(1).max(120),
    /** Para arrancar ya armado (por ejemplo, desde «Compartir» de un formulario). */
    form_id: refId.optional(),
    whatsapp_phone: z.string().trim().max(40).optional(),
});
export type CreateContactWidgetInput = z.infer<typeof createContactWidgetSchema>;

export const updateContactWidgetSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    config: z.unknown().optional(),
});
export type UpdateContactWidgetInput = z.infer<typeof updateContactWidgetSchema>;

export interface ContactWidgetDto {
    id: number;
    name: string;
    enabled: boolean;
    config: ContactWidgetConfig;
    /** `/api/v1/public/w/<token>` (relativo: el origen lo pone quien lo muestra). */
    public_path: string;
    /**
     * v0.1.409 (ADR-S102) — De dónde sale el código para pegar: la dirección
     * rápida (por Cloudflare) si la plataforma la tiene y la empresa no usa su
     * dominio propio. null = la dirección desde donde se mira.
     */
    embed_origin?: string | null;
    problems: WidgetProblem[];
    created_at: string;
    updated_at: string;
}

export interface WidgetFormOption extends WidgetTargetRef {
    list_id: number;
    list_name: string;
    /** El formulario pregunta un celular (sirve para «WhatsApp con datos primero»). */
    asks_phone: boolean;
    /** `/api/v1/public/f/<token>` (para la vista previa del editor). */
    public_path: string;
    /** Los nombres de sus preguntas (`{{nombre}}`) para el mensaje de WhatsApp. */
    answer_slugs: Array<{ slug: string; label: string }>;
    /** v0.1.395 — Los campos «Persona» de su lista (donde puede quedar quién atiende). */
    person_fields?: Array<{ id: number; label: string }>;
}

export interface WidgetBookingOption extends WidgetTargetRef {
    list_id: number;
    list_name: string;
    public_path: string;
}

/** v0.1.419 — Una tienda que puede abrir el botón «Ver la tienda». */
export interface WidgetShopOption extends WidgetTargetRef {
    list_name: string;
    public_path: string;
}

export interface ContactWidgetOptions {
    forms: WidgetFormOption[];
    bookings: WidgetBookingOption[];
    /** v0.1.419 — Las tiendas (vacío si el plan no incluye la tienda). */
    shops?: WidgetShopOption[];
    /** El color de la marca (lo que usa el widget sin color propio). */
    brand_color: string;
    company: string;
    logo_url: string | null;
    /** v0.1.395 — Las personas del equipo (para «quién atiende»). */
    members?: Array<{ id: number; name: string }>;
    /** v0.1.395 — La zona horaria de la empresa (null = todavía no eligió). */
    timezone?: string | null;
}

/** Lo que el envío de un formulario abierto desde el widget le cuenta al servidor. */
export const widgetSubmitContextSchema = z
    .object({
        token: z.string().regex(WIDGET_TOKEN_RE),
        button: z.string().regex(WIDGET_BUTTON_ID_RE),
        /** El título de la página del sitio (para `{{pagina}}`). */
        page_title: z.string().max(300).optional(),
    })
    .optional();
export type WidgetSubmitContext = z.infer<typeof widgetSubmitContextSchema>;

// ─────────────────────── Lo público ───────────────────────

export interface PublicWidgetButton {
    id: string;
    type: WidgetButtonType;
    label: string;
    description: string;
    icon: WidgetIcon;
    color: string;
    /**
     * Lo que se abre al tocarlo FUERA del panel: WhatsApp directo (la
     * dirección propia del widget, que redirige), `tel:`, `mailto:` o el
     * enlace. null = se abre en el panel (`frame`).
     */
    href: string | null;
    target: '_blank' | '_top' | null;
    /** La página del formulario o de la agenda que se abre en el panel. */
    frame: string | null;
    /** WhatsApp con datos primero: el panel muestra el formulario y después WhatsApp. */
    capture: boolean;
    /** v0.1.395 — Con horario: cuándo se ve. */
    when: WidgetWhen;
}

export interface PublicWidgetMeta {
    token: string;
    layout: ContactWidgetConfig['layout'];
    position: ContactWidgetConfig['position'];
    offset_x: number;
    offset_y: number;
    accent: string;
    ink: string;
    launcher_icon: WidgetIcon;
    launcher_label: string;
    title: string;
    subtitle: string;
    company: string;
    logo_url: string | null;
    mobile_bar: boolean;
    buttons: PublicWidgetButton[];
    /** v0.1.395 — El horario de atención (null = siempre «abierto»). */
    hours: PublicWidgetHours | null;
    /** v0.1.396 — En qué páginas y dispositivos aparece, y cuándo. */
    display: PublicWidgetDisplay;
    /** v0.1.396 — El saludo que se adelanta (null = no saluda). */
    greeting: PublicWidgetGreeting | null;
}

/**
 * El botón tal como lo ve el sitio. La MISMA función arma la página pública
 * (servidor) y la vista previa del editor: lo que se ve al diseñar es lo que
 * sale. `lenient` (la vista previa): un botón a medio armar se muestra igual,
 * sin destino, en vez de desaparecer mientras se escribe.
 */
export function buildPublicWidgetButton(
    b: WidgetButton,
    ctx: {
        accent: string;
        /** La redirección propia del widget a WhatsApp (`/public/w/<token>/go/<id>`). */
        goPath: (buttonId: string) => string;
        /** La página PUBLICADA de un formulario o una agenda; null = no existe o no está publicada. */
        formPath: (formId: number) => string | null;
        bookingPath: (pageId: number) => string | null;
        /** v0.1.419 — La tienda PUBLICADA (y que el plan incluye); null = no se puede abrir. */
        shopPath?: (shopId: number) => string | null;
        lenient?: boolean;
    },
): PublicWidgetButton | null {
    const color = b.color ?? WIDGET_TYPE_INFO[b.type].color ?? ctx.accent;
    const base: PublicWidgetButton = {
        id: b.id,
        type: b.type,
        label: widgetButtonLabel(b),
        description: b.description,
        icon: widgetButtonIcon(b),
        color,
        href: null,
        target: null,
        frame: null,
        capture: false,
        when: b.when,
    };
    const empty = ctx.lenient ? base : null;
    switch (b.type) {
        case 'whatsapp': {
            if (!widgetWhatsappReady(b)) return empty;
            const capture = b.capture_form_id !== null ? ctx.formPath(b.capture_form_id) : null;
            if (capture) return { ...base, frame: b.as_chat ? widgetChatPath(capture) : capture, capture: true };
            return { ...base, href: ctx.goPath(b.id), target: '_blank' };
        }
        case 'form': {
            const path = b.form_id !== null ? ctx.formPath(b.form_id) : null;
            return path ? { ...base, frame: b.as_chat ? widgetChatPath(path) : path } : empty;
        }
        case 'booking': {
            const path = b.booking_page_id !== null ? ctx.bookingPath(b.booking_page_id) : null;
            return path ? { ...base, frame: path } : empty;
        }
        case 'call': {
            const href = widgetTel(b.phone);
            return href ? { ...base, href, target: '_top' } : empty;
        }
        case 'email': {
            const href = widgetMailto(b.email, b.subject);
            return href ? { ...base, href, target: '_top' } : empty;
        }
        case 'link': {
            const href = widgetLinkUrl(b.url);
            return href ? { ...base, href, target: b.new_tab ? '_blank' : '_top' } : empty;
        }
        case 'shop': {
            const path = b.shop_id !== null ? (ctx.shopPath?.(b.shop_id) ?? null) : null;
            return path ? { ...base, frame: path } : empty;
        }
    }
}

/** v0.1.395 — ¿El botón de WhatsApp tiene a quién escribirle? (su número o, con varias personas, todas con número). */
export function widgetWhatsappReady(b: Pick<WidgetButton, 'phone' | 'advisors'>): boolean {
    if (b.advisors.length === 0) return widgetWhatsappDigits(b.phone) !== null;
    return b.advisors.every((a) => widgetWhatsappDigits(a.phone) !== null);
}

/** v0.1.395 — La página de un formulario abierta como chat (la página lo lee de la dirección). */
export function widgetChatPath(path: string): string {
    return `${path}${path.includes('?') ? '&' : '?'}imb_chat=1`;
}

/**
 * v0.1.395 — A quién le llega una conversación: por turnos (el contador que
 * lleva el servidor) o al azar. Sin personas, null (se usa el número del botón).
 */
export function pickWidgetAdvisor(b: Pick<WidgetButton, 'advisors' | 'rotation'>, turn: number, random: () => number = Math.random): WidgetAdvisor | null {
    const list = b.advisors;
    if (list.length === 0) return null;
    if (b.rotation === 'random') return list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;
    const n = Math.abs(Math.trunc(turn));
    return list[n % list.length]!;
}

/** Lo público del widget (sin los botones, que arma `buildPublicWidgetButton`). */
export function buildPublicWidgetMeta(
    token: string,
    config: ContactWidgetConfig,
    brand: { accent: string; company: string; logoUrl: string | null },
    buttons: PublicWidgetButton[],
    hours: PublicWidgetHours | null = null,
): PublicWidgetMeta {
    const accent = config.color ?? brand.accent;
    return {
        token,
        layout: config.layout,
        position: config.position,
        offset_x: config.offset_x,
        offset_y: config.offset_y,
        accent,
        ink: widgetInk(accent),
        launcher_icon: config.launcher_icon,
        launcher_label: config.launcher_label,
        title: config.title,
        subtitle: config.subtitle,
        company: brand.company,
        logo_url: config.show_logo ? brand.logoUrl : null,
        mobile_bar: config.mobile_bar,
        buttons,
        hours,
        display: buildPublicWidgetDisplay(config.display),
        greeting: buildPublicWidgetGreeting(config.greeting),
    };
}

/** El código que se pega en el sitio. */
export function widgetEmbedCode(origin: string, publicPath: string): string {
    const base = origin.replace(/\/+$/, '');
    return `<script src="${base}/api/v1/public/f/embed.js" data-imagina-widget="${base}${publicPath}" async></script>`;
}
