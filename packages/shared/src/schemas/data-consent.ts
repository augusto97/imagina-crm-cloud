import { z } from 'zod';
import { idSchema, isoDateSchema } from './common';

/**
 * Autorización de tratamiento de datos personales (Ley 1581 de 2012 y
 * Decreto 1377 de 2013, compilado en el Decreto 1074 de 2015).
 *
 * Cada empresa tiene UN texto de autorización (con su plantilla sugerida,
 * editable) que se pide en sus formularios públicos y la primera vez que un
 * cliente entra a su portal. Tres piezas:
 *
 *  - la CONFIGURACIÓN vive en `tenants.settings.data_consent` (plantilla con
 *    variables, datos del responsable, finalidades, enlace a la política);
 *  - cada cambio del texto ya armado crea una VERSIÓN numerada
 *    (`data_consent_versions`): lo que se aceptó no cambia aunque la empresa
 *    edite el texto después;
 *  - cada aceptación es una fila de EVIDENCIA (`data_consents`): quién, qué
 *    versión, cuándo, desde dónde (IP y navegador) y, si la retiró, cuándo.
 *
 * El texto es texto plano: párrafos separados por una línea en blanco y
 * renglones que empiezan con «- » como viñetas. Nunca HTML: se muestra con
 * `textContent` en la página pública y con `white-space: pre-wrap` en la app.
 */

// ─────────────────────────── Plantilla sugerida ───────────────────────────

export const DEFAULT_DATA_CONSENT_PURPOSES: readonly string[] = [
    'Atender mi solicitud y gestionar la relación comercial o contractual.',
    'Contactarme por correo electrónico, teléfono, mensaje de texto o WhatsApp en relación con mi solicitud y con los servicios contratados.',
    'Enviarme información sobre productos, servicios, novedades y promociones de {{empresa}}.',
    'Elaborar estadísticas internas y mejorar la calidad de los servicios.',
    'Cumplir las obligaciones legales, contables y tributarias aplicables.',
];

export const DEFAULT_DATA_CONSENT_TEMPLATE = `AUTORIZACIÓN PARA EL TRATAMIENTO DE DATOS PERSONALES

De conformidad con la Ley 1581 de 2012 y el Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015), autorizo de manera previa, expresa e informada a {{empresa}}, en su calidad de responsable del tratamiento, para recolectar, almacenar, usar, circular, actualizar y suprimir los datos personales que suministro por este medio, con las finalidades que se indican a continuación.

Responsable del tratamiento:
- Nombre o razón social: {{empresa}}
- NIT: {{nit}}
- Dirección: {{direccion}}
- Ciudad: {{ciudad}}
- Correo electrónico: {{correo}}
- Teléfono: {{telefono}}

Finalidades del tratamiento:
{{finalidades}}

Declaro que se me informó que, como titular de los datos, tengo derecho a:
- Conocer, actualizar y rectificar mis datos personales.
- Solicitar prueba de la autorización otorgada.
- Ser informado(a), previa solicitud, sobre el uso que se ha dado a mis datos personales.
- Presentar ante la Superintendencia de Industria y Comercio quejas por infracciones a la normativa de protección de datos personales.
- Revocar la autorización y/o solicitar la supresión de mis datos cuando en el tratamiento no se respeten los principios, derechos y garantías constitucionales y legales, siempre que no exista un deber legal o contractual de permanecer en la base de datos.
- Acceder en forma gratuita a mis datos personales.

Puedo ejercer estos derechos a través del correo electrónico y del teléfono del responsable indicados arriba.

Declaro también que se me informó que es facultativo responder las preguntas que versen sobre datos sensibles o sobre datos de niñas, niños y adolescentes, y que no estoy obligado(a) a suministrarlos.

La política de tratamiento de datos personales de {{empresa}} puede consultarse en {{politica}}.`;

export const DEFAULT_DATA_CONSENT_LABEL =
    'He leído y acepto la autorización para el tratamiento de mis datos personales por parte de {{empresa}}.';

/** Variables que entiende la plantilla (`{{empresa}}`…), con su explicación. */
export const DATA_CONSENT_VARIABLES: ReadonlyArray<{ key: string; label: string }> = [
    { key: 'empresa', label: 'Nombre o razón social del responsable' },
    { key: 'nit', label: 'NIT o documento' },
    { key: 'direccion', label: 'Dirección' },
    { key: 'ciudad', label: 'Ciudad' },
    { key: 'correo', label: 'Correo para ejercer los derechos' },
    { key: 'telefono', label: 'Teléfono' },
    { key: 'finalidades', label: 'Las finalidades, una por renglón' },
    { key: 'politica', label: 'Enlace a la política de tratamiento' },
];

