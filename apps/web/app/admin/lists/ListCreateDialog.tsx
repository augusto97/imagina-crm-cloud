import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateList } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { SlugEditor } from './SlugEditor';

interface ListCreateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ListCreateDialog({ open, onOpenChange }: ListCreateDialogProps): JSX.Element {
    const navigate = useNavigate();
    const create = useCreateList();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [slug, setSlug] = useState('');
    const [slugDirty, setSlugDirty] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            // Reset state al cerrar.
            setName('');
            setDescription('');
            setSlug('');
            setSlugDirty(false);
            setSubmitError(null);
            create.reset();
        }
    }, [open, create]);

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setSubmitError(null);
        try {
            const list = await create.mutateAsync({
                name: name.trim(),
                slug: slug || undefined,
                description: description.trim() || null,
            });
            onOpenChange(false);
            navigate(`/lists/${list.slug}/edit`);
        } catch (err) {
            if (err instanceof ApiError) {
                setSubmitError(err.message);
            } else if (err instanceof Error) {
                setSubmitError(err.message);
            }
        }
    };

    const canSubmit = name.trim() !== '' && !create.isPending;

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
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-full imcrm-max-w-md',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {__('Nueva lista')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Define el nombre y los campos llegarán después.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <form onSubmit={handleSubmit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4">
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
                            <Label htmlFor="new-list-description">
                                {__('Descripción (opcional)')}
                            </Label>
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
                                <Button type="button" variant="outline">
                                    {__('Cancelar')}
                                </Button>
                            </Dialog.Close>
                            <Button type="submit" disabled={!canSubmit}>
                                {create.isPending ? __('Creando…') : __('Crear lista')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
