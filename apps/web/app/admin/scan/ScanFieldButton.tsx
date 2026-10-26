import { Suspense, useState } from 'react';
import { SCAN_FILL_FIELD_TYPES, pickScanField } from '@imagina-base/shared';
import { ScanLine } from 'lucide-react';

import { useToast } from '@/components/ui/toast';
import { useFields } from '@/hooks/useFields';
import { useList } from '@/hooks/useLists';
import { __, sprintf } from '@/lib/i18n';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { codeForField } from '@/lib/scan/codeSearch';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

const FieldScanDialog = lazyWithReload(() => import('./FieldScanDialog'));

/**
 * H3 — El icono para LLENAR un campo con la cámara, en la ficha y en el alta.
 * Aparece en el campo «Código» de la lista (el elegido en sus ajustes o el
 * que lo dice en el nombre: SKU, serial, código de boleta), si es de texto o
 * número.
 */
export function ScanFieldButton({
    field,
    listId,
    onValue,
    className,
}: {
    field: FieldEntity;
    listId: number | string;
    onValue: (value: string | number) => void;
    className?: string;
}): JSX.Element | null {
    const list = useList(listId);
    const fields = useFields(listId);
    const toast = useToast();
    const [open, setOpen] = useState(false);
    if (!(SCAN_FILL_FIELD_TYPES as readonly string[]).includes(field.type)) return null;
    if (pickScanField(fields.data ?? [], list.data?.settings)?.id !== field.id) return null;
    return (
        <>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(true);
                }}
                className={cn(
                    'imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
                    className,
                )}
                aria-label={sprintf(__('Escanear %s con la cámara'), field.label)}
                title={__('Escanear con la cámara')}
                data-testid={`scan-field-${field.slug}`}
            >
                <ScanLine className="imcrm-h-4 imcrm-w-4" />
            </button>
            {open && (
                <Suspense fallback={null}>
                    <FieldScanDialog
                        open={open}
                        onOpenChange={setOpen}
                        fieldLabel={field.label}
                        onCode={(code) => {
                            const v = codeForField(code, field.type);
                            if (!v.ok) {
                                toast.error(__('No se puede usar este código'), v.message);
                                return;
                            }
                            setOpen(false);
                            onValue(v.value);
                            toast.success(sprintf(__('Código leído: %s'), String(v.value)));
                        }}
                    />
                </Suspense>
            )}
        </>
    );
}
