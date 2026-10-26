import { createCipheriv, createDecipheriv, createECDH, createHash, createHmac, createPrivateKey, randomBytes, sign } from 'node:crypto';

/**
 * H1 — Web Push con `node:crypto`, sin dependencias.
 *
 *  - RFC 8291: cifrado del mensaje para UN navegador (ECDH P-256 con su clave
 *    `p256dh` + su secreto `auth`, HKDF-SHA-256, AES-128-GCM).
 *  - RFC 8188: el formato `aes128gcm` (encabezado con salt, tamaño de registro
 *    y la clave pública efímera; un único registro con delimitador 0x02).
 *  - RFC 8292: VAPID — el servidor se identifica ante el servicio de push con
 *    un JWT ES256 firmado con SU par de llaves (las del manifiesto de la app).
 *
 * Por qué no la librería `web-push`: arrastra dependencias (http_ece,
 * asn1.js, jws, agentes de proxy) para algo que son ~100 líneas sobre
 * `node:crypto`, y las pruebas usan los vectores del RFC 8291 (Apéndice A)
 * — la única garantía real de que Chrome, Firefox y Safari lo descifran.
 */

export function b64url(buf: Buffer | Uint8Array): string {
    return Buffer.from(buf).toString('base64url');
}

export function fromB64url(s: string): Buffer {
    return Buffer.from(s.replace(/=+$/, ''), 'base64url');
}

/** Par VAPID: pública sin comprimir (65 bytes) y privada (32 bytes), en base64url. */
export interface VapidKeys {
    publicKey: string;
    privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(padKey(ecdh.getPrivateKey())) };
}

/** La privada de P-256 puede venir con menos de 32 bytes (ceros a la izquierda). */
function padKey(k: Buffer): Buffer {
    return k.length >= 32 ? k : Buffer.concat([Buffer.alloc(32 - k.length), k]);
}

function hmac(key: Buffer, data: Buffer): Buffer {
    return createHmac('sha256', key).update(data).digest();
}

/** HKDF-SHA-256 de un solo bloque (alcanza para ≤ 32 bytes, que es todo lo que se deriva). */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
    const prk = hmac(salt, ikm);
    return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

export interface EncryptOptions {
    /** Sólo para los tests (vectores del RFC): salt y par efímero fijos. */
    salt?: Buffer;
    asPrivateKey?: Buffer;
    /** Tamaño de registro declarado (RFC 8188). */
    recordSize?: number;
}

/**
 * Cifra `plaintext` para el navegador dueño de `p256dh`/`auth` (RFC 8291).
 * Devuelve el cuerpo completo del POST al servicio de push.
 */
export function encryptPushPayload(
    plaintext: Buffer | string,
    keys: { p256dh: string; auth: string },
    opts: EncryptOptions = {},
): Buffer {
    const uaPublic = fromB64url(keys.p256dh);
    const authSecret = fromB64url(keys.auth);
    if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error('p256dh inválida: se espera una clave P-256 sin comprimir');
    if (authSecret.length < 16) throw new Error('auth inválido: se esperan 16 bytes');

    const ecdh = createECDH('prime256v1');
    if (opts.asPrivateKey) ecdh.setPrivateKey(opts.asPrivateKey);
    else ecdh.generateKeys();
    const asPublic = ecdh.getPublicKey();
    const ecdhSecret = ecdh.computeSecret(uaPublic);
    const salt = opts.salt ?? randomBytes(16);
    const rs = opts.recordSize ?? 4096;

    // IKM = HKDF(auth, ecdh, "WebPush: info" 0x00 ua_public as_public)
    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), uaPublic, asPublic]);
    const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);
    const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'latin1'), 16);
    const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'latin1'), 12);

    const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
    // Un único registro: datos + delimitador 0x02 (último registro), sin relleno.
    if (data.length + 1 + 16 > rs) throw new Error('El mensaje es demasiado grande para un push');
    const cipher = createCipheriv('aes-128-gcm', cek, nonce);
    const ct = Buffer.concat([cipher.update(Buffer.concat([data, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

    const header = Buffer.alloc(16 + 4 + 1);
    salt.copy(header, 0);
    header.writeUInt32BE(rs, 16);
    header.writeUInt8(asPublic.length, 20);
    return Buffer.concat([header, asPublic, ct]);
}

/**
 * Descifra un cuerpo `aes128gcm` con las llaves del NAVEGADOR (lo que hace
 * Chrome al recibirlo). Sirve para los tests y para el servidor de push de
 * prueba del E2E.
 */
export function decryptPushPayload(body: Buffer, ua: { privateKey: Buffer; publicKey: Buffer; auth: Buffer }): Buffer {
    const salt = body.subarray(0, 16);
    const rs = body.readUInt32BE(16);
    const idLen = body.readUInt8(20);
    const asPublic = body.subarray(21, 21 + idLen);
    const ct = body.subarray(21 + idLen);
    if (ct.length > rs) throw new Error('Más de un registro: no soportado');
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(ua.privateKey);
    const ecdhSecret = ecdh.computeSecret(asPublic);
    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), ua.publicKey, asPublic]);
    const ikm = hkdf(ua.auth, ecdhSecret, keyInfo, 32);
    const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'latin1'), 16);
    const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'latin1'), 12);
    const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(ct.subarray(ct.length - 16));
    const padded = Buffer.concat([decipher.update(ct.subarray(0, ct.length - 16)), decipher.final()]);
    // Quita el relleno: ceros al final, después el delimitador (0x02 = último).
    let end = padded.length - 1;
    while (end >= 0 && padded[end] === 0) end--;
    if (end < 0 || padded[end] !== 2) throw new Error('Delimitador de registro inválido');
    return padded.subarray(0, end);
}

/**
 * Cabecera `Authorization: vapid t=<jwt>, k=<pública>` (RFC 8292). `aud` es
 * el ORIGEN del servicio de push (cada servicio valida que sea el suyo);
 * `sub` es un contacto del operador (`mailto:` o `https:`), que Apple exige.
 */
export function vapidAuthorization(
    endpoint: string,
    keys: VapidKeys,
    subject: string,
    nowSeconds: number = Math.floor(Date.now() / 1000),
    ttlSeconds = 12 * 3600,
): string {
    const aud = new URL(endpoint).origin;
    const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const claims = b64url(Buffer.from(JSON.stringify({ aud, exp: nowSeconds + ttlSeconds, sub: subject })));
    const input = `${header}.${claims}`;
    const sig = sign('sha256', Buffer.from(input), { key: vapidPrivateKeyObject(keys), dsaEncoding: 'ieee-p1363' });
    return `vapid t=${input}.${b64url(sig)}, k=${keys.publicKey}`;
}

function vapidPrivateKeyObject(keys: VapidKeys) {
    const pub = fromB64url(keys.publicKey);
    return createPrivateKey({
        key: {
            kty: 'EC',
            crv: 'P-256',
            d: b64url(padKey(fromB64url(keys.privateKey))),
            x: b64url(pub.subarray(1, 33)),
            y: b64url(pub.subarray(33, 65)),
        },
        format: 'jwk',
    });
}

/** Huella corta del endpoint: identifica el dispositivo sin exponer el endpoint. */
export function endpointHash(endpoint: string): string {
    return createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
}
