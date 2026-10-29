import { describe, expect, it } from 'vitest';
import {
    SMS_BULK_MAX,
    commercialWindowOfDay,
    finalSmsText,
    isGsm7Text,
    isWithinCommercialHours,
    maskSmsPhone,
    nextCommercialSendTime,
    nextSmsStatus,
    readSmsListFields,
    smsBulkSchema,
    smsCounterLabel,
    smsRecipient,
    smsSegments,
    smsSendSchema,
    stripSmsAccents,
    suggestSmsFields,
    writeSmsListFields,
} from './sms';
import { bookingNotificationsSchema } from './booking';
import { INTEGRATIONS, integrationDef } from './integrations';

const BOG = 'America/Bogota';

describe('SMS — cuántos SMS ocupa un texto', () => {
    it('GSM-7 trae ñ, é, ü, ¿, ¡ y Ç; á, í, ó y ú lo pasan a Unicode', () => {
        expect(isGsm7Text('Señor Müller, ¿confirma? ¡Gracias! é è à ì ò ù Ç É Ñ Ü')).toBe(true);
        for (const c of ['á', 'í', 'ó', 'ú', 'Á', 'Í', 'Ó', 'Ú']) expect(isGsm7Text(`Hola ${c}`)).toBe(false);
        const info = smsSegments('Tu cita es mañana a las 10:00');
        expect(info).toMatchObject({ encoding: 'gsm7', segments: 1, per_segment: 160 });
        const uni = smsSegments('Tu cita del día 3');
        expect(uni.encoding).toBe('ucs2');
        expect(uni.non_gsm).toEqual(['í']);
    });

    it('160 caracteres son 1 SMS; 161 son 2 (de 153); 307 son 3', () => {
        expect(smsSegments('a'.repeat(160))).toMatchObject({ segments: 1, units: 160, remaining: 0 });
        expect(smsSegments('a'.repeat(161))).toMatchObject({ segments: 2, per_segment: 153, remaining: 145 });
        expect(smsSegments('a'.repeat(306)).segments).toBe(2);
        expect(smsSegments('a'.repeat(307)).segments).toBe(3);
        expect(smsSegments('')).toMatchObject({ segments: 0, chars: 0 });
    });

    it('la tabla de extensión ocupa dos posiciones y nunca se parte entre dos SMS', () => {
        expect(smsSegments('a'.repeat(159) + '€')).toMatchObject({ encoding: 'gsm7', units: 161, segments: 2 });
        expect(smsSegments('a'.repeat(158) + '€')).toMatchObject({ units: 160, segments: 1 });
        // 152 + € (2) no entra en la primera parte de 153: salta entera a la segunda.
        expect(smsSegments('a'.repeat(152) + '€' + 'a'.repeat(10))).toMatchObject({ segments: 2, remaining: 153 - 12 });
        for (const c of ['^', '{', '}', '\\', '[', '~', ']', '|', '€']) expect(smsSegments(c).units).toBe(2);
    });

    it('Unicode: 70 por SMS solo, 67 en varios; un emoji no se parte', () => {
        expect(smsSegments('á'.repeat(70))).toMatchObject({ encoding: 'ucs2', segments: 1, per_segment: 70 });
        expect(smsSegments('á'.repeat(71))).toMatchObject({ segments: 2, per_segment: 67 });
        expect(smsSegments('á'.repeat(134)).segments).toBe(2);
        expect(smsSegments('á'.repeat(135)).segments).toBe(3);
        expect(smsSegments('á'.repeat(66) + '😀')).toMatchObject({ units: 68, segments: 1, chars: 67 });
        expect(smsSegments('á'.repeat(66) + '😀' + 'ááá')).toMatchObject({ units: 71, segments: 2, remaining: 67 - 5 });
    });

    it('el contador dice SMS y caracteres', () => {
        expect(smsCounterLabel(smsSegments('a'.repeat(145)))).toBe('1 SMS · 145 caracteres');
        expect(smsCounterLabel(smsSegments('á'.repeat(100)))).toBe('2 SMS · 100 caracteres');
    });

    it('«Quitar tildes» cambia sólo lo que no está en GSM-7 y conserva ñ, é, ü, ¿ y ¡', () => {
        const out = stripSmsAccents('Canción días útil ÓRBITA ñandú é ü ¿Sí? ¡Ok! “hola” — fin… a b');
        expect(out).toBe('Cancion dias util ORBITA ñandu é ü ¿Si? ¡Ok! "hola" - fin... a b');
        expect(isGsm7Text(out)).toBe(true);
        // Lo que no tiene equivalente queda: el contador sigue diciendo Unicode.
        expect(stripSmsAccents('Listo 😀')).toBe('Listo 😀');
        expect(smsSegments('Vence el día 30, ¡págala hoy!').encoding).toBe('ucs2');
        expect(smsSegments(stripSmsAccents('Vence el día 30, ¡págala hoy!')).encoding).toBe('gsm7');
        expect(finalSmsText('  Hola Ána \r\n ', true)).toBe('Hola Ana');
    });
});

