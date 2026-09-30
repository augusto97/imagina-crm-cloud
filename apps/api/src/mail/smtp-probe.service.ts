import { createConnection } from 'node:net';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { resolvePublicHost } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import type { SmtpDiagnostic, SmtpPortProbe } from '@imagina-base/shared';

/**
 * Puertos SMTP que se prueban SIEMPRE, además del configurado. Son los cuatro
 * que usan los proveedores reales: 25 (MTA a MTA, el que más se bloquea), 465
 * (TLS implícito), 587 (submission + STARTTLS) y 2525 (alternativo de Brevo,
 * SendGrid, Mailgun — el que suele quedar abierto cuando el VPS bloquea el
 * resto).
 */
const STANDARD_PORTS = [25, 465, 587, 2525];

/** El 465 habla TLS desde el primer byte: no hay saludo en claro que leer. */
const IMPLICIT_TLS_PORTS = new Set([465]);

const CONNECT_TIMEOUT_MS = 6_000;
/** Tras conectar, cuánto se espera el `220 …` antes de dar por buena la conexión. */
const GREETING_TIMEOUT_MS = 2_500;

/**
 * Diagnóstico de conectividad al SMTP (v0.1.151).
 *
 * "Connection timeout" es un mensaje que no le sirve a nadie: no distingue un
 * host mal escrito de un puerto equivocado, de TLS mal elegido, o de que el
 * proveedor del VPS bloquee el correo saliente (Hetzner, DigitalOcean, Oracle,
 * Google Cloud y AWS lo hacen por defecto — es la causa nº 1). La prueba corre
 * DESDE EL SERVIDOR, que es quien envía: es la única máquina cuya conectividad
 * importa.
 *
 * Alcance acotado a propósito: sólo los cuatro puertos SMTP estándar más el
 * configurado, y nunca contra direcciones link-local (169.254.0.0/16,
 * fe80::/10, donde viven los endpoints de metadata de las nubes). Las privadas
 * SÍ se prueban: un despliegue self-hosted con un relay interno es legítimo y
 * el envío real también llega ahí.
 */
@Injectable()
export class SmtpProbeService {
    private readonly logger = new Logger(SmtpProbeService.name);
    private readonly allowPrivate: boolean;

    constructor(@Optional() @Inject(ENV) env?: Pick<Env, 'SMTP_ALLOW_PRIVATE_HOSTS'>) {
        this.allowPrivate = env?.SMTP_ALLOW_PRIVATE_HOSTS === true;
    }

    async diagnose(input: { host: string; port: number; secure: boolean }): Promise<SmtpDiagnostic> {
        const host = input.host.trim();
        const base = { host, port: input.port, secure: input.secure };

        // SEC-27 (v0.1.226): el diagnóstico conecta DESDE EL SERVIDOR, así que
        // sólo contra direcciones públicas (antes bloqueaba sólo link-local: con
        // `127.0.0.1` y cualquier puerto servía de escáner de la red interna,
        // y devolvía el banner). La conexión va FIJADA a la IP validada.
        const resolved = await resolvePublicHost(host, { allowPrivate: this.allowPrivate });
        if (!resolved.ok && resolved.reason === 'dns') {
            return {
                ...base,
                dns: { ok: false, addresses: [], error: resolved.error },
                ports: [],
                verdict: 'dns_failed',
                hints: dnsHints(host, resolved.error),
            };
        }
        if (!resolved.ok) {
            return {
                ...base,
                dns: { ok: false, addresses: resolved.addresses, error: 'dirección no permitida' },
                ports: [],
                verdict: 'dns_failed',
                hints: [
                    'El nombre del servidor apunta a una dirección interna (privada o reservada). El SMTP de tu empresa tiene que ser un servidor accesible desde internet: escribí el host real de tu proveedor de correo.',
                ],
            };
        }

        const ports = [...new Set([input.port, ...STANDARD_PORTS])].sort((a, b) => a - b);
        const target = resolved.address;
        const probes = await Promise.all(ports.map((port) => this.probe(target, port)));

        return { ...base, dns: { ok: true, addresses: resolved.addresses }, ports: probes, ...verdictFor(base, probes) };
    }

    /** Un intento de conexión TCP + lectura del saludo. Nunca lanza. */
    private probe(host: string, port: number): Promise<SmtpPortProbe> {
        return new Promise((resolve) => {
            const started = Date.now();
            let connected = false;
            let settled = false;
            let banner = '';

            const socket = createConnection({ host, port });
            const finish = (result: Omit<SmtpPortProbe, 'ms'>): void => {
                if (settled) return;
                settled = true;
                socket.destroy();
                resolve({ ...result, ms: Date.now() - started });
            };

            socket.setTimeout(CONNECT_TIMEOUT_MS);
            socket.on('timeout', () => {
                // Ya conectado = el puerto está abierto aunque el servidor no
                // haya saludado (pasa con proxies y con TLS implícito).
                finish(connected ? { port, status: 'open' } : { port, status: 'timeout' });
            });
            socket.on('error', (err: NodeJS.ErrnoException) => {
                finish({
                    port,
                    status: err.code === 'ECONNREFUSED' ? 'refused' : 'error',
                    error: err.code ?? err.message,
                });
            });
            socket.on('connect', () => {
                connected = true;
                if (IMPLICIT_TLS_PORTS.has(port)) {
                    finish({ port, status: 'open' });
                    return;
                }
                socket.setTimeout(GREETING_TIMEOUT_MS);
            });
            socket.on('data', (chunk: Buffer) => {
                banner += chunk.toString('utf8');
                if (!banner.includes('\n') && banner.length < 512) return;
                finish({ port, status: 'open', greeting: firstLine(banner) });
            });
            socket.on('close', () => finish(connected ? { port, status: 'open' } : { port, status: 'error' }));
        });
    }
}

