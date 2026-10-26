import { Injectable } from '@nestjs/common';
import type { ImapDiagnostic, ImapDiagnosticStep, ImapSecurity } from '@imagina-base/shared';
import { ImapFlow } from 'imapflow';

/**
 * D2 — El lector del buzón por IMAP, detrás de una interfaz (`ImapReader`):
 * el motor no conoce la librería y los tests pueden usar un servidor IMAP de
 * verdad (el de `test/helpers/fake-imap-server.ts`) o uno en memoria.
 *
 * Sólo LEE: abre la carpeta en modo sólo lectura (EXAMINE) salvo que se pida
 * «marcar como leído», trae los UID nuevos y su MIME. Nunca borra ni mueve.
 */

export interface ImapConnParams {
    /** IP ya validada (anti-SSRF) o el nombre, si se permite la red interna. */
    host: string;
    /** Nombre del servidor para validar el certificado TLS (SNI). */
    servername: string;
    port: number;
    security: ImapSecurity;
    user: string;
    pass: string;
    allowInvalidCert: boolean;
}

export interface ImapFolderState {
    uidValidity: number;
    uidNext: number;
    exists: number;
}

export interface ImapFetched {
    uid: number;
    size: number;
    /** null = se pasó del tamaño máximo (no se bajó). */
    source: Buffer | null;
}

export interface ImapSession {
    folders(): Promise<string[]>;
    open(folder: string, opts: { writable: boolean }): Promise<ImapFolderState>;
    /** UIDs mayores que `afterUid`, en orden, hasta `max`; el MIME sólo si pesa ≤ `maxBytes`. */
    fetchAfter(afterUid: number, max: number, maxBytes: number): Promise<ImapFetched[]>;
    markSeen(uids: number[]): Promise<void>;
    close(): Promise<void>;
}

export interface ImapReader {
    connect(params: ImapConnParams): Promise<ImapSession>;
}

export const IMAP_READER = Symbol('IMAP_READER');

/** Topes de tiempo: un buzón que no contesta no puede trabar la cola. */
const CONNECT_TIMEOUT = 15_000;
const SOCKET_TIMEOUT = 60_000;

@Injectable()
export class ImapFlowReader implements ImapReader {
    async connect(params: ImapConnParams): Promise<ImapSession> {
        const client = new ImapFlow({
            host: params.host,
            port: params.port,
            secure: params.security === 'tls',
            // `starttls`: exigirlo; `none`: no intentarlo (`tls` ya va cifrado).
            doSTARTTLS: params.security === 'starttls' ? true : params.security === 'none' ? false : undefined,
            servername: params.servername,
            tls: { rejectUnauthorized: !params.allowInvalidCert, servername: params.servername },
            auth: { user: params.user, pass: params.pass },
            logger: false,
            disableAutoIdle: true,
            clientInfo: { name: 'Imagina Base' },
            connectionTimeout: CONNECT_TIMEOUT,
            greetingTimeout: CONNECT_TIMEOUT,
            socketTimeout: SOCKET_TIMEOUT,
        });
        // Un error del socket después de conectar no puede tumbar el proceso.
        client.on('error', () => undefined);
        await client.connect();
        return new ImapFlowSession(client);
    }
}

class ImapFlowSession implements ImapSession {
    constructor(private readonly client: ImapFlow) {}

    async folders(): Promise<string[]> {
        const list = await this.client.list();
        return list.map((m) => m.path).slice(0, 200);
    }

    async open(folder: string, opts: { writable: boolean }): Promise<ImapFolderState> {
        const box = await this.client.mailboxOpen(folder, { readOnly: !opts.writable });
        return { uidValidity: Number(box.uidValidity), uidNext: box.uidNext, exists: box.exists };
    }

    async fetchAfter(afterUid: number, max: number, maxBytes: number): Promise<ImapFetched[]> {
        const found: Array<{ uid: number; size: number }> = [];
        // `n:*` siempre trae al menos el último mensaje: se filtra por UID.
        for await (const msg of this.client.fetch(`${afterUid + 1}:*`, { uid: true, size: true }, { uid: true })) {
            if (msg.uid > afterUid) found.push({ uid: msg.uid, size: msg.size ?? 0 });
        }
        found.sort((a, b) => a.uid - b.uid);
        const out: ImapFetched[] = [];
        for (const m of found.slice(0, max)) {
            if (m.size > maxBytes) {
                out.push({ uid: m.uid, size: m.size, source: null });
                continue;
            }
            const full = await this.client.fetchOne(String(m.uid), { uid: true, source: true }, { uid: true });
            out.push({ uid: m.uid, size: m.size, source: full && full.source ? full.source : null });
        }
        return out;
    }

