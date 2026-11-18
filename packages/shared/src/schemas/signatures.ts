import { z } from 'zod';
import { idSchema } from './common';
import { emailSchema } from './auth';

/**
 * D6 — Firma electrónica de documentos (v0.1.446, ADR-S107).
 *
 * Un PDF de la app (una plantilla de documento de la lista, o un PDF que ya
 * está en un campo Archivo del registro) se manda a firmar por enlace a una o
 * varias personas. Quien firma lo lee, confirma su correo con un código,
 * dibuja o escribe su firma y acepta. Cuando firman todos, el PDF final lleva
 * cada página sellada y una hoja de constancia (quién, cuándo, desde dónde,
 * cómo se identificó y la huella SHA-256 del documento original).
 *
 * Es firma electrónica SIMPLE (Ley 527 de 1999, Decreto 2364 de 2012): no es
 * firma digital con certificado de una entidad acreditada.
 */

export const SIGNATURE_REQUEST_STATUSES = ['pending', 'completed', 'declined', 'expired', 'voided'] as const;
export type SignatureRequestStatus = (typeof SIGNATURE_REQUEST_STATUSES)[number];

/** `waiting` = todavía no le toca (firma en orden); `sent` = recibió el enlace. */
export const SIGNER_STATUSES = ['waiting', 'sent', 'viewed', 'signed', 'declined'] as const;
export type SignerStatus = (typeof SIGNER_STATUSES)[number];

export const SIGNATURE_ORDERS = ['parallel', 'sequential'] as const;
export type SignatureOrder = (typeof SIGNATURE_ORDERS)[number];

/**
 * Cómo se identifica quien firma antes de firmar: un código de 6 números por
 * correo, por SMS o por WhatsApp (v0.1.448), o sólo con el enlace.
 */
export const SIGNATURE_VERIFY = ['email', 'sms', 'whatsapp', 'none'] as const;
export type SignatureVerify = (typeof SIGNATURE_VERIFY)[number];

export const SIGNATURE_VERIFY_LABELS: Record<SignatureVerify, string> = {
    email: 'Con un código que le llega al correo',
    sms: 'Con un código que le llega por SMS',
    whatsapp: 'Con un código que le llega por WhatsApp',
    none: 'Sólo con el enlace',
};

/** ¿El código va al celular? (entonces cada persona necesita su número y hay que elegir la conexión). */
export function signatureVerifyNeedsPhone(verify: SignatureVerify | string): verify is 'sms' | 'whatsapp' {
    return verify === 'sms' || verify === 'whatsapp';
}

/**
 * Un número que se puede usar para mandar el código: 7 a 15 dígitos, con o sin
 * indicativo (`+57…`). La conexión le pone el indicativo de su país si falta.
 */
export function signaturePhoneLooksValid(raw: string): boolean {
    const t = raw.trim();
    if (t === '' || !/^\+?[\d\s().-]+$/.test(t)) return false;
    const digits = t.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
}

/** «••• ••• 812»: a qué celular se mandó el código, sin mostrar el número entero. */
export function maskPhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 4) return '•••';
    return `••• ••• ${digits.slice(-3)}`;
}

/** Plantilla aprobada de WhatsApp (API oficial de Meta) con la que sale el código: todas sus variables llevan el código. */
export const signatureVerifyTemplateSchema = z.object({
    name: z.string().trim().min(1).max(512),
    language: z.string().trim().min(2).max(16),
});
export type SignatureVerifyTemplate = z.infer<typeof signatureVerifyTemplateSchema>;

export const SIGNATURE_MAX_SIGNERS = 10;
/** Tope del PDF a firmar (el que se sube a un campo o el que arma una plantilla). */
export const SIGNATURE_MAX_PDF_BYTES = 20 * 1024 * 1024;
/** Tope de la imagen de la firma que manda la página (PNG en base64). */
export const SIGNATURE_MAX_IMAGE_CHARS = 600_000;

export const signatureSignerInputSchema = z.object({
    name: z.string().trim().min(1, 'Escribe el nombre de quien firma').max(120),
    email: emailSchema,
    /** «Cliente», «Representante legal»… (aparece en la constancia). */
    role: z.string().trim().max(60).optional().default(''),
    /** v0.1.448 — Celular para el código por SMS o WhatsApp. */
    phone: z.string().trim().max(32).optional().default(''),
});
export type SignatureSignerInput = z.infer<typeof signatureSignerInputSchema>;

