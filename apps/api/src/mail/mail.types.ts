/** Un mensaje de correo listo para enviar. `text` es el fallback plano. */
export interface MailMessage {
    to: string;
    subject: string;
    html?: string;
    text?: string;
    cc?: string;
    bcc?: string;
    /** Override del remitente (email); si falta, el transporte usa su default. */
    from?: string;
    fromName?: string;
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
