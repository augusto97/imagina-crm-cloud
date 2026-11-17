import { createServer, type Server } from 'node:net';
import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { MailService } from '../src/mail/mail.service';
import {
    MailPacer,
    isRateLimitRejection,
    isTransientSmtpRejection,
    paceIntervalMs,
    paceKey,
} from '../src/mail/mail-pacer';
import { SmtpMailTransport } from '../src/mail/transports/smtp.transport';
import { attachDiagnostics, readMailLog } from '../src/observability/diagnostics';
import { startRedis, type TestRedis } from './helpers/containers';

/**
 * v0.1.434 — ritmo de envío por servidor SMTP y reintento de los rechazos
 * pasajeros. El caso real: un SMTP que acepta 2 correos por segundo y
 * contesta «452 4.4.5 Messages per second limit exceeded» al tercero.
 */

/** SMTP de prueba: `reject(n)` decide si el n-ésimo MAIL FROM se rechaza (y con qué). */
function startSmtp(reject: (n: number) => string | null = () => null): Promise<{
    server: Server;
    port: number;
    accepted: number[];
    attempts: () => number;
}> {
    const accepted: number[] = [];
    let mailFrom = 0;
    const server = createServer((socket) => {
        let data = false;
        socket.write('220 fake ESMTP\r\n');
        socket.on('data', (chunk) => {
            for (const line of chunk.toString('utf8').split(/\r\n/)) {
                if (line === '') continue;
                if (data) {
                    if (line === '.') {
                        data = false;
                        accepted.push(Date.now());
                        socket.write('250 OK\r\n');
                    }
                    continue;
                }
                const cmd = line.slice(0, 4).toUpperCase();
                if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
                else if (cmd === 'AUTH') socket.write('235 ok\r\n');
                else if (cmd === 'MAIL') {
                    mailFrom += 1;
                    const r = reject(mailFrom);
                    socket.write(r ? `${r}\r\n` : '250 OK\r\n');
                } else if (cmd === 'DATA') {
                    data = true;
                    socket.write('354 go\r\n');
                } else if (cmd === 'QUIT') socket.write('221 bye\r\n');
                else socket.write('250 OK\r\n');
            }
        });
        socket.on('error', () => undefined);
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () =>
            resolve({
                server,
                port: (server.address() as { port: number }).port,
                accepted,
                attempts: () => mailFrom,
            }),
        );
    });
}

const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

/** MailService con el SMTP de prueba como transporte del servidor, sin esperas largas. */
function mailFor(port: number, perSecond: number | null, redis?: IORedis): MailService {
    const transport = new SmtpMailTransport({
        host: '127.0.0.1',
        port,
        secure: false,
        user: `u${port}`,
        pass: 'p',
        from: 'no-reply@test.local',
        max_per_second: perSecond,
    });
    const mail = new MailService(loadEnv(), transport, undefined, undefined, undefined, undefined, undefined, redis);
    (mail as unknown as { retryBackoffMs: number[] }).retryBackoffMs = [60, 60];
    return mail;
}

