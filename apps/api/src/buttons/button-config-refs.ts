import { BadRequestException } from '@nestjs/common';
import { buttonConfigSchema, buttonSetModesFor, validateFieldValue, type ButtonConfig } from '@imagina-base/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { automations, documentTemplates, fields } from '../db/schema';

/**
 * Campo «Botón» — al GUARDAR la config, lo que referencia tiene que ser de
 * ESTA lista: los campos que cambia (y de un tipo que se puede escribir de
 * esa forma), el campo Archivo donde guarda el PDF, la plantilla de documento
 * y la automatización. Un id de otra lista (o de otra empresa) se rechaza con
 * 400 en vez de quedar guardado y fallar recién al presionar.
 *
 * Una acción INCOMPLETA (sin enlace, sin plantilla…) sí se guarda: el editor
 * avisa y presionar la rechaza con el motivo.
 */
export async function assertButtonConfigRefs(
    tx: Tx,
    tenantId: number,
    listId: number,
    selfId: number | null,
    rawConfig: Record<string, unknown>,
): Promise<void> {
    const config: ButtonConfig = buttonConfigSchema.parse(rawConfig);
    const fail = (message: string): never => {
        throw new BadRequestException({
            code: 'invalid_button_config',
            message,
            data: { status: 400, errors: { config: message } },
        });
    };

    const fieldIds = new Set<number>();
    const templateIds = new Set<number>();
    const automationIds = new Set<number>();
    for (const a of config.actions) {
        if (a.type === 'update_fields') for (const v of a.values) fieldIds.add(v.field_id);
        if (a.type === 'generate_pdf') {
            if (a.document_template_id) templateIds.add(a.document_template_id);
            if (a.mode === 'save' && a.save_field_id) fieldIds.add(a.save_field_id);
        }
        if (a.type === 'run_automation' && a.automation_id) automationIds.add(a.automation_id);
        // El enlace: si empieza con texto fijo, el protocolo ya se puede validar.
        if (a.type === 'open_url' && a.url.trim() !== '' && !a.url.trim().startsWith('{{')) {
            if (!/^(https:\/\/|mailto:|tel:)/i.test(a.url.trim())) fail('El enlace tiene que empezar con https://, mailto: o tel:.');
        }
    }

    const fieldRows = fieldIds.size > 0
        ? await tx
              .select({ id: fields.id, listId: fields.listId, type: fields.type, label: fields.label, config: fields.config })
              .from(fields)
              .where(and(eq(fields.tenantId, tenantId), inArray(fields.id, [...fieldIds]), isNull(fields.deletedAt)))
        : [];
    const byId = new Map(fieldRows.filter((f) => f.listId === listId).map((f) => [f.id, f]));

    for (const a of config.actions) {
        if (a.type === 'update_fields') {
            for (const v of a.values) {
                const f = byId.get(v.field_id);
                if (!f || f.id === selfId) fail('Uno de los campos que cambia el botón no es de esta lista.');
                const modes = buttonSetModesFor(f!.type);
                if (modes.length === 0) fail(`«${f!.label}» no se puede cambiar con un botón.`);
                if (!modes.includes(v.mode)) fail(`«${f!.label}» no se puede cambiar de esa forma.`);
                // Un valor fijo (sin variables) tiene que valer para el campo.
                if (v.mode === 'set' && v.value !== undefined && v.value !== null && !(typeof v.value === 'string' && v.value.includes('{{'))) {
                    const res = validateFieldValue({ type: f!.type as never, config: (f!.config ?? {}) as Record<string, unknown>, is_required: false }, v.value);
                    if (!res.ok) fail(`«${f!.label}»: ${res.error}`);
                }
                if (v.mode === 'add' && !Number.isFinite(Number(v.value))) fail(`«${f!.label}»: la cantidad a sumar tiene que ser un número.`);
            }
        }
        if (a.type === 'generate_pdf' && a.mode === 'save' && a.save_field_id) {
            const f = byId.get(a.save_field_id);
            if (!f || f.type !== 'file') fail('El PDF se tiene que guardar en un campo Archivo de esta lista.');
        }
    }

    if (templateIds.size > 0) {
        const rows = await tx
            .select({ id: documentTemplates.id })
            .from(documentTemplates)
            .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.listId, listId), inArray(documentTemplates.id, [...templateIds])));
        if (rows.length !== templateIds.size) fail('La plantilla del PDF no es de esta lista.');
    }
    if (automationIds.size > 0) {
        const rows = await tx
            .select({ id: automations.id, triggerType: automations.triggerType, triggerConfig: automations.triggerConfig })
            .from(automations)
            .where(and(eq(automations.tenantId, tenantId), eq(automations.listId, listId), inArray(automations.id, [...automationIds]), isNull(automations.deletedAt)));
        if (rows.length !== automationIds.size) fail('La automatización del botón no es de esta lista.');
        for (const r of rows) {
            if (r.triggerType !== 'button_pressed') fail('La automatización del botón tiene que usar el disparador «Al presionar el botón».');
            const target = Number((r.triggerConfig as { button_field_id?: unknown } | null)?.button_field_id);
            if (selfId !== null && Number.isInteger(target) && target > 0 && target !== selfId) {
                fail('Esa automatización escucha otro botón.');
            }
        }
    }
}
