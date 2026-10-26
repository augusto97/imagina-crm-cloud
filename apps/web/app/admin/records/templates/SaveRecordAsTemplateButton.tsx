import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link } from 'react-router';
import { BookmarkPlus, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useTemplateFromRecord } from '@/hooks/useRecordTemplates';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { cn } from '@/lib/utils';

interface SaveRecordAsTemplateButtonProps {
    listId: number;
    listSlug?: string;
    recordId: number;
    /** Nombre sugerido (el título del registro). */
    title: string;
    compact?: boolean;
}

const PARTS = [
    { key: 'values', label: __('Los valores de los campos'), hint: __('Las fechas pasan a ser relativas a hoy (+N días).') },
    { key: 'subtasks', label: __('Sus subtareas'), hint: __('Con su responsable y sus fechas.') },
    { key: 'checklists', label: __('Sus checklists'), hint: __('Los ítems quedan sin marcar.') },
    { key: 'description', label: __('La descripción'), hint: null },
] as const;

type PartKey = (typeof PARTS)[number]['key'];

/**
 * C6 — «Guardar como plantilla» desde la ficha: toma los valores, las
 * subtareas, los checklists y la descripción de ESTE registro (lo que se
 * elija) y deja una plantilla de registro de la lista. Exige poder
 * administrar la lista o sus vistas.
 */
export function SaveRecordAsTemplateButton({ listId, listSlug, recordId, title, compact = false }: SaveRecordAsTemplateButtonProps): JSX.Element | null {
    const canManage = useCanAny(CAP.MANAGE_LISTS, CAP.MANAGE_VIEWS, 'workspace_admin');
    const save = useTemplateFromRecord(listId);
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [include, setInclude] = useState<Record<PartKey, boolean>>({ values: true, subtasks: true, checklists: true, description: true });
    const [error, setError] = useState<string | null>(null);
    if (!canManage) return null;

    const openDialog = (): void => {
        setName(title.trim() === '' ? __('Nueva plantilla') : title.slice(0, 120));
        setDescription('');
        setInclude({ values: true, subtasks: true, checklists: true, description: true });
        setError(null);
        setOpen(true);
    };

    const submit = (e: React.FormEvent): void => {
        e.preventDefault();
        if (name.trim() === '') {
            setError(__('Ponle un nombre a la plantilla.'));
            return;
        }
        save.mutate(
            { record_id: recordId, name: name.trim(), description: description.trim() || null, include },
            {
                onSuccess: (t) => {
                    setOpen(false);
                    toast.success(
                        sprintf(__('Se guardó la plantilla «%s»'), t.name),
                        __('Úsala en «Nuevo registro ▾ → Desde una plantilla». Se edita en los ajustes de la lista.'),
                    );
                },
                onError: (err) => setError(err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo guardar la plantilla.')),
            },
        );
    };

    return (
        <>
            <Button
                variant="ghost"
                size={compact ? 'icon' : 'sm'}
                onClick={openDialog}
                aria-label={__('Guardar como plantilla')}
                title={__('Guardar como plantilla')}
                className={cn(!compact && 'imcrm-gap-1.5')}
                data-testid="imcrm-save-record-template"
            >
                <BookmarkPlus className="imcrm-h-4 imcrm-w-4" />
                {!compact && __('Guardar como plantilla')}
            </Button>
            <Dialog.Root open={open} onOpenChange={setOpen}>
                <Dialog.Portal>
                    <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                    <Dialog.Content
                        className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg"
                        data-testid="imcrm-save-record-template-dialog"
                    >
                        <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                            <div className="imcrm-min-w-0">
                                <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Guardar como plantilla')}</Dialog.Title>
                                <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                    {__('Los registros que nazcan de esta plantilla traerán lo que marques aquí.')}
                                </Dialog.Description>
                            </div>
                            <Dialog.Close asChild>
                                <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                    <X className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                            </Dialog.Close>
                        </div>
                        <form onSubmit={submit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-3">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="rt-name">{__('Nombre')}</Label>
                                <Input id="rt-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="rt-desc">{__('Descripción (opcional)')}</Label>
                                <Input id="rt-desc" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder={__('Para qué sirve')} />
                            </div>
                            <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <legend className="imcrm-mb-1 imcrm-text-sm imcrm-font-medium">{__('Incluir')}</legend>
                                {PARTS.map((p) => (
                                    <label key={p.key} className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                                        <input
                                            type="checkbox"
                                            checked={include[p.key]}
                                            onChange={(e) => setInclude((s) => ({ ...s, [p.key]: e.target.checked }))}
                                            className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-accent-[hsl(var(--imcrm-primary))]"
                                        />
                                        <span>
                                            {p.label}
                                            {p.hint && <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{p.hint}</span>}
                                        </span>
                                    </label>
                                ))}
                            </fieldset>
                            {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
                            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                {listSlug ? (
                                    <Link to={`/lists/${listSlug}/edit?s=plantillas`} className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-underline" onClick={() => setOpen(false)}>
                                        {__('Ver las plantillas de la lista')}
                                    </Link>
                                ) : (
                                    <span />
                                )}
                                <div className="imcrm-flex imcrm-gap-2">
                                    <Dialog.Close asChild>
                                        <Button type="button" variant="outline">
                                            {__('Cancelar')}
                                        </Button>
                                    </Dialog.Close>
                                    <Button type="submit" disabled={save.isPending} className="imcrm-gap-2" data-testid="imcrm-save-record-template-submit">
                                        {save.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                                        {__('Guardar plantilla')}
                                    </Button>
                                </div>
                            </div>
                        </form>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </>
    );
}
