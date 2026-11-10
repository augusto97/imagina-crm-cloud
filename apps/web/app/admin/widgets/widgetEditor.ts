import {
    WIDGET_ADVISOR_VAR,
    WIDGET_MAX_ADVISORS,
    WIDGET_MAX_BUTTONS,
    WIDGET_TYPE_INFO,
    buildPublicWidgetButton,
    buildPublicWidgetHours,
    buildPublicWidgetMeta,
    resolveTimeZone,
    newWidgetButtonId,
    widgetButtonSchema,
    widgetProblems,
    type ContactWidgetConfig,
    type ContactWidgetOptions,
    type PublicWidgetButton,
    type PublicWidgetMeta,
    type WidgetAdvisor,
    type WidgetButton,
    type WidgetButtonType,
    type WidgetProblem,
    type WidgetTargetRef,
} from '@imagina-base/shared';

/**
 * v0.1.394 (ADR-S99) — Las piezas PURAS del editor del widget de contacto:
 * la vista previa (con la MISMA función que arma la página pública), los
 * problemas y las operaciones sobre los botones.
 */

/** El token de la vista previa: nunca se usa para enviar nada. */
export const PREVIEW_TOKEN = 'vista-previa-0000';

/** La página del sitio de ejemplo en la vista previa. */
export const PREVIEW_HOST = { url: 'https://tusitio.com/planes', title: 'Planes y precios' };

function refMaps(options: ContactWidgetOptions): {
    forms: Map<number, WidgetTargetRef>;
    bookings: Map<number, WidgetTargetRef>;
} {
    return {
        forms: new Map(options.forms.map((f) => [f.id, f])),
        bookings: new Map(options.bookings.map((b) => [b.id, b])),
    };
}

export function editorProblems(config: ContactWidgetConfig, options: ContactWidgetOptions): WidgetProblem[] {
    return widgetProblems(config, refMaps(options));
}

/**
 * Lo que dibuja la vista previa. Un botón a medio armar se ve igual (sin
 * destino), y un formulario o una agenda sólo se abren si están publicados:
 * la página de uno sin publicar no existe.
 */
export function previewMeta(config: ContactWidgetConfig, options: ContactWidgetOptions): PublicWidgetMeta {
    const forms = new Map(options.forms.map((f) => [f.id, f]));
    const bookings = new Map(options.bookings.map((b) => [b.id, b]));
    const accent = options.brand_color;
    const buttons = config.buttons
        .map((b) =>
            buildPublicWidgetButton(b, {
                accent: config.color ?? accent,
                goPath: () => '#',
                formPath: (id) => {
                    const f = forms.get(id);
                    return f && f.enabled ? f.public_path : null;
                },
                bookingPath: (id) => {
                    const p = bookings.get(id);
                    return p && p.enabled ? p.public_path : null;
                },
                lenient: true,
            }),
        )
        .filter((b): b is PublicWidgetButton => b !== null);
    // v0.1.395 — el horario sin festivos (los resuelve el servidor al publicar).
    const tz = resolveTimeZone(config.hours.timezone, options.timezone, browserTimeZone());
    const hours = buildPublicWidgetHours(config.hours, { tz, closedDates: [], timeFormat: 'h12' });
    return buildPublicWidgetMeta(PREVIEW_TOKEN, config, { accent, company: options.company, logoUrl: options.logo_url }, buttons, hours);
}

/** La zona del navegador (para proponer el horario cuando la empresa no eligió una). */
export function browserTimeZone(): string | null {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
        return null;
    }
}

/**
 * v0.1.395 — «Varias personas atienden»: al encenderlo, el número del botón
 * pasa a ser la primera persona (no se pierde lo escrito).
 */
export function startAdvisors(button: WidgetButton): WidgetAdvisor[] {
    return [{ id: newWidgetButtonId(), name: '', phone: button.phone, user_id: null }];
}

export function addAdvisor(list: WidgetAdvisor[]): WidgetAdvisor[] {
    if (list.length >= WIDGET_MAX_ADVISORS) return list;
    return [...list, { id: newWidgetButtonId(list.map((a) => a.id)), name: '', phone: '', user_id: null }];
}

