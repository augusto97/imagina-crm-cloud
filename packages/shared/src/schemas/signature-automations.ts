/**
 * D6 — Firma electrónica en las automatizaciones (v0.1.447, ADR-S107).
 *
 *  - Disparador «Cuando cambia una firma» (`signature_event`): se pidió, alguien
 *    firmó, firmaron todos, alguien no quiso firmar, venció o se anuló. Las
 *    acciones leen `{{firma.x}}`.
 *  - Acción «Pedir firma» (`request_signature`): arma el PDF de una plantilla
 *    de la lista (o toma el que está en un campo Archivo del registro) y lo
 *    manda a firmar a las personas que digan las variables. Deja `{{firma.x}}`
 *    (el enlace del primero que tiene que firmar, el código, la verificación)
 *    para los pasos siguientes: mandarlo por WhatsApp, por ejemplo.
 *
 * Todo puro y sin zod: lo usan el motor, el editor y el asistente.
 */

export const SIGNATURE_EVENT_TRIGGER = 'signature_event';
export const REQUEST_SIGNATURE_ACTION = 'request_signature';

export const SIGNATURE_EVENTS = ['requested', 'signed', 'completed', 'declined', 'expired', 'voided'] as const;
export type SignatureEvent = (typeof SIGNATURE_EVENTS)[number];

export const SIGNATURE_EVENT_LABELS: Record<SignatureEvent, string> = {
    requested: 'Se pidió la firma',
    signed: 'Alguien firmó',
    completed: 'Firmaron todos',
    declined: 'Alguien no quiso firmar',
    expired: 'Venció sin todas las firmas',
    voided: 'Se anuló',
};

/** Lo que el disparador (o la acción «Pedir firma») le pasa a los pasos siguientes como `{{firma.x}}`. */
export interface SignatureEventInfo {
    request_id: number;
    evento: SignatureEvent;
    titulo: string;
    /** Etiqueta del estado de la solicitud («Esperando firmas», «Firmado»…). */
    estado: string;
    /** El estado en clave (`pending`, `completed`, `declined`, `expired`, `voided`): para otros programas. */
    estado_clave: string;
    /** Número del documento si la plantilla numera («CC-0042»). */
    numero: string | null;
    /** Quien firmó o no quiso firmar (en esos eventos). */
    firmante: string | null;
    firmante_email: string | null;
    firmante_rol: string | null;
    firmaron: number;
    total: number;
    /** Por qué no quiso firmar o por qué se anuló. */
    motivo: string | null;
    /** Código corto de la solicitud (está en la constancia). */
    codigo: string;
    /** Página pública para verificar el documento. */
    verificar: string;
    /** La próxima persona que tiene que firmar y su enlace personal (null si no queda nadie). */
    siguiente: string | null;
    siguiente_email: string | null;
    enlace: string | null;
    /** El PDF firmado (cuando firmaron todos): un enlace de descarga. */
    pdf: string | null;
    template_id: number | null;
}

