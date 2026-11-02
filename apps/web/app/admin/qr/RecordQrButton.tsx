import { Suspense, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Download, Printer, QrCode, X } from 'lucide-react';

import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { CloudApiError } from '@/lib/cloud/client';
import { useIsGuest } from '@/lib/guest';
import { __, sprintf } from '@/lib/i18n';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

const RecordLabelsDialog = lazyWithReload(() => import('./RecordLabelsDialog'));

/**
 * La imagen se pide por la dirección con la que se entró (no por la de la
 * plataforma): así cumple la CSP del SPA (`img-src 'self'`) y se puede bajar
 * sin CORS. El token firmado es el mismo en cualquier dominio.
 */
export function localQrUrl(url: string): string {
    const m = /^https?:\/\/[^/]+(\/api\/v1\/public\/qr\/[^?#]+(?:\?[^#]*)?)$/.exec(url);
    return m ? m[1]! : url;
}

/**
 * v0.1.344 — «Código QR» del registro (modal, página y ficha): el QR con el
 * enlace a su ficha —o con su código, si la lista tiene un campo «Código»—,
 * para descargarlo, imprimir su etiqueta o copiar el enlace. Lo que hace cada
 * uno al escanearlo está escrito ahí mismo.
 */
export function RecordQrButton({
    listId,
    recordId,
    fields,
    listSettings,
    compact = false,
}: {
    listId: number;
    recordId: number;
    fields: FieldEntity[];
    listSettings?: Record<string, unknown> | null;
    compact?: boolean;
}): JSX.Element | null {
    const isGuest = useIsGuest();
    const [open, setOpen] = useState(false);
    if (isGuest) return null;
    const label = __('Código QR');
    return (
        <>
            {compact ? (
                <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={() => setOpen(true)} data-testid="record-qr" data-tour="record-qr">
                    <QrCode className="imcrm-h-4 imcrm-w-4" />
                </Button>
            ) : (
                <Button variant="outline" className="imcrm-gap-2" onClick={() => setOpen(true)} data-testid="record-qr" data-tour="record-qr">
                    <QrCode className="imcrm-h-4 imcrm-w-4" />
                    {label}
                </Button>
            )}
            {open && <RecordQrDialog listId={listId} recordId={recordId} fields={fields} listSettings={listSettings} onClose={() => setOpen(false)} />}
        </>
    );
}

export function RecordQrDialog({
    listId,
    recordId,
    fields,
    listSettings,
    onClose,
}: {
    listId: number;
    recordId: number;
    fields: FieldEntity[];
    listSettings?: Record<string, unknown> | null;
    onClose: () => void;
}): JSX.Element {
    const toast = useToast();
    const q = useQuery({
        queryKey: ['record-qr', listId, recordId] as const,
        queryFn: () => api.recordQr(listId, recordId),
        retry: false,
        staleTime: 5 * 60_000,
    });
    const info = q.data;
    const [mode, setMode] = useState<'link' | 'code'>('link');
    const [copied, setCopied] = useState(false);
    const [printing, setPrinting] = useState(false);
    const useCode = mode === 'code' && info?.code;
    const imageUrl = info ? localQrUrl(useCode ? info.code!.qr_url : info.link_qr_url) : '';
    const imageBig = imageUrl ? `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}s=720` : '';

    const copy = async (): Promise<void> => {
        if (!info) return;
        try {
            await navigator.clipboard.writeText(useCode ? info.code!.value : info.link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error(__('No se pudo copiar'));
        }
    };

    const downloadImage = async (): Promise<void> => {
        if (!info) return;
        try {
            const res = await fetch(imageBig, { credentials: 'omit' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const base = (useCode ? info.code!.value : info.title).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || `registro-${recordId}`;
            a.download = `QR - ${base}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
            toast.error(__('No se pudo descargar la imagen'), err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-max-h-[92vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md imcrm-overflow-y-auto imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="imcrm-record-qr-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Código QR del registro')}</Dialog.Title>
                            <Dialog.Description className="imcrm-truncate imcrm-text-sm imcrm-text-muted-foreground">
                                {info ? info.title : q.isError ? __('No se pudo cargar') : __('Cargando…')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" aria-label={__('Cerrar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>

                    {q.isError && (
                        <p className="imcrm-mt-4 imcrm-text-sm imcrm-text-destructive">
                            {q.error instanceof CloudApiError ? q.error.message : __('No se pudo armar el código QR.')}
                        </p>
                    )}

                    {info && (
                        <>
                            {info.code && (
                                <div className="imcrm-mt-4 imcrm-inline-flex imcrm-w-full imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-0.5" role="radiogroup" aria-label={__('Qué guarda el QR')}>
                                    {(['link', 'code'] as const).map((m) => (
                                        <button
                                            key={m}
                                            type="button"
                                            role="radio"
                                            aria-checked={mode === m}
                                            onClick={() => setMode(m)}
                                            className={cn(
                                                'imcrm-flex-1 imcrm-truncate imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-font-medium',
                                                mode === m ? 'imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-text-muted-foreground hover:imcrm-bg-accent',
                                            )}
                                            data-testid={`imcrm-record-qr-mode-${m}`}
                                        >
                                            {m === 'link' ? __('Enlace a la ficha') : sprintf(__('Su «%s»'), info.code!.field_label)}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className="imcrm-mt-4 imcrm-flex imcrm-justify-center">
                                <div className="imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-white imcrm-p-3">
                                    <img src={imageUrl} alt={__('Código QR')} width={208} height={208} className="imcrm-block imcrm-h-52 imcrm-w-52" data-testid="imcrm-record-qr-image" />
                                </div>
                            </div>
                            <p className="imcrm-mt-2 imcrm-break-all imcrm-text-center imcrm-font-mono imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-record-qr-content">
                                {useCode ? info.code!.value : info.link}
                            </p>

                            <div className="imcrm-mt-3 imcrm-rounded-lg imcrm-bg-muted/60 imcrm-p-3 imcrm-text-xs imcrm-leading-relaxed imcrm-text-muted-foreground">
                                {useCode
                                    ? sprintf(
                                          __('Guarda «%1$s». Al escanearlo con el escáner de la app se busca por el campo «%2$s», igual que un código de barras de fábrica.'),
                                          info.code!.value,
                                          info.code!.field_label,
                                      )
                                    : __('Al escanearlo con el escáner de la app se abre esta ficha. Con la cámara del teléfono también la abre, a quien tiene cuenta en la empresa: los demás ven la pantalla de entrar.')}
                            </div>

                            <div className="imcrm-mt-4 imcrm-grid imcrm-grid-cols-3 imcrm-gap-2">
                                <Button variant="outline" size="sm" className="imcrm-flex-col imcrm-gap-1 imcrm-py-2 imcrm-h-auto" onClick={() => void downloadImage()} data-testid="imcrm-record-qr-download">
                                    <Download className="imcrm-h-4 imcrm-w-4" />
                                    {__('Imagen')}
                                </Button>
                                <Button variant="outline" size="sm" className="imcrm-flex-col imcrm-gap-1 imcrm-py-2 imcrm-h-auto" onClick={() => setPrinting(true)} data-testid="imcrm-record-qr-print">
                                    <Printer className="imcrm-h-4 imcrm-w-4" />
                                    {__('Etiqueta')}
                                </Button>
                                <Button variant="outline" size="sm" className="imcrm-flex-col imcrm-gap-1 imcrm-py-2 imcrm-h-auto" onClick={() => void copy()} data-testid="imcrm-record-qr-copy">
                                    {copied ? <Check className="imcrm-h-4 imcrm-w-4" /> : <Copy className="imcrm-h-4 imcrm-w-4" />}
                                    {copied ? __('¡Copiado!') : useCode ? __('Copiar código') : __('Copiar enlace')}
                                </Button>
                            </div>

                            <p className="imcrm-mt-4 imcrm-text-xs imcrm-text-muted-foreground">
                                {__('En un correo, un WhatsApp o un PDF de una automatización usa la variable')}{' '}
                                <code className="imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-py-0.5 imcrm-font-mono">{'{{registro.qr}}'}</code>{' '}
                                {__('(la imagen de este QR) o')}{' '}
                                <code className="imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-py-0.5 imcrm-font-mono">{'{{registro.enlace}}'}</code>.
                            </p>
                        </>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
            {printing && info && (
                <Suspense fallback={null}>
                    <RecordLabelsDialog listId={listId} fields={fields} listSettings={listSettings} target={{ ids: [recordId] }} count={1} onClose={() => setPrinting(false)} />
                </Suspense>
            )}
        </Dialog.Root>
    );
}
