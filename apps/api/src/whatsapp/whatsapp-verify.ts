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
import {
    missingWaWebAbilities,
    parseWaWebAccounts,
    parseWaWebError,
    parseWaWebMe,
    waWebAbilityLabel,
    waWebAccountOption,
    waWebAccountStatusLabel,
    WA_WEB_NO_INBOUND_TEXT,
    waWebAccountsRequest,
    waWebCreds,
    waWebErrorText,
    waWebMeRequest,
    type WaWebAccount,
} from './whatsapp-web';

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

/**
 * v0.1.389 — Conectar «WhatsApp (Imagina WAS)» VERIFICA antes de guardar: la
 * clave entra (`/me`), tiene permiso para enviar y el plan incluye la API y
 * WhatsApp. Además lista los números para elegir (la persona no tiene por qué
 * saber el id de su cuenta) y avisa si al elegido le pasa algo (desconectado,
 * bloqueado). A los permisos que faltan de los recomendados (avisos, leer) se
 * los nombra, sin bloquear: enviar funciona igual.
 */
export async function verifyWhatsappWeb(creds: IntegrationCreds): Promise<VerifyOutcome> {
    const out: VerifyOutcome = { ok: true, label: null, error: null, warning: null, options: {} };
    const fail = (error: string): VerifyOutcome => ({ ...out, ok: false, error });
    const c = waWebCreds(creds);
    if (c.key === '') return fail('Falta la clave de API.');
    if (!/^https?:\/\/[^\s/]+/i.test(c.server)) return fail('La dirección del servidor no es válida: déjala vacía para usar whats.imagina.cloud.');
    const call = async (req: IntegrationRequest): Promise<{ status: number; body: string }> => {
        const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, captureBody: true, maxCaptureBytes: 256 * 1024, timeoutMs: 12_000 });
        return { status: res.status, body: res.body ?? '' };
    };
    try {
        const meRes = await call(waWebMeRequest(c));
        const meErr = parseWaWebError(meRes.status, meRes.body);
        if (meErr) return fail(waWebErrorText(meErr));
        const me = parseWaWebMe(meRes.body);
        if (me.features.api === false) return fail('Tu plan de WhatsApp no incluye el acceso por API: pide que lo activen en tu cuenta de Whats.');
        if (me.features.wa === false) return fail('Tu plan de WhatsApp no incluye WhatsApp: pide que lo activen en tu cuenta de Whats.');
        if (!me.abilities.includes('wa.send')) {
            return fail(`La clave no tiene permiso para enviar (${waWebAbilityLabel('wa.send')}): edítala en tu panel de WhatsApp (API Keys) y márcalo.`);
        }
        const missing = missingWaWebAbilities(me.abilities).filter((a) => a !== 'wa.send');
        const warnings: string[] = [];
        if (missing.length > 0) {
            warnings.push(
                `A la clave le faltan permisos: ${missing.map(waWebAbilityLabel).join(', ')}. Sin ellos no sabremos si cada mensaje se entregó o se leyó ni recibiremos los mensajes de tus clientes: márcalos en API Keys y actualiza la clave aquí.`,
            );
        }
        const fields: Record<string, string> = { workspace: me.workspace ?? '', abilities: me.abilities.join(',') };
        let accounts: WaWebAccount[] = [];
        if (me.abilities.includes('wa.accounts.view')) {
            const accRes = await call(waWebAccountsRequest(c));
            const accErr = parseWaWebError(accRes.status, accRes.body);
            if (accErr) warnings.push(`No pudimos listar tus números: ${waWebErrorText(accErr)}`);
            else accounts = parseWaWebAccounts(accRes.body);
            out.options.account = accounts.map(waWebAccountOption);
            if (!accErr && accounts.length === 0) {
                warnings.push('La clave es válida pero no hay ningún número de WhatsApp vinculado: conéctalo en tu panel escaneando el código QR.');
            }
        }
        const chosen = c.accountId !== null ? (accounts.find((a) => a.id === c.accountId) ?? null) : null;
        if (c.accountId !== null && accounts.length > 0 && !chosen) {
            return fail('Ese número no está en tu cuenta de WhatsApp: toca «Buscar mis cuentas» y elígelo de la lista.');
        }
        if (chosen) {
            fields.account_phone = chosen.phone ?? '';
            fields.account_name = chosen.name ?? '';
            out.label = [chosen.phone, chosen.name].filter((x): x is string => typeof x === 'string' && x !== '').join(' · ') || `#${chosen.id}`;
            if (!chosen.enabled || chosen.status !== 'connected') {
                warnings.push(`El número está «${waWebAccountStatusLabel(chosen)}»: los mensajes no van a salir hasta que vuelva a estar conectado en tu panel de WhatsApp.`);
            }
            if (chosen.receiveInbound === false) warnings.push(WA_WEB_NO_INBOUND_TEXT);
        } else if (me.workspace) {
            out.label = me.workspace;
        }
        return { ...out, warning: warnings.length > 0 ? warnings.join(' ') : null, fields };
    } catch (err) {
        const message = redactValues(err instanceof Error ? err.message : String(err), [c.key]);
        return fail(`No pudimos comunicarnos con el servidor de WhatsApp (${message}). Revisa la dirección y prueba de nuevo en un momento.`);
    }
}
