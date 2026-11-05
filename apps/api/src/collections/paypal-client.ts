import { createHash } from 'node:crypto';
import { safeWebhookFetch } from '../common/safe-fetch';
import type { IntegrationCreds, IntegrationRequest } from '../connectors/integration-calls';
import { paypalBase, type GatewayBases } from './collection-gateways';
import { parsePaypalToken, paypalTokenRequest, type PaypalTokenResult } from './paypal-gateway';

const TIMEOUT_MS = 15_000;

/** Pide un token a PayPal (sin caché: para verificar una credencial nueva). */
export async function requestPaypalToken(clientId: string, secret: string, base: string): Promise<PaypalTokenResult> {
    const req = paypalTokenRequest(clientId, secret, base);
    const res = await safeWebhookFetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        captureBody: true,
        timeoutMs: TIMEOUT_MS,
    });
    return parsePaypalToken(res.status, res.body ?? '');
}

/** Un error de PayPal con un motivo legible. */
export class PaypalCallError extends Error {}

export interface PaypalResponse {
    status: number;
    body: string;
}

/**
 * v0.1.372 — Llama a la API de PayPal con el token de la empresa. El token se
 * pide con el Client ID y el Secret y dura horas: se guarda en memoria por
 * credencial (la clave es un hash: nunca el Secret en claro) y se renueva
 * cinco minutos antes. Si PayPal lo rechaza (lo revocaron), se pide otro una
 * vez y se reintenta.
 */
export class PaypalClient {
    private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

    constructor(private readonly bases: () => GatewayBases) {}

    base(creds: IntegrationCreds): string {
        return paypalBase(creds, this.bases());
    }

    private key(creds: IntegrationCreds): string {
        return createHash('sha256').update(`${this.base(creds)}|${creds.fields.client_id ?? ''}|${creds.secret}`).digest('hex');
    }

    async token(creds: IntegrationCreds, fresh = false): Promise<string> {
        const key = this.key(creds);
        const cached = this.tokens.get(key);
        if (!fresh && cached && cached.expiresAt > Date.now()) return cached.token;
        const out = await requestPaypalToken(creds.fields.client_id ?? '', creds.secret, this.base(creds));
        if ('error' in out) throw new PaypalCallError(out.error);
        this.tokens.set(key, { token: out.token, expiresAt: Date.now() + Math.max(60, out.expiresIn - 300) * 1000 });
        if (this.tokens.size > 500) this.tokens.delete(this.tokens.keys().next().value!);
        return out.token;
    }

    /** Arma el pedido con el token y lo manda; reintenta una vez si el token venció. */
    async call(creds: IntegrationCreds, build: (base: string, token: string) => IntegrationRequest, maxCaptureBytes = 512_000): Promise<PaypalResponse> {
        const send = async (token: string): Promise<PaypalResponse> => {
            const req = build(this.base(creds), token);
            const res = await safeWebhookFetch(req.url, {
                method: req.method,
                headers: req.headers,
                body: req.body,
                captureBody: true,
                maxCaptureBytes,
                timeoutMs: TIMEOUT_MS,
            });
            return { status: res.status, body: res.body ?? '' };
        };
        const first = await send(await this.token(creds));
        if (first.status !== 401) return first;
        return send(await this.token(creds, true));
    }
}
