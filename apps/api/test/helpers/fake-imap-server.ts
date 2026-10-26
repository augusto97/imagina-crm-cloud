import { createServer, type Server, type Socket } from 'node:net';

/**
 * Servidor IMAP4rev1 MÍNIMO de verdad (sockets), para probar la mesa de ayuda
 * con la librería IMAP real: saludo, CAPABILITY, LOGIN, LIST/LSUB,
 * SELECT/EXAMINE, UID FETCH (tamaño y MIME), UID STORE (+FLAGS), NOOP, CLOSE
 * y LOGOUT. Sin TLS (el test conecta con «sin cifrado» a 127.0.0.1).
 *
 * Lo usan los tests de integración y el E2E (con `tsx`): guarda los comandos
 * recibidos para comprobar que el lector abre en sólo lectura y no toca nada.
 */

export interface FakeImapMessage {
    uid: number;
    flags: Set<string>;
    raw: Buffer;
}

export interface FakeImapServer {
    port: number;
    server: Server;
    /** Comandos recibidos (sin el tag), en orden. */
    commands: string[];
    folders: Map<string, FakeImapMessage[]>;
    uidValidity: number;
    /** Agrega un correo (MIME crudo) a la carpeta; devuelve su UID. */
    append(raw: string | Buffer, folder?: string): number;
    /** Cambia la contraseña aceptada (para probar el rechazo). */
    setPassword(pass: string): void;
    /** Simula un buzón recreado: UIDVALIDITY nuevo. */
    resetUidValidity(next: number): void;
    close(): Promise<void>;
}

/** Separa los argumentos de un comando IMAP: átomos, "cadenas" y (listas) crudas. */
function tokenize(line: string): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < line.length) {
        const ch = line[i]!;
        if (ch === ' ') {
            i++;
            continue;
        }
        if (ch === '"') {
            let s = '';
            i++;
            while (i < line.length && line[i] !== '"') {
                if (line[i] === '\\' && i + 1 < line.length) i++;
                s += line[i];
                i++;
            }
            i++;
            out.push(s);
            continue;
        }
        if (ch === '(') {
            let depth = 0;
            let s = '';
            while (i < line.length) {
                const c = line[i]!;
                if (c === '(') depth++;
                if (c === ')') depth--;
                s += c;
                i++;
                if (depth === 0) break;
            }
            out.push(s);
            continue;
        }
        let s = '';
        while (i < line.length && line[i] !== ' ') {
            s += line[i];
            i++;
        }
        out.push(s);
    }
    return out;
}

/** `1:5,7,9:*` → UIDs presentes que caen en el conjunto. */
function uidsInSet(set: string, all: number[]): number[] {
    const max = all.length ? Math.max(...all) : 0;
    const wanted = new Set<number>();
    for (const part of set.split(',')) {
        const [a, b] = part.split(':');
        const lo = a === '*' ? max : Number(a);
        const hi = b === undefined ? lo : b === '*' ? max : Number(b);
        const from = Math.min(lo, hi);
        const to = Math.max(lo, hi);
        for (const u of all) if (u >= from && u <= to) wanted.add(u);
        // `n:*` con n > último UID devuelve igual el último (RFC 3501).
        if (b === '*' && lo > max && max > 0) wanted.add(max);
    }
    return all.filter((u) => wanted.has(u));
}

