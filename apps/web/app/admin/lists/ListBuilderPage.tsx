import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useDeleteList, useList, useUpdateList } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';

import { AppearancePanel } from './AppearancePanel';
import { FieldBuilder } from './FieldBuilder';
import { MaintenancePanel } from './MaintenancePanel';
import { PermissionsPanel } from './PermissionsPanel';
import { PortalConfigPanel } from './PortalConfigPanel';
import { PublicVisibilityPanel } from './PublicVisibilityPanel';
import { SlugEditor } from './SlugEditor';

export function ListBuilderPage(): JSX.Element {
    const { listSlug } = useParams<{ listSlug: string }>();
    const navigate = useNavigate();
    const list = useList(listSlug);
    const update = useUpdateList(list.data?.id ?? listSlug ?? '');
    const remove = useDeleteList();

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [slug, setSlug] = useState('');
    const [slugDirty, setSlugDirty] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        if (list.data) {
            setName(list.data.name);
            setDescription(list.data.description ?? '');
            setSlug(list.data.slug);
            setSlugDirty(false);
        }
    }, [list.data]);

    const handleSave = async (): Promise<void> => {
        if (!list.data) return;
        setSubmitError(null);
        try {
            const updated = await update.mutateAsync({
                name: name.trim(),
                description: description.trim() || null,
                slug: slug !== list.data.slug ? slug : undefined,
            });
            // Si el slug cambió, navegamos a la URL nueva (queda más limpio).
            if (updated.slug !== list.data.slug) {
                navigate(`/lists/${updated.slug}/edit`, { replace: true });
            }
        } catch (err) {
            setSubmitError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    const handleDelete = async (): Promise<void> => {
        if (!list.data) return;
        const message = sprintf(
            /* translators: %s: list name */
            __('¿Eliminar la lista "%s"? Los datos se preservan a menos que pidas purgarlos.'),
            list.data.name,
        );
        if (!confirm(message)) {
            return;
        }
        await remove.mutateAsync({ idOrSlug: list.data.id });
        navigate('/lists');
    };

    if (list.isLoading) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-12 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando lista…')}
            </div>
        );
    }

    if (list.isError || !list.data) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-3">
                <Button variant="ghost" size="sm" onClick={() => navigate('/lists')} className="imcrm-gap-2">
                    <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                    {__('Volver a listas')}
                </Button>
                <p className="imcrm-text-sm imcrm-text-destructive">
                    {listSlug
                        ? sprintf(
                              /* translators: %s: list slug */
                              __('No se pudo cargar la lista "%s".'),
                              listSlug,
                          )
                        : __('No se pudo cargar la lista.')}
                </p>
            </div>
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6">
            <header className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-4">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate('/lists')}
                        className="imcrm-gap-2 imcrm-self-start imcrm-text-muted-foreground"
                    >
                        <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                        {__('Listas')}
                    </Button>
                    <h1 className="imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight">
                        {list.data.name}
                    </h1>
                </div>
                <div className="imcrm-flex imcrm-gap-2">
                    <Button
                        variant="outline"
                        onClick={() => navigate(`/lists/${list.data.slug}/records`)}
                    >
                        {__('Ver registros')}
                    </Button>
                    <Button
                        variant="outline"
                        className="imcrm-gap-2 imcrm-text-destructive hover:imcrm-text-destructive"
                        onClick={handleDelete}
                    >
                        <Trash2 className="imcrm-h-4 imcrm-w-4" />
                        {__('Eliminar')}
                    </Button>
                </div>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle>{__('General')}</CardTitle>
                    <CardDescription>{__('Datos básicos y slug de la lista.')}</CardDescription>
                </CardHeader>
                <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                    <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-4 md:imcrm-grid-cols-2">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="list-name">{__('Nombre')}</Label>
                            <Input
                                id="list-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </div>
                        <SlugEditor
                            type="list"
                            value={slug}
                            onChange={setSlug}
                            isDirty={slugDirty}
                            onDirty={() => setSlugDirty(true)}
                            currentSlug={list.data.slug}
                        />
                    </div>

                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label htmlFor="list-description">{__('Descripción')}</Label>
                        <Textarea
                            id="list-description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                        />
                    </div>

                    {submitError !== null && (
                        <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                            {submitError}
                        </div>
                    )}

                    {list.data.table_suffix && (
                        <details className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                            <summary className="imcrm-cursor-pointer imcrm-font-medium">
                                {__('Configuración avanzada')}
                            </summary>
                            <div className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <span>
                                    {__('Sufijo de tabla (read-only):')}{' '}
                                    <code className="imcrm-font-mono">{list.data.table_suffix}</code>
                                </span>
                            </div>
                        </details>
                    )}

                    <div className="imcrm-flex imcrm-justify-end">
                        <Button onClick={handleSave} disabled={update.isPending} className="imcrm-gap-2">
                            <Save className="imcrm-h-4 imcrm-w-4" />
                            {update.isPending ? __('Guardando…') : __('Guardar cambios')}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="imcrm-pt-5">
                    <FieldBuilder listId={list.data.id} />
                </CardContent>
            </Card>

            <AppearancePanel list={list.data} />
            <PermissionsPanel listId={list.data.id} />
            <PublicVisibilityPanel list={list.data} />
            <PortalConfigPanel list={list.data} />
            <MaintenancePanel listId={list.data.id} />
        </div>
    );
}
