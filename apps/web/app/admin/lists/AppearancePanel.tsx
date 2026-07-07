import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, LayoutDashboard, Loader2, SlidersHorizontal, Sparkles, UserSquare2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useUpdateList } from '@/hooks/useLists';
import { recordsKeys } from '@/hooks/useRecords';
import { CRM_TEMPLATES, CUSTOM_TEMPLATE_ID, DEFAULT_TEMPLATE_ID } from '@/lib/crmTemplates';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ListSummary } from '@/types/list';

interface AppearancePanelProps {
    list: ListSummary;
}

type RecordLayout = 'classic' | 'crm';

/**
 * Panel "Apariencia" del list builder: define cómo se renderea la
 * página individual de cada registro de esta lista.
 *
 * - **Layout** (`settings.record_layout`): `classic` (form lineal) o
 *   `crm` (header + sidebar agrupado + timeline).
 * - **Plantilla CRM** (`settings.crm_template_id`): solo se muestra
 *   cuando el layout es CRM. Define qué campos van en qué slot del
 *   header / sidebar. Built-ins: auto, contact, deal, task, support.
 *   Cada plantilla aplica heurísticas distintas para distribuir
 *   campos — ej. "Venta" pone monto al frente; "Tarea" pone
 *   fecha como subtítulo.
 */
