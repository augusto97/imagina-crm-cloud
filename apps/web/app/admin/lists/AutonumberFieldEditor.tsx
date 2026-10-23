import { useEffect, useRef } from 'react';
import {
    AUTONUMBER_SEPARATORS,
    autonumberSettings,
    formatAutonumber,
    suggestAutonumberPrefix,
} from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useList } from '@/hooks/useLists';
import { __, sprintf } from '@/lib/i18n';

/**
 * v0.1.300 — Config del ID automático (`TCK-0001`, `PED-2026-0042`): prefijo
 * (sugerido con el nombre de la lista), separador, dígitos, número inicial y
 * reinicio anual, con la vista previa armada por la MISMA función que usa el
 * servidor para los tests de paridad (`formatAutonumber`).
 */
interface Props {
    config: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
    listId?: number;
    /** Sin id = campo nuevo: los registros que ya existen se numeran al guardar. */
    currentFieldId?: number;
}

const SEPARATOR_LABELS: Record<string, string> = {
    '-': 'Guion (TCK-0001)',
    '/': 'Barra (TCK/0001)',
    '.': 'Punto (TCK.0001)',
    _: 'Guion bajo (TCK_0001)',
    '': 'Ninguno (TCK0001)',
};

export function AutonumberFieldEditor({ config, onChange, listId, currentFieldId }: Props): JSX.Element {
    const list = useList(listId);
    const listName = list.data?.name ?? '';
    const s = autonumberSettings(config);

    // Campo nuevo sin prefijo elegido: el sugerido por el nombre de la lista
    // (el servidor hace lo mismo si llega sin prefijo).
    const suggested = useRef(false);
    useEffect(() => {
        if (suggested.current || currentFieldId !== undefined || config.prefix !== undefined || listName === '') return;
        suggested.current = true;
        onChange({ ...config, prefix: suggestAutonumberPrefix(listName) });
    }, [listName, currentFieldId, config, onChange]);

    const year = new Date().getFullYear();
    const first = formatAutonumber(config, s.start, year);
    const second = formatAutonumber(config, s.start + 1, year);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="autonumber-editor">
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Prefijo')}</Label>
                    <Input
                        value={typeof config.prefix === 'string' ? config.prefix : ''}
                        maxLength={20}
                        placeholder={listName ? suggestAutonumberPrefix(listName) : 'TCK'}
                        aria-label={__('Prefijo')}
                        onChange={(e) =>
                            onChange({ ...config, prefix: e.target.value.toUpperCase().replace(/[^\p{L}\p{N}_.#/-]/gu, '') })
                        }
                    />
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Separador')}</Label>
                    <Select value={s.separator} aria-label={__('Separador')} onChange={(e) => onChange({ ...config, separator: e.target.value })}>
                        {AUTONUMBER_SEPARATORS.map((sep) => (
                            <option key={sep || 'none'} value={sep}>
                                {__(SEPARATOR_LABELS[sep] ?? sep)}
                            </option>
                        ))}
                    </Select>
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Dígitos')}</Label>
                    <Select value={s.digits} aria-label={__('Dígitos')} onChange={(e) => onChange({ ...config, digits: Number(e.target.value) })}>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                            <option key={n} value={n}>
                                {sprintf(__('%1$d (%2$s)'), n, '1'.padStart(n, '0'))}
                            </option>
                        ))}
                    </Select>
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Empieza en')}</Label>
                    <Input
                        type="number"
                        min={0}
                        max={1_000_000_000}
                        value={s.start}
                        aria-label={__('Empieza en')}
                        onChange={(e) => {
                            const n = Math.floor(Number(e.target.value));
                            onChange({ ...config, start: Number.isFinite(n) && n >= 0 ? Math.min(n, 1_000_000_000) : 1 });
                        }}
                    />
                </div>
            </div>
            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                <input type="checkbox" checked={s.yearly} onChange={(e) => onChange({ ...config, yearly: e.target.checked })} />
                {__('Incluir el año y reiniciar la numeración cada año')}
            </label>
            <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2 imcrm-text-sm">
                <span className="imcrm-text-muted-foreground">{__('Así se verán:')} </span>
                <span className="imcrm-font-mono imcrm-font-medium" data-testid="autonumber-preview">
                    {first}, {second}…
                </span>
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {currentFieldId === undefined
                    ? __('Se asigna solo al crear cada registro y nadie lo puede editar. Los registros que ya existen se numeran por orden de creación al guardar el campo.')
                    : __('Los cambios aplican a los registros nuevos: los que ya tienen su ID lo conservan. Subir el número inicial hace que los próximos sigan desde ahí; bajarlo nunca repite números.')}
                {s.yearly && ` ${__('El año es el de la zona horaria de la empresa.')}`}
            </p>
        </div>
    );
}