export const signatureSourceSchema = z.discriminatedUnion('kind', [
    /** Una plantilla de documento PDF de la lista (se arma con los datos del registro). */
    z.object({ kind: z.literal('template'), template_id: idSchema }),
    /** Un PDF que ya está en un campo Archivo del registro. */
    z.object({ kind: z.literal('file'), file_id: idSchema }),
]);
export type SignatureSource = z.infer<typeof signatureSourceSchema>;

/** Qué pasa en el registro cuando firman todos. */
export const signatureOnCompleteSchema = z.object({
    /** Campo Archivo donde se agrega el PDF firmado. */
    save_field_id: idSchema.nullable().default(null),
    /** Campo de selección que cambia de valor… */
    status_field_id: idSchema.nullable().default(null),
    /** …a esta opción (su `value`). */
    status_value: z.string().trim().max(120).nullable().default(null),
    /** Campo de fecha (o fecha y hora) con el momento de la última firma. */
    date_field_id: idSchema.nullable().default(null),
});
export type SignatureOnComplete = z.infer<typeof signatureOnCompleteSchema>;

export const createSignatureRequestSchema = z
    .object({
        record_id: idSchema,
        source: signatureSourceSchema,
        /** Nombre del documento (vacío = el de la plantilla o del archivo). */
        title: z.string().trim().max(160).optional().default(''),
        signers: z.array(signatureSignerInputSchema).min(1, 'Agrega al menos una persona').max(SIGNATURE_MAX_SIGNERS),
        order: z.enum(SIGNATURE_ORDERS).default('parallel'),
        message: z.string().trim().max(2000).optional().default(''),
        expires_days: z.number().int().min(1).max(180).default(30),
        verify: z.enum(SIGNATURE_VERIFY).default('email'),
        /** v0.1.448 — Conexión de SMS o de WhatsApp (del equipo) por la que sale el código. */
        verify_connection_id: idSchema.nullable().default(null),
        /** v0.1.448 — Con WhatsApp de Meta: la plantilla aprobada del código. */
        verify_template: signatureVerifyTemplateSchema.nullable().default(null),
        /** Cada cuántos días se le recuerda a quien no firmó (0 = nunca; máximo 3 recordatorios). */
        remind_days: z.number().int().min(0).max(30).default(3),
        on_complete: signatureOnCompleteSchema.default({}),
        /** false = no manda correos: se copian los enlaces y se mandan por otro medio. */
        send_email: z.boolean().default(true),
    })
    .superRefine((v, ctx) => {
        const seen = new Set<string>();
        v.signers.forEach((s, i) => {
            const key = s.email.toLowerCase();
            if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['signers', i, 'email'], message: 'Este correo ya está en la lista' });
            seen.add(key);
        });
        if (signatureVerifyNeedsPhone(v.verify)) {
            if (v.verify_connection_id === null) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['verify_connection_id'],
                    message: v.verify === 'sms' ? 'Elige la conexión de SMS por la que sale el código' : 'Elige la conexión de WhatsApp por la que sale el código',
                });
            }
            v.signers.forEach((s, i) => {
                if (!signaturePhoneLooksValid(s.phone)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['signers', i, 'phone'],
                        message: s.phone.trim() === '' ? 'Escribe el celular de esta persona: ahí le llega el código' : 'El celular no parece válido',
                    });
                }
            });
        }
        if ((v.on_complete.status_field_id === null) !== (v.on_complete.status_value === null || v.on_complete.status_value === '')) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['on_complete', 'status_value'], message: 'Elige el campo y la opción, o ninguno' });
        }
    });
export type CreateSignatureRequestInput = z.infer<typeof createSignatureRequestSchema>;

export const voidSignatureRequestSchema = z.object({
    reason: z.string().trim().max(500).optional().default(''),
});
export type VoidSignatureRequestInput = z.infer<typeof voidSignatureRequestSchema>;

