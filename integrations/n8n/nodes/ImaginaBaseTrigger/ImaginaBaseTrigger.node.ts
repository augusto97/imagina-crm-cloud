import type {
    IDataObject,
    IHookFunctions,
    ILoadOptionsFunctions,
    INodePropertyOptions,
    INodeType,
    INodeTypeDescription,
    IWebhookFunctions,
    IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { simplifyRecord, type ApiField, type ApiRecord } from '../ImaginaBase/fields';
import { CREDENTIAL, apiRequest, verifySignature } from '../ImaginaBase/transport';

const EVENTS = [
    { name: 'Se crea un registro', value: 'record.created' },
    { name: 'Cambia un registro', value: 'record.updated' },
    { name: 'Se borra un registro', value: 'record.deleted' },
    { name: 'Se envía un formulario', value: 'form.submitted' },
    { name: 'Se recibe un pago', value: 'payment.received' },
];

interface Saved {
    webhookId?: number;
    webhookSecret?: string;
}

function sameSet(a: unknown[], b: unknown[]): boolean {
    const x = [...a].map(String).sort();
    const y = [...b].map(String).sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
}

async function getLists(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
    const res = (await apiRequest.call(this, 'GET', '/lists')) as { data?: Array<{ id: number; name: string; slug: string }> };
    return (res.data ?? [])
        .map((l) => ({ name: l.name, value: l.id, description: l.slug }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * Disparador: al activar el flujo crea un webhook en la app (Ajustes → API →
 * Webhooks, «Lo registró un programa») con la dirección de n8n; al
 * desactivarlo lo borra. Cada aviso se comprueba con la firma antes de correr.
 */
export class ImaginaBaseTrigger implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Imagina Base Trigger',
        name: 'imaginaBaseTrigger',
        icon: 'file:imaginaBase.svg',
        group: ['trigger'],
        version: 1,
        subtitle: '={{($parameter["events"] || []).join(", ")}}',
        description: 'Corre el flujo cuando se crea, cambia o borra un registro, se envía un formulario o entra un pago',
        defaults: { name: 'Imagina Base Trigger' },
        inputs: [],
        outputs: [NodeConnectionTypes.Main],
        credentials: [{ name: CREDENTIAL, required: true }],
        webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
        properties: [
            {
                displayName: 'Cuándo',
                name: 'events',
                type: 'multiOptions',
                options: EVENTS,
                required: true,
                default: ['record.created'],
            },
            {
                displayName: 'Listas',
                name: 'lists',
                type: 'multiOptions',
                typeOptions: { loadOptionsMethod: 'getLists' },
                default: [],
                description: 'Vacío = todas las listas que ve quien creó el token',
            },
            {
                displayName: 'Simplificar',
                name: 'simplify',
                type: 'boolean',
                default: true,
                description:
                    'Whether to return the record values by field internal name plus the event (on) or the full notice as it arrives (off)',
            },
        ],
    };

    methods = { loadOptions: { getLists } };

    webhookMethods = {
        default: {
            async checkExists(this: IHookFunctions): Promise<boolean> {
                const saved = this.getWorkflowStaticData('node') as Saved;
                if (!saved.webhookId) return false;
                try {
                    const hook = (await apiRequest.call(this, 'GET', `/webhooks/${saved.webhookId}`)) as IDataObject;
                    const events = this.getNodeParameter('events') as string[];
                    const lists = this.getNodeParameter('lists', []) as number[];
                    const same =
                        hook.url === this.getNodeWebhookUrl('default') &&
                        hook.active === true &&
                        sameSet((hook.events as string[]) ?? [], events) &&
                        sameSet((hook.list_ids as number[] | null) ?? [], lists);
                    if (same) return true;
                    // Cambió algo (eventos, listas, la dirección) o se pausó: se rehace.
                    await apiRequest.call(this, 'DELETE', `/webhooks/${saved.webhookId}`).catch(() => undefined);
                } catch {
                    // Ya no existe en la app: se crea de nuevo.
                }
                delete saved.webhookId;
                delete saved.webhookSecret;
                return false;
            },

            async create(this: IHookFunctions): Promise<boolean> {
                const saved = this.getWorkflowStaticData('node') as Saved;
                const events = this.getNodeParameter('events') as string[];
                const lists = this.getNodeParameter('lists', []) as number[];
                const name = `n8n · ${this.getWorkflow().name ?? 'flujo'}`.slice(0, 80);
                const created = (await apiRequest.call(this, 'POST', '/webhooks', {
                    name,
                    url: this.getNodeWebhookUrl('default'),
                    events,
                    list_ids: lists.length ? lists : null,
                })) as IDataObject;
                saved.webhookId = Number(created.id);
                saved.webhookSecret = String(created.secret ?? '');
                return true;
            },

            async delete(this: IHookFunctions): Promise<boolean> {
                const saved = this.getWorkflowStaticData('node') as Saved;
                if (saved.webhookId) {
                    try {
                        await apiRequest.call(this, 'DELETE', `/webhooks/${saved.webhookId}`);
                    } catch {
                        // Ya lo habían borrado en la app.
                    }
                }
                delete saved.webhookId;
                delete saved.webhookSecret;
                return true;
            },
        },
    };

    async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
        const saved = this.getWorkflowStaticData('node') as Saved;
        const req = this.getRequestObject() as unknown as { rawBody?: Buffer; headers: Record<string, string | string[] | undefined> };
        const body = this.getBodyData() as IDataObject;
        const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body);
        const header = req.headers['x-webhook-signature'];
        const sig = Array.isArray(header) ? header[0] : header;
        if (!verifySignature(saved.webhookSecret ?? '', sig, raw)) {
            const res = this.getResponseObject();
            res.status(401).json({ message: 'Firma inválida' });
            return { noWebhookResponse: true };
        }
        // El aviso de prueba («Probar» en la app) confirma la dirección: no corre el flujo.
        if (body.event === 'ping') return { webhookResponse: { ok: true } };

        const simplify = this.getNodeParameter('simplify', true) as boolean;
        if (!simplify) return { workflowData: [this.helpers.returnJsonArray(body)] };

        const fields = Object.entries((body.fields as Record<string, { id: number; slug: string; label: string; type: string }>) ?? {}).map(
            ([, f]) => f as ApiField,
        );
        const record = body.record as ApiRecord | undefined;
        const out: IDataObject = {
            event: body.event,
            event_id: body.id,
            list: body.list,
            ...(record ? simplifyRecord(record, fields) : {}),
        };
        if (body.changes) out.changes = body.changes;
        if (body.form) out.form = body.form;
        if (body.payment) out.payment = body.payment;
        return { workflowData: [this.helpers.returnJsonArray(out)] };
    }
}
