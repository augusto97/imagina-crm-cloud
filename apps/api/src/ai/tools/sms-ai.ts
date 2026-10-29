import { SMS_FIELD_ROLES, SMS_PROVIDER_META, isSmsProvider, readSmsListFields, type Connection, type Field } from '@imagina-base/shared';

/**
 * SMS (ADR-S82) — Lo que el asistente / MCP sabe de los SMS: qué conexiones
 * hay (proveedor y remitente, NUNCA la credencial) y qué columnas de la lista
 * guardan el último envío. El envío es la acción `send_sms` de cada conexión
 * (la lista `connectors` de get_list_schema trae sus parámetros).
 */
export function smsSchema(connections: Connection[], listSettings: Record<string, unknown>, fields: Field[]): Record<string, unknown> | null {
    const sms = connections.filter((c) => c.integration_key !== null && isSmsProvider(c.integration_key));
    if (sms.length === 0) return null;
    const mapping = readSmsListFields(listSettings);
    const byId = new Map(fields.map((f) => [f.id, f.slug]));
    const columns: Record<string, string | null> = {};
    for (const role of SMS_FIELD_ROLES) columns[role] = mapping[role] ? (byId.get(mapping[role]!) ?? null) : null;
    return {
        connections: sms.map((c) => ({
            connection_id: c.id,
            name: c.name,
            provider: isSmsProvider(c.integration_key ?? '') ? SMS_PROVIDER_META[c.integration_key as keyof typeof SMS_PROVIDER_META].label : c.integration_key,
            account: c.account_label,
        })),
        list_columns: columns,
        rules:
            'Enviar un SMS es connector_action con action_key "send_sms": {to: "{{telefono}}" (un campo teléfono del registro), message (acepta {{slug}}), sender? (remitente; vacío = el de la conexión), strip_accents? (true cambia lo que no es GSM-7 —á, í, ó, ú, comillas tipográficas— por su equivalente y conserva la ñ: el SMS sin tildes entra en 160 caracteres, con tildes o emojis en 70 — cuesta el doble o más), respect_hours? (true para mensajes comerciales o de cobranza en Colombia: fuera de lunes a viernes 7:00–19:00 y sábados 8:00–15:00, y nunca domingos ni festivos, el SMS queda programado para la siguiente franja permitida — Ley 2300 de 2023)}. ' +
            'Un mensaje de más de 160 caracteres se manda en varias partes (cada una se cobra). El estado de entrega (enviado, entregado, fallido) queda en list_columns si la lista tiene esas columnas.',
    };
}
