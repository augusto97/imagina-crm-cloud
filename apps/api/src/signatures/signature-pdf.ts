import { createHash } from 'node:crypto';
import { maskPhone } from '@imagina-base/shared';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * D6 (v0.1.446, ADR-S107) — Las piezas del PDF de una firma. Puras (sin I/O):
 * lo que se prueba es exactamente lo que se guarda.
 *
 * - El documento ORIGINAL nunca se modifica: su huella SHA-256 es lo que se
 *   firma y la que figura en la constancia.
 * - El PDF FIRMADO = cada página del original con un sello al pie (el código
 *   de la solicitud y dónde verificarla) + las hojas de la constancia al final.
 */

export class SignaturePdfError extends Error {}

/** Huella SHA-256 en hexadecimal. */
export function sha256Hex(buf: Buffer | Uint8Array): string {
    return createHash('sha256').update(buf).digest('hex');
}

/** ¿Empieza como un PDF? (no le creemos a la extensión ni al tipo que mandaron). */
export function looksLikePdf(buf: Buffer): boolean {
    return buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

async function load(buf: Buffer): Promise<PDFDocument> {
    if (!looksLikePdf(buf)) throw new SignaturePdfError('El archivo no es un PDF.');
    try {
        return await PDFDocument.load(buf, { updateMetadata: false });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/encrypt/i.test(msg)) throw new SignaturePdfError('El PDF está protegido con contraseña: no se puede firmar.');
        throw new SignaturePdfError('No se pudo leer el PDF (está dañado o no es un PDF válido).');
    }
}

/** Cuántas páginas tiene (valida de paso que se pueda abrir y no esté cifrado). */
export async function pdfPageCount(buf: Buffer): Promise<number> {
    const doc = await load(buf);
    const n = doc.getPageCount();
    if (n < 1) throw new SignaturePdfError('El PDF no tiene páginas.');
    return n;
}

const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/**
 * El sello va en Helvetica (fuente estándar del PDF, sin incrustar): sólo
 * admite Windows-1252. Lo demás se cambia por un signo de pregunta en vez de
 * fallar (el nombre completo, con cualquier letra, está en la constancia).
 */
export function winAnsiSafe(s: string): string {
    let out = '';
    for (const ch of s.normalize('NFC')) {
        const cp = ch.codePointAt(0)!;
        if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || CP1252_EXTRA.has(ch)) out += ch;
        else if (cp === 0x0a || cp === 0x09) out += ' ';
        else out += '?';
    }
    return out;
}

/**
 * Sella cada página del original y le agrega la constancia al final.
 * `stamp` es el texto del pie (una línea).
 */
export async function buildSignedPdf(original: Buffer, constancia: Buffer, opts: { stamp: string; title: string }): Promise<Buffer> {
    const doc = await load(original);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const size = 6.5;
    const text = winAnsiSafe(opts.stamp).slice(0, 220);
    for (const page of doc.getPages()) {
        const { width } = page.getSize();
        const maxW = width - 36;
        // Recorta hasta que entre en el ancho de la página.
        let t = text;
        while (t.length > 10 && font.widthOfTextAtSize(t, size) > maxW) t = `${t.slice(0, -2)}…`;
        const w = font.widthOfTextAtSize(t, size);
        const x = Math.max(18, (width - w) / 2);
        page.drawRectangle({ x: x - 4, y: 6, width: w + 8, height: size + 5, color: rgb(1, 1, 1), opacity: 0.85 });
        page.drawText(t, { x, y: 8.5, size, font, color: rgb(0.35, 0.37, 0.42) });
    }
    const extra = await load(constancia);
    const copied = await doc.copyPages(extra, extra.getPageIndices());
    for (const p of copied) doc.addPage(p);
    doc.setTitle(winAnsiSafe(opts.title).slice(0, 200) || 'Documento firmado');
    doc.setProducer('Firma electrónica');
    doc.setModificationDate(new Date());
    return Buffer.from(await doc.save());
}

// ─────────────────────────── Constancia ───────────────────────────

/** Cómo se identificó cada persona (v0.1.448: también por SMS o WhatsApp a su celular). */
export function identificationText(s: Pick<ConstanciaSigner, 'verifiedBy' | 'phone'>): string {
    const cel = s.phone && s.phone.trim() !== '' ? ` ${maskPhone(s.phone)}` : '';
    if (s.verifiedBy === 'email') return 'Código de 6 números enviado a su correo';
    if (s.verifiedBy === 'sms') return `Código de 6 números enviado por SMS a su celular${cel}`;
    if (s.verifiedBy === 'whatsapp') return `Código de 6 números enviado por WhatsApp a su celular${cel}`;
    return 'Enlace personal';
}

export interface ConstanciaSigner {
    name: string;
    email: string;
    role: string;
    signedAt: string;
    ip: string;
    userAgent: string;
    verifiedBy: 'email' | 'sms' | 'whatsapp' | 'none';
    /** v0.1.448 — Celular al que llegó el código (por SMS o WhatsApp). */
    phone?: string;
    kind: 'drawn' | 'typed';
    /** PNG en base64 (sin el prefijo `data:`). */
    signaturePng: string;
}

export interface ConstanciaInput {
    title: string;
    company: string;
    code: string;
    documentNumber: string | null;
    originalSha256: string;
    pages: number;
    createdAt: string;
    completedAt: string;
    requestedBy: string | null;
    verifyUrl: string;
    consentText: string;
    signers: ConstanciaSigner[];
    /** Formatea una fecha ISO en la zona y el formato de la empresa. */
    formatWhen: (iso: string) => string;
}

