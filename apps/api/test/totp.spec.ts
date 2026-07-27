import { describe, expect, it } from 'vitest';
import {
    base32Decode,
    base32Encode,
    generateBackupCodes,
    generateTotpSecret,
    hotp,
    normalizeBackupCode,
    otpauthUri,
    totp,
    verifyTotp,
} from '../src/auth/totp';

/**
 * v0.1.120 — El algoritmo se valida contra los VECTORES DE PRUEBA de los RFC:
 * si esta implementación se desvía un dígito, ninguna app de autenticación del
 * mundo funcionaría con la nuestra.
 */
describe('TOTP (RFC 4226 / 6238)', () => {
    // El secreto de los vectores del RFC 4226: la cadena ASCII "12345678901234567890".
    const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'utf8'));

    it('base32 va y vuelve', () => {
        const buf = Buffer.from('12345678901234567890', 'utf8');
        expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
        // Tolera minúsculas, espacios y relleno.
        expect(base32Decode('mzxw 6yq=').toString('utf8')).toBe('foob');
    });

    it('HOTP: vectores del RFC 4226 (apéndice D)', () => {
        const secret = Buffer.from('12345678901234567890', 'utf8');
        const expected = [
            '755224', '287082', '359152', '969429', '338314',
            '254676', '287922', '162583', '399871', '520489',
        ];
        expected.forEach((code, counter) => {
            expect(hotp(secret, counter)).toBe(code);
        });
    });

    it('TOTP: vectores del RFC 6238 (SHA-1)', () => {
        // [segundos desde epoch, código esperado] con el secreto de 20 bytes.
        const vectors: Array<[number, string]> = [
            [59, '287082'],
            [1111111109, '081804'],
            [1111111111, '050471'],
            [1234567890, '005924'],
            [2000000000, '279037'],
        ];
        for (const [seconds, code] of vectors) {
            expect(totp(RFC_SECRET, seconds * 1000)).toBe(code);
        }
    });

    it('verifyTotp acepta ±1 ventana y rechaza lo demás', () => {
        const at = 1111111109 * 1000;
        expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at), at)).toBe(true);
        // Una ventana atrás y una adelante entran (reloj desfasado del móvil).
        expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at - 30_000), at)).toBe(true);
        expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at + 30_000), at)).toBe(true);
        // Dos ventanas ya no.
        expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at + 90_000), at)).toBe(false);
        // Basura: ni rompe ni pasa.
        expect(verifyTotp(RFC_SECRET, '000000', at)).toBe(false);
        expect(verifyTotp(RFC_SECRET, 'abcdef', at)).toBe(false);
        expect(verifyTotp(RFC_SECRET, '12345', at)).toBe(false);
    });

    it('el secreto generado tiene 160 bits y sirve para generar códigos', () => {
        const secret = generateTotpSecret();
        expect(base32Decode(secret)).toHaveLength(20);
        expect(verifyTotp(secret, totp(secret))).toBe(true);
        // Dos altas nunca comparten secreto.
        expect(generateTotpSecret()).not.toBe(secret);
    });

    it('el URI otpauth lleva secreto, emisor y parámetros', () => {
        const uri = otpauthUri('Imagina Base', 'ana@acme.test', RFC_SECRET);
        expect(uri.startsWith('otpauth://totp/Imagina%20Base%3Aana%40acme.test?')).toBe(true);
        const params = new URLSearchParams(uri.split('?')[1]);
        expect(params.get('secret')).toBe(RFC_SECRET);
        expect(params.get('issuer')).toBe('Imagina Base');
        expect(params.get('digits')).toBe('6');
        expect(params.get('period')).toBe('30');
    });

    it('códigos de respaldo: 10, únicos y normalizables', () => {
        const codes = generateBackupCodes();
        expect(codes).toHaveLength(10);
        expect(new Set(codes).size).toBe(10);
        for (const c of codes) {
            expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
            // El usuario puede tipearlo con espacios, minúsculas o sin guión.
            expect(normalizeBackupCode(c.toLowerCase().replace('-', ' '))).toBe(
                normalizeBackupCode(c),
            );
        }
    });
});
