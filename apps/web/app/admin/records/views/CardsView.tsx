import { useMemo } from 'react';

import { renderCellValue } from '@/admin/records/renderCellValue';
import { useAttachments } from '@/hooks/useAttachments';
import { colorFromString, pickPrimaryField } from '@/lib/recordCategorize';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/**
 * Vista Cards (Fase 12.A+): grid de tarjetas. Cada tarjeta muestra:
 *  - Imagen de portada opcional (del `coverField` configurado, tipo file).
 *  - Avatar colorizado generado desde el título (cuando no hay cover).
 *  - Título grande con el valor del primary field del record.
 *  - Hasta N campos extra (los configurados en `extraFields`) abajo
 *    con label inline.
 *
 * Click en una card abre el drawer del record — mismo flujo que la
 * TableView. La densidad de columnas (compact/comfortable/spacious)
 * se ajusta via CSS grid auto-fill.
 *
 * En 12.A acepta props pre-resueltas (los IDs ya mapeados a
 * FieldEntity). En 12.B sumamos editor de config en SaveViewDialog
 * y el wireup desde RecordsPage.
 */
interface CardsViewProps {
    fields: FieldEntity[];
    records: RecordEntity[];
    /** Fields a mostrar en cada card debajo del título. Si está vacío,
     * se omiten — solo se muestra el título. */
    extraFields: FieldEntity[];
    /** Field tipo `file` cuya URL se usa como portada. Si null, se
     * muestra el avatar colorizado. */
    coverField: FieldEntity | null;
    /** Densidad del grid. */
    size?: 'compact' | 'comfortable' | 'spacious';
    onCardClick: (record: RecordEntity) => void;
}

const SIZE_CLASSES: Record<NonNullable<CardsViewProps['size']>, string> = {
    compact: 'imcrm-grid-cols-[repeat(auto-fill,minmax(180px,1fr))]',
    comfortable: 'imcrm-grid-cols-[repeat(auto-fill,minmax(240px,1fr))]',
    spacious: 'imcrm-grid-cols-[repeat(auto-fill,minmax(320px,1fr))]',
};

export function CardsView({
    fields,
    records,
    extraFields,
    coverField,
    size = 'comfortable',
    onCardClick,
}: CardsViewProps): JSX.Element {
    const primary = useMemo(() => pickPrimaryField(fields), [fields]);

    // Resolución batch de attachment IDs → URLs. Cuando coverField
    // está set, recolectamos todos los IDs de cover de los records
    // visibles en un solo fetch a /files?ids=... (ADR-S16).
    const coverIds = useMemo(() => {
        if (! coverField) return [];
        return records
            .map((r) => normalizeAttachmentId(r.fields[coverField.slug]))
            .filter((id): id is number => id !== null && id > 0);
    }, [records, coverField]);

    const attachments = useAttachments(coverIds);

    if (records.length === 0) {
        return (
            <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-6 imcrm-py-12 imcrm-text-center">
                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Sin records que mostrar.')}
                </p>
            </div>
        );
    }

    return (
        <div className={cn('imcrm-grid imcrm-gap-3', SIZE_CLASSES[size])}>
            {records.map((rec) => {
                const coverId = coverField ? normalizeAttachmentId(rec.fields[coverField.slug]) : null;
                const cover = coverId !== null ? attachments.data?.get(coverId) ?? null : null;
                return (
                    <Card
                        key={rec.id}
                        record={rec}
                        primaryField={primary}
                        extraFields={extraFields}
                        coverUrl={cover?.thumbUrl ?? cover?.url ?? null}
                        onClick={() => onCardClick(rec)}
                    />
                );
            })}
        </div>
    );
}

function normalizeAttachmentId(value: unknown): number | null {
    if (value == null || value === '' || value === 0) return null;
    if (typeof value === 'number') return value > 0 ? value : null;
    if (typeof value === 'string') {
        const n = parseInt(value, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (Array.isArray(value) && value.length > 0) {
        return normalizeAttachmentId(value[0]);
    }
    return null;
}

function Card({
    record,
    primaryField,
    extraFields,
    coverUrl,
    onClick,
}: {
    record: RecordEntity;
    primaryField: FieldEntity | null;
    extraFields: FieldEntity[];
    coverUrl: string | null;
    onClick: () => void;
}): JSX.Element {
    const title = primaryField ? String(record.fields[primaryField.slug] ?? '') : '';
    const displayTitle = title || `#${record.id}`;
    const avatarBg = colorFromString(displayTitle);
    const initials = makeInitials(displayTitle);

    return (
        <button
            type="button"
            onClick={onClick}
            className="imcrm-group imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-left imcrm-shadow-imcrm-sm imcrm-transition-shadow hover:imcrm-shadow-imcrm-md focus:imcrm-outline-none focus:imcrm-ring-2 focus:imcrm-ring-primary focus:imcrm-ring-offset-2"
        >
            {coverUrl ? (
                <div
                    className="imcrm-relative imcrm-aspect-[16/9] imcrm-w-full imcrm-bg-muted"
                    style={{ backgroundImage: `url(${coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                    aria-hidden
                />
            ) : (
                <div
                    className="imcrm-flex imcrm-aspect-[16/9] imcrm-w-full imcrm-items-center imcrm-justify-center imcrm-text-2xl imcrm-font-semibold imcrm-text-white"
                    style={{ backgroundColor: avatarBg }}
                    aria-hidden
                >
                    {initials}
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5 imcrm-px-3 imcrm-py-2.5">
                <h3 className="imcrm-line-clamp-1 imcrm-text-sm imcrm-font-semibold imcrm-tracking-tight imcrm-text-foreground">
                    {displayTitle}
                </h3>
                {extraFields.length > 0 && (
                    <dl className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-text-[11px]">
                        {extraFields.map((f) => {
                            const raw = record.fields[f.slug];
                            if (raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0)) {
                                return null;
                            }
                            return (
                                <div key={f.id} className="imcrm-flex imcrm-items-baseline imcrm-gap-1.5">
                                    <dt className="imcrm-shrink-0 imcrm-truncate imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                                        {f.label}
                                    </dt>
                                    <dd className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-foreground">
                                        {renderCellValue(f, raw)}
                                    </dd>
                                </div>
                            );
                        })}
                    </dl>
                )}
            </div>
        </button>
    );
}

function makeInitials(title: string): string {
    const words = title.trim().split(/\s+/).slice(0, 2);
    if (words.length === 0) return '?';
    return words.map((w) => w.charAt(0).toUpperCase()).join('');
}
