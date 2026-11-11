import {
    INTEGRATIONS,
    WHATS_ACTION_OUTPUTS,
    WHATSAPP_FIELD_ROLES,
    readWhatsappListFields,
    renderWhatsappTemplate,
    whatsappTemplateShape,
    whatsappTemplateVariables,
    type Connection,
    type Field,
} from '@imagina-base/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { whatsappTemplates } from '../../db/schema';
import type { TenantDb } from '../../tenancy/tenant-db.service';
import { AiToolError } from './registry';

/**
 * D3 — Lo que el asistente / MCP sabe de WhatsApp oficial: qué números hay
 * (sin credenciales) y qué plantillas APROBADAS puede usar cada uno, con sus
 * variables. Las plantillas se crean en Meta: el modelo sólo puede elegir
 * entre las que existen.
 */
export interface WhatsappAiTemplate {
    name: string;
    language: string;
    category: string;
    header: string | null;
    body: string;
    /** Claves para `values.variables` (`body.1`, `header.1`, `button.0`). */
    variables: Array<{ key: string; label: string; example: string | null }>;
}

async function approvedTemplates(tenantDb: TenantDb, tenantId: number, connectionIds: number[]): Promise<Map<number, WhatsappAiTemplate[]>> {
    const out = new Map<number, WhatsappAiTemplate[]>();
    if (connectionIds.length === 0) return out;
    const rows = await tenantDb.withTenant(tenantId, (tx) =>
        tx
            .select()
            .from(whatsappTemplates)
            .where(and(eq(whatsappTemplates.tenantId, tenantId), inArray(whatsappTemplates.connectionId, connectionIds), eq(whatsappTemplates.status, 'APPROVED'))),
    );
    for (const r of rows) {
        const shape = whatsappTemplateShape(r.components, r.parameterFormat);
        const rendered = renderWhatsappTemplate(r.components, r.parameterFormat, {});
        const list = out.get(r.connectionId) ?? [];
        list.push({
            name: r.name,
            language: r.language,
            category: r.category,
            header: shape.header ? (shape.header.format === 'TEXT' ? (shape.header.text ?? '') : `[${shape.header.format}]`) : null,
            body: rendered.body.slice(0, 600),
            variables: whatsappTemplateVariables(r.components, r.parameterFormat).map((v) => ({ key: v.key, label: v.label, example: v.example })),
        });
        out.set(r.connectionId, list);
    }
    return out;
}

/**
 * v0.1.401 — Las acciones de Whats como `clave {dato, dato?}` (el `?` marca lo
 * opcional) y lo que deja para los pasos siguientes ({{whats.x}}). Sale del
 * catálogo: una acción nueva aparece sola.
 */
function whatsActionShapes(): string[] {
    const def = INTEGRATIONS.find((i) => i.key === 'whatsapp_web');
    return (def?.actions ?? []).map((a) => {
        const params = a.params.map((p) => (p.required ? p.key : `${p.key}?`)).join(', ');
        const outs = WHATS_ACTION_OUTPUTS[a.key as keyof typeof WHATS_ACTION_OUTPUTS] ?? [];
        return `${a.key} {${params}}${outs.length ? ` → ${outs.map((o) => `{{whats.${o}}}`).join(' ')}` : ''}`;
    });
}

