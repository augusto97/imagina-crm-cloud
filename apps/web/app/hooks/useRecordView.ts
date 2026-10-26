import { timeKeys } from '@/hooks/useTimeTracking';
import { useEffect, useState } from 'react';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    RECORD_VIEW_ACTIVITY_LIMIT,
    RECORD_VIEW_BACKLINK_ROWS,
    RECORD_VIEW_SUBTASKS,
    type RecordViewBundle,
} from '@imagina-base/shared';

import { documentKeys, issuedDocumentKeys } from '@/admin/documents/useDocuments';
import { layoutDataKeys } from '@/admin/records/layout/useLayoutData';
import { recordDataConsentsKey } from '@/cloud/components/dataConsentText';
import { api, cloudRecordsMeta, mapRecord, normalizeDates, primeFieldMap, type FieldKeyMap } from '@/lib/api';
import type { RecordsQuery } from '@/types/record';

import { activityKeys, toEntity, type ActivityDtoWire } from './useActivity';
import { approvalKeys } from './useApprovals';
import { checklistKeys } from './useChecklists';
import { commentsKeys, fromApiComment } from './useComments';
import { fieldsKeys } from './useFields';
import { listsKeys } from './useLists';
import { notificationKeys } from './useNotifications';
import { descriptionKeys } from './useRecordDescription';
import { dependencyKeys } from './dependencyKeys';
import { canonicalListId, joinInflight, listIdentifiersFor, recordsKeys } from './useRecords';

/**
 * Ficha del registro en UN request (regla de oro nº 8).
 *
 * `GET /lists/:l/records/:id/view` trae todo lo que el modal o la página del
 * registro piden al abrir, y aquí se SIEMBRA en el cache de cada pieza con
 * sus keys de siempre: los componentes (descripción, comentarios, actividad,
 * vinculados, cobros, PDF, seguir…) no cambian y encuentran sus datos sin
 * pedir nada. Antes eran ~11 requests (con un N+1 por lista vinculada) y la
 * ficha diseñada una cascada de 4-5 pasos.
 */
export const recordViewKeys = {
    all: ['record-view'] as const,
    forRecord: (listId: string | number, recordId: number) => ['record-view', String(listId), recordId] as const,
};

/** La query de «Vinculados» (igual que `RecordBacklinks`). */
export function backlinksQuery(relationFieldId: number, recordId: number): RecordsQuery {
    return { page: 1, per_page: RECORD_VIEW_BACKLINK_ROWS, related_to: `${relationFieldId}:${recordId}` };
}

/** La query de las subtareas de un registro (igual que `RecordSubtasks`). */
export function subtasksQuery(recordId: number): RecordsQuery {
    return { page: 1, per_page: RECORD_VIEW_SUBTASKS, parent: recordId };
}

/** Las keys de actividad que usa la ficha (panel lateral 100, feed 50). */
const ACTIVITY_LIMITS = [50, RECORD_VIEW_ACTIVITY_LIMIT];

/**
 * Un registro que se acaba de borrar: sus piezas (ficha, descripción,
 * comentarios, actividad) salen del cache. Si quedaran, la invalidación de la
 * lista o el aviso del socket las volvían a pedir y respondían 404.
 */
export function forgetRecord(qc: QueryClient, listKey: string | number, recordId: number): void {
    for (const id of listIdentifiersFor(qc, listKey)) {
        qc.removeQueries({ queryKey: recordViewKeys.forRecord(id, recordId), exact: true });
        qc.removeQueries({ queryKey: descriptionKeys.forRecord(id, recordId), exact: true });
        qc.removeQueries({ queryKey: commentsKeys.forRecord(id, recordId) });
        qc.removeQueries({ queryKey: activityKeys.forRecord(id, recordId) });
        qc.removeQueries({ queryKey: recordsKeys.item(id, recordId), exact: true });
    }
}

