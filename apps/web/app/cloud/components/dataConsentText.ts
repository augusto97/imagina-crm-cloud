import { DATA_CONSENT_WITHDRAW_VIA_LABELS, type RecordDataConsentDto } from '@imagina-base/shared';

import { __ } from '@/lib/i18n';
import { formatDateTime } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';

/** «Formulario «Contacto»» → «desde el formulario «Contacto»». */
export function consentOrigin(label: string): string {
    if (label === '') return '';
    return `${__('desde el')} ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/** La frase de una autorización de datos, tal como se lee en la ficha. */
export function consentSentence(c: RecordDataConsentDto): string {
    const accepted = `${__('aceptada el')} ${formatDateTime(parseUtcDate(c.accepted_at))} · ${__('versión')} ${c.version} · ${consentOrigin(c.source_label)}`;
    if (c.withdrawn_at === null) return accepted;
    const via = c.withdrawn_via ? ` ${__(DATA_CONSENT_WITHDRAW_VIA_LABELS[c.withdrawn_via])}` : '';
    return `${__('retirada el')} ${formatDateTime(parseUtcDate(c.withdrawn_at))}${via} (${accepted})`;
}

/** Clave del cache de la ficha (ID numérico de la lista — regla de oro nº 7); la siembra el bundle del registro. */
export const recordDataConsentsKey = (listId: number, recordId: number) => ['record-data-consents', listId, recordId] as const;
