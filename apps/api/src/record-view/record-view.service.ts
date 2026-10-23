import { Injectable, Logger, Optional } from '@nestjs/common';
import {
    DATA_BLOCK_TYPES,
    layoutBlocks,
    listRecordsQuerySchema,
    readRecordLayoutV3,
    RECORD_VIEW_ACTIVITY_LIMIT,
    RECORD_VIEW_BACKLINK_ROWS,
    RECORD_VIEW_LINKED_LISTS,
    RECORD_VIEW_SUBTASKS,
    type RecordViewBundle,
    type RelationPath,
} from '@imagina-base/shared';
import { ActivityService } from '../activity/activity.service';
import { CollectionsService } from '../collections/collections.service';
import { CommentsService } from '../comments/comments.service';
import { DataConsentService } from '../data-consent/data-consent.service';
import { mapLimit } from '../common/map-limit';
import { RecordLayoutDataService } from '../dashboards/record-layout-data.service';
import { DocumentsService } from '../documents/documents.service';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';

/** Piezas que se piden en paralelo, con tope (el pool de conexiones es compartido). */
const PARALLEL = 4;

/**
 * Bundle de la ficha de un registro (regla de oro nº 8).
 *
 * Abrir el modal del registro disparaba ~11 requests (y un N+1 por cada lista
 * vinculada en «Vinculados»); la ficha diseñada era una cascada de 4-5 pasos
 * (lista → campos + registro → relaciones → campos del otro lado → datos de
 * los bloques). Aquí sale TODO en uno, con las MISMAS funciones que usan los
 * endpoints sueltos — así el ACL es idéntico por construcción:
 *  - el registro base tiene que ser visible (404 si no, igual que `get`);
 *  - comentarios, actividad, cobros, vinculados y subtareas pasan por sus
 *    services con la persona que mira (scope del rol + campos ocultos).
 *
 * Una pieza que falla viaja en `null`: ese componente la pide por su cuenta
 * y el resto de la ficha se ve igual.
 */
@Injectable()
export class RecordViewService {
    private readonly logger = new Logger(RecordViewService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly comments: CommentsService,
        private readonly activity: ActivityService,
        private readonly notifications: NotificationsService,
        private readonly documents: DocumentsService,
        private readonly collections: CollectionsService,
        private readonly layoutData: RecordLayoutDataService,
        private readonly time: TimeTrackingService,
        // Ley 1581 — la línea «Autorización de datos» de la ficha.
        @Optional() private readonly dataConsent?: DataConsentService,
    ) {}

