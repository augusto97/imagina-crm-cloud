import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

interface CardsConfigPanelProps {
    fields: FieldEntity[];
    cardFieldIds: number[];
    onCardFieldIdsChange: (ids: number[]) => void;
    coverFieldId: number;
    onCoverFieldIdChange: (id: number) => void;
    size: 'compact' | 'comfortable' | 'spacious';
    onSizeChange: (size: 'compact' | 'comfortable' | 'spacious') => void;
}

/**
 * Editor visual de la configuración de una vista Cards. Reusado
 * entre `SaveViewDialog` (modo create) y `EditCardsViewDialog`
 * (modo edit). Fase 12.C.
 *
 * UI:
 *  - Multi-select con checkboxes para `card_field_ids`. Excluye
 *    fields tipo `relation` porque no se pueden renderizar dentro
 *    de una card.
 *  - Single select para `card_cover_field_id`. Solo fields tipo
 *    `file`. Deshabilitado si la lista no tiene ninguno.
 *  - Segmented control para `card_size`.
 */
export function CardsConfigPanel({
    fields,
    cardFieldIds,
    onCardFieldIdsChange,
    coverFieldId,
    onCoverFieldIdChange,
    size,
    onSizeChange,
}: CardsConfigPanelProps): JSX.Element {
    const candidateFields = fields.filter((f) => f.type !== 'relation');
    const fileFields = fields.filter((f) => f.type === 'file');

    return (
        <>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Campos en la tarjeta')}</Label>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Aparecen debajo del título. El título es siempre el campo primario.')}
                </p>
                <div className="imcrm-flex imcrm-max-h-[160px] imcrm-flex-col imcrm-gap-1 imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-p-2">
                    {candidateFields.length === 0 ? (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Sin campos disponibles.')}
                        </p>
                    ) : (
                        candidateFields.map((f) => (
                            <label
                                key={f.id}
                                className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs"
                            >
                                <input
                                    type="checkbox"
                                    checked={cardFieldIds.includes(f.id)}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            onCardFieldIdsChange([...cardFieldIds, f.id]);
                                        } else {
                                            onCardFieldIdsChange(cardFieldIds.filter((id) => id !== f.id));
                                        }
                                    }}
                                />
                                <span className="imcrm-truncate">
                                    {f.label}
                                    <span className="imcrm-ml-1 imcrm-text-muted-foreground">({f.type})</span>
                                </span>
                            </label>
                        ))
                    )}
                </div>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="cards-cover">{__('Imagen de portada (opcional)')}</Label>
                <Select
                    id="cards-cover"
                    value={coverFieldId}
                    onChange={(e) => onCoverFieldIdChange(Number(e.target.value))}
                    disabled={fileFields.length === 0}
                >
                    <option value={0}>{__('— Sin portada (avatar colorizado) —')}</option>
                    {fileFields.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.label}
                        </option>
                    ))}
                </Select>
                {fileFields.length === 0 && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Necesitás un campo tipo Archivo para usar portada.')}
                    </p>
                )}
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Densidad del grid')}</Label>
                <div className="imcrm-flex imcrm-gap-1 imcrm-rounded-md imcrm-bg-muted imcrm-p-0.5">
                    {(['compact', 'comfortable', 'spacious'] as const).map((s) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => onSizeChange(s)}
                            className={cn(
                                'imcrm-flex-1 imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                                size === s
                                    ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm'
                                    : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                            )}
                        >
                            {s === 'compact'
                                ? __('Compacta')
                                : s === 'comfortable'
                                  ? __('Normal')
                                  : __('Espaciada')}
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
}
