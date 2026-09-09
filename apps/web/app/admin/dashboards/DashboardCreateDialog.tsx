import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { FilePlus2, LayoutTemplate, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useCreateDashboard } from '@/hooks/useDashboards';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { DashboardVisibility } from '@/types/dashboard';

import { DashboardTemplateGallery } from './DashboardTemplateGallery';
import { DashboardVisibilityFields } from './DashboardVisibilityFields';

interface DashboardCreateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

type Mode = 'blank' | 'template';

/**
 * "Nuevo dashboard": en blanco (el contenedor vacío; los widgets se añaden
 * en la propia página) o **desde una plantilla** (v0.1.167): la galería
 * elige la lista y mapea los roles de campo, y el tablero nace con sus
 * widgets funcionando.
 */
export function DashboardCreateDialog({ open, onOpenChange }: DashboardCreateDialogProps): JSX.Element {
    // v0.1.168 — la plantilla primero y por defecto; "En blanco" segunda.
    const [mode, setMode] = useState<Mode>('template');
    const navigate = useNavigate();
    const toast = useToast();

    useEffect(() => {
        if (!open) setMode('template');
    }, [open]);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
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
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Nuevo dashboard')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {mode === 'blank'
                                    ? __('Crea el contenedor; añade widgets desde la propia página del dashboard.')
                                    : __('Elegí una plantilla y la lista sobre la que se arma: nace con los widgets listos.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <div className="imcrm-mt-4 imcrm-grid imcrm-grid-cols-2 imcrm-gap-1 imcrm-rounded-lg imcrm-bg-muted imcrm-p-1">
                        <ModeButton active={mode === 'template'} onClick={() => setMode('template')} icon={LayoutTemplate} label={__('Plantilla')} />
                        <ModeButton active={mode === 'blank'} onClick={() => setMode('blank')} icon={FilePlus2} label={__('En blanco')} />
                    </div>

                    <div className="imcrm-mt-4 imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col">
                        {mode === 'blank' ? (
                            <BlankForm open={open} onDone={() => onOpenChange(false)} />
                        ) : (
                            <DashboardTemplateGallery
                                onCreated={(dashboard, warnings) => {
                                    toast.success(__('Dashboard creado desde la plantilla'), dashboard.name);
                                    for (const w of warnings) toast.error(__('Un widget no se pudo crear'), w);
                                    onOpenChange(false);
                                    navigate(`/dashboards/${dashboard.id}`);
                                }}
                            />
                        )}
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

function BlankForm({ open, onDone }: { open: boolean; onDone: () => void }): JSX.Element {
    const navigate = useNavigate();
    const create = useCreateDashboard();
    const { reset: resetCreate } = create;
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [visibility, setVisibility] = useState<DashboardVisibility>('workspace');
    const [allowedRoles, setAllowedRoles] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setName('');
            setDescription('');
            setVisibility('workspace');
            setAllowedRoles([]);
            setError(null);
            resetCreate();
        }
    }, [open, resetCreate]);

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        try {
            const dashboard = await create.mutateAsync({
                name: name.trim(),
                description: description.trim() === '' ? null : description.trim(),
                visibility,
                allowed_roles: visibility === 'roles' ? allowedRoles : [],
                widgets: [],
            });
            onDone();
            navigate(`/dashboards/${dashboard.id}`);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    return (
        <form onSubmit={handleSubmit} className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="db-name">{__('Nombre')}</Label>
                <Input id="db-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={__('Ej. Pipeline comercial')} autoFocus />
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="db-desc">{__('Descripción (opcional)')}</Label>
                <Textarea id="db-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <DashboardVisibilityFields
                idPrefix="db-create"
                visibility={visibility}
                allowedRoles={allowedRoles}
                onVisibilityChange={setVisibility}
                onAllowedRolesChange={setAllowedRoles}
            />
            {error !== null && (
                <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">{error}</div>
            )}
            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                <Dialog.Close asChild>
                    <Button type="button" variant="outline">{__('Cancelar')}</Button>
                </Dialog.Close>
                <Button type="submit" disabled={name.trim() === '' || create.isPending}>
                    {create.isPending ? __('Creando…') : __('Crear')}
                </Button>
            </div>
        </form>
    );
}
