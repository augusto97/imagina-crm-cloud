import { safeWebhookFetch } from '../common/safe-fetch';
import { redactValues } from '../connectors/connection-parts';
import type { IntegrationCreds, IntegrationRequest, VerifyOutcome } from '../connectors/integration-calls';
import {
    isMetaId,
    metaErrorText,
    parseMetaError,
    parsePhoneInfo,
    parseWabaPhoneIds,
    phoneInfoRequest,
    wabaPhonesRequest,
    whatsappCreds,
    type GraphBase,
} from './whatsapp-graph';

/**
 * D3 — Conectar «WhatsApp Business (oficial)» VERIFICA contra Meta antes de
 * guardar: el número existe y es de esa cuenta, el token sirve y la clave
 * secreta es la de la app del token (el `appsecret_proof` que Meta valida).
 * A diferencia de una app de mensajería por clave, aquí un dato malo NO se
 * guarda: casi siempre es un id cruzado o un token temporal de 24 h, y lo
 * correcto es saberlo en el mismo diálogo, con el motivo de Meta traducido.
 */
export async function verifyWhatsappCloud(creds: IntegrationCreds, base: GraphBase): Promise<VerifyOutcome> {
    const out: VerifyOutcome = { ok: true, label: null, error: null, warning: null, options: {} };
    const fail = (error: string): VerifyOutcome => ({ ...out, ok: false, error });
    const wa = whatsappCreds(creds);
    if (wa.token === '') return fail('Falta el token de acceso.');
    if (!isMetaId(wa.phoneNumberId)) return fail('El identificador del número de teléfono son sólo números (por ejemplo 123456789012345). No es el número en sí.');
    if (!isMetaId(wa.wabaId)) return fail('El identificador de la cuenta de WhatsApp Business son sólo números (por ejemplo 123456789012345).');
    if (wa.appSecret === '') return fail('Falta la clave secreta de la app.');

    const call = async (req: IntegrationRequest): Promise<{ status: number; body: string }> => {
        const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, captureBody: true, timeoutMs: 12_000 });
        return { status: res.status, body: res.body ?? '' };
    };
    try {
        const phone = await call(phoneInfoRequest(base, wa));
        const phoneErr = parseMetaError(phone.status, phone.body);
        if (phoneErr) return fail(metaErrorText(phoneErr));
        const info = parsePhoneInfo(phone.body);

        const waba = await call(wabaPhonesRequest(base, wa));
        const wabaErr = parseMetaError(waba.status, waba.body);
        if (wabaErr) return fail(`No pudimos leer la cuenta de WhatsApp Business: ${metaErrorText(wabaErr)}`);
        const ids = parseWabaPhoneIds(waba.body);
        if (ids.length > 0 && !ids.includes(wa.phoneNumberId)) {
            return fail('Ese número no pertenece a esa cuenta de WhatsApp Business: revisa los dos identificadores (están en la misma pantalla de Meta).');
        }
        const label = [info.displayPhone, info.verifiedName].filter((x): x is string => x !== null).join(' · ');
        return {
            ...out,
            label: label !== '' ? label : null,
            fields: {
                display_phone: info.displayPhone ?? '',
                verified_name: info.verifiedName ?? '',
                quality_rating: info.qualityRating ?? '',
            },
        };
    } catch (err) {
        const message = redactValues(err instanceof Error ? err.message : String(err), [wa.token, wa.appSecret]);
        return fail(`No pudimos comunicarnos con Meta (${message}). Prueba de nuevo en un momento.`);
    }
}
