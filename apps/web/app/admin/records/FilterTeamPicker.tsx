import { MY_TEAMS_TOKEN } from '@imagina-base/shared';

import { useTeamMap, useTeams } from '@/hooks/useTeams';
import { __ } from '@/lib/i18n';

import type { FieldOption } from './fieldOptions';
import { FilterOptionPicker } from './FilterOptionPicker';

interface FilterTeamPickerProps {
    mode: 'single' | 'multi';
    /** ids de equipo (número) o `$my_teams` — escalar en `eq`/`neq`, lista en `in`/`nin`. */
    value: unknown;
    onChange: (next: number | string | Array<number | string> | null) => void;
}

const MY_TEAMS_LABEL = (): string => __('Mis equipos (los de quien mira)');

/** Un valor del filtro → texto del picker (`$my_teams` queda tal cual). */
function toKey(v: unknown): string | null {
    if (v === MY_TEAMS_TOKEN) return MY_TEAMS_TOKEN;
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
    return Number.isInteger(n) && n > 0 ? String(n) : null;
}

function fromKey(k: string): number | string {
    return k === MY_TEAMS_TOKEN ? MY_TEAMS_TOKEN : Number(k);
}

/**
 * C1 — valor de un filtro sobre un campo «Equipo»: se eligen los equipos de
 * la lista, y la primera opción es «Mis equipos», que el servidor resuelve con
 * los equipos de quien mira — así una vista guardada «de mis equipos» le
 * muestra a cada persona lo de SUS equipos.
 */
export function FilterTeamPicker({ mode, value, onChange }: FilterTeamPickerProps): JSX.Element {
    const teams = useTeams();
    const map = useTeamMap();
    const options: FieldOption[] = [
        { value: MY_TEAMS_TOKEN, label: MY_TEAMS_LABEL() },
        ...(teams.data ?? []).map((t) => ({ value: String(t.id), label: t.name, color: undefined })),
    ];
    const keys = (Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value])
        .map(toKey)
        .filter((k): k is string => k !== null);
    const pickerValue = mode === 'multi' ? keys : (keys[0] ?? null);

    return (
        <FilterOptionPicker
            mode={mode}
            value={pickerValue}
            onChange={(next) => {
                if (mode === 'multi') onChange(Array.isArray(next) ? next.map(fromKey) : []);
                else onChange(typeof next === 'string' && next !== '' ? fromKey(next) : null);
            }}
            options={options}
            loading={teams.isLoading}
            emptyHint={__('Todavía no hay equipos. Créalos en Ajustes → Equipos.')}
            resolveLabel={(k) => (k === MY_TEAMS_TOKEN ? MY_TEAMS_LABEL() : (map.get(Number(k))?.name ?? __('Equipo borrado')))}
            placeholder={mode === 'multi' ? __('Elegir equipos…') : __('Elegir equipo…')}
            aria-label={__('Equipo')}
            data-testid="imcrm-filter-team-picker"
        />
    );
}