/** El bloque `whatsapp` de get_list_schema (null si la empresa no conectó WhatsApp oficial). */
export async function whatsappSchema(
    tenantDb: TenantDb,
    tenantId: number,
    connections: Connection[],
    listSettings: Record<string, unknown>,
    fields: Field[],
): Promise<Record<string, unknown> | null> {
    // v0.1.389 — también Whats, la versión nueva de WAS (sin plantillas ni ventana de 24 h).
    const wa = connections.filter((c) => c.integration_key === 'whatsapp_cloud' || c.integration_key === 'whatsapp_web');
    if (wa.length === 0) return null;
    const templates = await approvedTemplates(
        tenantDb,
        tenantId,
        wa.filter((c) => c.integration_key === 'whatsapp_cloud').map((c) => c.id),
    );
    const mapping = readWhatsappListFields(listSettings);
    const byId = new Map(fields.map((f) => [f.id, f.slug]));
    const columns: Record<string, string | null> = {};
    for (const role of WHATSAPP_FIELD_ROLES) columns[role] = mapping[role] ? (byId.get(mapping[role]!) ?? null) : null;
    return {
        connections: wa.map((c) =>
            c.integration_key === 'whatsapp_web'
                ? {
                      connection_id: c.id,
                      kind: 'whats',
                      name: c.name,
                      phone: c.account_label,
                      actions: whatsActionShapes(),
                  }
                : {
                      connection_id: c.id,
                      kind: 'oficial',
                      name: c.name,
                      phone: c.account_label,
                      approved_templates: templates.get(c.id) ?? [],
                  },
        ),
        list_columns: columns,
        rules:
            'Conexiones kind "whats" (Whats, la versión nueva de WAS): cada acción es connector_action {connection_id, action_key, values} con las claves de actions. ' +
            'Los mensajes (send_text, send_media con url https pública, send_location, send_contact) salen siempre, sin plantillas ni ventana de 24 h; es un número vinculado, así que sólo a contactos que esperan el mensaje. ' +
            'Las demás trabajan sobre el contacto de Whats con ese teléfono (recipient: "{{telefono}}"): si no existe se crea con values.name (o el título del registro), salvo remove_tags, remove_from_group, unsubscribe, reply_conversation y conversation_status, que lo necesitan existente. ' +
            'tags y group van por NOMBRE (create_missing "true" crea los que falten); flow y drip por id (el editor los elige de la cuenta); variables y fields son un JSON {"clave": "{{slug}}"}. ' +
            'Lo que deja cada acción ({{whats.contacto_id}}, {{whats.mensaje_id}}…) sirve en los pasos siguientes. Nunca se envía a grupos de WhatsApp. ' +
            'Conexiones kind "oficial" (Meta): send_template sirve siempre (plantilla APROBADA de approved_templates, con todas sus variables en values.variables: {"body.1": "{{slug}}"…}). ' +
            'send_text (texto libre) sólo funciona si el contacto escribió en las últimas 24 h — fuera de esa ventana la acción falla: para avisos usa una plantilla. ' +
            'El destinatario es values.to (un campo teléfono: "{{telefono}}"). Las plantillas se crean y aprueban en Meta, nunca desde aquí. ' +
            'Disparador whatsapp_message_received (llegó un mensaje de un contacto; {{whatsapp.texto}}, {{whatsapp.de}}, {{whatsapp.nombre}}): {connection_id?, field_filters?}. ' +
            'En el registro queda sólo el último mensaje (list_columns): un campo con IA cuya fuente es esa columna puede resumirlo o clasificarlo.',
    };
}

/**
 * Valida una acción `send_template` propuesta: la plantilla existe, está
 * aprobada y trae TODAS sus variables. Error corregible (con lo que hay) en
 * vez de guardar una automatización que fallaría en cada corrida.
 */
export async function assertWhatsappTemplateAction(
    tenantDb: TenantDb,
    tenantId: number,
    connectionId: number,
    values: Record<string, unknown>,
    where: string,
): Promise<void> {
    const name = String(values.template ?? '').trim();
    const language = String(values.language ?? '').trim();
    const list = (await approvedTemplates(tenantDb, tenantId, [connectionId])).get(connectionId) ?? [];
    const available = list.map((t) => `${t.name} (${t.language})`).join(', ') || 'ninguna — hay que crearlas y aprobarlas en Meta';
    const hits = list.filter((t) => t.name === name);
    if (hits.length === 0) {
        throw new AiToolError(`La acción ${where} usa la plantilla «${name}», que no está aprobada en esa cuenta de WhatsApp. Plantillas aprobadas: ${available}.`);
    }
    const tpl = language !== '' ? hits.find((t) => t.language === language) : hits[0];
    if (!tpl) {
        throw new AiToolError(`La plantilla «${name}» no está en el idioma «${language}». Idiomas: ${hits.map((t) => t.language).join(', ')}.`);
    }
    let vars: Record<string, unknown> = {};
    const raw = values.variables;
    if (typeof raw === 'string' && raw.trim() !== '') {
        try {
            vars = JSON.parse(raw) as Record<string, unknown>;
        } catch {
            throw new AiToolError('values.variables tiene que ser un objeto {"body.1": "…"} (o ese objeto en texto JSON).');
        }
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        vars = raw as Record<string, unknown>;
    }
    const missing = tpl.variables.filter((v) => String(vars[v.key] ?? '').trim() === '').map((v) => v.key);
    if (missing.length > 0) {
        throw new AiToolError(`A la plantilla «${name}» le faltan variables en values.variables: ${missing.join(', ')}.`);
    }
}