// ─────────────────────────── Configuración ───────────────────────────

const optionalEmail = z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: 'Correo inválido' });

const optionalHttps = z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https:\/\/[^\s]+$/i.test(v), { message: 'Tiene que empezar con https://' });

/** Quién es el responsable del tratamiento (art. 12 de la Ley 1581). */
export const dataConsentResponsibleSchema = z.object({
    /** Vacío = el nombre de la empresa en la app. */
    name: z.string().trim().max(200).default(''),
    id_number: z.string().trim().max(60).default(''),
    address: z.string().trim().max(300).default(''),
    city: z.string().trim().max(120).default(''),
    email: optionalEmail.default(''),
    phone: z.string().trim().max(60).default(''),
});
export type DataConsentResponsible = z.infer<typeof dataConsentResponsibleSchema>;

export const DATA_CONSENT_MAX_PURPOSES = 20;

export const dataConsentConfigSchema = z.object({
    /** Pedir la autorización (en los formularios y, si se elige, en el portal). */
    enabled: z.boolean().default(false),
    responsible: dataConsentResponsibleSchema.default({}),
    purposes: z
        .array(z.string().trim().min(1).max(500))
        .max(DATA_CONSENT_MAX_PURPOSES)
        .default([...DEFAULT_DATA_CONSENT_PURPOSES]),
    /** Enlace a la política completa de la empresa (https). */
    policy_url: optionalHttps.default(''),
    /** `null` = la plantilla sugerida (y recibe sus mejoras con cada versión de la app). */
    template: z.string().max(20000).nullable().default(null),
    /** Texto corto junto a la casilla. `null` = el sugerido. */
    checkbox_label: z.string().trim().max(500).nullable().default(null),
    /** Pedirla la primera vez que un cliente entra al portal (y cuando cambia la versión). */
    ask_in_portal: z.boolean().default(true),
    /** Versión vigente (número por empresa, no un id: viaja igual al migrar la empresa). */
    current_version: z.number().int().positive().nullable().default(null),
});
export type DataConsentConfig = z.infer<typeof dataConsentConfigSchema>;

/** Lectura tolerante de `tenants.settings.data_consent` (nunca lanza). */
export function readDataConsentConfig(raw: unknown): DataConsentConfig {
    const parsed = dataConsentConfigSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : dataConsentConfigSchema.parse({});
}

export const updateDataConsentSchema = z
    .object({
        enabled: z.boolean(),
        responsible: dataConsentResponsibleSchema,
        purposes: z.array(z.string().trim().max(500)).max(DATA_CONSENT_MAX_PURPOSES),
        policy_url: optionalHttps,
        template: z.string().max(20000).nullable(),
        checkbox_label: z.string().trim().max(500).nullable(),
        ask_in_portal: z.boolean(),
    })
    .partial();
export type UpdateDataConsentInput = z.infer<typeof updateDataConsentSchema>;

// ─────────────────────────── Armar el texto ───────────────────────────

export interface DataConsentContext {
    /** Nombre de la empresa en la app (si el responsable no tiene otro). */
    tenantName: string;
}

/** Los valores de cada variable para esta configuración. */
export function dataConsentVariables(cfg: DataConsentConfig, ctx: DataConsentContext): Record<string, string> {
    const r = cfg.responsible;
    return {
        empresa: r.name || ctx.tenantName.trim(),
        nit: r.id_number,
        direccion: r.address,
        ciudad: r.city,
        correo: r.email,
        telefono: r.phone,
        politica: cfg.policy_url,
        finalidades: cfg.purposes
            .map((p) => p.trim())
            .filter((p) => p !== '')
            .map((p) => `- ${p}`)
            .join('\n'),
    };
}

const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/gi;
/** Marca interna de «renglón que no va». */
const DROP = '\u0000';

/**
 * Resuelve las variables de un texto. Regla simple y predecible: un RENGLÓN
 * que usa una variable vacía no aparece (así «- NIT: {{nit}}» desaparece si
 * la empresa no cargó su NIT, en vez de quedar «NIT: » colgando). Una
 * variable desconocida queda escrita tal cual, para que se vea en la vista
 * previa y se corrija.
 */
