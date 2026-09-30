import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useToast } from '@/components/ui/toast';
import { useUpdateRecord } from '@/hooks/useRecords';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import type { RecordEntity } from '@/types/record';

import { layoutDataKeys } from './useLayoutData';

const DELAY_MS = 700;

/**
 * v0.1.230 — La ficha nueva guarda SOLA, campo por campo (como ClickUp o
 * Notion): no hay botón "Guardar" que olvidarse de apretar. Los cambios se
 * juntan unos instantes (escribir no manda una petición por tecla) y se
 * mandan sólo los campos que cambiaron.
 *
 * Mientras un campo tiene un cambio pendiente, la versión del servidor no lo
 * pisa (si no, lo que llega de la respuesta anterior borraría lo que la
 * persona sigue escribiendo).
 */
export function useRecordAutosave(listId: number, record: RecordEntity) {
    const update = useUpdateRecord(listId);
    const toast = useToast();
    const qc = useQueryClient();
    const server = useMemo<Record<string, unknown>>(() => ({ ...record.fields, ...record.relations }), [record]);
    const [values, setValues] = useState<Record<string, unknown>>(server);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const pending = useRef<Record<string, unknown>>({});
    const timer = useRef<number | null>(null);

    // Lo que llega del servidor reemplaza lo local, salvo lo que está pendiente.
    useEffect(() => {
        setValues((local) => {
            const next = { ...server };
            for (const k of Object.keys(pending.current)) next[k] = local[k];
            return next;
        });
    }, [server]);

    const flush = useCallback(async (): Promise<void> => {
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
            timer.current = null;
        }
        const patch = pending.current;
        if (Object.keys(patch).length === 0) return;
        pending.current = {};
        setSaving(true);
        try {
            await update.mutateAsync({ id: record.id, values: patch });
            setErrors((e) => {
                const next = { ...e };
                for (const k of Object.keys(patch)) delete next[k];
                return next;
            });
            // Los gráficos de la ficha pueden depender de lo que cambió.
            void qc.invalidateQueries({ queryKey: layoutDataKeys.all });
        } catch (err) {
            if (err instanceof ApiError) setErrors((e) => ({ ...e, ...err.errors }));
            toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : undefined);
        } finally {
            setSaving(false);
        }
    }, [qc, record.id, toast, update]);

    const setValue = useCallback(
        (slug: string, value: unknown): void => {
            setValues((v) => ({ ...v, [slug]: value }));
            pending.current = { ...pending.current, [slug]: value };
            if (timer.current !== null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => void flush(), DELAY_MS);
        },
        [flush],
    );

    // Salir de la ficha con cambios pendientes: se guardan igual.
    const flushRef = useRef(flush);
    flushRef.current = flush;
    useEffect(() => () => void flushRef.current(), []);

    return { values, setValue, errors, saving, flush };
}
