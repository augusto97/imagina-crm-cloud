import { createECDH, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    b64url,
    decryptPushPayload,
    encryptPushPayload,
    endpointHash,
    fromB64url,
    generateVapidKeys,
    vapidAuthorization,
} from '../src/pwa/web-push';

/**
 * H1 — Web Push con `node:crypto`. Los vectores son los del RFC 8291
 * (Apéndice A): si el cifrado coincide byte a byte, Chrome, Firefox y Safari
 * descifran lo que manda el servidor.
 */
const RFC = {
    plaintext: 'When I grow up, I want to be a watermelon',
    asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    body:
        'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

describe('H1 — Web Push (RFC 8291 / 8188 / 8292)', () => {
    it('cifra EXACTAMENTE como el vector del RFC 8291 (Apéndice A)', () => {
        const body = encryptPushPayload(
            RFC.plaintext,
            { p256dh: RFC.uaPublic, auth: RFC.auth },
            { salt: fromB64url(RFC.salt), asPrivateKey: fromB64url(RFC.asPrivate) },
        );
        expect(b64url(body)).toBe(RFC.body);
        // El encabezado lleva la clave pública efímera del servidor del RFC.
        expect(b64url(body.subarray(21, 86))).toBe(RFC.asPublic);
    });

    it('descifra el vector del RFC con las llaves del navegador', () => {
        const out = decryptPushPayload(fromB64url(RFC.body), {
            privateKey: fromB64url(RFC.uaPrivate),
            publicKey: fromB64url(RFC.uaPublic),
            auth: fromB64url(RFC.auth),
        });
        expect(out.toString('utf8')).toBe(RFC.plaintext);
    });

    it('ida y vuelta con llaves nuevas (salt y clave efímera al azar en cada mensaje)', () => {
        const ua = createECDH('prime256v1');
        ua.generateKeys();
        const auth = Buffer.from('0123456789abcdef');
        const keys = { p256dh: b64url(ua.getPublicKey()), auth: b64url(auth) };
        const msg = JSON.stringify({ title: 'Ana te mencionó en «Acme»', url: '/#/lists/x/records/1' });
        const a = encryptPushPayload(msg, keys);
        const b = encryptPushPayload(msg, keys);
        expect(b64url(a)).not.toBe(b64url(b));
        const out = decryptPushPayload(a, { privateKey: ua.getPrivateKey(), publicKey: ua.getPublicKey(), auth });
        expect(out.toString('utf8')).toBe(msg);
    });

    it('rechaza llaves que no son de P-256 y mensajes demasiado grandes', () => {
        expect(() => encryptPushPayload('x', { p256dh: b64url(Buffer.alloc(10)), auth: RFC.auth })).toThrow(/p256dh/);
        expect(() => encryptPushPayload('x'.repeat(5000), { p256dh: RFC.uaPublic, auth: RFC.auth })).toThrow(/grande/);
    });

    it('VAPID: JWT ES256 con aud = origen del servicio, verificable con la pública', () => {
        const keys = generateVapidKeys();
        expect(fromB64url(keys.publicKey)).toHaveLength(65);
        expect(fromB64url(keys.privateKey)).toHaveLength(32);
        const now = 1_800_000_000;
        const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:ops@imagina.test', now);
        const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
        expect(m).not.toBeNull();
        expect(m![2]).toBe(keys.publicKey);
        const [h, c, s] = m![1]!.split('.');
        expect(JSON.parse(fromB64url(h!).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
        expect(JSON.parse(fromB64url(c!).toString())).toEqual({ aud: 'https://fcm.googleapis.com', exp: now + 12 * 3600, sub: 'mailto:ops@imagina.test' });
        const pub = fromB64url(keys.publicKey);
        const key = createPublicKey({
            key: { kty: 'EC', crv: 'P-256', x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)) },
            format: 'jwk',
        });
        const sig = fromB64url(s!);
        expect(sig).toHaveLength(64);
        expect(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, sig)).toBe(true);
    });

    it('huella del endpoint: estable y corta', () => {
        expect(endpointHash('https://push.test/a')).toBe(endpointHash('https://push.test/a'));
        expect(endpointHash('https://push.test/a')).not.toBe(endpointHash('https://push.test/b'));
        expect(endpointHash('https://push.test/a')).toMatch(/^[0-9a-f]{16}$/);
    });
});