export function startFakeImap(opts: { user: string; pass: string; port?: number; host?: string; uidValidity?: number }): Promise<FakeImapServer> {
    let password = opts.pass;
    const folders = new Map<string, FakeImapMessage[]>([['INBOX', []]]);
    const commands: string[] = [];
    let uidNext = 1;
    const state = { uidValidity: opts.uidValidity ?? 1001 };

    const handle = (socket: Socket): void => {
        let buffer = Buffer.alloc(0);
        let authed = false;
        let selected: string | null = null;
        let pendingLiteral: { size: number; before: string; tag: string } | null = null;
        const write = (s: string | Buffer): void => {
            if (!socket.destroyed) socket.write(s);
        };
        write('* OK [CAPABILITY IMAP4rev1] Fake IMAP listo\r\n');

        const run = (tag: string, rest: string): void => {
            const parts = tokenize(rest);
            let cmd = (parts.shift() ?? '').toUpperCase();
            let uid = false;
            if (cmd === 'UID') {
                uid = true;
                cmd = (parts.shift() ?? '').toUpperCase();
            }
            commands.push(`${uid ? 'UID ' : ''}${cmd} ${parts.join(' ')}`.trim());
            const ok = (text = `${cmd} completado`): void => write(`${tag} OK ${text}\r\n`);
            switch (cmd) {
                case 'CAPABILITY':
                    write('* CAPABILITY IMAP4rev1\r\n');
                    return ok();
                case 'NOOP':
                    return ok();
                case 'LOGIN': {
                    const [user, pass] = parts;
                    if (user === opts.user && pass === password) {
                        authed = true;
                        return ok('[CAPABILITY IMAP4rev1] Sesión iniciada');
                    }
                    return void write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
                }
                case 'LOGOUT':
                    write('* BYE Chau\r\n');
                    ok();
                    socket.end();
                    return;
            }
            if (!authed) return void write(`${tag} BAD Primero LOGIN\r\n`);
            switch (cmd) {
                case 'LIST':
                case 'LSUB': {
                    const pattern = parts[1] ?? '';
                    if (pattern === '') {
                        write(`* ${cmd} (\\Noselect) "/" ""\r\n`);
                        return ok();
                    }
                    for (const name of folders.keys()) {
                        if (pattern === '*' || pattern === name) write(`* ${cmd} () "/" "${name}"\r\n`);
                    }
                    return ok();
                }
                case 'SELECT':
                case 'EXAMINE': {
                    const name = parts[0] ?? '';
                    const box = folders.get(name) ?? folders.get(name.toUpperCase() === 'INBOX' ? 'INBOX' : '');
                    if (!box) return void write(`${tag} NO [NONEXISTENT] Mailbox doesn't exist\r\n`);
                    selected = folders.has(name) ? name : 'INBOX';
                    write('* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)\r\n');
                    write('* OK [PERMANENTFLAGS (\\Seen \\*)] Flags\r\n');
                    write(`* ${box.length} EXISTS\r\n`);
                    write('* 0 RECENT\r\n');
                    write(`* OK [UIDVALIDITY ${state.uidValidity}] UIDs\r\n`);
                    write(`* OK [UIDNEXT ${uidNext}] Próximo\r\n`);
                    return ok(cmd === 'EXAMINE' ? '[READ-ONLY] EXAMINE completado' : '[READ-WRITE] SELECT completado');
                }
                case 'CLOSE':
                case 'UNSELECT':
                    selected = null;
                    return ok();
                case 'FETCH': {
                    if (!selected) return void write(`${tag} BAD Sin carpeta\r\n`);
                    const box = folders.get(selected)!;
                    const all = box.map((m) => m.uid);
                    const items = (parts[1] ?? '').toUpperCase();
                    const uids = uid ? uidsInSet(parts[0] ?? '', all) : uidsInSet(parts[0] ?? '', all.map((_u, i) => i + 1)).map((s) => all[s - 1]!);
                    for (const u of uids) {
                        const seq = all.indexOf(u) + 1;
                        const m = box[seq - 1]!;
                        const bits = [`UID ${m.uid}`];
                        if (items.includes('RFC822.SIZE')) bits.push(`RFC822.SIZE ${m.raw.length}`);
                        if (items.includes('FLAGS')) bits.push(`FLAGS (${[...m.flags].join(' ')})`);
                        const wantsBody = items.includes('BODY.PEEK[]') || items.includes('BODY[]') || items.includes('RFC822)') || items.endsWith('RFC822');
                        if (wantsBody) {
                            write(`* ${seq} FETCH (${bits.join(' ')} BODY[] {${m.raw.length}}\r\n`);
                            write(m.raw);
                            write(')\r\n');
                            if (items.includes('BODY[]') && !items.includes('PEEK')) m.flags.add('\\Seen');
                        } else {
                            write(`* ${seq} FETCH (${bits.join(' ')})\r\n`);
                        }
                    }
                    return ok();
                }
                case 'STORE': {
                    if (!selected) return void write(`${tag} BAD Sin carpeta\r\n`);
                    const box = folders.get(selected)!;
                    const all = box.map((m) => m.uid);
                    const op = (parts[1] ?? '').toUpperCase();
                    const flags = (parts[2] ?? '').replace(/[()]/g, '').split(' ').filter(Boolean);
                    const uids = uid ? uidsInSet(parts[0] ?? '', all) : [];
                    for (const u of uids) {
                        const m = box.find((x) => x.uid === u)!;
                        if (op.startsWith('+')) flags.forEach((f) => m.flags.add(f));
                        else if (op.startsWith('-')) flags.forEach((f) => m.flags.delete(f));
                        if (!op.includes('SILENT')) write(`* ${all.indexOf(u) + 1} FETCH (UID ${u} FLAGS (${[...m.flags].join(' ')}))\r\n`);
                    }
                    return ok();
                }
                default:
                    return void write(`${tag} BAD Comando no soportado\r\n`);
            }
        };

        socket.on('data', (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            for (;;) {
                if (pendingLiteral) {
                    if (buffer.length < pendingLiteral.size) return;
                    const lit = buffer.subarray(0, pendingLiteral.size).toString('utf8');
                    buffer = buffer.subarray(pendingLiteral.size);
                    const idx = buffer.indexOf('\r\n');
                    if (idx < 0) return;
                    const tail = buffer.subarray(0, idx).toString('utf8');
                    buffer = buffer.subarray(idx + 2);
                    const { tag, before } = pendingLiteral;
                    pendingLiteral = null;
                    run(tag, `${before}"${lit.replace(/["\\]/g, '\\$&')}"${tail}`);
                    continue;
                }
                const idx = buffer.indexOf('\r\n');
                if (idx < 0) return;
                const line = buffer.subarray(0, idx).toString('utf8');
                buffer = buffer.subarray(idx + 2);
                const sp = line.indexOf(' ');
                const tag = sp > 0 ? line.slice(0, sp) : line;
                let rest = sp > 0 ? line.slice(sp + 1) : '';
                const lit = /\{(\d+)\+?\}$/.exec(rest);
                if (lit) {
                    rest = rest.slice(0, rest.length - lit[0].length);
                    pendingLiteral = { size: Number(lit[1]), before: rest, tag };
                    if (!lit[0].includes('+')) write('+ Listo\r\n');
                    continue;
                }
                run(tag, rest);
            }
        });
        socket.on('error', () => undefined);
    };

    const server = createServer(handle);
    return new Promise((resolve) => {
        server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', () => {
            const api: FakeImapServer = {
                port: (server.address() as { port: number }).port,
                server,
                commands,
                folders,
                get uidValidity() {
                    return state.uidValidity;
                },
                append(raw, folder = 'INBOX') {
                    if (!folders.has(folder)) folders.set(folder, []);
                    const u = uidNext++;
                    folders.get(folder)!.push({ uid: u, flags: new Set(), raw: Buffer.isBuffer(raw) ? raw : Buffer.from(raw.replace(/\r?\n/g, '\r\n'), 'utf8') });
                    return u;
                },
                setPassword(pass) {
                    password = pass;
                },
                resetUidValidity(next) {
                    state.uidValidity = next;
                },
                close: () => new Promise((r) => server.close(() => r())),
            };
            resolve(api);
        });
    });
}

