import { describe, expect, it } from 'vitest';

import { NOTIFICATION_KINDS, readNotificationPrefs, updateNotificationPrefsSchema } from './notifications';
import { pushLine, pushSubscribeSchema, pushTag } from './push';
import { codeSearchQuerySchema, normalizeScanCode, pickScanField, readScanFieldId, scanCodeAsNumber } from './scan';

describe('H1 — preferencias de push', () => {
    it('por defecto: lo directo y con apuro (mención, asignación, aprobación, recordatorio, SLA)', () => {
        const prefs = readNotificationPrefs({});
        const on = NOTIFICATION_KINDS.filter((k) => prefs.push[k]);
        expect(on.sort()).toEqual(['approval', 'assigned', 'mention', 'reminder', 'sla']);
        // Preferencias guardadas ANTES de existir el push: se completan con los defaults.
        expect(readNotificationPrefs({ email: { mention: false } }).push.mention).toBe(true);
        // Lo guardado manda.
        expect(readNotificationPrefs({ push: { mention: false, update: true } }).push).toMatchObject({ mention: false, update: true, assigned: true });
    });

    it('el PATCH acepta cambiar un solo tipo y rechaza tipos que no existen', () => {
        expect(updateNotificationPrefsSchema.parse({ push: { comment: true } })).toEqual({ push: { comment: true } });
        expect(updateNotificationPrefsSchema.safeParse({ push: { comment: 'sí' } }).success).toBe(false);
        // Una clave desconocida se descarta (no se guarda basura).
        expect(updateNotificationPrefsSchema.parse({ push: { inventado: true } })).toEqual({ push: {} });
    });

    it('la suscripción del navegador: endpoint URL y claves base64url', () => {
        const ok = {
            endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
            keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) },
            expirationTime: null,
        };
        expect(pushSubscribeSchema.safeParse(ok).success).toBe(true);
        expect(pushSubscribeSchema.safeParse({ ...ok, endpoint: 'no es una url' }).success).toBe(false);
        expect(pushSubscribeSchema.safeParse({ ...ok, keys: { ...ok.keys, auth: 'con espacios y +/' } }).success).toBe(false);
    });

    it('título y línea: una sola línea y cortados con «…»', () => {
        expect(pushLine('  Hola\n\tmundo  ', 40)).toBe('Hola mundo');
        expect(pushLine('a'.repeat(50), 10)).toBe(`${'a'.repeat(9)}…`);
        expect(pushTag('mention', 42)).toBe('rec-42-mention');
        expect(pushTag('failure', null, 7)).toBe('n-7');
        expect(pushTag('failure', null)).toBe('k-failure');
    });
});

describe('H3 — códigos escaneados', () => {
    it('se normaliza: sin control (GS1) ni espacios de los bordes', () => {
        expect(normalizeScanCode('\u001d  TZ-001 \n')).toBe('TZ-001');
        expect(normalizeScanCode('A B')).toBe('A B');
    });

    it('un código numérico también encuentra el número guardado', () => {
        expect(scanCodeAsNumber('0123')).toBe(123);
        expect(scanCodeAsNumber('-12.5')).toBe(-12.5);
        expect(scanCodeAsNumber('7701234567890')).toBe(7701234567890);
        // Un EAN de 16+ dígitos no entra en un número sin perder precisión.
        expect(scanCodeAsNumber('1234567890123456')).toBeNull();
        expect(scanCodeAsNumber('TZ-1')).toBeNull();
        expect(scanCodeAsNumber('1e5')).toBeNull();
    });

    it('el campo «Código»: el elegido (si sigue siendo válido) o el que lo dice en el nombre', () => {
        const fields = [
            { id: 1, slug: 'nombre', label: 'Nombre', type: 'text' },
            { id: 2, slug: 'sku', label: 'SKU', type: 'text' },
            { id: 3, slug: 'stock', label: 'Stock', type: 'number' },
            { id: 4, slug: 'foto', label: 'Código de foto', type: 'file' },
        ];
        expect(pickScanField(fields, {})?.id).toBe(2);
        expect(pickScanField(fields, { scan_field_id: 3 })?.id).toBe(3);
        // Elegido pero de un tipo que no se busca → cae a la pista por nombre.
        expect(pickScanField(fields, { scan_field_id: 4 })?.id).toBe(2);
        expect(pickScanField([{ id: 9, slug: 'cliente', label: 'Cliente', type: 'text' }], null)).toBeNull();
        expect(readScanFieldId({ scan_field_id: '12' })).toBe(12);
        expect(readScanFieldId({ scan_field_id: -1 })).toBeNull();
    });

    it('la consulta: código obligatorio y tope de resultados', () => {
        expect(codeSearchQuerySchema.parse({ code: 'X1' }).limit).toBe(20);
        expect(codeSearchQuerySchema.safeParse({ code: '' }).success).toBe(false);
        expect(codeSearchQuerySchema.safeParse({ code: 'X', limit: 500 }).success).toBe(false);
    });
});