export function AppearancePanel({ list }: AppearancePanelProps): JSX.Element {
    const update = useUpdateList(list.id);
    const toast = useToast();
    const qc = useQueryClient();

    const settings = list.settings as { record_layout?: RecordLayout; crm_template_id?: string };
    const currentLayout = settings.record_layout ?? 'classic';
    const currentTemplateId = settings.crm_template_id ?? DEFAULT_TEMPLATE_ID;

    const setLayout = async (next: RecordLayout): Promise<void> => {
        if (next === currentLayout) return;
        try {
            await update.mutateAsync({
                settings: { ...list.settings, record_layout: next },
            });
            // Forzamos refetch del cache de records y de la lista para
            // que cualquier RecordPage abierto en otra tab/ruta pille
            // el cambio en su próximo render — sin esto la primera
            // navegación a una ficha podía mostrar el layout viejo
            // por una fracción de segundo.
            qc.removeQueries({ queryKey: recordsKeys.forList(list.id) });
            toast.success(
                next === 'crm' ? __('Layout CRM activado') : __('Layout Lista activado'),
            );
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo cambiar el layout'), err.message);
        }
    };

    const setTemplate = async (id: string): Promise<void> => {
        if (id === currentTemplateId) return;
        try {
            // Mantenemos `crm_template_custom` aunque elijas un
            // built-in (no destruimos el trabajo del editor visual
            // si el user picó otra plantilla por error). El resolver
            // (`getResolvedLayout`) ya ignora el custom cuando
            // `crm_template_id !== 'custom'`.
            await update.mutateAsync({
                settings: { ...list.settings, crm_template_id: id },
            });
            // Forzamos refetch del records cache. Sin esto, una
            // RecordPage abierta en otra tab podía seguir mostrando
            // el layout anterior hasta que la query expirase su
            // staleTime — visualmente confundía como si el cambio
            // de plantilla "no aplicara".
            qc.removeQueries({ queryKey: recordsKeys.forList(list.id) });
            toast.success(__('Plantilla aplicada'));
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo cambiar la plantilla'), err.message);
        }
    };

    return (
        <Card>
            <CardHeader className="imcrm-pb-3">
                <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base">
                    <LayoutDashboard className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" />
                    {__('Apariencia del registro')}
                </CardTitle>
                <CardDescription>
                    {__(
                        'Define cómo se ve la página individual de cada registro de esta lista. El layout CRM es ideal para contactos, ventas o leads; el clásico para listas tipo base de datos.',
                    )}
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-5 imcrm-pt-0">
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                    <LayoutOption
                        active={currentLayout === 'classic'}
                        disabled={update.isPending}
                        title={__('Lista')}
                        description={__('Form lineal con todos los campos. Default.')}
                        Icon={LayoutDashboard}
                        onClick={() => void setLayout('classic')}
                    />
                    <LayoutOption
                        active={currentLayout === 'crm'}
                        disabled={update.isPending}
                        title={__('Panel CRM')}
                        description={__('Header con avatar, badges, sidebar colapsable y timeline.')}
                        Icon={UserSquare2}
                        onClick={() => void setLayout('crm')}
                    />
                </div>

                {currentLayout === 'crm' && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-4">
                        <div>
                            <h4 className="imcrm-text-sm imcrm-font-semibold">{__('Plantilla')}</h4>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__(
                                    'Define qué campos van en cuál slot del panel CRM. Cada plantilla aplica heurísticas distintas a tu lista — los campos sin clasificar caen en "Otros".',
                                )}
                            </p>
                        </div>
                        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            {CRM_TEMPLATES.map((tpl) => (
                                <li key={tpl.id}>
                                    <button
                                        type="button"
                                        onClick={() => void setTemplate(tpl.id)}
                                        disabled={update.isPending}
                                        className={cn(
                                            'imcrm-flex imcrm-w-full imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-px-3 imcrm-py-2.5 imcrm-text-left imcrm-transition-colors',
                                            currentTemplateId === tpl.id
                                                ? 'imcrm-border-primary imcrm-bg-primary/5'
                                                : 'imcrm-border-border imcrm-bg-card hover:imcrm-border-primary/40 hover:imcrm-bg-accent/30',
                                            update.isPending && 'imcrm-opacity-50 imcrm-cursor-not-allowed',
                                        )}
                                    >
                                        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
                                            <span className="imcrm-text-sm imcrm-font-medium">{tpl.name}</span>
                                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                                {tpl.description}
                                            </span>
                                        </div>
                                        {currentTemplateId === tpl.id && (
                                            <Check className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" aria-hidden />
                                        )}
                                    </button>
                                </li>
                            ))}
                            <li>
                                <div
                                    className={cn(
                                        'imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-px-3 imcrm-py-2.5',
                                        currentTemplateId === CUSTOM_TEMPLATE_ID
                                            ? 'imcrm-border-primary imcrm-bg-primary/5'
                                            : 'imcrm-border-border imcrm-bg-card',
                                    )}
                                >
                                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-0.5">
                                        <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                                            <Sparkles className="imcrm-h-3 imcrm-w-3 imcrm-text-primary" />
                                            {__('Personalizada')}
                                        </span>
                                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                            {__('Diseñada manualmente con el editor visual. Cada slot a tu medida.')}
                                        </span>
                                    </div>
                                    <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-2">
                                        {currentTemplateId === CUSTOM_TEMPLATE_ID && (
                                            <Check className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                                        )}
                                        <Button asChild size="sm" variant="outline" className="imcrm-gap-1.5">
                                            <Link to={`/lists/${list.slug}/template-editor`}>
                                                <SlidersHorizontal className="imcrm-h-3 imcrm-w-3" />
                                                {currentTemplateId === CUSTOM_TEMPLATE_ID
                                                    ? __('Editar')
                                                    : __('Crear')}
                                            </Link>
                                        </Button>
                                    </div>
                                </div>
                            </li>
                        </ul>
                    </div>
                )}

                {update.isPending && (
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                        {__('Guardando…')}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

interface LayoutOptionProps {
    active: boolean;
    disabled: boolean;
    title: string;
    description: string;
    Icon: typeof LayoutDashboard;
    onClick: () => void;
}

function LayoutOption({
    active,
    disabled,
    title,
    description,
    Icon,
    onClick,
}: LayoutOptionProps): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                'imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-1 imcrm-rounded-lg imcrm-border imcrm-px-4 imcrm-py-3 imcrm-text-left imcrm-transition-all',
                active
                    ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-shadow-imcrm-sm'
                    : 'imcrm-border-border imcrm-bg-card hover:imcrm-border-primary/40 hover:imcrm-bg-accent/30',
                disabled && 'imcrm-opacity-50 imcrm-cursor-not-allowed',
            )}
        >
            <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                <Icon
                    className={cn(
                        'imcrm-h-4 imcrm-w-4',
                        active ? 'imcrm-text-primary' : 'imcrm-text-muted-foreground',
                    )}
                />
                {title}
            </span>
            <span className="imcrm-text-xs imcrm-text-muted-foreground">{description}</span>
        </button>
    );
}