/** Arma un correo MIME simple (texto o HTML, con adjuntos opcionales). */
export function buildMime(p: {
    from: string;
    to: string;
    subject: string;
    text?: string;
    html?: string;
    messageId: string;
    inReplyTo?: string;
    references?: string[];
    headers?: Record<string, string>;
    attachments?: Array<{ filename: string; contentType: string; content: Buffer }>;
    date?: Date;
}): string {
    const lines: string[] = [
        `From: ${p.from}`,
        `To: ${p.to}`,
        `Subject: ${p.subject}`,
        `Message-ID: <${p.messageId}>`,
        `Date: ${(p.date ?? new Date()).toUTCString()}`,
        'MIME-Version: 1.0',
    ];
    if (p.inReplyTo) lines.push(`In-Reply-To: <${p.inReplyTo}>`);
    if (p.references?.length) lines.push(`References: ${p.references.map((r) => `<${r}>`).join(' ')}`);
    for (const [k, v] of Object.entries(p.headers ?? {})) lines.push(`${k}: ${v}`);
    const boundary = 'b-fake-imap-1';
    const alt = 'b-fake-imap-alt';
    const body: string[] = [];
    const bodyPart = (): string[] => {
        if (p.html && p.text) {
            return [
                `Content-Type: multipart/alternative; boundary="${alt}"`,
                '',
                `--${alt}`,
                'Content-Type: text/plain; charset=utf-8',
                '',
                p.text,
                `--${alt}`,
                'Content-Type: text/html; charset=utf-8',
                '',
                p.html,
                `--${alt}--`,
            ];
        }
        if (p.html) return ['Content-Type: text/html; charset=utf-8', '', p.html];
        return ['Content-Type: text/plain; charset=utf-8', '', p.text ?? ''];
    };
    if (p.attachments?.length) {
        lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
        body.push('', `--${boundary}`, ...bodyPart());
        for (const a of p.attachments) {
            body.push(
                `--${boundary}`,
                `Content-Type: ${a.contentType}; name="${a.filename}"`,
                `Content-Disposition: attachment; filename="${a.filename}"`,
                'Content-Transfer-Encoding: base64',
                '',
                a.content.toString('base64'),
            );
        }
        body.push(`--${boundary}--`, '');
        return [...lines, ...body].join('\r\n');
    }
    const part = bodyPart();
    return [...lines, ...part.slice(0, 1), ...part.slice(1)].join('\r\n') + '\r\n';
}
