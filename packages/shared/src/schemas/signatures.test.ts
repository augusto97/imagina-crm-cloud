import { describe, expect, it } from 'vitest';

import {
    createSignatureRequestSchema,
    maskEmail,
    maskPhone,
    signatureConsentText,
    signaturePhoneLooksValid,
    signatureProgress,
    signedFilename,
    signersDue,
    submitSignatureSchema,
    type SignerLike,
} from './signatures';

describe('firma electrónica — reglas puras (D6)', () => {
    it('a quién le toca: en paralelo todos los pendientes, en orden sólo el siguiente', () => {
        const s: Array<SignerLike & { id: number }> = [
            { id: 1, position: 1, status: 'signed' },
            { id: 2, position: 2, status: 'sent' },
            { id: 3, position: 3, status: 'waiting' },
        ];
        expect(signersDue('parallel', s).map((x) => x.id)).toEqual([2, 3]);
        expect(signersDue('sequential', s).map((x) => x.id)).toEqual([2]);
        expect(signersDue('sequential', s.map((x) => ({ ...x, status: 'signed' as const })))).toEqual([]);
        expect(signatureProgress(s)).toEqual({ signed: 1, total: 3 });
    });

    it('el correo enmascarado deja ver lo justo', () => {
        expect(maskEmail('ana.gomez@acme.co')).toBe('an******@acme.co');
        expect(maskEmail('jo@x.com')).toBe('j*@x.com');
        expect(maskEmail('sin-arroba')).toBe('sin-arroba');
    });

    it('la aceptación nombra a la empresa y la ley', () => {
        const t = signatureConsentText('Café Aurora');
        expect(t).toContain('Café Aurora');
        expect(t).toContain('Ley 527 de 1999');
    });

    it('valida la solicitud: correos repetidos y campo de estado sin opción', () => {
        const base = { record_id: 5, source: { kind: 'template', template_id: 2 } } as const;
        const dup = createSignatureRequestSchema.safeParse({
            ...base,
            signers: [
                { name: 'Ana', email: 'ana@x.co' },
                { name: 'Ana 2', email: 'ANA@x.co' },
            ],
        });
        expect(dup.success).toBe(false);
        const half = createSignatureRequestSchema.safeParse({
            ...base,
            signers: [{ name: 'Ana', email: 'ana@x.co' }],
            on_complete: { status_field_id: 3 },
        });
        expect(half.success).toBe(false);
        const ok = createSignatureRequestSchema.parse({ ...base, signers: [{ name: 'Ana', email: 'ana@x.co' }] });
        expect(ok.order).toBe('parallel');
        expect(ok.verify).toBe('email');
        expect(ok.expires_days).toBe(30);
        expect(ok.on_complete).toEqual({ save_field_id: null, status_field_id: null, status_value: null, date_field_id: null });
    });

    it('v0.1.448: el código por SMS o WhatsApp pide la conexión y el celular de cada persona', () => {
        const base = { record_id: 5, source: { kind: 'template', template_id: 2 } } as const;
        const noConn = createSignatureRequestSchema.safeParse({ ...base, verify: 'sms', signers: [{ name: 'Ana', email: 'ana@x.co', phone: '300 111 2233' }] });
        expect(noConn.success).toBe(false);
        expect(noConn.success ? [] : noConn.error.issues.map((i) => i.path.join('.'))).toEqual(['verify_connection_id']);
        const noPhone = createSignatureRequestSchema.safeParse({ ...base, verify: 'whatsapp', verify_connection_id: 4, signers: [{ name: 'Ana', email: 'ana@x.co' }, { name: 'Bo', email: 'bo@x.co', phone: '12' }] });
        expect(noPhone.success ? [] : noPhone.error.issues.map((i) => i.path.join('.'))).toEqual(['signers.0.phone', 'signers.1.phone']);
        const ok = createSignatureRequestSchema.parse({ ...base, verify: 'sms', verify_connection_id: 4, signers: [{ name: 'Ana', email: 'ana@x.co', phone: '+57 (300) 111-2233' }] });
        expect(ok.signers[0]!.phone).toBe('+57 (300) 111-2233');
        expect(ok.verify_template).toBeNull();
        // Con correo, el celular no hace falta.
        expect(createSignatureRequestSchema.parse({ ...base, signers: [{ name: 'Ana', email: 'ana@x.co' }] }).signers[0]!.phone).toBe('');
        expect(signaturePhoneLooksValid('3001112233')).toBe(true);
        expect(signaturePhoneLooksValid('+57 300 111 2233')).toBe(true);
        expect(signaturePhoneLooksValid('300-abc')).toBe(false);
        expect(signaturePhoneLooksValid('123456')).toBe(false);
        expect(maskPhone('+573001112233')).toBe('••• ••• 233');
        expect(maskPhone('12')).toBe('•••');
    });

    it('la firma tiene que venir como PNG y con la aceptación', () => {
        const png = 'data:image/png;base64,iVBORw0KGgo=';
        expect(submitSignatureSchema.safeParse({ name: 'Ana Gómez', kind: 'drawn', image: png, consent: true }).success).toBe(true);
        expect(submitSignatureSchema.safeParse({ name: 'Ana Gómez', kind: 'drawn', image: png, consent: false }).success).toBe(false);
        expect(submitSignatureSchema.safeParse({ name: 'Ana Gómez', kind: 'drawn', image: 'data:image/svg+xml;base64,PHN2Zz4=', consent: true }).success).toBe(false);
        expect(submitSignatureSchema.safeParse({ name: 'Ana Gómez', kind: 'typed', image: png, consent: true, code: '12a456' }).success).toBe(false);
    });

    it('nombre del PDF firmado', () => {
        expect(signedFilename('Contrato de servicios.pdf')).toBe('Contrato de servicios - firmado.pdf');
        expect(signedFilename('  ')).toBe('Documento - firmado.pdf');
        expect(signedFilename('a/b:c')).toBe('a b c - firmado.pdf');
    });
});
