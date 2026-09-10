import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, FilePlus2, LayoutTemplate, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useCreateList } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { DuplicateListForm } from './DuplicateListDialog';
import { SlugEditor } from './SlugEditor';
import { TemplateGallery } from './TemplateGallery';

interface ListCreateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * v0.1.173 — la lista nace DENTRO de esta carpeta (menú contextual de la
     * carpeta): en blanco, desde plantilla o duplicando, las tres la respetan.
     */
    groupId?: number;
    groupName?: string;
}

type Mode = 'blank' | 'template' | 'duplicate';

/**
 * "Nueva lista" (v0.1.166): tres caminos, como al crear en ClickUp o
 * Airtable — **en blanco**, **desde una plantilla** (galería del sistema +
 * las del workspace, con vista previa) o **duplicando una lista** que ya
 * existe. El diálogo se ensancha en la galería: con dos columnas de
 * plantillas y la vista previa al lado, un modal angosto no sirve.
 */
export function ListCreateDialog({ open, onOpenChange, groupId, groupName }: ListCreateDialogProps): JSX.Element {
    // v0.1.168 — la plantilla es la PRIMERA opción y la que se abre por
    // defecto (pedido del usuario); "En blanco" queda segunda.
    const [mode, setMode] = useState<Mode>('template');
    const navigate = useNavigate();
    const toast = useToast();

    useEffect(() => {
        if (!open) setMode('template');
    }, [open]);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay
                    className={cn(
                        'imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm',
                        'imcrm-animate-imcrm-fade-in',
                    )}
                />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[88vh] imcrm-w-[calc(100%-1.5rem)] imcrm-flex-col',
                        mode === 'template' ? 'imcrm-max-w-4xl' : 'imcrm-max-w-md',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg imcrm-transition-[max-width]',
                    )}
                    style={{ transform: 'translate(-50%, -50%)' }}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {groupName !== undefined
                                    ? sprintf(
                                          /* translators: %s: folder name */
                                          __('Nueva lista en «%s»'),
                                          groupName,
                                      )
                                    : __('Nueva lista')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {mode === 'blank' && __('Define el nombre y los campos llegarán después.')}
                                {mode === 'template' && __('Elegí una plantilla: nace con campos, vistas y automatizaciones listos.')}
                                {mode === 'duplicate' && __('Una copia de una lista que ya tenés.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    {/* Selector de camino */}
                    <div className="imcrm-mt-4 imcrm-grid imcrm-grid-cols-3 imcrm-gap-1 imcrm-rounded-lg imcrm-bg-muted imcrm-p-1">
                        <ModeButton active={mode === 'template'} onClick={() => setMode('template')} icon={LayoutTemplate} label={__('Plantilla')} />
                        <ModeButton active={mode === 'blank'} onClick={() => setMode('blank')} icon={FilePlus2} label={__('En blanco')} />
                        <ModeButton active={mode === 'duplicate'} onClick={() => setMode('duplicate')} icon={Copy} label={__('Duplicar')} />
                    </div>

                    <div className="imcrm-mt-4 imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col">
                        {mode === 'blank' && <BlankForm open={open} groupId={groupId} onDone={() => onOpenChange(false)} />}
                        {mode === 'template' && (
                            <TemplateGallery
                                groupId={groupId}
                                onCreated={(lists, warnings) => {
                                    const first = lists[0];
                                    toast.success(
                                        lists.length > 1 ? __('Listas creadas desde la plantilla') : __('Lista creada desde la plantilla'),
                                        lists.map((l) => l.name).join(', '),
                                    );
                                    for (const w of warnings) toast.error(__('Algo no se pudo crear'), w);
                                    onOpenChange(false);
                                    if (first) navigate(`/lists/${first.slug}/records`);
                                }}
                            />
                        )}
                        {mode === 'duplicate' && <DuplicateListForm groupId={groupId} onDone={() => onOpenChange(false)} />}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function ModeButton({
    active,
    onClick,
    icon: Icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                'imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-sm imcrm-transition-colors',
                active
                    ? 'imcrm-bg-card imcrm-font-medium imcrm-text-foreground imcrm-shadow-imcrm-sm imcrm-ring-1 imcrm-ring-border'
                    : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
            )}
        >
            <Icon className="imcrm-h-4 imcrm-w-4" />
            {label}
        </button>
    );
}

/** El alta en blanco de siempre (nombre, dirección web, descripción). */
function BlankForm({ open, groupId, onDone }: { open: boolean; groupId?: number; onDone: () => void }): JSX.Element {
    const navigate = useNavigate();
    const create = useCreateList();
    const { reset: resetCreate } = create;
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [slug, setSlug] = useState('');
    const [slugDirty, setSlugDirty] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            // Reset state al cerrar. Dep en `resetCreate` (estable en React
            // Query), NO en el objeto `create` (nueva identidad cada render →
            // provocaba un loop infinito de renders).
            setName('');
            setDescription('');
            setSlug('');
            setSlugDirty(false);
            setSubmitError(null);
            resetCreate();
        }
    }, [open, resetCreate]);

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setSubmitError(null);
        try {
            const list = await create.mutateAsync({
                name: name.trim(),
                slug: slug || undefined,
                description: description.trim() || null,
                ...(groupId !== undefined ? { group_id: groupId } : {}),
            });
            onDone();
            navigate(`/lists/${list.slug}/edit`);
        } catch (err) {
            if (err instanceof ApiError || err instanceof Error) setSubmitError(err.message);
        }
    };

    const canSubmit = name.trim() !== '' && !create.isPending;

    return (
        <form onSubmit={handleSubmit} className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="new-list-name">{__('Nombre')}</Label>
                <Input
                    id="new-list-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={__('Ej. Clientes')}
                    autoFocus
                />
            </div>

            <SlugEditor
                type="list"
                sourceText={name}
                value={slug}
                onChange={setSlug}
                isDirty={slugDirty}
                onDirty={() => setSlugDirty(true)}
            />

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="new-list-description">{__('Descripción (opcional)')}</Label>
                <Textarea
                    id="new-list-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={__('¿Para qué usarás esta lista?')}
                    rows={3}
                />
            </div>

            {submitError !== null && (
                <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                    {submitError}
                </div>
            )}

            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                <Dialog.Close asChild>
                    <Button type="button" variant="outline">{__('Cancelar')}</Button>
                </Dialog.Close>
                <Button type="submit" disabled={!canSubmit}>
                    {create.isPending ? __('Creando…') : __('Crear lista')}
                </Button>
            </div>
        </form>
    );
}
