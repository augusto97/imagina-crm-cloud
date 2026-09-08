import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useDuplicateList } from '@/hooks/useListTemplates';
import { useLists } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Duplicar una lista (v0.1.166) — el "Duplicate" de ClickUp, con sus
 * opciones: la estructura (campos) va siempre; vistas, automatizaciones,
 * ajustes y registros se eligen. Con `sourceId` fijo se usa desde la
 * propia lista; sin él, el usuario elige cuál duplicar (pestaña de "Nueva
 * lista").
 */
interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Lista de origen fija (desde Ajustes de esa lista). */
    sourceId?: number;
}

export function DuplicateListDialog({ open, onOpenChange, sourceId }: Props): JSX.Element {
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
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Duplicar lista')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Los campos van siempre. Elegí qué más llevarte.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>
                    {open && (
                        <DuplicateListForm
                            sourceId={sourceId}
                            onDone={() => onOpenChange(false)}
                            className="imcrm-mt-4"
                        />
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/**
 * El formulario, reutilizable dentro del diálogo de "Nueva lista" (pestaña
 * Duplicar) y en el diálogo propio.
 */
export function DuplicateListForm({
    sourceId,
    onDone,
    className,
}: {
    sourceId?: number;
    onDone: () => void;
    className?: string;
}): JSX.Element {
    const lists = useLists();
    const duplicate = useDuplicateList();
    const navigate = useNavigate();
    const toast = useToast();

    const [chosen, setChosen] = useState<number | ''>(sourceId ?? '');
    const [name, setName] = useState('');
    const [views, setViews] = useState(true);
    const [automations, setAutomations] = useState(true);
    const [settings, setSettings] = useState(true);
    const [records, setRecords] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const source = (lists.data ?? []).find((l) => l.id === (chosen === '' ? -1 : chosen)) ?? null;

    // Nombre sugerido al elegir el origen (editable).
    useEffect(() => {
        if (source) setName(sprintf(
            /* translators: %s: nombre de la lista original */
            __('%s (copia)'),
            source.name,
        ));
    }, [source]);

    const submit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        if (!source) return;
        setError(null);
        try {
            const res = await duplicate.mutateAsync({
                listId: source.id,
                input: { name: name.trim() || undefined, include: { views, automations, settings, records } },
            });
            const copy = res.lists[0];
            toast.success(__('Lista duplicada'), copy?.name);
            for (const w of res.warnings) toast.error(__('Algo no se pudo copiar'), w);
            onDone();
            if (copy) navigate(`/lists/${copy.slug}/records`);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    return (
        <form onSubmit={submit} className={cn('imcrm-flex imcrm-flex-col imcrm-gap-4', className)}>
            {sourceId === undefined && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="dup-source">{__('Lista a duplicar')}</Label>
                    <Select
                        id="dup-source"
                        value={chosen === '' ? '' : String(chosen)}
                        onChange={(e) => setChosen(e.target.value === '' ? '' : Number(e.target.value))}
                    >
                        <option value="">{__('Elegí una lista…')}</option>
                        {(lists.data ?? []).map((l) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                    </Select>
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="dup-name">{__('Nombre de la copia')}</Label>
                <Input id="dup-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!source} />
            </div>

            <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
                <legend className="imcrm-px-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                    {__('Incluir')}
                </legend>
                <Check checked={views} onChange={setViews} label={__('Vistas guardadas')} />
                <Check checked={automations} onChange={setAutomations} label={__('Automatizaciones')} hint={__('Los webhooks entrantes reciben una URL nueva.')} />
                <Check checked={settings} onChange={setSettings} label={__('Ajustes')} hint={__('Permisos por rol, apariencia y plantillas de ficha. La publicación pública no se copia.')} />
                <Check checked={records} onChange={setRecords} label={__('Registros')} hint={__('Hasta 500. Los archivos adjuntos no se copian.')} />
            </fieldset>

            {error !== null && (
                <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">{error}</div>
            )}

            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                <Button type="submit" disabled={!source || name.trim() === '' || duplicate.isPending} className="imcrm-gap-2">
                    {duplicate.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Copy className="imcrm-h-4 imcrm-w-4" />}
                    {duplicate.isPending ? __('Duplicando…') : __('Duplicar')}
                </Button>
            </div>
        </form>
    );
}

function Check({
    checked,
    onChange,
    label,
    hint,
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    hint?: string;
}): JSX.Element {
    return (
        <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="imcrm-mt-0.5" />
            <span className="imcrm-flex imcrm-flex-col">
                <span>{label}</span>
                {hint && <span className="imcrm-text-xs imcrm-text-muted-foreground">{hint}</span>}
            </span>
        </label>
    );
}
