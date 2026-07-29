import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

interface RecordTitleInputProps {
    /**
     * Campo que hace de título (primario, o el primer texto de la lista).
     * Si la lista no tiene ninguno, el título no se puede editar y se muestra
     * el texto que reciba `fallback`.
     */
    field: FieldEntity | undefined;
    /** Valor actual (el mismo `values` que edita el resto de la ficha). */
    value: unknown;
    onChange: (next: string) => void;
    /** Texto a mostrar cuando no hay campo de título (ej. "Registro #12"). */
    fallback: string;
    editable: boolean;
    className?: string;
    /** `true` en el alta: el campo arranca enfocado. */
    autoFocus?: boolean;
}

/**
 * Título editable de la ficha del registro (v0.1.136).
 *
 * El título NO es un campo aparte: es la MISMA celda del campo primario, con
 * otra tipografía. Antes se mostraba de sólo lectura y para cambiar el nombre
 * había que bajar a la sección "Campos" — y en el alta directamente decía
 * "Nuevo registro" sin dejar escribirlo. Editar acá escribe en ese campo (y la
 * fila de "Campos" lo refleja al instante, porque leen el mismo estado).
 */
export function RecordTitleInput({
    field,
    value,
    onChange,
    fallback,
    editable,
    className,
    autoFocus = false,
}: RecordTitleInputProps): JSX.Element {
    const text = typeof value === 'string' ? value : '';
    // Borrador local: escribir no puede depender de que el padre re-renderice.
    const [draft, setDraft] = useState(text);
    const focused = useRef(false);

    useEffect(() => {
        // Sólo se adopta el valor externo si no lo está tipeando el usuario
        // (cambio de registro, respuesta del servidor).
        if (!focused.current) setDraft(text);
    }, [text]);

    const base = cn('imcrm-text-2xl imcrm-font-bold imcrm-tracking-tight', className);

    if (field === undefined || !editable) {
        return (
            <h2 className={base}>{text !== '' ? text : fallback}</h2>
        );
    }

    return (
        <input
            type="text"
            value={draft}
            autoFocus={autoFocus}
            aria-label={field.label}
            placeholder={field.label}
            onFocus={() => {
                focused.current = true;
            }}
            onBlur={() => {
                focused.current = false;
            }}
            onChange={(e) => {
                setDraft(e.target.value);
                onChange(e.target.value);
            }}
            className={cn(
                base,
                // Se ve como un título, no como un input: sin borde ni fondo
                // hasta que se lo toca.
                'imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-transparent imcrm-bg-transparent',
                'imcrm-px-1.5 imcrm-py-0.5 imcrm-outline-none imcrm-transition-colors',
                'hover:imcrm-border-border focus:imcrm-border-ring focus:imcrm-bg-background',
                'placeholder:imcrm-font-normal placeholder:imcrm-text-muted-foreground/70',
            )}
        />
    );
}
