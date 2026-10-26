import { useState } from 'react';

import { CodeScanner } from '@/components/scan/CodeScanner';
import { ScanDialog } from '@/components/scan/ScanDialog';
import { __, sprintf } from '@/lib/i18n';

/** H3 — Leer UN código para llenar un campo (se carga a pedido). */
export default function FieldScanDialog({
    open,
    onOpenChange,
    fieldLabel,
    onCode,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    fieldLabel: string;
    onCode: (code: string) => void;
}): JSX.Element {
    // Si el código no sirve (p. ej. texto en un campo numérico) se vuelve a leer.
    const [round, setRound] = useState(0);
    return (
        <ScanDialog
            open={open}
            onOpenChange={onOpenChange}
            title={sprintf(__('Escanear «%s»'), fieldLabel)}
            description={__('El código leído queda escrito en el campo.')}
            testId="field-scan-dialog"
        >
            <CodeScanner
                key={round}
                onCode={(code) => {
                    onCode(code);
                    setRound((r) => r + 1);
                }}
            />
        </ScanDialog>
    );
}
