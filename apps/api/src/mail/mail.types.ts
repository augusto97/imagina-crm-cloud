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
}

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
