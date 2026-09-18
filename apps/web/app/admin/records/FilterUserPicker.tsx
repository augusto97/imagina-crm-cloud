import { useEffect, useRef, useState } from 'react';

import { useWpUser, useWpUsersSearch } from '@/hooks/useWpUsers';
import { getBootData } from '@/lib/boot';
import { __ } from '@/lib/i18n';

import type { FieldOption } from './fieldOptions';
import { FilterOptionPicker } from './FilterOptionPicker';

interface FilterUserPickerProps {
    mode: 'single' | 'multi';
    /** ids de usuario (número) — escalar en `eq`/`neq`, lista en `in`/`nin`. */
    value: unknown;
    onChange: (next: number | number[] | null) => void;
}

/**
 * v0.1.191 — valor de un filtro sobre un campo `user`: antes era un
 * `<input type=number>` donde había que saber el ID interno del miembro.
 * Ahora se busca por nombre (el mismo endpoint del picker de asignación)
 * y hay un acceso directo "Yo" — el filtro de "mis registros" es el que
 * más se usa. Los ids ya elegidos se resuelven a nombre por id.
 */
export function FilterUserPicker({ mode, value, onChange }: FilterUserPickerProps): JSX.Element {
    const [query, setQuery] = useState('');
    const [debounced, setDebounced] = useState('');
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setDebounced(query), 200);
        return () => {
            if (timer.current !== null) clearTimeout(timer.current);
        };
    }, [query]);

    const search = useWpUsersSearch(debounced, 8);
    const options: FieldOption[] = (search.data ?? []).map((u) => ({
        value: String(u.id),
        label: u.display_name || u.login,
    }));

    const ids: number[] = Array.isArray(value)
        ? value.map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : (typeof value === 'number' || (typeof value === 'string' && value !== ''))
            ? [Number(value)].filter((n) => Number.isInteger(n) && n > 0)
            : [];

    const pickerValue = mode === 'multi' ? ids.map(String) : (ids[0] !== undefined ? String(ids[0]) : null);

    const emit = (next: string | string[] | null): void => {
        if (mode === 'multi') {
            onChange(Array.isArray(next) ? next.map(Number) : []);
        } else {
            onChange(typeof next === 'string' && next !== '' ? Number(next) : null);
        }
    };

    const meId = getBootData().user.id || null;
    const actions = meId !== null
        ? [{
            key: 'me',
            label: __('Yo (mi usuario)'),
            onSelect: () => {
                if (mode === 'multi') {
                    emit(ids.includes(meId) ? ids.map(String) : [...ids.map(String), String(meId)]);
                } else {
                    emit(String(meId));
                }
            },
        }]
        : [];

    return (
        <FilterOptionPicker
            mode={mode}
            value={pickerValue}
            onChange={emit}
            options={options}
            onSearch={setQuery}
            loading={search.isFetching && debounced !== ''}
            emptyHint={__('Escribí para buscar miembros.')}
            resolveLabel={(id) => <UserName id={Number(id)} />}
            actions={actions}
            placeholder={mode === 'multi' ? __('Elegir personas…') : __('Elegir persona…')}
            aria-label={__('Usuario')}
            data-testid="imcrm-filter-user-picker"
        />
    );
}

function UserName({ id }: { id: number }): JSX.Element {
    const user = useWpUser(id);
    if (user.data) return <>{user.data.display_name || user.data.login}</>;
    if (user.isLoading) return <>{__('Cargando…')}</>;
    return <>{__('Usuario')} #{id}</>;
}
