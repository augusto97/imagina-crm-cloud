import { useEffect, useState } from 'react';

/**
 * Devuelve `value` debounced — actualiza el valor retornado solo
 * `delay` ms después del último cambio. Útil para inputs de búsqueda
 * donde queremos que el state visible (lo que el user escribe)
 * actualice instantáneo pero la query de red solo se dispare cuando
 * el user pausa.
 *
 *   const [draft, setDraft] = useState('');
 *   const debounced = useDebouncedValue(draft, 300);
 *   // <Input value={draft} onChange={...} />  ← responsivo
 *   // useQuery({ search: debounced, ... })    ← solo dispara tras pausa
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        if (debounced === value) return;
        const t = window.setTimeout(() => setDebounced(value), delay);
        return () => window.clearTimeout(t);
        // `debounced` intencionalmente fuera de deps: solo queremos
        // re-armar el timer cuando cambia `value` o `delay`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, delay]);

    return debounced;
}
