import { CheckCircle2, Printer, Repeat, ScanLine, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __, sprintf } from '@/lib/i18n';

const SEEN_KEY = 'imcrm:scan:intro:v1';

/** ¿Ya vio la explicación del escáner en este dispositivo? */
export function scanIntroSeen(): boolean {
    try {
        return window.localStorage.getItem(SEEN_KEY) === '1';
    } catch {
        return true;
    }
}

export function markScanIntroSeen(): void {
    try {
        window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
        /* nada */
    }
}

/**
 * v0.1.344 — Lo que hace el escáner, la PRIMERA vez que se abre (y desde
 * «¿Cómo funciona?» las siguientes): antes era un ícono que abría la cámara
 * sin decir para qué. La cámara no se pide hasta «Empezar a escanear».
 */
export function ScanIntro({
    scope,
    fieldLabel,
    onStart,
    onPrintLabels,
}: {
    scope: 'list' | 'global';
    /** El campo «Código» con el que se busca en la lista (null = todos los de texto y número). */
    fieldLabel?: string | null;
    onStart: () => void;
    /** Ofrecer imprimir etiquetas con el QR de los registros (los que no tienen código). */
    onPrintLabels?: () => void;
}): JSX.Element {
    const steps = [
        {
            icon: ScanLine,
            title: __('Apunta al código'),
            text: __('El QR o el código de barras de lo que tienes en la mano: un producto, un equipo, una entrada, una etiqueta impresa desde la app.'),
        },
        {
            icon: Search,
            title: __('La app lo busca'),
            text:
                scope === 'global'
                    ? __('En todas tus listas, sin importar en cuál esté.')
                    : fieldLabel
                      ? sprintf(__('En el campo «%s» de esta lista (se puede cambiar abajo, en «Campo del código»).'), fieldLabel)
                      : __('En los campos de texto y número de esta lista. Si tienes un campo «SKU» o «Código», elígelo abajo para que sea más preciso.'),
        },
        {
            icon: CheckCircle2,
            title: __('Abre su ficha'),
            text:
                scope === 'global'
                    ? __('Si lo encuentra, abre el registro al instante. Un QR impreso desde la app abre su ficha directo.')
                    : __('Si lo encuentra, abre el registro. Si no existe, te ofrece crearlo con ese código ya puesto.'),
        },
    ];
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="scan-intro">
            <div>
                <h3 className="imcrm-text-base imcrm-font-semibold">{__('Encuentra registros con la cámara')}</h3>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Sirve para lo que ya tiene un código, y para lo que no: la app imprime etiquetas con el QR de cada registro.')}
                </p>
            </div>
            <ol className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                {steps.map((s, i) => (
                    <li key={s.title} className="imcrm-flex imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-primary">
                            <s.icon className="imcrm-h-4 imcrm-w-4" />
                        </span>
                        <span className="imcrm-min-w-0">
                            <span className="imcrm-block imcrm-text-sm imcrm-font-medium">
                                {i + 1}. {s.title}
                            </span>
                            <span className="imcrm-block imcrm-text-sm imcrm-text-muted-foreground">{s.text}</span>
                        </span>
                    </li>
                ))}
            </ol>
            {scope === 'list' && (
                <div className="imcrm-flex imcrm-gap-2.5 imcrm-rounded-lg imcrm-bg-muted/60 imcrm-p-3 imcrm-text-xs imcrm-text-muted-foreground">
                    <Repeat className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    <span>
                        <strong className="imcrm-font-medium imcrm-text-foreground">{__('Escaneo continuo:')}</strong>{' '}
                        {__('para contar inventario o recibir gente en la puerta de un evento. La cámara queda abierta y cada código suena y se anota.')}
                    </span>
                </div>
            )}
            <div className="imcrm-flex imcrm-flex-col-reverse imcrm-gap-2 sm:imcrm-flex-row sm:imcrm-justify-end">
                {onPrintLabels && (
                    <Button variant="outline" className="imcrm-gap-2" onClick={onPrintLabels} data-testid="scan-intro-labels">
                        <Printer className="imcrm-h-4 imcrm-w-4" />
                        {__('Imprimir etiquetas con QR')}
                    </Button>
                )}
                <Button
                    className="imcrm-gap-2"
                    onClick={() => {
                        markScanIntroSeen();
                        onStart();
                    }}
                    data-testid="scan-intro-start"
                >
                    <ScanLine className="imcrm-h-4 imcrm-w-4" />
                    {__('Empezar a escanear')}
                </Button>
            </div>
        </div>
    );
}
