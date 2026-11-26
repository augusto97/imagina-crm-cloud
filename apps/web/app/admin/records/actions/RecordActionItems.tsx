import type { ReactNode } from 'react';

import { GeneratePdfButton } from '@/admin/documents/GeneratePdfButton';
import { RecordEditLinkButton } from '@/admin/forms/RecordEditLinkButton';
import { RecordShareButton } from '@/admin/guests/RecordShareButton';
import { RecordFollowControls } from '@/admin/mywork/RecordFollowControls';
import { RecordQrButton } from '@/admin/qr/RecordQrButton';
import { SendSmsButton } from '@/cloud/components/sms/SendSmsButton';
import { SendWhatsappButton } from '@/cloud/components/whatsapp/SendWhatsappButton';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { RecordAskAgentButton } from '../ai/RecordAi';
import { SaveRecordAsTemplateButton } from '../templates/SaveRecordAsTemplateButton';
import { RecordActionGroup } from './RecordAction';

/**
 * v0.1.471 — Lo que va en el menú «Acciones» de un registro, por grupos y en
 * el mismo orden en la ventana, la página y la ficha diseñada. Cada acción se
 * esconde sola si no aplica (sin WhatsApp conectado no hay «Enviar WhatsApp»),
 * y un grupo sin acciones no se ve.
 */
export function RecordActionItems({
    listId,
    listSlug,
    recordId,
    fields,
    listSettings,
    title,
    isGuest,
    storeRules,
    includeFollow = false,
    extra,
}: {
    listId: number;
    listSlug?: string;
    recordId: number;
    fields: FieldEntity[];
    listSettings?: Record<string, unknown> | null;
    title: string;
    isGuest: boolean;
    /** Lista de una tienda o un sitio: sin «Guardar como plantilla». */
    storeRules: boolean;
    /** «Seguir» y «Recordarme» también en el menú (en el teléfono no caben en la barra). */
    includeFollow?: boolean;
    /** Lo que se agrega al final (en el teléfono: diseñar y eliminar). */
    extra?: ReactNode;
}): JSX.Element {
    return (
        <>
            {includeFollow && !isGuest && (
                <RecordActionGroup title={__('Seguimiento')}>
                    <RecordFollowControls listId={listId} recordId={recordId} compact />
                </RecordActionGroup>
            )}
            <RecordActionGroup title={__('Enviar y compartir')}>
                {!isGuest && <SendWhatsappButton listId={listId} recordId={recordId} compact />}
                {!isGuest && <SendSmsButton listId={listId} recordId={recordId} compact />}
                <RecordShareButton listId={listId} recordId={recordId} title={title} compact />
                {!isGuest && <RecordEditLinkButton listId={listId} recordId={recordId} compact />}
                {!isGuest && <RecordQrButton listId={listId} recordId={recordId} fields={fields} listSettings={listSettings} compact />}
            </RecordActionGroup>
            {!isGuest && (
                <RecordActionGroup title={__('Documentos')}>
                    <GeneratePdfButton listId={listId} listSlug={listSlug} recordId={recordId} fields={fields} compact />
                    {!storeRules && <SaveRecordAsTemplateButton listId={listId} listSlug={listSlug} recordId={recordId} title={title} compact />}
                </RecordActionGroup>
            )}
            {!isGuest && (
                <RecordActionGroup title={__('Inteligencia artificial')}>
                    <RecordAskAgentButton listId={listId} recordId={recordId} compact />
                </RecordActionGroup>
            )}
            {extra}
        </>
    );
}
