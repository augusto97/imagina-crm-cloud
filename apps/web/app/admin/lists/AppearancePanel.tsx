import { useQueryClient } from '@tanstack/react-query';
import { readRecordLayoutV3 } from '@imagina-base/shared';
import { Link } from 'react-router';
import { Check, LayoutDashboard, Loader2, SlidersHorizontal, Sparkles, UserSquare2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
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
    // v0.1.231 — Con un diseño del editor guardado, ése manda (es la "Personalizada").
    const hasDesign = readRecordLayoutV3(list.settings) !== null;
    const currentTemplateId = hasDesign ? CUSTOM_TEMPLATE_ID : settings.crm_template_id ?? DEFAULT_TEMPLATE_ID;
    const confirm = useConfirm();

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
                next === 'crm' ? __('Ficha diseñada activada') : __('Ficha simple activada'),
            );
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo cambiar el layout'), err.message);
        }
    };

    const setTemplate = async (id: string): Promise<void> => {
        if (id === currentTemplateId) return;
        if (hasDesign) {
            const ok = await confirm({
                title: __('¿Reemplazar tu diseño?'),
                description: __('La ficha pasa a usar esta plantilla y se descarta el diseño hecho en el editor.'),
                confirmLabel: __('Usar la plantilla'),
                destructive: true,
            });
            if (!ok) return;
        }
        try {
            const next = { ...list.settings, crm_template_id: id } as Record<string, unknown>;
            delete next.record_layout_v3;
            // Mantenemos `crm_template_custom` aunque elijas un
            // built-in (no destruimos el trabajo del editor visual
            // si el user picó otra plantilla por error). El resolver
            // (`getResolvedLayout`) ya ignora el custom cuando
            // `crm_template_id !== 'custom'`.
            await update.mutateAsync({ settings: next });
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
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-5">
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                    <LayoutOption
                        active={currentLayout === 'classic'}
                        disabled={update.isPending}
                        title={__('Ficha simple')}
                        description={__('Todos los campos, uno debajo del otro. Es la opción por defecto.')}
                        Icon={LayoutDashboard}
                        onClick={() => void setLayout('classic')}
                    />
                    <LayoutOption
                        active={currentLayout === 'crm'}
                        disabled={update.isPending}
                        title={__('Ficha diseñada')}
                        description={__('Portada, etapas, pestañas y gráficos de los registros vinculados. Se guarda sola.')}
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
                                    'Todas se arman solas con tus campos y relaciones; cambia la composición y el estilo. Si quieres retocarla, abre el editor: arranca desde la que elegiste.',
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
                                        <TemplateThumb id={tpl.id} />
                                        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-0.5">
                                            <span className="imcrm-text-sm imcrm-font-medium">{tpl.name}</span>
                                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                                {TEMPLATE_BLURB[tpl.id] ?? tpl.description}
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
                                            {__('Diseña la ficha con el editor visual: pestañas, secciones, gráficos de los vinculados y cada campo con la forma que mejor lo muestra.')}
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
                                                    ? __('Editar diseño')
                                                    : __('Abrir el editor')}
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
        </div>
    );
}

/**
 * Qué hace cada plantilla, en lenguaje claro (las descripciones de `crmTemplates`
 * eran de la grilla vieja). v0.1.236 — cada una es una ficha distinta.
 */
const TEMPLATE_BLURB: Record<string, string> = {
    auto: 'Una banda con los números clave, los detalles y un adelanto de lo vinculado (por estado y los últimos).',
    contact: 'Perfil de la persona: botones para escribir o llamar, sus datos al costado y lo que tiene con la empresa como tarjetas.',
    deal: 'El valor del negocio en grande, el cierre en cuenta regresiva, lo vinculado como tablero y el historial a lo ancho.',
    task: 'Plana y sin portada, como Linear: el trabajo y la conversación al centro, entrega y propiedades en un panel al costado.',
    support: 'Una franja de SLA (prioridad, vencimiento, estado), la conversación como protagonista y el historial del cliente.',
};

const THUMB_ACCENT: Record<string, string> = {
    auto: 'hsl(var(--imcrm-primary))',
    contact: '#0f9f6e',
    deal: '#2a5bd7',
    task: 'hsl(var(--imcrm-muted-foreground))',
    support: '#d9622b',
};

