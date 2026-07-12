import { CalendarPlus, Clock, type LucideIcon } from 'lucide-react';

import { FieldValueDisplay } from '@/admin/records/crm/FieldValueDisplay';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

interface RecordMetaGridProps {
    record: RecordEntity;
    /** Campos visibles de la lista (ya filtrados por ACL en el server). */
    fields?: FieldEntity[];
    /**
     * Valores vivos del form (para que la grilla refleje ediciones sin
     * guardar). Si no se pasa, cae a `record.fields`.
     */
    values?: Record<string, unknown>;
    /** 2 columnas en anchos sm+ (página). false = 1 columna (drawer). */
    twoCols?: boolean;
    className?: string;
}

/**
 * Grilla de metadatos estilo ClickUp bajo el título del record:
 * pares icono+label → valor. Muestra SOLO datos ya presentes en el
 * record — timestamps (creado/actualizado) + los campos "clave" que
 * ClickUp promociona al header cuando existen en la lista: el primer
 * select (estado, como pill), el primer user (asignado), el primer
 * multi_select (etiquetas) y la primera fecha. Render read-only vía
 * `FieldValueDisplay`; la edición sigue viviendo en la sección
 * "Campos" de abajo.
 */
export function RecordMetaGrid({
    record,
    fields,
    values,
    twoCols = true,
    className,
}: RecordMetaGridProps): JSX.Element {
    const vals = values ?? record.fields;
    const sorted = [...(fields ?? [])].sort((a, b) => a.position - b.position);

    const firstOfType = (...types: string[]): FieldEntity | undefined =>
        sorted.find((f) => types.includes(f.type));

    const promoted = [
        firstOfType('select'),
        firstOfType('user'),
        firstOfType('multi_select'),
        firstOfType('date', 'datetime'),
    ].filter((f): f is FieldEntity => f !== undefined);

    return (
        <div
            className={cn(
                'imcrm-grid imcrm-grid-cols-1 imcrm-gap-x-8 imcrm-gap-y-2.5',
                twoCols && 'sm:imcrm-grid-cols-2',
                className,
            )}
        >
            <MetaCell icon={CalendarPlus} label={__('Creado')}>
                <span className="imcrm-tabular-nums">{formatTimestamp(record.created_at)}</span>
            </MetaCell>
            <MetaCell icon={Clock} label={__('Actualizado')}>
                <span className="imcrm-tabular-nums">{formatTimestamp(record.updated_at)}</span>
            </MetaCell>
            {promoted.map((field) => (
                <MetaCell key={field.id} icon={fieldTypeIcon(field.type)} label={field.label}>
                    <FieldValueDisplay field={field} value={vals[field.slug]} />
                </MetaCell>
            ))}
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

/** Timestamps del API vienen naive-UTC (`YYYY-MM-DD HH:MM:SS`). */
function formatTimestamp(value: string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value + 'Z');
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}