// ── Puro (testeable sin red) ─────────────────────────────────────────────

function firstLine(text: string): string {
    return text.split(/\r?\n/, 1)[0]!.slice(0, 200).trim();
}

export function isLinkLocal(ip: string): boolean {
    const lower = ip.toLowerCase();
    if (/^169\.254\./.test(lower)) return true;
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
    if (mapped) return /^169\.254\./.test(mapped[1]!);
    const p3 = lower.slice(0, 3);
    return p3 === 'fe8' || p3 === 'fe9' || p3 === 'fea' || p3 === 'feb';
}

function dnsHints(host: string, error: string): string[] {
    const hints = [
        `El nombre «${host}» no resuelve (${error}). Revisá que esté bien escrito: va sólo el host, sin «http://», sin barras y sin espacios.`,
    ];
    if (host.includes('@')) hints.push('Parece que escribiste un email en el campo Host. Ahí va el servidor (ej. smtp.tu-proveedor.com).');
    if (/^https?:/i.test(host)) hints.push('Sacá el «http://» o «https://» del host.');
    return hints;
}

/** El puerto define el TLS: 465 es implícito; 25/587/2525 usan STARTTLS. */
function tlsAdviceFor(port: number, secure: boolean): string | null {
    if (IMPLICIT_TLS_PORTS.has(port) && !secure) {
        return 'El puerto 465 habla TLS desde el inicio: activá «Conexión segura (SSL/TLS)». Con la opción apagada la conexión se queda esperando y da timeout.';
    }
    if (!IMPLICIT_TLS_PORTS.has(port) && secure) {
        return `El puerto ${port} usa STARTTLS: desactivá «Conexión segura (SSL/TLS)» (se cifra igual, pero después del saludo). Con la opción activada el servidor no contesta y da timeout.`;
    }
    return null;
}

/**
 * Traduce los intentos a un veredicto + consejos accionables. Puro: la lógica
 * que importa se testea sin abrir un socket.
 */
export function verdictFor(
    cfg: { port: number; secure: boolean },
    probes: SmtpPortProbe[],
): { verdict: SmtpDiagnostic['verdict']; hints: string[] } {
    const mine = probes.find((p) => p.port === cfg.port);
    const openOthers = probes.filter((p) => p.status === 'open' && p.port !== cfg.port);

    if (mine?.status === 'open') {
        const tls = tlsAdviceFor(cfg.port, cfg.secure);
        if (tls) return { verdict: 'tls_mismatch', hints: [tls] };
        return {
            verdict: 'ok',
            hints: [
                `El servidor llega al puerto ${cfg.port} sin problemas${mine.greeting ? ` (responde «${mine.greeting}»)` : ''}.`,
                'Si el envío igual falla, ya no es de red: revisá usuario y contraseña, y que el remitente (From) esté autorizado por tu proveedor.',
            ],
        };
    }

    if (openOthers.length > 0) {
        const suggested = openOthers.find((p) => p.port === 587) ?? openOthers.find((p) => p.port === 465) ?? openOthers[0]!;
        const hints = [
            `El puerto ${cfg.port} no responde, pero el ${suggested.port} sí. Probá con ese.`,
            suggested.port === 465
                ? 'Con el 465 activá «Conexión segura (SSL/TLS)».'
                : `Con el ${suggested.port} dejá «Conexión segura» desactivada (usa STARTTLS).`,
        ];
        if (mine?.status === 'refused') {
            hints.push(`El servidor rechaza la conexión en el ${cfg.port}: ese puerto está cerrado del otro lado.`);
        }
        return { verdict: 'port_closed', hints };
    }

    const allTimeout = probes.length > 0 && probes.every((p) => p.status === 'timeout');
    if (allTimeout) {
        return {
            verdict: 'all_blocked',
            hints: [
                'Ningún puerto SMTP responde desde el servidor. La causa más común es que el proveedor del VPS bloquee el correo saliente: Hetzner, DigitalOcean, Oracle Cloud, Google Cloud y AWS lo hacen por defecto.',
                'Solución: pedirle al proveedor que habilite el envío SMTP (suelen desbloquearlo a pedido), o usar un proveedor de correo que ofrezca el puerto 2525.',
                'Si el bloqueo no es del proveedor, revisá el firewall del propio servidor (ufw/iptables) y que el host esté bien escrito.',
            ],
        };
    }

    return {
        verdict: 'all_blocked',
        hints: [
            'No se pudo abrir ninguna conexión SMTP con ese servidor. Revisá el host y el puerto con tu proveedor de correo.',
            'Si el servidor rechaza la conexión (no es timeout), el host resuelve pero no hay un SMTP escuchando ahí.',
        ],
    };
}
