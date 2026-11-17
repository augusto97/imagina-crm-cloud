import { describe, expect, it } from 'vitest';
import { explainSendError, formatSmtpRate, parseSmtpRate, tlsMismatch } from './smtpHelp';

describe('tlsMismatch', () => {
    it('465 sin conexión segura → avisa (es el timeout clásico)', () => {
        expect(tlsMismatch({ port: '465', secure: false })).toContain('activa');
    });

    it('587 con conexión segura → avisa que use STARTTLS', () => {
        expect(tlsMismatch({ port: '587', secure: true })).toContain('STARTTLS');
    });

    it('combinaciones coherentes no avisan nada', () => {
        expect(tlsMismatch({ port: '465', secure: true })).toBeNull();
        expect(tlsMismatch({ port: '587', secure: false })).toBeNull();
        expect(tlsMismatch({ port: '2525', secure: false })).toBeNull();
    });

    it('un puerto no estándar no se opina (puede ser cualquiera de los dos modos)', () => {
        expect(tlsMismatch({ port: '10025', secure: true })).toBeNull();
        expect(tlsMismatch({ port: '10025', secure: false })).toBeNull();
    });
});

describe('explainSendError', () => {
    it('timeout → manda al diagnóstico, sin perder el error original', () => {
        const text = explainSendError('Connection timeout');
        expect(text).toContain('Connection timeout');
        expect(text).toContain('Diagnosticar conexión');
    });

    it('credenciales rechazadas → apunta a usuario/contraseña', () => {
        expect(explainSendError('535 Invalid login: authentication failed')).toContain('credenciales');
    });

    it('remitente rechazado → apunta al From', () => {
        expect(explainSendError('550 Sender address rejected')).toContain('remitente');
    });

    it('sin error → mensaje genérico; error desconocido → tal cual', () => {
        expect(explainSendError(undefined)).toBe('No se pudo enviar la prueba.');
        expect(explainSendError('Algo raro pasó')).toBe('Algo raro pasó');
    });
});

describe('correos por segundo (v0.1.434)', () => {
    it('vacío = el valor por defecto; acepta coma decimal; fuera de rango = inválido', () => {
        expect(parseSmtpRate('')).toBeNull();
        expect(parseSmtpRate(' 2 ')).toBe(2);
        expect(parseSmtpRate('0,5')).toBe(0.5);
        expect(parseSmtpRate('0')).toBeUndefined();
        expect(parseSmtpRate('100')).toBeUndefined();
        expect(parseSmtpRate('dos')).toBeUndefined();
        expect(formatSmtpRate(0.5)).toBe('0,5');
        expect(formatSmtpRate(null)).toBe('');
    });

    it('el «452 … limit exceeded» del proveedor dice qué tocar', () => {
        const msg = explainSendError('Mail command failed: 452 4.4.5 Messages per second limit exceeded (2/2)');
        expect(msg).toContain('Correos por segundo');
    });
});