/** «Chrome en Windows» a partir del User-Agent (sin guardar nada más que lo que ya está). */
export function browserLabel(ua: string): string {
    const s = ua || '';
    const browser = /Edg\//.test(s)
        ? 'Edge'
        : /OPR\//.test(s)
          ? 'Opera'
          : /SamsungBrowser\//.test(s)
            ? 'Samsung Internet'
            : /Firefox\//.test(s)
              ? 'Firefox'
              : /Chrome\//.test(s)
                ? 'Chrome'
                : /Safari\//.test(s)
                  ? 'Safari'
                  : '';
    const os = /iPhone|iPad|iPod/.test(s)
        ? 'iPhone/iPad'
        : /Android/.test(s)
          ? 'Android'
          : /Windows/.test(s)
            ? 'Windows'
            : /Mac OS X|Macintosh/.test(s)
              ? 'Mac'
              : /Linux/.test(s)
                ? 'Linux'
                : '';
    if (browser && os) return `${browser} en ${os}`;
    return browser || os || 'Navegador no identificado';
}

/**
 * La definición de pdfmake de la constancia (puro dato: viaja al hilo de
 * PDF). Una hoja carta con el resumen, una ficha por cada persona con su
 * firma, y el texto que aceptó.
 */
export function constanciaDefinition(i: ConstanciaInput): Record<string, unknown> {
    const muted = '#6b7280';
    const ink = '#111827';
    const line = { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 532, y2: 0, lineWidth: 0.6, lineColor: '#e5e7eb' }], margin: [0, 8, 0, 8] };
    const kv = (k: string, v: string): unknown[] => [
        { text: k, color: muted, fontSize: 8.5 },
        { text: v, color: ink, fontSize: 9 },
    ];
    const summary: unknown[][] = [
        kv('Documento', i.title),
        ...(i.documentNumber ? [kv('Número', i.documentNumber)] : []),
        kv('Emitido por', i.company || '—'),
        ...(i.requestedBy ? [kv('Enviado a firmar por', i.requestedBy)] : []),
        kv('Enviado', i.formatWhen(i.createdAt)),
        kv('Firmado por todos', i.formatWhen(i.completedAt)),
        kv('Páginas del original', String(i.pages)),
        kv('Código de verificación', i.code),
        kv('Huella SHA-256 del original', i.originalSha256),
    ];
    const signerBlocks = i.signers.map((s, idx) => ({
        unbreakable: true,
        margin: [0, 6, 0, 6],
        table: {
            widths: [150, '*'],
            body: [
                [
                    {
                        stack: [
                            { text: `Firma ${idx + 1}`, color: muted, fontSize: 8, margin: [0, 0, 0, 4] },
                            { image: `data:image/png;base64,${s.signaturePng}`, fit: [140, 60] },
                        ],
                        fillColor: '#f9fafb',
                    },
                    {
                        fillColor: '#f9fafb',
                        table: {
                            widths: [110, '*'],
                            body: [
                                kv('Nombre', s.name),
                                ...(s.role ? [kv('Rol', s.role)] : []),
                                kv('Correo', s.email),
                                kv('Firmó', i.formatWhen(s.signedAt)),
                                kv('Cómo firmó', s.kind === 'drawn' ? 'Dibujó su firma' : 'Escribió su nombre como firma'),
                                kv('Identificación', identificationText(s)),
                                kv('Dirección IP', s.ip || '—'),
                                kv('Navegador', browserLabel(s.userAgent)),
                            ],
                        },
                        layout: 'noBorders',
                    },
                ],
            ],
        },
        // Sin funciones (la definición viaja al hilo de PDF): la ficha es un fondo suave.
        layout: 'noBorders',
    }));
    return {
        pageSize: 'LETTER',
        pageMargins: [40, 48, 40, 48],
        info: { title: `Constancia de firma — ${i.title}`.slice(0, 200), producer: 'Firma electrónica' },
        defaultStyle: { font: 'Roboto', fontSize: 9, color: ink, lineHeight: 1.2 },
        content: [
            { text: 'Constancia de firma electrónica', fontSize: 16, bold: true, margin: [0, 0, 0, 2] },
            { text: i.title, fontSize: 10.5, color: muted, margin: [0, 0, 0, 10] },
            {
                columns: [
                    { width: '*', table: { widths: [130, '*'], body: summary }, layout: 'noBorders' },
                    { width: 96, stack: [{ qr: i.verifyUrl.slice(0, 600), fit: 92, eccLevel: 'M', foreground: ink }, { text: 'Verifícala aquí', fontSize: 7.5, color: muted, alignment: 'center', margin: [0, 4, 0, 0] }] },
                ],
                columnGap: 16,
            },
            line,
            { text: `Personas que firmaron (${i.signers.length})`, bold: true, fontSize: 11, margin: [0, 0, 0, 4] },
            ...signerBlocks,
            line,
            { text: 'Lo que aceptó cada persona antes de firmar', bold: true, fontSize: 10, margin: [0, 0, 0, 4] },
            { text: i.consentText, color: '#374151', fontSize: 8.5 },
            {
                text:
                    'Esta es una firma electrónica simple (Ley 527 de 1999 y Decreto 2364 de 2012). La huella SHA-256 identifica al documento ' +
                    'original: si se cambia una sola letra, la huella deja de coincidir. Para comprobarla, abre el enlace del código QR o ' +
                    `escribe el código ${i.code} en la página de verificación.`,
                color: muted,
                fontSize: 7.5,
                margin: [0, 10, 0, 0],
            },
            { text: i.verifyUrl, color: muted, fontSize: 7.5, margin: [0, 2, 0, 0] },
        ],
    };
}

/** El texto del sello al pie de cada página del original. */
export function stampText(code: string, verifyHost: string, signers: number): string {
    return `Firmado electrónicamente por ${signers} ${signers === 1 ? 'persona' : 'personas'} · Código ${code} · Verifica en ${verifyHost}`;
}
