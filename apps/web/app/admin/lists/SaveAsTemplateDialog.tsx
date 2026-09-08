import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { LayoutTemplate, Loader2, X } from 'lucide-react';
import { TEMPLATE_CATEGORIES, type TemplateCategory } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useCreateListTemplate } from '@/hooks/useListTemplates';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ListSummary } from '@/types/list';

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
    ventas: 'Ventas',
    clientes: 'Clientes',
    proyectos: 'Proyectos',
    operaciones: 'Operaciones',
    finanzas: 'Finanzas',
    personas: 'Personas',
    otros: 'Otros',
};

/**
 * "Guardar como plantilla" (v0.1.166): la lista actual pasa a la galería
 * del workspace, con nombre, descripción y categoría propios, y con la misma
 * elección de qué incluir que al duplicar. Es la mitad "Save as template"
 * del Template Center de ClickUp.
 */
interface Props {
    list: ListSummary;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function SaveAsTemplateDialog({ list, open, onOpenChange }: Props): JSX.Element {
    const create = useCreateListTemplate();
    const toast = useToast();

    const [name, setName] = useState(list.name);
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState<TemplateCategory>('otros');
    const [views, setViews] = useState(true);
    const [automations, setAutomations] = useState(true);
    const [settings, setSettings] = useState(true);
    const [records, setRecords] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setName(list.name);
        setDescription('');
        setCategory('otros');
        setViews(true);
        setAutomations(true);
        setSettings(true);
        setRecords(false);
        setError(null);
    }, [open, list.name]);

    const submit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        try {
            const tpl = await create.mutateAsync({
                list_id: list.id,
                name: name.trim(),
                description: description.trim() || null,
                category,
                include: { views, automations, settings, records },
            });
            toast.success(__('Plantilla guardada'), tpl.name);
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg',
                    )}
                    style={{ transform: 'translate(-50%, -50%)' }}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Guardar como plantilla')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Queda en la galería del workspace para crear listas iguales a ésta.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <form onSubmit={submit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="tpl-name">{__('Nombre de la plantilla')}</Label>
                            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="tpl-desc">{__('Descripción (opcional)')}</Label>
                            <Textarea id="tpl-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={__('Para qué sirve y cuándo usarla')} />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="tpl-cat">{__('Categoría')}</Label>
                            <Select id="tpl-cat" value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory)}>
                                {TEMPLATE_CATEGORIES.map((c) => (
                                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                                ))}
                            </Select>
                        </div>

                        <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
                            <legend className="imcrm-px-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                {__('Incluir')}
                            </legend>
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input type="checkbox" checked={views} onChange={(e) => setViews(e.target.checked)} />
                                {__('Vistas guardadas')}
                            </label>
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input type="checkbox" checked={automations} onChange={(e) => setAutomations(e.target.checked)} />
                                {__('Automatizaciones')}
                            </label>
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input type="checkbox" checked={settings} onChange={(e) => setSettings(e.target.checked)} />
                                {__('Ajustes (permisos, apariencia, plantillas de ficha)')}
                            </label>
                            <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                                <input type="checkbox" checked={records} onChange={(e) => setRecords(e.target.checked)} className="imcrm-mt-0.5" />
                                <span className="imcrm-flex imcrm-flex-col">
                                    {__('Registros como datos de ejemplo')}
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Hasta 500. Quien use la plantilla puede omitirlos.')}</span>
                                </span>
                            </label>
                        </fieldset>

                        {error !== null && (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">{error}</div>
                        )}

                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline">{__('Cancelar')}</Button>
                            </Dialog.Close>
                            <Button type="submit" disabled={name.trim() === '' || create.isPending} className="imcrm-gap-2">
                                {create.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />}
                                {create.isPending ? __('Guardando…') : __('Guardar plantilla')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
