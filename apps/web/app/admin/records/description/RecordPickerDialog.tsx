import { useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { useRecords } from '@/hooks/useRecords';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface RecordPickerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Lista desde la que se abrió (arranca seleccionada). */
    defaultListSlug?: string;
    onPick: (pick: { id: number; listSlug: string; label: string }) => void;
}

/**
 * Buscador de registros para mencionar desde la descripción (v0.1.134).
 *
 * Cruza listas a propósito: el caso real de un CRM es referenciar la factura
 * desde el cliente, o al revés. La búsqueda es la del servidor (`?search=`),
 * así que respeta el ACL de quien busca — nadie menciona lo que no puede ver.
 */
export function RecordPickerDialog({
    open,
    onOpenChange,
    defaultListSlug,
    onPick,
}: RecordPickerDialogProps): JSX.Element {
    const lists = useLists();
    const [listSlug, setListSlug] = useState(defaultListSlug ?? '');
    const [term, setTerm] = useState('');
    const debounced = useDebouncedValue(term, 200);

    const effectiveSlug = listSlug !== '' ? listSlug : (lists.data?.[0]?.slug ?? '');
    const fields = useFields(effectiveSlug === '' ? undefined : effectiveSlug);
    const primary = useMemo(
        () => fields.data?.find((f) => f.is_primary) ?? fields.data?.[0],
        [fields.data],
    );

    const records = useRecords(effectiveSlug === '' ? undefined : effectiveSlug, {
        per_page: 12,
        ...(debounced.trim() !== '' ? { search: debounced.trim() } : {}),
    });

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="imcrm-w-[min(460px,94vw)]">
                <SheetHeader>
                    <SheetTitle>{__('Mencionar un registro')}</SheetTitle>
                    <SheetDescription>
                        {__('Se inserta como enlace: al clickearlo se abre ese registro.')}
                    </SheetDescription>
                </SheetHeader>

                <div className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <Select
                        value={effectiveSlug}
                        onChange={(e) => setListSlug(e.target.value)}
                        className="imcrm-h-9"
                        aria-label={__('Lista')}
                    >
                        {(lists.data ?? []).map((l) => (
                            <option key={l.id} value={l.slug}>
                                {l.name}
                            </option>
                        ))}
                    </Select>
                    <Input
                        autoFocus
                        value={term}
                        onChange={(e) => setTerm(e.target.value)}
                        placeholder={__('Buscar…')}
                        className="imcrm-h-9"
                    />
                </div>

                <div className="imcrm-mt-3 imcrm-flex imcrm-max-h-[60vh] imcrm-flex-col imcrm-gap-0.5 imcrm-overflow-y-auto">
                    {(records.data?.data ?? []).map((r) => {
                        const label = recordLabel(r.fields, primary?.slug);
                        return (
                            <button
                                key={r.id}
                                type="button"
                                onClick={() => {
                                    onPick({ id: r.id, listSlug: effectiveSlug, label });
                                    onOpenChange(false);
                                }}
                                className={cn(
                                    'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm',
                                    'hover:imcrm-bg-accent/60',
                                )}
                            >
                                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{label}</span>
                                <span className="imcrm-shrink-0 imcrm-text-[11px] imcrm-text-muted-foreground">
                                    #{r.id}
                                </span>
                            </button>
                        );
                    })}
                    {records.isFetched && (records.data?.data ?? []).length === 0 && (
                        <p className="imcrm-px-2 imcrm-py-4 imcrm-text-sm imcrm-text-muted-foreground">
                            {__('No hay registros que coincidan.')}
                        </p>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}

/** Etiqueta legible del registro: campo primario, o el primer texto que haya. */
function recordLabel(fields: Record<string, unknown>, primarySlug?: string): string {
    const fromPrimary = primarySlug === undefined ? undefined : fields[primarySlug];
    if (typeof fromPrimary === 'string' && fromPrimary.trim() !== '') return fromPrimary;
    for (const value of Object.values(fields)) {
        if (typeof value === 'string' && value.trim() !== '') return value;
    }
    return __('Registro');
}