    async bundle(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number): Promise<RecordViewBundle> {
        // El registro primero: si no es visible, 404 y no se calcula nada más.
        const record = await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        const list = await this.lists.get(tenantId, String(record.list_id));
        const listKey = String(list.id);

        const soft = async <T>(what: string, fn: () => Promise<T>): Promise<T | null> => {
            try {
                return await fn();
            } catch (err) {
                // Un permiso que falta es lo esperado (la pieza no se ve);
                // otra cosa se anota, pero la ficha se abre igual.
                const status = (err as { status?: number; getStatus?: () => number }).getStatus?.() ?? 500;
                if (status >= 500) this.logger.warn(`bundle de la ficha: «${what}» falló: ${(err as Error).message}`);
                return null;
            }
        };

        const tasks: Array<() => Promise<unknown>> = [
            () => this.fields.list(tenantId, listKey),
            () => soft('descripción', () => this.records.getDescription(tenantId, actor, listKey, recordId)),
            () => soft('seguir', () => this.notifications.followState(tenantId, actor.userId, recordId)),
            () => soft('recordatorios', () => this.notifications.listReminders(tenantId, actor, { recordId })),
            () => soft('documentos', () => this.documents.list(tenantId, listKey)),
            // v0.1.290 — «Documentos emitidos» (el registro ya pasó el ACL arriba).
            () =>
                soft('documentos emitidos', () =>
                    this.tenantDb.withTenant(tenantId, (tx) => this.documents.issuedInTx(tx, tenantId, recordId)),
                ),
            () => soft('cobros', () => this.collections.recordPayments(tenantId, actor, listKey, recordId)),
            () => soft('relaciones', () => this.fields.relationPaths(tenantId, listKey)),
            () =>
                soft('comentarios', () =>
                    this.tenantDb.withTenant(tenantId, (tx) => this.comments.listInTx(tx, tenantId, recordId)),
                ),
            () =>
                soft('actividad', async () =>
                    (
                        await this.activity.list(tenantId, listKey, {
                            recordId,
                            limit: RECORD_VIEW_ACTIVITY_LIMIT,
                            viewer: { role: actor.role, userId: actor.userId },
                        })
                    ).data,
                ),
            () =>
                record.parent_id !== null
                    ? Promise.resolve(null)
                    : soft('subtareas', () =>
                          this.records.list(
                              tenantId,
                              actor,
                              listKey,
                              listRecordsQuerySchema.parse({ parent: recordId, limit: RECORD_VIEW_SUBTASKS, page: 1 }),
                          ),
                      ),
            () => soft('bloques de la ficha', () => this.savedLayoutData(tenantId, actor, list, recordId)),
            // v0.1.291 — el tiempo registrado (total, por persona, entradas y
            // el cronómetro de quien mira): el bloque no sale a pedirlo.
            () =>
                soft('tiempo', () =>
                    this.tenantDb.withTenant(tenantId, (tx) => this.time.recordTimeInTx(tx, tenantId, actor, recordId)),
                ),
            // Autorizaciones de tratamiento de datos (el registro ya pasó el ACL arriba).
            () => (this.dataConsent ? soft('autorizaciones', () => this.dataConsent!.forRecord(tenantId, recordId)) : Promise.resolve(null)),
        ];
        const [
            fields,
            description,
            follow,
            reminders,
            documents,
            issuedDocuments,
            payments,
            paths,
            comments,
            activity,
            subtasks,
            layout,
            time,
            dataConsents,
        ] = (await mapLimit(tasks, PARALLEL, (t) => t())) as [
            RecordViewBundle['fields'],
            RecordViewBundle['description'],
            RecordViewBundle['follow'],
            RecordViewBundle['reminders'],
            RecordViewBundle['documents'],
            RecordViewBundle['issued_documents'],
            RecordViewBundle['payments'],
            RelationPath[] | null,
            RecordViewBundle['comments'],
            RecordViewBundle['activity'],
            RecordViewBundle['subtasks'],
            RecordViewBundle['layout_data'],
            RecordViewBundle['time'],
            RecordViewBundle['data_consents'],
        ];

        // Lo que depende de las relaciones: las listas del otro lado (cabecera
        // y campos, para la ficha automática y las columnas) y la primera
        // página de cada «Vinculados».
        const relations = paths ?? [];
        const others = [...new Set(relations.slice(0, RECORD_VIEW_LINKED_LISTS).map((p) => p.other_list_id))];
        for (const p of relations) if (p.direction === 'reverse' && !others.includes(p.list_id)) others.push(p.list_id);
        const linked = (
            await mapLimit(others, PARALLEL, (id) =>
                soft('lista vinculada', async () => ({
                    list: await this.lists.get(tenantId, String(id)),
                    fields: await this.fields.list(tenantId, String(id)),
                })),
            )
        ).filter((x): x is NonNullable<typeof x> => x !== null);

        const reverse = relations.filter((p) => p.direction === 'reverse');
        const backlinks = (
            await mapLimit(reverse, PARALLEL, (p) =>
                soft('vinculados', async () => ({
                    relation_field_id: p.relation_field_id,
                    list_id: p.list_id,
                    records: await this.records.list(
                        tenantId,
                        actor,
                        String(p.list_id),
                        listRecordsQuerySchema.parse({
                            limit: RECORD_VIEW_BACKLINK_ROWS,
                            page: 1,
                            related_to: `${p.relation_field_id}:${recordId}`,
                        }),
                    ),
                })),
            )
        ).filter((x): x is NonNullable<typeof x> => x !== null);

        return {
            list,
            fields,
            record,
            description: description ?? null,
            follow,
            reminders,
            documents,
            issued_documents: issuedDocuments,
            payments,
            relation_paths: paths,
            linked_lists: linked,
            backlinks: backlinks as RecordViewBundle['backlinks'],
            subtasks: subtasks as RecordViewBundle['subtasks'],
            comments,
            activity,
            layout_data: layout,
            time,
            data_consents: dataConsents,
        };
    }

    /**
     * Datos de los gráficos y tablas de la ficha diseñada GUARDADA, con la
     * misma firma que calcula el front (`useLayoutData`): si coinciden, la
     * ficha no tiene que pedirlos aparte.
     */
    private async savedLayoutData(
        tenantId: number,
        actor: Actor,
        list: { id: number; settings: unknown },
        recordId: number,
    ): Promise<RecordViewBundle['layout_data']> {
        const settings = (list.settings ?? {}) as Record<string, unknown>;
        if (settings.record_layout !== 'crm') return null;
        const layout = readRecordLayoutV3(settings);
        if (!layout) return null;
        const blocks = layoutBlocks(layout)
            .filter((b) => DATA_BLOCK_TYPES.includes(b.type))
            .map((b) => ({ id: b.id, type: b.type as 'chart' | 'related', title: b.title, config: b.config }));
        if (blocks.length === 0) return null;
        const data = await this.layoutData.data(tenantId, actor, String(list.id), recordId, { blocks });
        return { sig: JSON.stringify(blocks), data };
    }
}