/** Lo que manda la página al firmar. */
export const submitSignatureSchema = z.object({
    /** Nombre completo tal como lo escribe quien firma (va a la constancia). */
    name: z.string().trim().min(2, 'Escribe tu nombre completo').max(120),
    kind: z.enum(['drawn', 'typed']),
    /** La firma como PNG (`data:image/png;base64,…`). */
    image: z
        .string()
        .max(SIGNATURE_MAX_IMAGE_CHARS, 'La firma es demasiado grande')
        .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'La firma no es válida'),
    code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, 'El código tiene 6 números')
        .optional(),
    consent: z.literal(true, { errorMap: () => ({ message: 'Para firmar tienes que aceptar' }) }),
});
export type SubmitSignatureInput = z.infer<typeof submitSignatureSchema>;

export const declineSignatureSchema = z.object({
    reason: z.string().trim().min(3, 'Cuéntanos por qué no firmas').max(1000),
});
export type DeclineSignatureInput = z.infer<typeof declineSignatureSchema>;

// ─────────────────────────── DTO ───────────────────────────

export interface SignerDto {
    id: number;
    position: number;
    name: string;
    email: string;
    role: string;
    /** v0.1.448 — Celular (para el código por SMS o WhatsApp); vacío si no se pidió. */
    phone: string;
    status: SignerStatus;
    sent_at: string | null;
    viewed_at: string | null;
    signed_at: string | null;
    declined_at: string | null;
    decline_reason: string | null;
    reminders_sent: number;
    /** Nombre con el que firmó (lo que escribió). */
    signed_name: string | null;
    /** Sólo para quien pidió la firma: el enlace para mandarlo por otro medio (null si ya firmó o no le toca). */
    link: string | null;
}

export interface SignatureRequestDto {
    id: number;
    list_id: number;
    record_id: number;
    title: string;
    status: SignatureRequestStatus;
    order: SignatureOrder;
    verify: SignatureVerify;
    /** v0.1.448 — Conexión por la que sale el código (SMS o WhatsApp) y su nombre. */
    verify_connection_id: number | null;
    verify_connection_name: string | null;
    message: string;
    source: 'template' | 'file';
    template_id: number | null;
    /** Número del documento si la plantilla numera («CC-0042»). */
    document_number: string | null;
    original_sha256: string;
    signed_sha256: string | null;
    pages: number;
    expires_at: string;
    created_at: string;
    created_by: number | null;
    created_by_name: string | null;
    completed_at: string | null;
    voided_at: string | null;
    void_reason: string | null;
    /** Código corto público de la solicitud (está en la constancia). */
    code: string;
    on_complete: SignatureOnComplete;
    signers: SignerDto[];
}

/** Lo que ve quien firma (sin datos de las demás personas salvo nombre y estado). */
export interface PublicSignatureDto {
    title: string;
    company: string;
    brand: { name: string; color: string | null; logo_url: string | null };
    status: SignatureRequestStatus;
    message: string;
    expires_at: string;
    pages: number;
    verify: SignatureVerify;
    /** `phone_masked`: a qué celular llega el código («••• ••• 812»), con SMS o WhatsApp. */
    signer: { name: string; email_masked: string; phone_masked: string | null; status: SignerStatus; role: string };
    /** Las demás personas: nombre, rol y si ya firmaron. */
    others: Array<{ name: string; role: string; status: SignerStatus }>;
    /** El texto exacto de la aceptación (va también a la constancia). */
    consent_text: string;
    /** Firmado por todos: la página ofrece descargar el PDF firmado. */
    signed_available: boolean;
    /** Verificación pública (enlace de la constancia). */
    verify_url: string;
}

// ─────────────────────────── Reglas puras ───────────────────────────

/** a***@dominio.com — para mostrar a quién se mandó el código sin exponer el correo entero. */
export function maskEmail(email: string): string {
    const [user = '', domain = ''] = email.split('@');
    if (!domain) return email;
    const head = user.slice(0, Math.min(2, Math.max(1, user.length - 1)));
    return `${head}${'*'.repeat(Math.max(1, Math.min(6, user.length - head.length)))}@${domain}`;
}

/**
 * El texto que acepta quien firma. Va igual a la constancia: lo que se lee es
 * lo que queda como prueba.
 */
