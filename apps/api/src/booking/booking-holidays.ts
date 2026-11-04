import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    addDaysYmd,
    blockedHolidayDates,
    classifyHoliday,
    colombianHolidays,
    holidayCountry,
    holidayIcsUrl,
    msToYmd,
    type BookingAvailability,
    type HolidayItem,
} from '@imagina-base/shared';
import type Redis from 'ioredis';
import { safeWebhookFetch } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';

/**
 * v0.1.349 — Festivos por país para la agenda (ADR-S67 addendum).
 *
 * Fuente: el iCal PÚBLICO del calendario oficial de festivos de Google de ese
 * país (sin cuenta ni clave; lo que muestra Google Calendar en «Festivos en
 * …»). Está al día con los decretos —un puente nuevo, un festivo que se
 * mueve— sin sacar una versión de la app.
 *
 * Caché en Redis por país: fresco 7 días; si Google no responde se sigue con
 * lo último que se supo hasta 400 días (nunca se deja de bloquear un festivo
 * conocido por un corte de red). Sin nada guardado:
 *  - Colombia: las reglas de la app (Ley Emiliani), como antes de v0.1.349;
 *  - otro país: sin festivos (la página sigue ofreciendo horarios) y el que
 *    llama decide avisar.
 *
 * Seguridad: la dirección sale SÓLO del catálogo (`HOLIDAY_COUNTRIES`, código
 * validado), va por el guard anti-SSRF, con tope de tiempo y de tamaño, y el
 * iCal se lee como texto (nada se interpreta como HTML ni se ejecuta).
 */

const FRESH_MS = 7 * 86_400_000;
const STALE_MS = 400 * 86_400_000;
const MEMO_MS = 10 * 60_000;
const MAX_ICS_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 5000;

interface Cached {
    at: number;
    items: HolidayItem[];
}

/** Lo que dice un renglón «CLAVE;PARAM=…:valor» (valor ya sin los escapes de iCal). */
function unescapeText(v: string): string {
    return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
}

/**
 * Los festivos de un iCal (sólo eventos de día completo `VALUE=DATE`). Un
 * evento de varios días se expande (DTEND es exclusivo). Tolerante: lo que no
 * se entiende se salta.
 */
