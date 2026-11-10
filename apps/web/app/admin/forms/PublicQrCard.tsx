import { useEffect, useRef, useState } from 'react';
import { Download, QrCode } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { qrTargetUrl } from './embedCode';

/**
 * v0.1.359 — El código QR del formulario o de la agenda, para imprimirlo en un
 * volante, un cartel o el mostrador. Se dibuja en el navegador (la dirección
 * ya es pública) y la librería se pide sólo al abrir esta tarjeta. Lleva
 * `utm_source=qr`: las estadísticas del formulario cuentan aparte a quien
 * llega por el QR.
 *
 * v0.1.397 — Una tarjeta compacta dentro de la pestaña del enlace (antes era
 * una pestaña propia, casi vacía).
 */
const QR_ANCHOR = { form: 'form-qr', booking: 'booking-qr' } as const;

export function PublicQrCard({ url, name, kind, highlight }: { url: string; name: string; kind: 'form' | 'booking'; highlight?: boolean }): JSX.Element {
    const canvas = useRef<HTMLCanvasElement>(null);
    const box = useRef<HTMLElement>(null);
    // v0.1.397 — Abierto desde «El código QR»: se trae a la vista y se marca.
    useEffect(() => {
        if (highlight) box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [highlight]);
    const [ready, setReady] = useState(false);
    const target = qrTargetUrl(url);
    const fileBase = (name.trim() || (kind === 'booking' ? 'agenda' : 'formulario'))
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'qr';

    useEffect(() => {
        let alive = true;
        void import('qrcode').then((mod) => {
            if (!alive || !canvas.current) return;
            void mod.default.toCanvas(canvas.current, target, { width: 168, margin: 1, errorCorrectionLevel: 'M' }).then(() => {
                // La librería le pone 168 px en línea: el tamaño lo dan las clases.
                if (canvas.current) {
                    canvas.current.style.width = '';
                    canvas.current.style.height = '';
                }
                if (alive) setReady(true);
            });
        });
        return () => {
            alive = false;
        };
    }, [target]);

    const download = async (format: 'png' | 'svg'): Promise<void> => {
        const mod = await import('qrcode');
        // Un Blob (no un `data:`): algunos navegadores del celular no descargan
        // un enlace `data:` y lo abren en la misma pestaña.
        let blob: Blob;
        if (format === 'png') {
            const data = await mod.default.toDataURL(target, { width: 1024, margin: 2, errorCorrectionLevel: 'M' });
            const bin = atob(data.slice(data.indexOf(',') + 1));
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            blob = new Blob([bytes], { type: 'image/png' });
        } else {
            const svg = await mod.default.toString(target, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
            blob = new Blob([svg], { type: 'image/svg+xml' });
        }
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = `qr-${fileBase}.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    };

    return (
        <section
            ref={box}
            className={cn(
                'imcrm-flex imcrm-items-center imcrm-gap-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-p-3.5 imcrm-transition-shadow',
                highlight && 'imcrm-ring-2 imcrm-ring-primary/50',
            )}
            data-testid={`${kind}-qr`}
            data-tour={QR_ANCHOR[kind]}
            data-highlight={highlight ? '' : undefined}
        >
            <canvas
                ref={canvas}
                width={168}
                height={168}
                aria-label={__('Código QR del enlace')}
                role="img"
                className="imcrm-h-[104px] imcrm-w-[104px] imcrm-shrink-0 imcrm-rounded-lg imcrm-bg-white imcrm-p-1.5 imcrm-ring-1 imcrm-ring-border"
                data-testid={`${kind}-qr-canvas`}
            />
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-2">
                <div>
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                        <QrCode className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        {__('Código QR')}
                    </p>
                    <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">
                        {kind === 'form'
                            ? __('Para un volante, un cartel o el mostrador: al escanearlo se abre el formulario. En las estadísticas aparece como «Código QR».')
                            : __('Para un volante, un cartel o el mostrador: al escanearlo se abre la agenda para reservar.')}
                    </p>
                </div>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                    <Button
                        variant="outline"
                        size="sm"
                        className="imcrm-h-8 imcrm-gap-1 imcrm-text-xs"
                        disabled={!ready}
                        onClick={() => void download('png')}
                        data-testid={`${kind}-qr-png`}
                    >
                        <Download className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('PNG')}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="imcrm-h-8 imcrm-gap-1 imcrm-text-xs"
                        disabled={!ready}
                        onClick={() => void download('svg')}
                        title={__('Un archivo que se agranda sin perder calidad, para imprenta.')}
                        data-testid={`${kind}-qr-svg`}
                    >
                        <Download className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('SVG para imprenta')}
                    </Button>
                </div>
            </div>
        </section>
    );
}
