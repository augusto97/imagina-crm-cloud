import { useEffect, useRef, useState } from 'react';
import { Download, QrCode } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';

import { qrTargetUrl } from './embedCode';

/**
 * v0.1.359 — El código QR del formulario o de la agenda, para imprimirlo en un
 * volante, un cartel o el mostrador. Se dibuja en el navegador (la dirección
 * ya es pública) y la librería se pide sólo al abrir esta tarjeta. Lleva
 * `utm_source=qr`: las estadísticas del formulario cuentan aparte a quien
 * llega por el QR.
 */
const QR_ANCHOR = { form: 'form-qr', booking: 'booking-qr' } as const;

export function PublicQrCard({ url, name, kind }: { url: string; name: string; kind: 'form' | 'booking' }): JSX.Element {
    const canvas = useRef<HTMLCanvasElement>(null);
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
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid={`${kind}-qr`} data-tour={QR_ANCHOR[kind]}>
            <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                <QrCode className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Código QR')}
            </span>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                <canvas
                    ref={canvas}
                    width={168}
                    height={168}
                    aria-label={__('Código QR del enlace')}
                    role="img"
                    className="imcrm-h-[120px] imcrm-w-[120px] imcrm-shrink-0 imcrm-rounded-md imcrm-bg-white imcrm-p-1.5 imcrm-ring-1 imcrm-ring-border"
                    data-testid={`${kind}-qr-canvas`}
                />
                <div className="imcrm-flex imcrm-min-w-[180px] imcrm-flex-1 imcrm-flex-col imcrm-gap-2">
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {kind === 'form'
                            ? __('Imprímelo en un volante, un cartel o el mostrador: al escanearlo se abre el formulario. Quienes lleguen por aquí aparecen como «Código QR» en las estadísticas.')
                            : __('Imprímelo en un volante, un cartel o el mostrador: al escanearlo se abre la agenda para reservar.')}
                    </p>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                        <Button
                            variant="outline"
                            size="sm"
                            className="imcrm-gap-1 imcrm-text-xs"
                            disabled={!ready}
                            onClick={() => void download('png')}
                            data-testid={`${kind}-qr-png`}
                        >
                            <Download className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Imagen (PNG)')}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="imcrm-gap-1 imcrm-text-xs"
                            disabled={!ready}
                            onClick={() => void download('svg')}
                            data-testid={`${kind}-qr-svg`}
                        >
                            <Download className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Para imprenta (SVG)')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
