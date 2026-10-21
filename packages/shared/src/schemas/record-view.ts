import { z } from 'zod';
import { activitySchema } from './activity';
import { recordPaymentsSchema } from './collections';
import { commentSchema } from './comment';
import { idSchema } from './common';
import { documentTemplateSummarySchema, issuedDocumentSchema } from './document-design';
import { fieldSchema } from './field';
import { listSchema } from './list';
import type { FollowStateDto, ReminderDto } from './notifications';
import { recordSchema } from './record';
import { richDocSchema } from './rich-text';
import { recordTimeSchema } from './time-tracking';

/**
 * Un camino de relación que toca una lista (v0.1.170): sus propias relaciones
 * (hacia afuera) y las de otras listas que apuntan a ella (hacia adentro).
 */
export const relationPathSchema = z.object({
    relation_field_id: idSchema,
    relation_label: z.string(),
    direction: z.enum(['forward', 'reverse']),
    /** Lista donde VIVE el campo relation. */
    list_id: idSchema,
    list_name: z.string(),
    /** Lista del otro lado (de donde se leen los campos). */
    other_list_id: idSchema,
    other_list_name: z.string(),
});
export type RelationPath = z.infer<typeof relationPathSchema>;

/** Cuántas filas viajan por grupo de «Vinculados» (igual que la ficha). */
export const RECORD_VIEW_BACKLINK_ROWS = 20;
/** Cuántas entradas de actividad viajan (el panel lateral pide 100). */
export const RECORD_VIEW_ACTIVITY_LIMIT = 100;
/** Cuántas listas del otro lado viajan con sus campos (la ficha automática usa 4). */
export const RECORD_VIEW_LINKED_LISTS = 4;
/** Cuántas subtareas viajan en la ficha. */
export const RECORD_VIEW_SUBTASKS = 50;

/**
 * Bundle de la ficha de un registro (regla de oro nº 8): TODO lo que el modal
 * o la página del registro necesitan al abrir, en UN request — antes eran ~11
 * (con un N+1 por cada lista vinculada) y la ficha diseñada era una cascada de
 * 4-5 pasos. El front siembra con esto los caches de cada pieza, así los
 * componentes de siempre siguen funcionando sin pedir nada.
 *
 * Cada pieza es opcional/nullable: si una falla (o la persona no tiene
 * permiso), viaja `null` y ese componente la pide por su cuenta — nunca se
 * cae la ficha entera por una parte.
 */
export const recordViewBundleSchema = z.object({
    list: listSchema,
    fields: z.array(fieldSchema),
    record: recordSchema,
    description: richDocSchema.nullable(),
    follow: z.custom<FollowStateDto>().nullable(),
    reminders: z.array(z.custom<ReminderDto>()).nullable(),
    documents: z.array(documentTemplateSummarySchema).nullable(),
    /** v0.1.290 — Documentos emitidos (numerados) del registro, vigentes y anulados. */
    issued_documents: z.array(issuedDocumentSchema).nullable(),
    payments: recordPaymentsSchema.nullable(),
    relation_paths: z.array(relationPathSchema).nullable(),
    /** Listas del otro lado de cada relación (cabecera y campos). */
    linked_lists: z.array(z.object({ list: listSchema, fields: z.array(fieldSchema) })),
    /** «Vinculados»: la primera página de cada relación que apunta a este registro. */
    backlinks: z.array(
        z.object({
            relation_field_id: idSchema,
            list_id: idSchema,
            records: z.object({ data: z.array(recordSchema), meta: z.record(z.unknown()) }),
        }),
    ),
    /** Subtareas de este registro (o null si es una subtarea). */
    subtasks: z.object({ data: z.array(recordSchema), meta: z.record(z.unknown()) }).nullable(),
    comments: z.array(commentSchema).nullable(),
    activity: z.array(activitySchema).nullable(),
    /**
     * Datos de los bloques de la ficha diseñada GUARDADA (`record_layout_v3`)
     * con la firma de sus bloques; el front sólo los usa si su firma coincide.
     */
    layout_data: z.object({ sig: z.string(), data: z.record(z.unknown()) }).nullable(),
    /**
     * v0.1.291 — el tiempo registrado del registro (total, por persona, las
     * últimas entradas y el cronómetro en curso de quien mira).
     */
    time: recordTimeSchema.nullable().default(null),
});
export type RecordViewBundle = z.infer<typeof recordViewBundleSchema>;
