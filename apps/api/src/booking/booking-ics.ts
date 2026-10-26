/**
 * D5 — El archivo .ics de una cita («Agregar a mi calendario»): RFC 5545,
 * puro. Un solo evento con UID estable por cita, así reprogramar o cancelar
 * actualiza el MISMO evento en el calendario del cliente (SEQUENCE sube con
 * cada cambio; cancelar manda STATUS:CANCELLED con METHOD:CANCEL).
 */

export interface IcsEventInput {
    uid: string;
    start: Date;
    end: Date;
    summary: string;
    description: string;
    location: string;
    /** Sube en cada cambio (el calendario reemplaza la versión anterior). */
    sequence: number;
    cancelled?: boolean;
    url?: string;
    organizerName?: string;
    now?: Date;
}

/** Texto de una propiedad: barra invertida, punto y coma, coma y saltos de línea escapados. */
export function icsText(v: string): string {
    return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsDate(d: Date): string {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Corta las líneas a 75 octetos (las continuaciones empiezan con un espacio). */
export function foldIcsLine(line: string): string {
    const bytes = Buffer.from(line, 'utf8');
    if (bytes.length <= 75) return line;
    const parts: string[] = [];
    let current = '';
    let size = 0;
    for (const ch of line) {
        const n = Buffer.byteLength(ch, 'utf8');
        const limit = parts.length === 0 ? 75 : 74;
        if (size + n > limit) {
            parts.push(current);
            current = '';
            size = 0;
        }
        current += ch;
        size += n;
    }
    parts.push(current);
    return parts.join('\r\n ');
}

export function buildIcs(e: IcsEventInput): string {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Imagina Base//Agenda//ES',
        'CALSCALE:GREGORIAN',
        `METHOD:${e.cancelled ? 'CANCEL' : 'PUBLISH'}`,
        'BEGIN:VEVENT',
        `UID:${e.uid}`,
        `DTSTAMP:${icsDate(e.now ?? new Date())}`,
        `DTSTART:${icsDate(e.start)}`,
        `DTEND:${icsDate(e.end)}`,
        `SEQUENCE:${Math.max(0, Math.floor(e.sequence))}`,
        `SUMMARY:${icsText(e.summary)}`,
        ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
        ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
        ...(e.url ? [`URL:${e.url}`] : []),
        `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
        'TRANSP:OPAQUE',
        ...(e.cancelled
            ? []
            : ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(e.summary)}`, 'TRIGGER:-PT1H', 'END:VALARM']),
        'END:VEVENT',
        'END:VCALENDAR',
    ];
    return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
