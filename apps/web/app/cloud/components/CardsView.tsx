import { jsonbKeyForField, type Field, type RecordDto } from '@imagina-base/shared';
import { formatValue } from '@/cloud/lib/fieldValue';

/**
 * Vista de tarjetas: una grilla responsiva de cards, cada una con el campo
 * título destacado y hasta 4 campos de detalle. Read-only (click → drawer);
 * la edición vive en el drawer. Es el tipo de vista `cards` del CONTRACT §7.
 */
export function CardsView({
    fields,
    records,
    onOpen,
}: {
    fields: Field[];
    records: RecordDto[];
    onOpen: (record: RecordDto) => void;
}): JSX.Element {
    const titleField = fields.find((f) => f.type === 'text') ?? fields[0];
    const detailFields = fields.filter((f) => f.id !== titleField?.id).slice(0, 4);

    if (records.length === 0) {
        return (
            <div className="imcrm-flex imcrm-h-full imcrm-min-h-32 imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground">
                Sin registros para mostrar.
            </div>
        );
    }

    return (
        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3 xl:imcrm-grid-cols-4">
            {records.map((r) => (
                <button
                    key={r.id}
                    onClick={() => onOpen(r)}
                    className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 imcrm-text-left imcrm-shadow-sm hover:imcrm-border-primary/40 hover:imcrm-shadow"
                >
                    <span className="imcrm-truncate imcrm-text-sm imcrm-font-semibold">
                        {titleField
                            ? formatValue(titleField, r.data[jsonbKeyForField(titleField.id)]) || `#${r.id}`
                            : `#${r.id}`}
                    </span>
                    <dl className="imcrm-space-y-1">
                        {detailFields.map((f) => {
                            const text = formatValue(f, r.data[jsonbKeyForField(f.id)]);
                            if (text === '') return null;
                            return (
                                <div key={f.id} className="imcrm-flex imcrm-justify-between imcrm-gap-2 imcrm-text-xs">
                                    <dt className="imcrm-shrink-0 imcrm-text-muted-foreground">{f.label}</dt>
                                    <dd className="imcrm-truncate">{text}</dd>
                                </div>
                            );
                        })}
                    </dl>
                </button>
            ))}
        </div>
    );
}
