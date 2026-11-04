import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Copy, ExternalLink, FilePen, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { CloudApiError } from '@/lib/cloud/client';
import { useIsGuest } from '@/lib/guest';
import { __, sprintf } from '@/lib/i18n';
import { formatLongDate } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { createEditLink, useEditLinkForms, type EditLinkForm } from './useForms';

/**
 * v0.1.360 — «Enlace para actualizar» (modal, página y ficha del registro): un
 * enlace firmado que abre un formulario con lo que este registro ya tiene; al
 * enviarlo, se actualiza este registro. Aparece sólo si algún formulario de la
 * lista lo permite (y quien mira puede editar registros).
 */
export function RecordEditLinkButton({ listId, recordId, compact = false }: { listId: number; recordId: number; compact?: boolean }): JSX.Element | null {
    const isGuest = useIsGuest();
    const forms = useEditLinkForms(isGuest ? undefined : listId);
    const [open, setOpen] = useState(false);
    if (isGuest || !forms.data || forms.data.length === 0) return null;
    const label = __('Enlace para actualizar');
    return (
        <>
            {compact ? (
                <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={() => setOpen(true)} data-testid="record-edit-link" data-tour="record-edit-link">
                    <FilePen className="imcrm-h-4 imcrm-w-4" />
                </Button>
            ) : (
                <Button variant="outline" className="imcrm-gap-2" onClick={() => setOpen(true)} data-testid="record-edit-link" data-tour="record-edit-link">
                    <FilePen className="imcrm-h-4 imcrm-w-4" />
                    {label}
                </Button>
            )}
            {open && <EditLinkDialog listId={listId} recordId={recordId} forms={forms.data} onClose={() => setOpen(false)} />}
        </>
    );
}

function EditLinkDialog({ listId, recordId, forms, onClose }: { listId: number; recordId: number; forms: EditLinkForm[]; onClose: () => void }): JSX.Element {
    const toast = useToast();
    const [formId, setFormId] = useState<number>(forms[0]!.id);
    const [link, setLink] = useState<{ formId: number; url: string; expires_at: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const current = link && link.formId === formId ? link : null;

    const make = async (): Promise<void> => {
        setBusy(true);
        setError(null);
        try {
            const out = await createEditLink(listId, formId, recordId);
            setLink({ formId, ...out });
            try {
                await navigator.clipboard.writeText(out.url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
            } catch {
                // Sin permiso del portapapeles: el enlace queda a la vista para copiarlo.
            }
        } catch (err) {
            setError(err instanceof CloudApiError ? err.message : __('No se pudo crear el enlace.'));
        } finally {
            setBusy(false);
        }
    };

    const copy = async (): Promise<void> => {
        if (!current) return;
        try {
            await navigator.clipboard.writeText(current.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error(__('No se pudo copiar'));
        }
    };

    return (
        <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-max-h-[92vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md imcrm-overflow-y-auto imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="record-edit-link-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Enlace para actualizar')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Abre el formulario con lo que este registro ya tiene. Lo que la persona cambie y envíe se guarda en este registro.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" aria-label={__('Cerrar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>

                    {forms.length > 1 && (
                        <div className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-1.5" role="radiogroup" aria-label={__('Con qué formulario')}>
                            <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{__('Con qué formulario')}</span>
                            {forms.map((f) => (
                                <button
                                    key={f.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={formId === f.id}
                                    onClick={() => setFormId(f.id)}
                                    className={cn(
                                        'imcrm-rounded-lg imcrm-border imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-sm',
                                        formId === f.id ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-font-medium' : 'imcrm-border-border hover:imcrm-bg-accent',
                                    )}
                                    data-testid={`record-edit-link-form-${f.id}`}
                                >
                                    {f.title}
                                </button>
                            ))}
                        </div>
                    )}

                    {current ? (
                        <div className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <Input readOnly value={current.url} onFocus={(e) => e.currentTarget.select()} className="imcrm-font-mono imcrm-text-xs" data-testid="record-edit-link-url" />
                            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                                <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => void copy()} data-testid="record-edit-link-copy">
                                    {copied ? <Check className="imcrm-h-4 imcrm-w-4" /> : <Copy className="imcrm-h-4 imcrm-w-4" />}
                                    {copied ? __('¡Copiado!') : __('Copiar enlace')}
                                </Button>
                                <Button variant="outline" size="sm" className="imcrm-gap-1.5" asChild>
                                    <a href={current.url} target="_blank" rel="noopener noreferrer" data-testid="record-edit-link-open">
                                        <ExternalLink className="imcrm-h-4 imcrm-w-4" />
                                        {__('Abrir')}
                                    </a>
                                </Button>
                            </div>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {sprintf(__('Sirve hasta el %s. Mándalo sólo a quien es dueño de estos datos: quien lo tenga puede verlos y cambiarlos.'), formatLongDate(new Date(current.expires_at)))}
                            </p>
                        </div>
                    ) : (
                        <Button className="imcrm-mt-4 imcrm-w-full imcrm-gap-1.5" onClick={() => void make()} disabled={busy} data-testid="record-edit-link-create">
                            <Copy className="imcrm-h-4 imcrm-w-4" />
                            {busy ? __('Creando…') : __('Crear y copiar el enlace')}
                        </Button>
                    )}
                    {error && <p className="imcrm-mt-3 imcrm-text-sm imcrm-text-destructive">{error}</p>}

                    <p className="imcrm-mt-4 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Para que salga solo en un correo, WhatsApp o SMS de una automatización, usa la variable que aparece en los ajustes del formulario, en «Actualizar un registro».')}
                    </p>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