export function signatureConsentText(company: string): string {
    const who = company.trim() || 'quien me lo envió';
    return (
        `Acepto firmar este documento por medios electrónicos. Entiendo que mi firma electrónica tiene la misma validez ` +
        `que una firma manuscrita (Ley 527 de 1999 y Decreto 2364 de 2012) y que ${who} conserva una constancia con la ` +
        `fecha, la hora, mi dirección IP, el navegador que usé y la huella del documento.`
    );
}

export interface SignerLike {
    position: number;
    status: SignerStatus;
}

/**
 * A quiénes les toca firmar AHORA: todos los pendientes si es en paralelo; en
 * orden, sólo el de la posición más baja que todavía no firmó.
 */
export function signersDue<T extends SignerLike>(order: SignatureOrder, signers: readonly T[]): T[] {
    const open = signers.filter((s) => s.status !== 'signed' && s.status !== 'declined');
    if (order === 'parallel') return open;
    const next = [...open].sort((a, b) => a.position - b.position)[0];
    return next ? [next] : [];
}

/** «1 de 3 firmaron». */
export function signatureProgress(signers: readonly SignerLike[]): { signed: number; total: number } {
    return { signed: signers.filter((s) => s.status === 'signed').length, total: signers.length };
}

export const SIGNATURE_STATUS_LABELS: Record<SignatureRequestStatus, string> = {
    pending: 'Esperando firmas',
    completed: 'Firmado',
    declined: 'Rechazado',
    expired: 'Vencido',
    voided: 'Anulado',
};

export const SIGNER_STATUS_LABELS: Record<SignerStatus, string> = {
    waiting: 'Le toca después',
    sent: 'Enviado',
    viewed: 'Lo abrió',
    signed: 'Firmó',
    declined: 'Rechazó',
};

/** Un nombre de archivo para el PDF firmado: «Contrato - firmado.pdf». */
export function signedFilename(title: string): string {
    const base = title.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Documento';
    return `${base} - firmado.pdf`;
}

/**
 * v0.1.447 — Lo que el cliente ve en su portal: los documentos de SU registro
 * en los que es una de las personas que firman (por su correo). `sign_url` es
 * su enlace personal mientras le toque firmar; el firmado se baja con
 * `GET /portal/me/signatures/:id/signed.pdf`.
 */
export const portalSignatureSchema = z.object({
    id: idSchema,
    title: z.string(),
    status: z.enum(SIGNATURE_REQUEST_STATUSES),
    document_number: z.string().nullable(),
    my_status: z.enum(SIGNER_STATUSES),
    sign_url: z.string().nullable(),
    signed_available: z.boolean(),
    created_at: z.string(),
    expires_at: z.string(),
});
export type PortalSignature = z.infer<typeof portalSignatureSchema>;

/** Lo que responde pedir el código: por dónde salió y a qué destino (enmascarado). */
export interface SignatureCodeSent {
    sent: boolean;
    channel: 'email' | 'sms' | 'whatsapp';
    /** El correo o el celular enmascarado. */
    destination: string;
    /** Compatibilidad con la página de v0.1.446: el destino (correo o celular) enmascarado. */
    email_masked: string;
    minutes: number;
}

/**
 * v0.1.448 — Una conexión de la empresa (del equipo) que puede mandar el
 * código de firma: SMS o WhatsApp. Con WhatsApp de Meta hace falta una
 * plantilla aprobada (`templates`; conviene una de categoría «Autenticación»).
 */
export interface SignatureCodeChannel {
    id: number;
    name: string;
    channel: 'sms' | 'whatsapp';
    /** `sms_twilio`, `whatsapp_cloud`, `whatsapp_web`… */
    provider: string;
    needs_template: boolean;
    templates: Array<{ name: string; language: string; category: string; preview: string; usable: boolean; reason: string | null }>;
}

/** El texto del código cuando sale por SMS o por WhatsApp (Whats, sin plantilla). */
export function signatureCodeText(code: string, company: string, minutes: number): string {
    const who = company.trim() !== '' ? `${company.trim()}: ` : '';
    return `${who}tu código para firmar es ${code}. Vence en ${minutes} minutos. No lo compartas con nadie.`;
}