export function fillDataConsentText(template: string, vars: Record<string, string>): string {
    // Las finalidades primero: son varios renglones y pueden usar variables.
    const expanded = template.replace(/^([^\n]*)\{\{\s*finalidades\s*\}\}([^\n]*)$/gim, (_line, before: string, after: string) => {
        const items = (vars.finalidades ?? '').split('\n').filter((l) => l.trim() !== '');
        // Sin finalidades, el renglón se cae como cualquier variable vacía.
        if (items.length === 0) return DROP;
        return items.map((it) => `${before}${it}${after}`).join('\n');
    });
    const out: string[] = [];
    for (const line of expanded.replace(/\r\n/g, '\n').split('\n')) {
        if (line === DROP) continue;
        let drop = false;
        const filled = line.replace(TOKEN, (whole, key: string) => {
            const k = key.toLowerCase();
            if (!(k in vars)) return whole;
            const v = (vars[k] ?? '').trim();
            if (v === '') drop = true;
            return v;
        });
        if (!drop) out.push(filled.replace(/[ \t]+$/g, ''));
    }
    return out
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** El texto y la casilla ya armados con los datos de la empresa. */
export function renderDataConsent(
    cfg: DataConsentConfig,
    ctx: DataConsentContext,
): { text: string; label: string; policy_url: string | null } {
    const vars = dataConsentVariables(cfg, ctx);
    return {
        text: fillDataConsentText(cfg.template ?? DEFAULT_DATA_CONSENT_TEMPLATE, vars),
        label: fillDataConsentText(cfg.checkbox_label ?? DEFAULT_DATA_CONSENT_LABEL, vars).replace(/\n+/g, ' '),
        policy_url: cfg.policy_url === '' ? null : cfg.policy_url,
    };
}

/**
 * Lo que falta para poder pedir la autorización. La Ley 1581 (art. 12) exige
 * informar quién es el responsable, su dirección física o electrónica y su
 * teléfono, y las finalidades. Sin esto no se puede activar.
 */
export function dataConsentMissing(cfg: DataConsentConfig, ctx: DataConsentContext): string[] {
    const out: string[] = [];
    const r = cfg.responsible;
    if (!(r.name || ctx.tenantName.trim())) out.push('Nombre o razón social del responsable');
    if (r.email === '') out.push('Correo para ejercer los derechos');
    if (r.phone === '') out.push('Teléfono del responsable');
    if (cfg.purposes.filter((p) => p.trim() !== '').length === 0) out.push('Al menos una finalidad');
    const text = cfg.template ?? DEFAULT_DATA_CONSENT_TEMPLATE;
    if (text.trim() === '') out.push('El texto de la autorización');
    const label = cfg.checkbox_label ?? DEFAULT_DATA_CONSENT_LABEL;
    if (label.trim() === '') out.push('El texto junto a la casilla');
    return out;
}

/** Recomendado, pero no bloquea (el texto se arma sin esos renglones). */
export function dataConsentRecommended(cfg: DataConsentConfig): string[] {
    const out: string[] = [];
    if (cfg.responsible.id_number === '') out.push('NIT o documento del responsable');
    if (cfg.responsible.address === '') out.push('Dirección física del responsable');
    if (cfg.policy_url === '') out.push('Enlace a la política de tratamiento de datos');
    return out;
}

// ─────────────────────────── Versiones y evidencia ───────────────────────────

export interface DataConsentVersionDto {
    version: number;
    text: string;
    checkbox_label: string;
    policy_url: string | null;
    /** SHA-256 de lo aceptado (casilla + texto + enlace): prueba de integridad. */
    text_hash: string;
    created_at: string;
    created_by_name: string | null;
    /** Cuántas autorizaciones se dieron sobre esta versión. */
    consents?: number;
}

export interface DataConsentState {
    config: DataConsentConfig;
    /** Lo sugerido (para «Restablecer» y para ver qué cambió). */
    defaults: { template: string; checkbox_label: string; purposes: string[] };
    variables: ReadonlyArray<{ key: string; label: string }>;
    /** El texto armado con la configuración ACTUAL (vista previa). */
    preview: { text: string; label: string; policy_url: string | null };
    missing: string[];
    recommended: string[];
    /** Se pide de verdad: activada y con una versión vigente. */
    active: boolean;
    current: DataConsentVersionDto | null;
    versions: Array<Omit<DataConsentVersionDto, 'text' | 'checkbox_label'>>;
    stats: { accepted: number; withdrawn: number; forms_asking: number };
}

export const DATA_CONSENT_SOURCES = ['form', 'portal', 'booking'] as const;
export type DataConsentSource = (typeof DATA_CONSENT_SOURCES)[number];

export const DATA_CONSENT_WITHDRAW_VIAS = ['link', 'portal', 'admin'] as const;
export type DataConsentWithdrawVia = (typeof DATA_CONSENT_WITHDRAW_VIAS)[number];

export const DATA_CONSENT_WITHDRAW_VIA_LABELS: Record<DataConsentWithdrawVia, string> = {
    link: 'desde el enlace del correo',
    portal: 'desde el portal del cliente',
    admin: 'registrada por la empresa',
};

/** Una autorización tal como la ve el admin (con la evidencia completa). */
export interface DataConsentRecordDto {
    id: number;
    version: number;
    source: DataConsentSource;
    /** «Formulario «Contacto»» o «Portal del cliente». */
    source_label: string;
    form_id: number | null;
    list_id: number | null;
    list_name: string | null;
    list_slug: string | null;
    record_id: number | null;
    subject_name: string | null;
    subject_email: string | null;
    accepted_at: string;
    ip: string | null;
    user_agent: string | null;
    withdrawn_at: string | null;
    withdrawn_via: DataConsentWithdrawVia | null;
    withdrawn_note: string | null;
    withdrawn_by_name: string | null;
}

export interface DataConsentRecordsPage {
    items: DataConsentRecordDto[];
    next_cursor: number | null;
}

export const listDataConsentsQuerySchema = z.object({
    status: z.enum(['all', 'active', 'withdrawn']).default('all'),
    source: z.enum(['all', 'form', 'portal', 'booking']).default('all'),
    /** Aceptadas desde / hasta este día (zona de la empresa), inclusive. */
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    /** Nombre o correo del titular. */
    q: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});
export type ListDataConsentsQuery = z.infer<typeof listDataConsentsQuerySchema>;

/** El admin registra un retiro que llegó por otro canal (correo, teléfono). */
export const adminWithdrawConsentSchema = z.object({
    note: z.string().trim().max(500).default(''),
});
export type AdminWithdrawConsentInput = z.infer<typeof adminWithdrawConsentSchema>;

/**
 * Lo que la FICHA de un registro muestra de sus autorizaciones: sin IP ni
 * navegador (eso es evidencia para el admin, en Ajustes → Datos personales).
 */
export interface RecordDataConsentDto {
    id: number;
    version: number;
    source: DataConsentSource;
    source_label: string;
    subject_name: string | null;
    subject_email: string | null;
    accepted_at: string;
    withdrawn_at: string | null;
    withdrawn_via: DataConsentWithdrawVia | null;
}

// ─────────────────────────── Formularios y portal ───────────────────────────

/** Lo que la página pública necesita para dibujar la casilla. */
export interface PublicDataConsent {
    version: number;
    label: string;
    text: string;
    policy_url: string | null;
}

/** ¿Pueden los formularios de esta empresa pedir la autorización? (constructor) */
export interface FormDataConsentAvailability {
    active: boolean;
    consent: PublicDataConsent | null;
    /** Quien mira puede configurarla (admin). */
    can_configure: boolean;
}

export const PORTAL_CONSENT_STATUSES = ['not_required', 'required', 'accepted', 'outdated', 'withdrawn'] as const;
export type PortalConsentStatus = (typeof PORTAL_CONSENT_STATUSES)[number];

/** El estado de la autorización del cliente en el portal de la empresa. */
export interface PortalConsentDto {
    status: PortalConsentStatus;
    /** La versión vigente (la que se le pide aceptar). */
    consent: PublicDataConsent | null;
    company: string;
    branding: { primary_color: string | null; app_name: string | null; logo_url: string | null };
    accepted_at: string | null;
    accepted_version: number | null;
    withdrawn_at: string | null;
}

export const portalAcceptConsentSchema = z.object({ version: idSchema });
export type PortalAcceptConsentInput = z.infer<typeof portalAcceptConsentSchema>;

/** En el boot del portal: para el menú («Ver / retirar mi autorización»). */
export const portalBootConsentSchema = z
    .object({
        version: z.number().int().positive(),
        accepted_at: z.string(),
    })
    .nullable()
    .default(null);
