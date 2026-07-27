import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useDeleteList, useUpdateList } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import type { ListSummary } from '@/types/list';

import { SlugEditor } from './SlugEditor';

interface Props {
    list: ListSummary;
}

/**
 * Sección "General": nombre, dirección web (slug) y descripción.
 *
 * Antes vivía inline en la página del builder junto con el resto de los
 * paneles; se extrajo con el rediseño de v0.1.126. El bloque de
 * "configuración avanzada" (sufijo de tabla) desapareció: era jerga
 * heredada del plugin que no significaba nada para el usuario.
 */
export function GeneralPanel({ list }: Props): JSX.Element {
    const navigate = useNavigate();
    const update = useUpdateList(list.id);
    const toast = useToast();

    const [name, setName] = useState(list.name);
    const [description, setDescription] = useState(list.description ?? '');
    const [slug, setSlug] = useState(list.slug);
    const [slugDirty, setSlugDirty] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        setName(list.name);
        setDescription(list.description ?? '');
        setSlug(list.slug);
        setSlugDirty(false);
    }, [list]);

    const dirty = name !== list.name || description !== (list.description ?? '') || slug !== list.slug;

    const handleSave = async (): Promise<void> => {
        setSubmitError(null);
        try {
            const updated = await update.mutateAsync({
                name: name.trim(),
                description: description.trim() || null,
                slug: slug !== list.slug ? slug : undefined,
            });
            toast.success(__('Cambios guardados'));
            // El slug es parte de la URL: si cambió, movemos la página a la
            // dirección nueva (los enlaces viejos siguen funcionando gracias
            // al historial de slugs — v0.1.117).
            if (updated.slug !== list.slug) {
                navigate(`/lists/${updated.slug}/edit?s=general`, { replace: true });
            }
        } catch (err) {
            setSubmitError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-4 md:imcrm-grid-cols-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="list-name">{__('Nombre')}</Label>
                    <Input id="list-name" value={name} onChange={(e) => setName(e.target.value)} />
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Es el nombre que se ve en el menú lateral.')}
                    </p>
                </div>
                <SlugEditor
                    type="list"
                    label={__('Dirección web')}
                    value={slug}
                    onChange={setSlug}
                    isDirty={slugDirty}
                    onDirty={() => setSlugDirty(true)}
                    currentSlug={list.slug}
                />
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="list-description">{__('Descripción')}</Label>
                <Textarea
                    id="list-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder={__('Para qué sirve esta lista. Opcional.')}
                />
            </div>

            {submitError !== null && (
                <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                    {submitError}
                </div>
            )}

            <div className="imcrm-flex imcrm-justify-end">
                <Button
                    onClick={() => void handleSave()}
                    disabled={!dirty || update.isPending}
                    className="imcrm-gap-2"
                >
                    <Save className="imcrm-h-4 imcrm-w-4" />
                    {update.isPending ? __('Guardando…') : __('Guardar cambios')}
                </Button>
            </div>
        </div>
    );
}

/**
 * Zona de peligro: eliminar la lista. Vive al FINAL de la sección
 * General, no en el encabezado de la página — antes el botón "Eliminar"
 * estaba arriba a la derecha, al lado de "Ver registros", que es
 * exactamente donde no querés una acción irreversible.
 */
export function DangerZonePanel({ list }: Props): JSX.Element {
    const navigate = useNavigate();
    const remove = useDeleteList();
    const confirm = useConfirm();
    const toast = useToast();

    const handleDelete = async (): Promise<void> => {
        const ok = await confirm({
            title: sprintf(
                /* translators: %s: list name */
                __('¿Eliminar la lista "%s"?'),
                list.name,
            ),
            description: __(
                'Se quitará del menú junto con sus campos, vistas y automatizaciones. Los registros dejan de ser accesibles desde la app.',
            ),
            confirmLabel: __('Eliminar lista'),
            destructive: true,
        });
        if (!ok) return;
        await remove.mutateAsync({ idOrSlug: list.id });
        toast.success(__('Lista eliminada'));
        navigate('/lists');
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-4 sm:imcrm-flex-row sm:imcrm-items-center sm:imcrm-justify-between">
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
                <h3 className="imcrm-text-sm imcrm-font-semibold imcrm-text-foreground">
                    {__('Eliminar esta lista')}
                </h3>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('No se puede deshacer. Te pedimos confirmación antes.')}
                </p>
            </div>
            <Button
                variant="outline"
                onClick={() => void handleDelete()}
                disabled={remove.isPending}
                className="imcrm-shrink-0 imcrm-gap-2 imcrm-border-destructive/40 imcrm-text-destructive hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
            >
                <Trash2 className="imcrm-h-4 imcrm-w-4" />
                {__('Eliminar lista')}
            </Button>
        </div>
    );
}