/** Miniatura de la composición de cada plantilla (se ve la diferencia antes de elegir). */
function TemplateThumb({ id }: { id: string }): JSX.Element {
    const accent = THUMB_ACCENT[id] ?? THUMB_ACCENT.auto!;
    const box = (style: React.CSSProperties, key?: string | number, solid = false): JSX.Element => (
        <div
            key={key}
            className="imcrm-rounded-[2px]"
            style={{ background: solid ? `color-mix(in srgb, ${accent} 55%, transparent)` : 'hsl(var(--imcrm-muted-foreground) / 0.22)', ...style }}
        />
    );
    const band = (children: React.ReactNode, tone: 'accent' | 'muted' = 'accent'): JSX.Element => (
        <div
            className="imcrm-flex imcrm-gap-[2px] imcrm-rounded-[3px] imcrm-p-[2px]"
            style={{ background: tone === 'accent' ? `color-mix(in srgb, ${accent} 16%, transparent)` : 'hsl(var(--imcrm-muted))' }}
        >
            {children}
        </div>
    );
    const card = (h: number, key?: number): JSX.Element => (
        <div key={key} className="imcrm-rounded-[2px] imcrm-bg-card imcrm-ring-1 imcrm-ring-border" style={{ height: h, flex: 1 }} />
    );
    const col = (flex: number, children: React.ReactNode): JSX.Element => (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-[2px]" style={{ flex }}>
            {children}
        </div>
    );
    let body: JSX.Element;
    switch (id) {
        case 'contact':
            body = (
                <div className="imcrm-flex imcrm-flex-1 imcrm-gap-[3px]">
                    {col(1, [box({ height: 4 }, 1, true), box({ height: 4 }, 2, true), box({ height: 6 }, 3), box({ height: 8 }, 4)])}
                    {col(2, [
                        <div key="c" className="imcrm-flex imcrm-gap-[2px]">{[0, 1, 2].map((k) => card(9, k))}</div>,
                        box({ height: 5 }, 5),
                        box({ height: 7 }, 6),
                    ])}
                </div>
            );
            break;
        case 'deal':
            body = (
                <>
                    {band([box({ height: 8, flex: 2 }, 1, true), card(8, 2)])}
                    <div className="imcrm-flex imcrm-gap-[2px]">{[0, 1, 2].map((k) => card(5, k))}</div>
                    <div className="imcrm-flex imcrm-flex-1 imcrm-gap-[3px]">
                        {col(2, [box({ height: 6 }, 1), box({ height: 5 }, 2)])}
                        {col(1, [box({ height: 4 }, 3, true), box({ height: 7 }, 4)])}
                    </div>
                </>
            );
            break;
        case 'task':
            body = (
                <div className="imcrm-flex imcrm-flex-1 imcrm-gap-[3px]">
                    {col(2, [box({ height: 10 }, 1), box({ height: 1 }, 2), box({ height: 9 }, 3)])}
                    {col(1, [
                        <div key="d" className="imcrm-rounded-[2px]" style={{ height: 5, background: 'rgb(16 185 129 / 0.35)' }} />,
                        box({ height: 3 }, 2),
                        box({ height: 3 }, 3),
                        box({ height: 3 }, 4),
                    ])}
                </div>
            );
            break;
        case 'support':
            body = (
                <>
                    {band([0, 1, 2, 3].map((k) => card(6, k)), 'muted')}
                    <div className="imcrm-flex imcrm-flex-1 imcrm-gap-[3px]">
                        {col(1.4, [box({ height: 4 }, 1, true), box({ height: 14 }, 2)])}
                        {col(1, [box({ height: 5 }, 3), box({ height: 4 }, 4), box({ height: 6 }, 5)])}
                    </div>
                </>
            );
            break;
        default:
            body = (
                <>
                    {band([0, 1, 2, 3].map((k) => card(6, k)))}
                    <div className="imcrm-flex imcrm-flex-1 imcrm-gap-[3px]">
                        {col(2, [box({ height: 6 }, 1), box({ height: 5 }, 2)])}
                        {col(1, [box({ height: 4 }, 3), box({ height: 8 }, 4)])}
                    </div>
                </>
            );
    }
    return (
        <div
            aria-hidden
            className="imcrm-flex imcrm-h-[64px] imcrm-w-[88px] imcrm-shrink-0 imcrm-flex-col imcrm-gap-[3px] imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-p-[4px]"
            data-thumb={id}
        >
            {id === 'task' ? (
                <div className="imcrm-h-[5px] imcrm-w-1/2 imcrm-rounded-[2px] imcrm-bg-foreground/50" />
            ) : (
                <div
                    className="imcrm-h-[8px] imcrm-rounded-[2px]"
                    style={{ background: id === 'deal' ? accent : `linear-gradient(115deg, color-mix(in srgb, ${accent} 60%, transparent), color-mix(in srgb, ${accent} 12%, transparent))` }}
                />
            )}
            {body}
        </div>
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
