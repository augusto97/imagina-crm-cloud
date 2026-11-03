import type { IntegrationKey } from '@imagina-base/shared';
import {
    GRAPH_BASE,
    IntegrationInputError,
    TEAMS_DM_CHAT_PLACEHOLDER,
    buildIntegrationRequest,
    checkIntegrationResponse,
    emailList,
    graphErrorMessage,
    teamsMeRequest,
    teamsOneOnOneRequest,
    type IntegrationCreds,
    type IntegrationRequest,
    type IntegrationValues,
} from './integration-calls';

/**
 * El pedido de una acción de la galería, listo para salir (v0.1.348).
 *
 * Casi todas las acciones son UNA petición (`buildIntegrationRequest`, pura).
 * El mensaje directo de Teams necesita dos antes: saber el id de la cuenta
 * conectada y abrir (o encontrar) el chat uno a uno con la persona. Eso vive
 * aquí para que el motor y «Probar ahora» hagan exactamente lo mismo.
 *
 * Sin `fetch` (la simulación de «Probar» paso a paso, que no toca nada) los
 * pasos previos no se ejecutan: el pedido queda con el chat por completar.
 */

export type GraphFetch = (req: IntegrationRequest) => Promise<{ status: number; body: string }>;

export interface PrepareOptions {
    /** Ejecuta los pasos previos. Sin esto, no se toca la red. */
    fetch?: GraphFetch;
    /** Otra base para Microsoft Graph (sólo el entorno de pruebas: `MS_GRAPH_API_URL`). */
    graphBase?: string;
}

function rebaseGraph(req: IntegrationRequest, base: string | undefined): IntegrationRequest {
    const target = (base ?? '').replace(/\/+$/, '');
    if (target === '' || target === GRAPH_BASE || !req.url.startsWith(GRAPH_BASE)) return req;
    return { ...req, url: `${target}${req.url.slice(GRAPH_BASE.length)}` };
}

function json(body: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(body) as unknown;
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

export async function prepareIntegrationRequest(
    integration: IntegrationKey,
    actionKey: string,
    compiled: IntegrationValues,
    creds: IntegrationCreds,
    opts: PrepareOptions = {},
): Promise<IntegrationRequest> {
    const req = rebaseGraph(buildIntegrationRequest(integration, actionKey, compiled, creds), opts.graphBase);
    if (integration !== 'teams' || actionKey !== 'send_direct_message' || !opts.fetch) return req;

    const email = emailList(compiled.values.to ?? '')[0]!;
    const me = await opts.fetch(rebaseGraph(teamsMeRequest(creds.accessToken), opts.graphBase));
    const meJson = json(me.body);
    const meId = typeof meJson?.id === 'string' ? meJson.id : '';
    if (me.status >= 400 || meId === '') {
        throw new IntegrationInputError(
            checkIntegrationResponse('teams', me.status, me.body) ?? 'No pudimos leer la cuenta de Teams conectada.',
        );
    }
    const upn = typeof meJson?.userPrincipalName === 'string' ? meJson.userPrincipalName.toLowerCase() : '';
    if (upn !== '' && upn === email.toLowerCase()) {
        throw new IntegrationInputError('Ese correo es el de la cuenta conectada: Teams no permite mandarse un mensaje directo a uno mismo.');
    }

    const chat = await opts.fetch(rebaseGraph(teamsOneOnOneRequest(creds.accessToken, meId, email), opts.graphBase));
    const chatJson = json(chat.body);
    const chatId = typeof chatJson?.id === 'string' ? chatJson.id : '';
    if (chat.status >= 400 || chatId === '') {
        const said = graphErrorMessage(chatJson);
        if (chat.status === 404 || chat.status === 400 || /not found|does not exist|Invalid user/i.test(said)) {
            throw new IntegrationInputError(
                `No encontramos a «${email}» en Teams de tu organización. Revisa que sea su correo de trabajo (el mismo con el que entra a Teams).`,
            );
        }
        throw new IntegrationInputError(
            checkIntegrationResponse('teams', chat.status, chat.body) ?? 'Microsoft no abrió el chat con esa persona.',
        );
    }
    return { ...req, url: req.url.replace(TEAMS_DM_CHAT_PLACEHOLDER, encodeURIComponent(chatId)) };
}