export function seedRecordView(qc: QueryClient, b: RecordViewBundle): void {
    const listId = b.list.id;
    const lid = String(listId);
    const recordId = b.record.id;
    const maps = new Map<number, FieldKeyMap>();
    maps.set(listId, primeFieldMap([listId, b.list.slug], b.fields));

    qc.setQueryData(listsKeys.detail(lid), normalizeDates(b.list));
    qc.setQueryData(listsKeys.detail(b.list.slug), normalizeDates(b.list));
    qc.setQueryData(fieldsKeys.forList(lid), normalizeDates(b.fields));
    qc.setQueryData(recordsKeys.item(lid, recordId), mapRecord(b.record, maps.get(listId)!));
    qc.setQueryData(descriptionKeys.forRecord(lid, recordId), b.description);

    if (b.follow) qc.setQueryData(notificationKeys.follow(recordId), b.follow);
    if (b.reminders) qc.setQueryData(notificationKeys.reminders(recordId), normalizeDates(b.reminders));
    if (b.documents) qc.setQueryData(documentKeys.forList(listId), normalizeDates(b.documents));
    if (b.issued_documents) qc.setQueryData(issuedDocumentKeys.forRecord(listId, recordId), normalizeDates(b.issued_documents));
    if (b.payments) qc.setQueryData(['record-payments', listId, recordId], b.payments);
    // Ley 1581 — las autorizaciones de datos del registro (línea de la ficha).
    if (b.data_consents) qc.setQueryData(recordDataConsentsKey(listId, recordId), b.data_consents);
    if (b.relation_paths) qc.setQueryData(['relation-paths', lid], b.relation_paths);
    // v0.1.291 — registro de tiempo: viaja en el mismo bundle (sin otra request).
    if (b.time) qc.setQueryData(timeKeys.forRecord(lid, recordId), b.time);
    // C5 — aprobaciones: flujos disponibles y solicitudes del registro.
    if (b.approvals) qc.setQueryData(approvalKeys.forRecord(lid, recordId), b.approvals);
    // A8 — dependencias («bloqueado por» / «bloquea»): la sección no sale a pedirlas.
    if (b.dependencies) qc.setQueryData(dependencyKeys.forRecord(lid, recordId), b.dependencies);
    // A9 — checklists del registro: la sección no sale a pedirlos.
    if (b.checklists) qc.setQueryData(checklistKeys.forRecord(lid, recordId), b.checklists);
    if (b.comments) {
        const rows = normalizeDates(b.comments) as Array<Parameters<typeof fromApiComment>[0]>;
        qc.setQueryData(commentsKeys.forRecord(listId, recordId), rows.map(fromApiComment));
    }
    if (b.activity) {
        const rows = (normalizeDates(b.activity) as ActivityDtoWire[]).map(toEntity);
        for (const limit of ACTIVITY_LIMITS) {
            // Sólo se siembra si alcanza: con 100 entradas no sabemos si hay más.
            if (rows.length < RECORD_VIEW_ACTIVITY_LIMIT || limit <= rows.length) {
                qc.setQueryData([...activityKeys.forRecord(lid, recordId), limit], rows.slice(0, limit));
            }
        }
    }
    for (const linked of b.linked_lists) {
        const id = String(linked.list.id);
        maps.set(linked.list.id, primeFieldMap([linked.list.id, linked.list.slug], linked.fields));
        qc.setQueryData(listsKeys.detail(id), normalizeDates(linked.list));
        qc.setQueryData(fieldsKeys.forList(id), normalizeDates(linked.fields));
    }
    const page = (rows: unknown[], meta: Record<string, unknown>, map: FieldKeyMap) => {
        const data = rows.map((r) => mapRecord(r, map));
        return { data, meta: cloudRecordsMeta(meta, data.length) };
    };
    for (const bl of b.backlinks) {
        const map = maps.get(bl.list_id);
        if (!map) continue;
        qc.setQueryData(
            recordsKeys.list(canonicalListId(qc, bl.list_id), backlinksQuery(bl.relation_field_id, recordId)),
            page(bl.records.data, bl.records.meta, map),
        );
    }
    if (b.subtasks) {
        qc.setQueryData(
            recordsKeys.list(lid, subtasksQuery(recordId)),
            page(b.subtasks.data, b.subtasks.meta, maps.get(listId)!),
        );
    }
    if (b.layout_data) {
        qc.setQueryData([...layoutDataKeys.forRecord(listId, recordId, b.layout_data.sig), 'record'], b.layout_data.data);
    }
}

/**
 * Pide el bundle y avisa cuándo los caches están sembrados (`ready`). Mientras
 * no lo están, la ficha muestra un esqueleto en vez de montar los paneles —
 * si no, cada uno saldría a pedir lo suyo en paralelo con el bundle.
 *
 * `ready` queda ENGANCHADO por registro: un refetch posterior no desmonta los
 * paneles (se perdería lo que se está escribiendo). Si el bundle falla, la
 * ficha se monta igual y cada pieza se pide por su cuenta.
 */
export function useRecordView(
    listKey: string | number | undefined,
    recordId: number | undefined,
    enabled = true,
): { ready: boolean; isError: boolean; data: RecordViewBundle | undefined } {
    const qc = useQueryClient();
    const on = enabled && listKey !== undefined && listKey !== '' && recordId !== undefined && recordId > 0;
    const keyList = on ? canonicalListId(qc, listKey) : '';
    const query = useQuery({
        queryKey: recordViewKeys.forRecord(keyList, recordId ?? 0),
        // v0.1.286 — si la key pasó de slug a id con el pedido en vuelo, se
        // reusa (sin segundo `/view`).
        queryFn: () =>
            joinInflight(qc, recordViewKeys.forRecord(keyList, recordId ?? 0), recordViewKeys.forRecord(String(listKey ?? ''), recordId ?? 0), async () => {
                const res = await api.get<RecordViewBundle>(`/lists/${listKey}/records/${recordId}/view`);
                seedRecordView(qc, res.data);
                return res.data;
            }),
        enabled: on,
        // Los paneles tienen sus propias queries (y el realtime las refresca):
        // el bundle sólo hace falta al ABRIR la ficha.
        staleTime: 20_000,
        refetchOnWindowFocus: false,
        retry: false,
    });
    const sig = `${keyList}:${recordId ?? 0}`;
    const settled = !on || query.isError || (query.isSuccess && !query.isFetching);
    const [readyFor, setReadyFor] = useState<string | null>(null);
    useEffect(() => {
        if (settled) setReadyFor(sig);
    }, [settled, sig]);
    return { ready: settled || readyFor === sig, isError: query.isError, data: query.data };
}