export function parseHolidayIcs(text: string): HolidayItem[] {
    // Desplegar los renglones continuados (RFC 5545: empiezan con espacio o tab).
    const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const out = new Map<string, HolidayItem>();
    let ev: Record<string, string> | null = null;
    for (const line of lines) {
        if (line === 'BEGIN:VEVENT') {
            ev = {};
            continue;
        }
        if (line === 'END:VEVENT') {
            if (ev) addEvent(ev, out);
            ev = null;
            if (out.size >= MAX_ITEMS) break;
            continue;
        }
        if (!ev) continue;
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        const head = line.slice(0, colon);
        const key = head.split(';')[0]!.toUpperCase();
        if (key === 'DTSTART' || key === 'DTEND' || key === 'SUMMARY' || key === 'DESCRIPTION' || key === 'STATUS') {
            ev[key] = line.slice(colon + 1);
            if (key === 'DTSTART' || key === 'DTEND') ev[`${key}_PARAMS`] = head;
        }
    }
    return [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

function icsDate(v: string | undefined): string | null {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec((v ?? '').trim());
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function addEvent(ev: Record<string, string>, out: Map<string, HolidayItem>): void {
    if ((ev.STATUS ?? '').toUpperCase() === 'CANCELLED') return;
    if (!/VALUE=DATE(?!-)/i.test(ev.DTSTART_PARAMS ?? '')) return;
    const start = icsDate(ev.DTSTART);
    if (!start) return;
    const endExclusive = icsDate(ev.DTEND) ?? addDaysYmd(start, 1);
    const name = unescapeText(ev.SUMMARY ?? '').slice(0, 120) || 'Festivo';
    const kind = classifyHoliday(unescapeText(ev.DESCRIPTION ?? ''));
    let day = start;
    for (let i = 0; i < 10 && day < endExclusive; i++, day = addDaysYmd(day, 1)) {
        const prev = out.get(day);
        // Si el mismo día trae un festivo nacional y uno regional, manda el nacional.
        if (!prev || (prev.kind === 'regional' && kind !== 'regional')) out.set(day, { date: day, name, kind });
    }
}

/** Respaldo de Colombia: las reglas de la app (Ley Emiliani), sin nombres. */
export function colombianFallback(fromYear: number, toYear: number): HolidayItem[] {
    const out: HolidayItem[] = [];
    for (let y = fromYear; y <= toYear; y++) {
        for (const ms of colombianHolidays(y)) out.push({ date: msToYmd(ms), name: 'Festivo', kind: 'national' });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
}

@Injectable()
export class BookingHolidaysService {
    private readonly logger = new Logger(BookingHolidaysService.name);
    private readonly memo = new Map<string, { at: number; items: HolidayItem[] | null }>();
    private readonly inflight = new Map<string, Promise<HolidayItem[] | null>>();

    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
    ) {}

    /**
     * Los festivos conocidos de un país (todos los años que trae el calendario
     * de Google: unos pocos hacia atrás y uno o dos hacia adelante), o null si
     * no hay forma de saberlos ahora (país desconocido, Google no responde y no
     * hay nada guardado — salvo Colombia, que tiene respaldo).
     */
    async items(code: string): Promise<HolidayItem[] | null> {
        const country = holidayCountry(code);
        if (!country) return null;
        const memo = this.memo.get(country.code);
        if (memo && Date.now() - memo.at < MEMO_MS) return memo.items;
        let p = this.inflight.get(country.code);
        if (!p) {
            p = this.load(country.code).finally(() => this.inflight.delete(country.code));
            this.inflight.set(country.code, p);
        }
        const items = await p;
        this.memo.set(country.code, { at: Date.now(), items });
        if (this.memo.size > 100) this.memo.clear();
        return items;
    }

    private async load(code: string): Promise<HolidayItem[] | null> {
        const key = `holidays:v1:${code}`;
        let cached: Cached | null = null;
        try {
            const raw = await this.redis.get(key);
            if (raw) cached = JSON.parse(raw) as Cached;
        } catch {
            cached = null;
        }
        if (cached && Array.isArray(cached.items) && Date.now() - cached.at < FRESH_MS) return cached.items;
        try {
            const items = await this.fetchCountry(code);
            if (items.length > 0) {
                await this.redis.set(key, JSON.stringify({ at: Date.now(), items } satisfies Cached), 'PX', STALE_MS).catch(() => undefined);
                return items;
            }
            throw new Error('el calendario vino vacío');
        } catch (err) {
            this.logger.warn(`Festivos de ${code}: no se pudieron bajar (${err instanceof Error ? err.message : String(err)}).`);
            if (cached && Array.isArray(cached.items)) return cached.items;
            if (code === 'CO') {
                const y = new Date().getUTCFullYear();
                return colombianFallback(y - 1, y + 2);
            }
            return null;
        }
    }

    private async fetchCountry(code: string): Promise<HolidayItem[]> {
        const country = holidayCountry(code)!;
        const url = holidayIcsUrl(country, this.env.HOLIDAYS_ICS_BASE || 'https://calendar.google.com');
        const res = await safeWebhookFetch(url, {
            method: 'GET',
            headers: { accept: 'text/calendar' },
            captureBody: true,
            maxCaptureBytes: MAX_ICS_BYTES,
            timeoutMs: 8000,
        });
        if (res.status !== 200) throw new Error(`Google respondió ${res.status}`);
        const body = res.body ?? '';
        if (!body.startsWith('BEGIN:VCALENDAR')) throw new Error('la respuesta no es un calendario');
        return parseHolidayIcs(body);
    }

    /**
     * Las fechas en que esa persona no atiende por festivo, o `undefined` si
     * no se pudieron saber (el motor usa entonces sus reglas: Colombia o nada).
     */
    async blockedFor(availability: BookingAvailability): Promise<Set<string> | undefined> {
        if (availability.holiday_country === null) return new Set();
        const items = await this.items(availability.holiday_country);
        if (!items) return undefined;
        return blockedHolidayDates(items, availability.holiday_work, availability.holiday_off);
    }
}
