import { CalendarPlus, Clock, type LucideIcon } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { RecordEntity } from '@/types/record';
import { formatDateTimeStr } from '@/lib/tenantFormat';

interface RecordMetaGridProps {
    record: RecordEntity;
    /** 2 columnas en anchos sm+ (página). false = 1 columna (drawer). */
    twoCols?: boolean;
    className?: string;
}

/**
 * Metadatos del registro bajo el título: cuándo se creó y cuándo cambió por
 * última vez — lo que NO es un campo editable.
 *
 * Antes la grilla repetía también el estado, el responsable, las etiquetas y
 * la primera fecha… que ya están en «Campos» justo debajo (ahí, además, se
 * editan). Se veía cada dato dos veces y sólo uno respondía al click.
 */
export function RecordMetaGrid({ record, twoCols = true, className }: RecordMetaGridProps): JSX.Element {
    return (
        <div
            className={cn(
                'imcrm-grid imcrm-grid-cols-1 imcrm-gap-x-8 imcrm-gap-y-2.5',
                twoCols && 'sm:imcrm-grid-cols-2',
                className,
            )}
        >
            <MetaCell icon={CalendarPlus} label={__('Creado')}>
                <span className="imcrm-whitespace-nowrap imcrm-tabular-nums">{formatTimestamp(record.created_at)}</span>
            </MetaCell>
            <MetaCell icon={Clock} label={__('Actualizado')}>
                <span className="imcrm-whitespace-nowrap imcrm-tabular-nums">{formatTimestamp(record.updated_at)}</span>
            </MetaCell>
        </div>
    );
}

interface MetaCellProps {
    icon: LucideIcon;
    label: string;
    children: React.ReactNode;
}

function MetaCell({ icon: Icon, label, children }: MetaCellProps): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-min-w-0 imcrm-items-start imcrm-gap-2">
            <Icon
                className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground"
                aria-hidden
            />
            <span className="imcrm-w-[96px] imcrm-shrink-0 imcrm-pt-0.5 imcrm-text-[12px] imcrm-text-muted-foreground">
                {label}
            </span>
            <div className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-sm">{children}</div>
        </div>
    );
}

/**
 * Timestamps del API: naive-UTC (`YYYY-MM-DD HH:MM:SS`) o ya con `Z` (el
 * adaptador la agrega). Con el formato regional de la empresa, como el resto
 * de la app (v0.1.210: antes usaba el del navegador).
 */
function formatTimestamp(value: string | null | undefined): string {
    if (!value) return '—';
    return formatDateTimeStr(value);
}