/** ¿El disparador reacciona a este evento? (sin eventos elegidos = todos). */
export function signatureTriggerMatches(cfg: Record<string, unknown>, info: Pick<SignatureEventInfo, 'evento' | 'template_id'>): boolean {
    const events = readSignatureTriggerEvents(cfg);
    if (events.length > 0 && !events.includes(info.evento)) return false;
    const templates = Array.isArray(cfg.signature_template_ids)
        ? (cfg.signature_template_ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : [];
    if (templates.length > 0 && (info.template_id === null || !templates.includes(info.template_id))) return false;
    return true;
}

export function readSignatureTriggerEvents(cfg: Record<string, unknown>): SignatureEvent[] {
    const raw = Array.isArray(cfg.signature_events) ? (cfg.signature_events as unknown[]).map(String) : [];
    return SIGNATURE_EVENTS.filter((e) => raw.includes(e));
}

export const SIGNATURE_MERGE_TAGS: Array<{ tag: string; label: string }> = [
    { tag: 'firma.evento', label: 'Qué pasó' },
    { tag: 'firma.titulo', label: 'Nombre del documento' },
    { tag: 'firma.estado', label: 'Estado de la firma' },
    { tag: 'firma.numero', label: 'Número del documento' },
    { tag: 'firma.firmante', label: 'Quien firmó (o no quiso)' },
    { tag: 'firma.firmante_email', label: 'Correo de quien firmó' },
    { tag: 'firma.firmaron', label: 'Cuántos firmaron' },
    { tag: 'firma.total', label: 'Cuántos tienen que firmar' },
    { tag: 'firma.motivo', label: 'Motivo (no firmó o se anuló)' },
    { tag: 'firma.siguiente', label: 'Quien firma ahora' },
    { tag: 'firma.siguiente_email', label: 'Correo de quien firma ahora' },
    { tag: 'firma.enlace', label: 'Enlace para firmar (de quien firma ahora)' },
    { tag: 'firma.pdf', label: 'PDF firmado (cuando firmaron todos)' },
    { tag: 'firma.verificar', label: 'Página para verificar el documento' },
    { tag: 'firma.codigo', label: 'Código de verificación' },
];

/** El valor de `{{firma.x}}` (vacío si no aplica). */
export function signatureEventValue(info: SignatureEventInfo, key: string): string | undefined {
    switch (key) {
        case 'evento':
            return SIGNATURE_EVENT_LABELS[info.evento] ?? info.evento;
        case 'evento_clave':
            return info.evento;
        case 'id':
            return String(info.request_id);
        case 'titulo':
            return info.titulo;
        case 'estado':
            return info.estado;
        case 'estado_clave':
            return info.estado_clave;
        case 'numero':
            return info.numero ?? '';
        case 'firmante':
            return info.firmante ?? '';
        case 'firmante_email':
            return info.firmante_email ?? '';
        case 'firmante_rol':
            return info.firmante_rol ?? '';
        case 'firmaron':
            return String(info.firmaron);
        case 'total':
            return String(info.total);
        case 'motivo':
            return info.motivo ?? '';
        case 'codigo':
            return info.codigo;
        case 'verificar':
            return info.verificar;
        case 'siguiente':
            return info.siguiente ?? '';
        case 'siguiente_email':
            return info.siguiente_email ?? '';
        case 'enlace':
            return info.enlace ?? '';
        case 'pdf':
            return info.pdf ?? '';
        default:
            return undefined;
    }
}

/** Resumen en palabras del disparador («Cuando firman todos»). */
export function signatureTriggerSummary(cfg: Record<string, unknown>): string {
    const events = readSignatureTriggerEvents(cfg);
    if (events.length === 0) return 'Cuando cambia una firma';
    if (events.length === 1) {
        const one: Record<SignatureEvent, string> = {
            requested: 'Cuando se pide una firma',
            signed: 'Cuando alguien firma',
            completed: 'Cuando firman todos un documento',
            declined: 'Cuando alguien no quiere firmar',
            expired: 'Cuando vence una firma sin completarse',
            voided: 'Cuando se anula una firma',
        };
        return one[events[0]!];
    }
    return `Cuando una firma: ${events.map((e) => SIGNATURE_EVENT_LABELS[e].toLowerCase()).join(', ')}`;
}

// ─────────────────────────── Acción «Pedir firma» ───────────────────────────

export interface RequestSignatureSignerConfig {
    /** Nombre (acepta variables: «{{nombre}}»). */
    name: string;
    /** Correo (acepta variables o el slug de un campo correo / persona). */
    email: string;
    role: string;
    /** v0.1.448 — Celular para el código por SMS o WhatsApp (acepta variables o el slug de un campo teléfono). */
    phone: string;
}

export interface RequestSignatureActionConfig {
    source: 'template' | 'file';
    template_id: number | null;
    /** Slug del campo Archivo con el PDF (se toma el último PDF del campo). */
    file_field: string;
    title: string;
    signers: RequestSignatureSignerConfig[];
    order: 'parallel' | 'sequential';
    verify: 'email' | 'sms' | 'whatsapp' | 'none';
    /** v0.1.448 — Conexión de SMS o WhatsApp (del equipo) por la que sale el código. */
    verify_connection_id: number | null;
    /** v0.1.448 — Con WhatsApp de Meta: la plantilla aprobada (todas sus variables llevan el código). */
    verify_template: { name: string; language: string } | null;
    message: string;
    expires_days: number;
    remind_days: number;
    send_email: boolean;
    /** Qué pasa en el registro cuando firman todos (slugs). */
    save_field: string;
    status_field: string;
    status_value: string;
    date_field: string;
}

const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, min: number, max: number, dflt: number): number => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

function readVerifyTemplate(v: unknown): { name: string; language: string } | null {
    if (!v || typeof v !== 'object') return null;
    const t = v as Record<string, unknown>;
    const name = str(t.name, 512);
    const language = str(t.language, 16);
    return name !== '' && language !== '' ? { name, language } : null;
}

