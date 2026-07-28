import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/react';
import type { RichDoc } from '@imagina-base/shared';
import { Check, Loader2 } from 'lucide-react';

import { useRecordDescription, useUpdateRecordDescription } from '@/hooks/useRecordDescription';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// El motor del editor pesa (~100 KB gz): sólo se descarga al abrir una ficha,
// nunca al cargar la tabla.
const DescriptionEditor = lazy(() =>
    import('./DescriptionEditor').then((m) => ({ default: m.DescriptionEditor })),
);

interface RecordDescriptionProps {
    listKey: string | number;
    /** Slug de la lista (para el selector de registro a mencionar). */
    listSlug?: string;
    recordId: number;
    /** Sin permiso de edición el documento se ve, pero no se toca. */
    editable: boolean;
    className?: string;
}

const AUTOSAVE_MS = 900;

/**
 * Firma comparable de un documento. Ignora los párrafos vacíos del final (el
 * editor agrega uno para poder escribir debajo del último bloque; no es
 * contenido) — si no, cada apertura de la ficha "cambiaría" el documento.
 */
export function docKey(doc: JSONContent | null | undefined): string {
    if (doc === null || doc === undefined) return 'null';
    const content = [...(doc.content ?? [])];
    while (content.length > 0) {
        const last = content[content.length - 1];
        const empty =
            last !== undefined
            && last.type === 'paragraph'
            && (last.content === undefined || last.content.length === 0);
        if (!empty) break;
        content.pop();
    }
    if (content.length === 0) return 'null';
    return JSON.stringify({ ...doc, content });
}

/**
 * Descripción del registro (v0.1.133) — el cuerpo tipo documento de la ficha,
 * como el de una tarea de ClickUp.
 *
 * Guarda SOLO (autosave con debounce) y avisa el estado en una línea discreta:
 * nadie tiene que acordarse de apretar un botón para no perder lo escrito.
 */
export function RecordDescription({
    listKey,
    listSlug,
    recordId,
    editable,
    className,
}: RecordDescriptionProps): JSX.Element {
    const { data, isLoading } = useRecordDescription(listKey, recordId);
    const save = useUpdateRecordDescription(listKey, recordId);
    const { mutate } = save;

    const [dirty, setDirty] = useState(false);
    const pending = useRef<JSONContent | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    /**
     * Última versión que el servidor tiene (o que ya le mandamos).
     *
     * Es el guard contra un borrado accidental: al montar, el editor emite un
     * cambio propio (agrega el párrafo final, normaliza el documento) que NO
     * es una edición del usuario. Sin esta comparación, abrir una ficha
     * mandaba `null` y BORRABA la descripción que había.
     */
    const serverKey = docKey((data ?? null) as JSONContent | null);
    const lastSent = useRef(serverKey);
    useEffect(() => {
        lastSent.current = serverKey;
    }, [serverKey, recordId]);

    const send = useCallback(
        (doc: JSONContent | null) => {
            lastSent.current = docKey(doc);
            mutate((doc as RichDoc | null) ?? null);
        },
        [mutate],
    );

    const flush = useCallback(() => {
        if (timer.current !== null) {
            clearTimeout(timer.current);
            timer.current = null;
        }
        if (!dirty) return;
        setDirty(false);
        send(pending.current);
    }, [dirty, send]);

    const handleChange = useCallback(
        (doc: JSONContent | null, fromUser: boolean) => {
            if (!fromUser) {
                // Normalización del editor al cargar (no la escribió nadie):
                // se adopta como nueva referencia y NO se guarda.
                lastSent.current = docKey(doc);
                return;
            }
            // Mismo contenido (ruido de foco/selección) → tampoco se guarda.
            if (docKey(doc) === lastSent.current) return;
            pending.current = doc;
            setDirty(true);
            if (timer.current !== null) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
                timer.current = null;
                setDirty(false);
                send(pending.current);
            }, AUTOSAVE_MS);
        },
        [send],
    );

    // Al desmontar (cerrar el modal, navegar) se guarda lo que quedó pendiente:
    // el debounce no puede costarle al usuario los últimos segundos de escritura.
    const flushRef = useRef(flush);
    flushRef.current = flush;
    useEffect(
        () => () => {
            flushRef.current();
        },
        [recordId],
    );

    const status = dirty || save.isPending
        ? { icon: Loader2, text: __('Guardando…'), spin: true }
        : save.isSuccess
            ? { icon: Check, text: __('Guardado'), spin: false }
            : null;

    return (
        <section className={cn('imcrm-relative', className)} data-imcrm-description>
            <div className="imcrm-mb-1 imcrm-flex imcrm-items-center imcrm-gap-2">
                <h3 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                    {__('Descripción')}
                </h3>
                {status !== null && (
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                        <status.icon
                            className={cn('imcrm-h-3 imcrm-w-3', status.spin && 'imcrm-animate-spin')}
                            aria-hidden
                        />
                        {status.text}
                    </span>
                )}
                {save.isError && (
                    <span className="imcrm-text-[11px] imcrm-text-destructive">
                        {__('No se pudo guardar')}
                    </span>
                )}
            </div>

            {isLoading ? (
                <div className="imcrm-h-16 imcrm-animate-pulse imcrm-rounded-md imcrm-bg-muted/60" />
            ) : (
                <Suspense fallback={<div className="imcrm-h-16" />}>
                    <DescriptionEditor
                        key={recordId}
                        value={(data ?? null) as JSONContent | null}
                        editable={editable}
                        listSlug={listSlug ?? (typeof listKey === 'string' ? listKey : undefined)}
                        recordId={recordId}
                        onChange={handleChange}
                        onBlurFlush={flush}
                    />
                </Suspense>
            )}
        </section>
    );
}