describe('Ritmo de envío por SMTP (v0.1.434)', () => {
    let redis: TestRedis;
    let client: IORedis;

    beforeAll(async () => {
        redis = await startRedis();
        client = new IORedis(redis.url);
        attachDiagnostics(client);
    }, 120_000);

    afterAll(async () => {
        await client?.quit();
        await redis?.stop();
    });

    it('piezas puras: intervalo, clave y qué rechazo es pasajero', () => {
        expect(paceIntervalMs(null)).toBe(1000); // sin dato: 1 por segundo
        expect(paceIntervalMs(2)).toBe(500);
        expect(paceIntervalMs(0.5)).toBe(2000);
        expect(paceIntervalMs(999)).toBe(20); // tope 50/s
        expect(paceIntervalMs(0)).toBe(10_000); // piso 0,1/s
        // Mismo servidor y cuenta = mismo turno (sin importar mayúsculas).
        expect(paceKey('SMTP.Acme.com', 587, 'Ana')).toBe(paceKey('smtp.acme.com', 587, 'ana'));
        expect(paceKey('smtp.acme.com', 587, 'ana')).not.toBe(paceKey('smtp.acme.com', 587, 'luis'));

        const limit = Object.assign(new Error('Mail command failed: 452 4.4.5 Messages per second limit exceeded (2/2)'), {
            responseCode: 452,
        });
        expect(isTransientSmtpRejection(limit)).toBe(true);
        expect(isRateLimitRejection(limit)).toBe(true);
        expect(isTransientSmtpRejection(Object.assign(new Error('451 greylisted'), { responseCode: 451 }))).toBe(true);
        expect(isRateLimitRejection(Object.assign(new Error('451 greylisted'), { responseCode: 451 }))).toBe(false);
        // Credenciales, remitente o conexión: reintentar en el lugar no sirve.
        expect(isTransientSmtpRejection(Object.assign(new Error('Invalid login'), { responseCode: 535 }))).toBe(false);
        expect(isTransientSmtpRejection(Object.assign(new Error('Sender rejected'), { responseCode: 550 }))).toBe(false);
        expect(isTransientSmtpRejection(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }))).toBe(false);
        // Sin código (otro transporte): por el texto.
        expect(isTransientSmtpRejection(new Error('421 Too many connections, try again later'))).toBe(true);
    });

    it('el turno se comparte entre procesos por Redis (y sin Redis, dentro del proceso)', async () => {
        const a = new MailPacer(client);
        const b = new MailPacer(client); // "otro proceso"
        const key = `mail:pace:test-${Date.now()}`;
        const waits = [await a.reserve(key, 200), await b.reserve(key, 200), await a.reserve(key, 200)];
        expect(waits[0]).toBe(0);
        expect(waits[1]).toBeGreaterThanOrEqual(150);
        expect(waits[2]).toBeGreaterThanOrEqual(350);
        // Un rechazo por límite corre el turno de TODOS.
        const later = Date.now() + 2_000;
        expect(await b.reserve(key, 200, later)).toBeGreaterThanOrEqual(1_900);
        expect(await a.reserve(key, 200)).toBeGreaterThanOrEqual(2_100);

        // Redis caído: sigue el ritmo dentro del proceso, sin romper el envío.
        const broken = new MailPacer({ eval: () => Promise.reject(new Error('down')) } as never);
        expect(await broken.reserve('k', 300)).toBe(0);
        expect(await broken.reserve('k', 300)).toBeGreaterThanOrEqual(250);
    });

    it('espacia los envíos al mismo servidor aunque salgan a la vez', async () => {
        const smtp = await startSmtp();
        try {
            const mail = mailFor(smtp.port, 10, client); // 10/s → 100 ms entre correos
            const t0 = Date.now();
            await Promise.all(
                Array.from({ length: 5 }, (_, i) => mail.sendNow({ to: `c${i}@test.local`, subject: 's', text: 'x' })),
            );
            expect(smtp.accepted).toHaveLength(5);
            const sorted = [...smtp.accepted].sort((x, y) => x - y);
            // 5 correos a 10 por segundo: al menos 4 pausas de ~100 ms.
            expect(sorted[4]! - t0).toBeGreaterThanOrEqual(380);
            for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(60);
        } finally {
            await close(smtp.server);
        }
    });

    it('un «452 … limit exceeded» se reintenta en el lugar y el correo sale (sin pasar por «Falló»)', async () => {
        const smtp = await startSmtp((n) => (n <= 2 ? '452 4.4.5 Messages per second limit exceeded (2/2)' : null));
        try {
            const mail = mailFor(smtp.port, 50, client);
            await mail.sendNow({ to: 'reintento@test.local', subject: 'Aviso de prueba 452', text: 'x' });
            expect(smtp.attempts()).toBe(3); // dos rechazos + el bueno
            expect(smtp.accepted).toHaveLength(1);
            await new Promise((r) => setTimeout(r, 50));
            const log = (await readMailLog(client)).filter((e) => e.subject === 'Aviso de prueba 452');
            expect(log.map((e) => e.status)).toEqual(['sent']);
        } finally {
            await close(smtp.server);
        }
    });

    it('un rechazo permanente no se reintenta, y uno pasajero que no cede sube con el motivo', async () => {
        const perm = await startSmtp(() => '550 5.7.1 Sender rejected');
        try {
            const mail = mailFor(perm.port, 50, client);
            await expect(mail.sendNow({ to: 'x@test.local', subject: 'perm', text: 'x' })).rejects.toThrow(/550/);
            expect(perm.attempts()).toBe(1);
        } finally {
            await close(perm.server);
        }

        const busy = await startSmtp(() => '452 4.4.5 Messages per second limit exceeded (2/2)');
        try {
            const mail = mailFor(busy.port, 50, client);
            await expect(mail.sendNow({ to: 'x@test.local', subject: 'Siempre 452', text: 'x' })).rejects.toThrow(/452/);
            expect(busy.attempts()).toBe(3); // el intento + 2 reintentos en el lugar
            await new Promise((r) => setTimeout(r, 50));
            const log = (await readMailLog(client)).filter((e) => e.subject === 'Siempre 452');
            expect(log.map((e) => e.status)).toEqual(['failed']); // envío directo: es el final

            // En la cola, un intento que se va a repetir se lee «Se reintenta», no «Falló».
            const deliver = (mail as unknown as { deliver: (m: unknown, final: boolean) => Promise<void> }).deliver.bind(mail);
            await expect(deliver({ to: 'x@test.local', subject: 'Cola 452', text: 'x' }, false)).rejects.toThrow(/452/);
            await new Promise((r) => setTimeout(r, 50));
            const queued = (await readMailLog(client)).filter((e) => e.subject === 'Cola 452');
            expect(queued.map((e) => e.status)).toEqual(['retrying']);
        } finally {
            await close(busy.server);
        }
    });
});