/** Lectura tolerante de la config de la acción (lo guardado antes o a medias no rompe). */
export function readRequestSignatureConfig(cfg: Record<string, unknown>): RequestSignatureActionConfig {
    const tpl = Number(cfg.template_id);
    const signers = Array.isArray(cfg.signers)
        ? (cfg.signers as unknown[])
              .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
              .slice(0, 10)
              .map((s) => ({ name: str(s.name, 300), email: str(s.email, 300), role: str(s.role, 60), phone: str(s.phone, 300) }))
        : [];
    return {
        source: cfg.source === 'file' ? 'file' : 'template',
        template_id: Number.isInteger(tpl) && tpl > 0 ? tpl : null,
        file_field: str(cfg.file_field, 120),
        title: str(cfg.title, 160),
        signers,
        order: cfg.order === 'sequential' ? 'sequential' : 'parallel',
        verify: cfg.verify === 'none' || cfg.verify === 'sms' || cfg.verify === 'whatsapp' ? cfg.verify : 'email',
        verify_connection_id: Number.isInteger(Number(cfg.verify_connection_id)) && Number(cfg.verify_connection_id) > 0 ? Number(cfg.verify_connection_id) : null,
        verify_template: readVerifyTemplate(cfg.verify_template),
        message: str(cfg.message, 2000),
        expires_days: int(cfg.expires_days, 1, 180, 30),
        remind_days: int(cfg.remind_days, 0, 30, 3),
        send_email: cfg.send_email !== false,
        save_field: str(cfg.save_field, 120),
        status_field: str(cfg.status_field, 120),
        status_value: str(cfg.status_value, 120),
        date_field: str(cfg.date_field, 120),
    };
}

/** Lo que falta para guardar la acción (en palabras, con la ruta del dato). */
export function requestSignatureIssues(cfg: Record<string, unknown>, at: string): Array<{ path: string; message: string }> {
    const out: Array<{ path: string; message: string }> = [];
    const c = readRequestSignatureConfig(cfg);
    if (c.source === 'template' && c.template_id === null) out.push({ path: `${at}.config.template_id`, message: 'Elige la plantilla del documento que se firma.' });
    if (c.source === 'file' && c.file_field === '') out.push({ path: `${at}.config.file_field`, message: 'Elige el campo Archivo con el PDF que se firma.' });
    if (c.signers.length === 0) out.push({ path: `${at}.config.signers`, message: 'Agrega al menos una persona que firme.' });
    c.signers.forEach((s, i) => {
        if (s.email === '') out.push({ path: `${at}.config.signers.${i}.email`, message: `Escribe el correo de la persona ${i + 1} (o una variable como «{{correo}}»).` });
        if (s.name === '') out.push({ path: `${at}.config.signers.${i}.name`, message: `Escribe el nombre de la persona ${i + 1} (o una variable como «{{nombre}}»).` });
        if ((c.verify === 'sms' || c.verify === 'whatsapp') && s.phone === '') {
            out.push({ path: `${at}.config.signers.${i}.phone`, message: `Escribe el celular de la persona ${i + 1} (o una variable como «{{celular}}»): ahí le llega el código.` });
        }
    });
    if ((c.verify === 'sms' || c.verify === 'whatsapp') && c.verify_connection_id === null) {
        out.push({
            path: `${at}.config.verify_connection_id`,
            message: c.verify === 'sms' ? 'Elige la conexión de SMS por la que sale el código.' : 'Elige la conexión de WhatsApp por la que sale el código.',
        });
    }
    if ((c.status_field === '') !== (c.status_value === '')) {
        out.push({ path: `${at}.config.status_value`, message: 'Elige el campo de estado y su opción, o ninguno.' });
    }
    return out;
}

/** Variables que deja la acción «Pedir firma» (para el selector del editor). */
export const REQUEST_SIGNATURE_OUTPUTS: Array<{ tag: string; label: string }> = [
    { tag: 'firma.enlace', label: 'Enlace para firmar (de quien firma primero)' },
    { tag: 'firma.siguiente', label: 'Quien firma primero' },
    { tag: 'firma.titulo', label: 'Nombre del documento' },
    { tag: 'firma.numero', label: 'Número del documento' },
    { tag: 'firma.verificar', label: 'Página para verificar' },
    { tag: 'firma.codigo', label: 'Código de verificación' },
];

/** Resumen en palabras de la acción («Pide la firma de «Contrato» a 2 personas, en orden»). */
export function requestSignatureSummary(cfg: Record<string, unknown>, templateName?: string | null): string {
    const c = readRequestSignatureConfig(cfg);
    const doc = c.source === 'file' ? 'el PDF del registro' : templateName ? `«${templateName}»` : 'un documento';
    const n = c.signers.length;
    const who = n === 0 ? '' : n === 1 ? ' a 1 persona' : ` a ${n} personas`;
    const via = c.verify === 'sms' ? ', con código por SMS' : c.verify === 'whatsapp' ? ', con código por WhatsApp' : '';
    return `Pide la firma de ${doc}${who}${n > 1 && c.order === 'sequential' ? ', en orden' : ''}${via}`;
}
