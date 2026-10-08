/** Un mensaje de correo listo para enviar. `text` es el fallback plano. */
export interface MailMessage {
    /** Tenant emisor: si tiene SMTP propio, el correo sale por él. */
    tenantId?: number;
    to: string;
    subject: string;
    html?: string;
    text?: string;
    cc?: string;
    bcc?: string;
    /** Override del remitente (email); si falta, el transporte usa su default. */
    from?: string;
    fromName?: string;
    /**
     * v0.1.245 — `fromName` es sólo una SUGERENCIA (la marca de la empresa en
     * los correos del portal): por el SMTP compartido da nombre al remitente
     * de la plataforma, pero con SMTP propio manda el remitente que la empresa
     * configuró ahí.
     */
    fromNameSoft?: boolean;
    /** A dónde van las respuestas (SEC-33: el `from` de una empresa por SMTP compartido). */
    replyTo?: string;
    /**
     * v0.1.266 — Adjuntos (un PDF generado: cuenta de cobro, recibo). El
     * contenido viaja en base64 para que el mensaje siga siendo JSON plano
     * (la cola de correo lo serializa).
     */
    attachments?: MailAttachment[];
}

export interface MailAttachment {
    filename: string;
    contentType: string;
    contentBase64: string;
}

/** Tope total de adjuntos de un correo (Gmail admite 25 MB; dejamos margen). */
export const MAIL_MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/**
 * Transporte de correo intercambiable (ADR-S11): `log` para dev/tests y `smtp`
 * (nodemailer) para producción. El `MailService` no conoce la implementación,
 * sólo esta interfaz — así enchufar un proveedor real no toca el dominio.
 */
export interface MailTransport {
    readonly name: string;
    send(message: MailMessage): Promise<void>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/**
 * v0.1.249 (ADR-S29) — la CUENTA de Google o Microsoft de la empresa como
 * forma de envío. Lo implementa el módulo de conectores (que tiene los tokens)
 * y lo consume el MailService: se declara acá como interfaz para no atar el
 * correo a los conectores (los tests de correo siguen sin conocerlos).
 */
export interface TenantMailAccountSender {
    /**
     * Transporte de la cuenta elegida por la empresa, o `null` si no eligió
     * ninguna. Si eligió una y hoy no se puede usar (se borró, se revocó el
     * acceso), LANZA: caer al correo de la plataforma cambiaría el remitente en
     * silencio, que es el tipo de fallo que v0.1.150 dejó de tolerar.
     */
    resolve(tenantId: number): Promise<MailTransport | null>;
}

export const MAIL_ACCOUNT_SENDER = Symbol('MAIL_ACCOUNT_SENDER');

/** La empresa eligió una cuenta y hoy no se puede usar: el motivo, legible. */
export class MailAccountUnusableError extends Error {
    readonly code = 'mail_account_unusable';
}

/**
 * La cuenta llegó al límite de envío del proveedor. Reintentar en segundos no
 * sirve (Google y Microsoft bloquean hasta 24 h): el worker lo marca como
 * irrecuperable y el motivo queda donde el usuario lo busca.
 */
export class MailAccountLimitError extends Error {
    readonly code = 'mail_account_limit';
}