export function updateAdvisor(list: WidgetAdvisor[], id: string, patch: Partial<WidgetAdvisor>): WidgetAdvisor[] {
    return list.map((a) => (a.id === id ? { ...a, ...patch, id: a.id } : a));
}

/** Al apagarlo, el botón vuelve a un número: el de la primera persona. */
export function stopAdvisors(button: WidgetButton): Partial<WidgetButton> {
    return { advisors: [], phone: button.phone || button.advisors[0]?.phone || '', assign_field_id: null };
}

/** Un botón nuevo, con lo que mejor le sirve a cada tipo ya puesto. */
export function newButton(
    type: WidgetButtonType,
    config: ContactWidgetConfig,
    options: ContactWidgetOptions,
): WidgetButton {
    const id = newWidgetButtonId(config.buttons.map((b) => b.id));
    const firstForm = options.forms.find((f) => f.enabled) ?? options.forms[0];
    const firstBooking = options.bookings.find((b) => b.enabled) ?? options.bookings[0];
    const phone = config.buttons.find((b) => (b.type === 'whatsapp' || b.type === 'call') && b.phone)?.phone ?? '';
    return widgetButtonSchema.parse({
        id,
        type,
        phone: type === 'whatsapp' || type === 'call' ? phone : '',
        message: type === 'whatsapp' ? 'Hola, vengo de {{pagina}}.' : '',
        form_id: type === 'form' ? firstForm?.id ?? null : null,
        booking_page_id: type === 'booking' ? firstBooking?.id ?? null : null,
    });
}

export function canAddButton(config: ContactWidgetConfig): boolean {
    return config.buttons.length < WIDGET_MAX_BUTTONS;
}

export function addButton(config: ContactWidgetConfig, button: WidgetButton): ContactWidgetConfig {
    if (!canAddButton(config)) return config;
    return { ...config, buttons: [...config.buttons, button] };
}

export function updateButton(config: ContactWidgetConfig, id: string, patch: Partial<WidgetButton>): ContactWidgetConfig {
    return { ...config, buttons: config.buttons.map((b) => (b.id === id ? { ...b, ...patch, id: b.id, type: patch.type ?? b.type } : b)) };
}

export function removeButton(config: ContactWidgetConfig, id: string): ContactWidgetConfig {
    return { ...config, buttons: config.buttons.filter((b) => b.id !== id) };
}

export function moveButton(config: ContactWidgetConfig, id: string, delta: -1 | 1): ContactWidgetConfig {
    const i = config.buttons.findIndex((b) => b.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= config.buttons.length) return config;
    const next = [...config.buttons];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return { ...config, buttons: next };
}

/** Las variables del mensaje de WhatsApp: la página siempre y, con datos primero, las respuestas. */
export function whatsappVars(button: WidgetButton, options: ContactWidgetOptions): Array<{ key: string; label: string }> {
    const out = [
        { key: 'pagina', label: 'La página de tu sitio' },
        { key: 'url', label: 'La dirección de la página' },
    ];
    if (button.advisors.length > 0) out.push({ key: WIDGET_ADVISOR_VAR, label: 'Quién atiende' });
    if (button.capture_form_id !== null) {
        const f = options.forms.find((x) => x.id === button.capture_form_id);
        if (f) {
            for (const a of f.answer_slugs) out.push({ key: a.slug, label: a.label });
            out.push({ key: 'formulario.nombre', label: 'El nombre del formulario' });
        }
    }
    return out;
}

/** Los sitios de «Sólo en estos sitios», uno por renglón o separados por coma. */
export function parseDomains(text: string): string[] {
    return [
        ...new Set(
            text
                .split(/[\n,]+/)
                .map((d) => d.trim())
                .filter((d) => d !== ''),
        ),
    ].slice(0, 20);
}

export function typeLabel(type: WidgetButtonType): string {
    return WIDGET_TYPE_INFO[type].label;
}

/** Iguales para «hay cambios sin guardar» (sin depender del orden de las claves). */
export function sameConfig(a: ContactWidgetConfig, b: ContactWidgetConfig): boolean {
    return stable(a) === stable(b);
}

function stable(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    if (v && typeof v === 'object') {
        return `{${Object.keys(v as Record<string, unknown>)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
            .join(',')}}`;
    }
    return JSON.stringify(v);
}
