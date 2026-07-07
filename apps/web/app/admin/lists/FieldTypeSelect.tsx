import { Select } from '@/components/ui/select';
import { useFieldTypes } from '@/hooks/useFieldTypes';
import { allowedTargetsFor, riskOf, type TypeRisk } from '@/lib/fieldTypeMigration';
import { __ } from '@/lib/i18n';
import type { FieldTypeSlug } from '@/types/field';

interface FieldTypeSelectProps {
    value: FieldTypeSlug | '';
    onChange: (slug: FieldTypeSlug) => void;
    disabled?: boolean;
    /**
     * Si está presente, el dropdown limita las opciones disponibles
     * al tipo actual + las transiciones permitidas. Útil al editar
     * un field existente: cambiar a un tipo arbitrario podría
     * corromper la columna; solo se ofrecen conversiones seguras o
     * con riesgo controlado.
     */
    editingFromType?: FieldTypeSlug;
}

const RISK_LABELS: Record<TypeRisk, string> = {
    safe: '✓ seguro',
    lossy: '⚠ posible pérdida',
    destructive: '✗ pérdida significativa',
};

export function FieldTypeSelect({
    value,
    onChange,
    disabled,
    editingFromType,
}: FieldTypeSelectProps): JSX.Element {
    const { data: types, isLoading } = useFieldTypes();

    // Modo edición: solo mostramos el tipo actual + las transiciones
    // permitidas. El backend rechaza el resto, así que mejor no
    // ofrecerlo en la UI.
    const visibleTypes = (() => {
        if (! editingFromType || ! types) return types;
        const allowed = new Set(allowedTargetsFor(editingFromType).map((t) => t.type));
        return types.filter((t) => t.slug === editingFromType || allowed.has(t.slug));
    })();

    return (
        <Select
            value={value}
            disabled={disabled || isLoading}
            onChange={(e) => onChange(e.target.value as FieldTypeSlug)}
        >
            <option value="" disabled>
                {isLoading ? __('Cargando…') : __('Selecciona un tipo')}
            </option>
            {visibleTypes?.map((t) => {
                let label: string = t.label;
                if (editingFromType && t.slug !== editingFromType) {
                    const risk = riskOf(editingFromType, t.slug);
                    if (risk) {
                        label = `${t.label} — ${RISK_LABELS[risk]}`;
                    }
                }
                return (
                    <option key={t.slug} value={t.slug}>
                        {label}
                    </option>
                );
            })}
        </Select>
    );
}
