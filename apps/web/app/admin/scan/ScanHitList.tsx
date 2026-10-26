import type { CodeSearchHit } from '@imagina-base/shared';
import { ChevronRight } from 'lucide-react';

import { __, sprintf } from '@/lib/i18n';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';

/** H3 — Los registros donde coincidió un código (cuando hay más de uno). */
export function ScanHitList({
    hits,
    showList,
    onPick,
}: {
    hits: CodeSearchHit[];
    /** Mostrar la lista de cada uno (búsqueda global). */
    showList: boolean;
    onPick: (hit: CodeSearchHit) => void;
}): JSX.Element {
    return (
        <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border" data-testid="scan-hits">
            {hits.map((h) => {
                const Icon = listIcon(h.list_icon) ?? DEFAULT_LIST_ICON;
                return (
                    <li key={`${h.list_id}-${h.record_id}`}>
                        <button
                            type="button"
                            onClick={() => onPick(h)}
                            className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent"
                            data-scan-hit={h.record_id}
                        >
                            <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" style={{ color: listColor(h.list_color) }} aria-hidden />
                            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                <span className="imcrm-truncate imcrm-font-medium">{h.title || sprintf(__('Registro #%d'), h.record_id)}</span>
                                <span className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {showList ? `${h.list_name} · ${h.field_label}` : h.field_label}
                                </span>
                            </span>
                            <ChevronRight className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