    async markSeen(uids: number[]): Promise<void> {
        if (uids.length === 0) return;
        await this.client.messageFlagsAdd(uids.join(','), ['\\Seen'], { uid: true });
    }

    async close(): Promise<void> {
        try {
            await this.client.logout();
        } catch {
            this.client.close();
        }
    }
}

/**
 * Traduce un error de conexión/lectura a un diagnóstico en lenguaje claro:
 * en qué paso se cortó y qué hacer. PURO.
 */
export function imapErrorDiagnostic(err: unknown, ctx: { host: string; port: number; security: ImapSecurity; folder: string }): ImapDiagnostic {
    const e = (err ?? {}) as { code?: string; message?: string; authenticationFailed?: boolean; tlsFailed?: boolean; mailboxMissing?: boolean; responseText?: string; serverResponseCode?: string };
    const code = String(e.code ?? '');
    const text = `${e.message ?? ''} ${e.responseText ?? ''}`.trim();
    const make = (step: ImapDiagnosticStep, message: string, hints: string[]): ImapDiagnostic => ({ ok: false, step, message, hints });

    if (e.authenticationFailed || /AUTHENTICATIONFAILED|authenticat|invalid credentials|login failed|LOGIN failed|\[AUTH\]/i.test(`${code} ${e.serverResponseCode ?? ''} ${text}`)) {
        return make('auth', 'El servidor rechazó el usuario o la contraseña.', [
            'Revisa el usuario (casi siempre la dirección completa del buzón) y la contraseña.',
            'Gmail, Microsoft y Zoho exigen una CONTRASEÑA DE APLICACIÓN (no la contraseña normal de la cuenta): créala siguiendo los pasos de arriba.',
            'En Microsoft 365 / Outlook.com el acceso por IMAP con contraseña suele estar bloqueado: reenvía los correos a otro buzón.',
        ]);
    }
    if (e.mailboxMissing || code === 'NotFound' || /NONEXISTENT|doesn.?t exist|no such mailbox|not found/i.test(text)) {
        return make('folder', `No existe la carpeta «${ctx.folder}» en ese buzón.`, ['Usa INBOX (la bandeja de entrada) o elige una de las carpetas que muestra la prueba.']);
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        return make('dns', `El servidor «${ctx.host}» no existe (no resuelve).`, ['Revisa que esté bien escrito: va sólo el nombre, como imap.gmail.com.']);
    }
    if (
        e.tlsFailed ||
        code === 'ClosedAfterConnectTLS' ||
        code === 'UPGRADE_TIMEOUT' ||
        /certificate|self.signed|CERT_|ERR_TLS|wrong version number|SSL|tls/i.test(`${code} ${text}`)
    ) {
        const cert = /certificate|self.signed|CERT_|altname/i.test(`${code} ${text}`);
        return make(
            'tls',
            cert ? 'No se pudo verificar el certificado de seguridad del servidor.' : 'No se pudo establecer la conexión segura (TLS).',
            cert
                ? ['Revisa que el nombre del servidor sea el que te dio tu proveedor (el certificado se emite para ese nombre).', 'Si es un servidor propio con un certificado autofirmado, activa «Aceptar un certificado no verificado».']
                : [
                      ctx.security === 'tls'
                          ? `El puerto ${ctx.port} no parece hablar TLS desde el inicio: con 993 usa «SSL/TLS»; con 143, «STARTTLS».`
                          : `Prueba con el puerto 993 y «SSL/TLS» (lo que usan Gmail, Outlook y Zoho).`,
                  ],
        );
    }
    if (code === 'GREETING_TIMEOUT') {
        return make('tls', 'El servidor no saludó: la seguridad elegida no corresponde al puerto.', [
            ctx.port === 993 && ctx.security !== 'tls' ? 'El puerto 993 habla TLS desde el inicio: elige «SSL/TLS».' : 'Con el puerto 993 elige «SSL/TLS»; con el 143, «STARTTLS».',
        ]);
    }
    if (code === 'ECONNREFUSED') {
        return make('connect', `El servidor rechazó la conexión en el puerto ${ctx.port}.`, ['Revisa el puerto: lo habitual es 993 (SSL/TLS) o 143 (STARTTLS).']);
    }
    if (code === 'CONNECT_TIMEOUT' || code === 'ETIMEDOUT' || code === 'ETIMEOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || /timeout/i.test(text)) {
        return make('connect', `No hubo respuesta del servidor en el puerto ${ctx.port}.`, [
            'Revisa el servidor y el puerto. Si son correctos, puede que un firewall bloquee la salida a ese puerto.',
        ]);
    }
    return make('connect', `No se pudo leer el buzón: ${text || code || 'error desconocido'}.`, ['Revisa los datos de conexión con tu proveedor de correo.']);
}