describe('SMS — horario de la Ley 2300 de 2023', () => {
    it('lunes a viernes 7:00–19:00 (19:00 ya no), en la zona de la empresa', () => {
        // Jueves 29 de octubre de 2026 (Bogotá = UTC−5).
        expect(isWithinCommercialHours(new Date('2026-10-29T15:00:00Z'), BOG)).toBe(true);
        expect(isWithinCommercialHours(new Date('2026-10-29T23:59:00Z'), BOG)).toBe(true); // 18:59
        expect(isWithinCommercialHours(new Date('2026-10-30T00:00:00Z'), BOG)).toBe(false); // 19:00
        expect(isWithinCommercialHours(new Date('2026-10-29T11:59:00Z'), BOG)).toBe(false); // 6:59
        expect(nextCommercialSendTime(new Date('2026-10-30T00:30:00Z'), BOG).toISOString()).toBe('2026-10-30T12:00:00.000Z');
        // Dentro de la franja: sale en el acto.
        const now = new Date('2026-10-29T16:05:00Z');
        expect(nextCommercialSendTime(now, BOG).getTime()).toBe(now.getTime());
    });

    it('sábados 8:00–15:00; ni domingos ni festivos (el 2 de noviembre de 2026 es festivo)', () => {
        expect(isWithinCommercialHours(new Date('2026-10-31T19:59:00Z'), BOG)).toBe(true); // sáb 14:59
        expect(isWithinCommercialHours(new Date('2026-10-31T20:00:00Z'), BOG)).toBe(false); // sáb 15:00
        expect(nextCommercialSendTime(new Date('2026-10-31T12:30:00Z'), BOG).toISOString()).toBe('2026-10-31T13:00:00.000Z'); // sáb 7:30 → 8:00
        // Sábado por la tarde → domingo no, lunes 2 (festivo) no → martes 3 a las 7:00.
        expect(nextCommercialSendTime(new Date('2026-10-31T21:00:00Z'), BOG).toISOString()).toBe('2026-11-03T12:00:00.000Z');
        expect(commercialWindowOfDay('2026-11-01', BOG)).toBeNull();
        expect(commercialWindowOfDay('2026-11-02', BOG)).toBeNull();
        expect(commercialWindowOfDay('2026-12-25', BOG)).toBeNull();
    });

    it('en otra zona cuenta su reloj; sin zona válida, la de Colombia', () => {
        // 18:30 en Ciudad de México (UTC−6) del jueves = 00:30Z del viernes: aún se puede allá.
        expect(isWithinCommercialHours(new Date('2026-10-30T00:30:00Z'), 'America/Mexico_City')).toBe(true);
        expect(isWithinCommercialHours(new Date('2026-10-30T00:30:00Z'), null)).toBe(false);
    });
});

