import type { AgencyClient } from '@imagina-base/shared';

import { __ } from '@/lib/i18n';

/** El estado de una empresa cliente en palabras (y su color). */
export function clientStateLabel(c: Pick<AgencyClient, 'access' | 'paused' | 'archived'>): { label: string; tone: 'ok' | 'warn' | 'bad' } {
    if (c.archived) return { label: __('Archivada'), tone: 'bad' };
    if (c.paused) return { label: __('Pausada por la agencia'), tone: 'warn' };
    if (c.access.state === 'locked') return { label: __('Bloqueada'), tone: 'bad' };
    if (c.access.state === 'read_only') {
        return { label: c.access.reason === 'agency' ? __('Solo lectura (por tu agencia)') : __('Solo lectura'), tone: 'warn' };
    }
    return { label: __('Activa'), tone: 'ok' };
}
