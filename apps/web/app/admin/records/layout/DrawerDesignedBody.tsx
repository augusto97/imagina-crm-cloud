import type { MutableRefObject } from 'react';
import type { AutoLayoutFlavor } from '@imagina-base/shared';

import { getBootData } from '@/lib/boot';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';
import type { RecordEntity } from '@/types/record';

import { RecordLayoutView } from './RecordLayoutView';

export interface DrawerDesignedBodyProps {
    list: ListSummary;
    record: RecordEntity;
    fields: FieldEntity[];
    previewTemplate?: AutoLayoutFlavor;
    onSavingChange: (saving: boolean) => void;
    flushRef: MutableRefObject<(() => Promise<void>) | null>;
    onConversationInLayout: (has: boolean) => void;
    onOpenRecord?: (id: number) => void;
    onDelete: () => void;
    deleting: boolean;
}

/**
 * v0.1.470 — La ficha diseñada dentro de la ventana flotante del registro.
 * Va en su propio chunk: la tabla no paga el motor de la ficha (bloques,
 * gráficos de los vinculados) hasta que se abre un registro de una lista que
 * la usa. La ventana pone su barra (acciones, «Guardando…», «Diseñar esta
 * ficha»); aquí va el cuerpo, que se guarda solo campo por campo.
 */
export default function DrawerDesignedBody(props: DrawerDesignedBodyProps): JSX.Element {
    const boot = getBootData();
    return (
        <RecordLayoutView
            key={`${props.record.id}:${props.previewTemplate ?? ''}`}
            embedded
            list={props.list}
            record={props.record}
            fields={props.fields}
            currentUserId={boot.user.id}
            isAdmin={boot.user.capabilities.workspace_admin === true}
            onDelete={props.onDelete}
            deleting={props.deleting}
            previewTemplate={props.previewTemplate}
            onSavingChange={props.onSavingChange}
            flushRef={props.flushRef}
            onConversationInLayout={props.onConversationInLayout}
            onOpenRecord={props.onOpenRecord}
        />
    );
}