describe('SMS — estados, teléfonos y columnas', () => {
    it('los estados sólo avanzan y los finales no cambian', () => {
        expect(nextSmsStatus(null, 'enviado')).toBe('enviado');
        expect(nextSmsStatus('enviado', 'entregado')).toBe('entregado');
        expect(nextSmsStatus('entregado', 'enviado')).toBeNull();
        expect(nextSmsStatus('enviado', 'fallido')).toBe('fallido');
        expect(nextSmsStatus('fallido', 'entregado')).toBeNull();
        expect(nextSmsStatus('entregado', 'fallido')).toBeNull();
        expect(nextSmsStatus('programado', 'en_cola')).toBe('en_cola');
        expect(nextSmsStatus('enviado', 'enviado')).toBeNull();
    });

    it('un número local toma el país de la conexión (Colombia si no dice otro)', () => {
        expect(smsRecipient('300 111 2233')).toEqual({ ok: true, e164: '+573001112233' });
        expect(smsRecipient('(55) 1234 5678', 'MX')).toEqual({ ok: true, e164: '+525512345678' });
        expect(smsRecipient('+1 (555) 123-4567')).toEqual({ ok: true, e164: '+15551234567' });
        expect(smsRecipient('0057 300 111 2233')).toEqual({ ok: true, e164: '+573001112233' });
        expect(smsRecipient('').ok).toBe(false);
        expect(smsRecipient('hola').ok).toBe(false);
        expect(maskSmsPhone('+573001112233')).toBe('+57 300…');
    });

    it('columnas: lee, escribe y sugiere el primer teléfono', () => {
        const fields = [
            { id: 4, slug: 'nombre', type: 'text' },
            { id: 7, slug: 'celular', type: 'phone' },
            { id: 9, slug: 'sms_estado', type: 'select' },
        ];
        expect(suggestSmsFields(fields)).toEqual({ phone: 7, last_at: null, last_status: 9 });
        const settings = { sms: writeSmsListFields({ phone: 7, last_at: 12, last_status: null }) };
        expect(settings.sms).toEqual({ phone_field_id: 7, last_at_field_id: 12, last_status_field_id: null });
        expect(readSmsListFields(settings)).toEqual({ phone: 7, last_at: 12, last_status: null });
        expect(readSmsListFields({ sms: { phone_field_id: 'x' } })).toEqual({ phone: null, last_at: null, last_status: null });
    });

    it('los esquemas de la API exigen mensaje y topean la selección', () => {
        expect(smsSendSchema.safeParse({ connection_id: 1, message: '   ' }).success).toBe(false);
        expect(smsSendSchema.parse({ connection_id: 1, message: 'Hola' })).toMatchObject({ strip_accents: false, respect_hours: false });
        const ids = Array.from({ length: SMS_BULK_MAX + 1 }, (_, i) => i + 1);
        expect(smsBulkSchema.safeParse({ connection_id: 1, record_ids: ids, message: 'x' }).success).toBe(false);
    });

    it('el catálogo trae los cinco proveedores con la misma acción y la agenda trae recordatorios por SMS', () => {
        const keys = INTEGRATIONS.filter((i) => i.category === 'sms').map((i) => i.key);
        expect(keys).toEqual(['sms_twilio', 'sms_bulkgate', 'sms_infobip', 'sms_labsmobile', 'sms_onurix']);
        for (const k of keys) {
            const def = integrationDef(k)!;
            expect(def.auth.kind).toBe('key');
            expect(def.actions.map((a) => a.key)).toEqual(['send_sms']);
            expect(def.actions[0]!.params.map((p) => p.key)).toEqual(['to', 'message', 'sender', 'strip_accents', 'respect_hours']);
            if (def.auth.kind === 'key') expect(def.auth.fields.filter((f) => f.secret).length).toBe(1);
        }
        const n = bookingNotificationsSchema.parse({});
        expect(n.sms_reminders).toMatchObject({ enabled: false, connection_id: null, strip_accents: true });
        expect(n.sms_reminders.text).toContain('{{cita.inicio}}');
    });
});
