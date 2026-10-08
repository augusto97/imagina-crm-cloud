import { isIP } from 'node:net';
import { bareHost, devPrivateEgressAllowed, isBlockedAddress } from '../common/safe-fetch';
import { describeS3Error, S3FileStorage, type S3StorageConfig } from '../files/s3-file-storage';
import type { IntegrationCreds, VerifyOutcome } from './integration-calls';

/**
 * v0.1.268 (ADR-S36) — del formulario de la integración «Almacenamiento S3»
 * a la config del driver. PURO salvo el chequeo final de `verifyS3`.
 *
 * La dirección (endpoint) la escribe la empresa: tiene que ser https y no
 * puede apuntar a la red interna del servidor. Un literal IP se mira acá
 * porque node no pasa por `lookup` para una IP; los nombres los cubre el
 * `guardedLookup` del driver al conectar.
 */
export interface S3ConfigResult {
    ok: true;
    config: S3StorageConfig;
    label: string;
}

export function s3ConfigFromCreds(
    creds: IntegrationCreds,
    opts: { allowPrivate?: boolean } = {},
): S3ConfigResult | { ok: false; error: string } {
    const f = creds.fields;
    const bucket = (f.bucket ?? '').trim();
    const accessKeyId = (f.access_key_id ?? '').trim();
    const secretAccessKey = creds.secret.trim();
    if (bucket === '') return { ok: false, error: 'Falta el bucket.' };
    if (!/^[a-z0-9][a-z0-9.\-_]{1,254}$/i.test(bucket)) {
        return { ok: false, error: 'El nombre del bucket no es válido (sólo letras, números, puntos, guiones).' };
    }
    if (accessKeyId === '') return { ok: false, error: 'Falta el ID de la clave de acceso.' };
    if (secretAccessKey === '') return { ok: false, error: 'Falta la clave secreta.' };

    const allowPrivate = opts.allowPrivate === true || devPrivateEgressAllowed();
    let endpoint = (f.endpoint ?? '').trim().replace(/\/+$/, '');
    let host = 'Amazon S3';
    if (endpoint !== '') {
        if (!/^[a-z]+:\/\//i.test(endpoint)) endpoint = `https://${endpoint}`;
        let url: URL;
        try {
            url = new URL(endpoint);
        } catch {
            return { ok: false, error: 'La dirección del servicio no es una URL válida.' };
        }
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowPrivate)) {
            return { ok: false, error: 'La dirección del servicio tiene que empezar con https://.' };
        }
        if (url.pathname !== '/' && url.pathname !== '') {
            return { ok: false, error: 'La dirección del servicio va sin carpeta ni bucket (ej. https://s3.us-east-005.backblazeb2.com).' };
        }
        if (url.username || url.password || url.search || url.hash) {
            return { ok: false, error: 'La dirección del servicio no puede llevar usuario, contraseña ni parámetros.' };
        }
        const literal = bareHost(url.hostname);
        if (isIP(literal) && isBlockedAddress(literal) && !allowPrivate) {
            return { ok: false, error: 'La dirección del servicio apunta a una red interna: no está permitido.' };
        }
        endpoint = url.origin;
        host = url.hostname;
    }
    const region = (f.region ?? '').trim() || 'us-east-1';
    const pathStyleRaw = (f.path_style ?? '').trim().toLowerCase();
    return {
        ok: true,
        label: `${bucket} · ${host}`,
        config: {
            endpoint,
            region,
            bucket,
            accessKeyId,
            secretAccessKey,
            forcePathStyle: pathStyleRaw === 'true' || pathStyleRaw === '1',
            prefix: (f.prefix ?? '').trim(),
            guard: !allowPrivate,
        },
    };
}

/** Sube, lee y borra un archivo chiquito: la credencial sirve para guardar o no. */
export async function verifyS3(creds: IntegrationCreds, opts: { allowPrivate?: boolean } = {}): Promise<VerifyOutcome> {
    const base: VerifyOutcome = { ok: false, label: null, error: null, warning: null, options: {} };
    const built = s3ConfigFromCreds(creds, opts);
    if (!built.ok) return { ...base, error: built.error };
    try {
        await new S3FileStorage(built.config).selfTest();
        return { ...base, ok: true, label: built.label };
    } catch (err) {
        return { ...base, error: describeS3Error(err) };
    }
}
