import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Check, LayoutTemplate, Loader2, Trash2, X, Zap } from 'lucide-react';
import { remapAutomationSlugs, type AutomationTemplateCategory, type AutomationTemplateSummary } from '@imagina-base/shared';

import { RoleFieldMapper } from '@/admin/templates/RoleFieldMapper';
import { suggestRoleMapping } from '@/admin/templates/roleMapping';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useAutomationTemplates, useDeleteAutomationTemplate } from '@/hooks/useAutomationTemplates';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';

import { actionMetaFor, triggerMetaFor } from './automationMeta';
import type { AutomationFormState } from './config-editors';

const CATEGORY_LABELS: Record<AutomationTemplateCategory, string> = {
    correo: 'Correo',
    plazos: 'Plazos',
    campos: 'Campos',
    integraciones: 'Integraciones',
    otros: 'Otros',
};

const NO_TEMPLATES: AutomationTemplateSummary[] = [];

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    list: ListSummary;
    fields: FieldEntity[];
}

/**
 * Recetas de automatización (v0.1.167): elegir una, indicar qué campo de la
 * lista cumple cada rol (sugerido por nombre y tipo) y abrir el EDITOR con
 * la automatización ya armada — no se guarda nada hasta que la persona
 * revisa destinatarios y valores y toca Guardar.
 */
export function AutomationTemplateDialog({ open, onOpenChange, list, fields }: Props): JSX.Element {
    const templates = useAutomationTemplates(open);
    const remove = useDeleteAutomationTemplate();
    const navigate = useNavigate();
    const confirm = useConfirm();
    const toast = useToast();

    const [category, setCategory] = useState<AutomationTemplateCategory | 'all' | 'mine'>('all');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [mapping, setMapping] = useState<Record<string, number>>({});

    useEffect(() => {
        if (!open) {
            setSelectedId(null);
            setMapping({});
            setCategory('all');
        }
    }, [open]);

    const all = templates.data ?? NO_TEMPLATES;
    const visible = useMemo(
        () =>
            all.filter((t) => {
                if (category === 'mine') return t.source === 'workspace';
                if (category === 'all') return true;
                return t.category === category;
            }),
        [all, category],
    );
    const hasMine = all.some((t) => t.source === 'workspace');
    const categoriesPresent = useMemo(() => {
        const set = new Set(all.map((t) => t.category));
        return (Object.keys(CATEGORY_LABELS) as AutomationTemplateCategory[]).filter((c) => set.has(c));
    }, [all]);
    const selected = selectedId !== null ? all.find((t) => t.id === selectedId) ?? null : null;

    const pick = (t: AutomationTemplateSummary): void => {
        setSelectedId(t.id);
        setMapping(suggestRoleMapping(t.template.fields, fields));
    };

    const handleDelete = async (t: AutomationTemplateSummary): Promise<void> => {
        const ok = await confirm({
            title: __('¿Borrar esta plantilla?'),
            description: __('Las automatizaciones creadas a partir de ella no se tocan.'),
            confirmLabel: __('Borrar plantilla'),
            destructive: true,
        });
        if (!ok) return;
        try {
            await remove.mutateAsync(t.id);
            if (selectedId === t.id) setSelectedId(null);
            toast.success(__('Plantilla borrada'));
        } catch (err) {
            toast.error(__('No se pudo borrar la plantilla'), err instanceof Error ? err.message : undefined);
        }
    };

    const missingRequired = selected ? selected.template.fields.filter((r) => r.required && mapping[r.key] === undefined) : [];

    const openInEditor = (): void => {
        if (!selected) return;
        const slugById = new Map(fields.map((f) => [f.id, f.slug]));
        const roleToSlug: Record<string, string> = {};
        for (const [role, fid] of Object.entries(mapping)) {
            const slug = slugById.get(fid);
            if (slug !== undefined) roleToSlug[role] = slug;
        }
        const body = remapAutomationSlugs(
            { trigger_config: selected.template.trigger_config, actions: selected.template.actions },
            roleToSlug,
        );
        const preset: AutomationFormState = {
            name: selected.template.name,
            description: selected.template.description ?? '',
            triggerType: selected.template.trigger_type,
            triggerConfig: body.trigger_config,
            actions: body.actions as AutomationFormState['actions'],
            isActive: true,
        };
        onOpenChange(false);
        navigate(`/lists/${list.slug}/automations/new`, { state: { preset } });
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[88vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-4xl imcrm-flex-col imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg"
                    style={{ transform: 'translate(-50%, -50%)' }}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Automatización desde una plantilla')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Elegí una receta, indicá qué campo cumple cada rol y se abre en el editor para revisarla antes de guardar.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <div className="imcrm-mt-4 imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-3 imcrm-overflow-y-auto md:imcrm-flex-row md:imcrm-gap-0 md:imcrm-overflow-visible">
                        <div className="imcrm-flex imcrm-min-w-0 imcrm-shrink-0 imcrm-flex-col imcrm-gap-3 md:imcrm-min-h-0 md:imcrm-w-1/2 md:imcrm-shrink md:imcrm-pr-4">
                            <div className="imcrm-flex imcrm-shrink-0 imcrm-gap-1.5 imcrm-overflow-x-auto imcrm-overflow-y-hidden imcrm-px-0.5 imcrm-py-1">
                                <Chip active={category === 'all'} onClick={() => setCategory('all')}>{__('Todas')}</Chip>
                                {hasMine && <Chip active={category === 'mine'} onClick={() => setCategory('mine')}>{__('Mis plantillas')}</Chip>}
                                {categoriesPresent.map((c) => (
                                    <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{CATEGORY_LABELS[c]}</Chip>
                                ))}
                            </div>
                            {templates.isLoading ? (
                                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                                    {__('Cargando plantillas…')}
                                </p>
                            ) : (
                                <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-col imcrm-gap-2 md:imcrm-overflow-y-auto">
                                    {visible.map((t) => {
                                        const active = t.id === selectedId;
                                        const trigger = triggerMetaFor(t.template.trigger_type);
                                        return (
                                            <button
                                                key={t.id}
                                                type="button"
                                                onClick={() => pick(t)}
                                                className={cn(
                                                    'imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors',
                                                    active
                                                        ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary'
                                                        : 'imcrm-border-border imcrm-bg-card hover:imcrm-border-primary/40 hover:imcrm-bg-accent/30',
                                                )}
                                            >
                                                <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-ring-1 imcrm-ring-inset imcrm-ring-border">
                                                    <trigger.icon className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                                </span>
                                                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-0.5">
                                                    <span className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                                        <span className="imcrm-truncate imcrm-text-sm imcrm-font-semibold">{t.name}</span>
                                                        {active && <Check className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" />}
                                                    </span>
                                                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                                        {t.source === 'workspace' ? __('Del workspace') : CATEGORY_LABELS[t.category]}
                                                    </span>
                                                    {t.description && (
                                                        <span className="imcrm-line-clamp-2 imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">{t.description}</span>
                                                    )}
                                                </span>
                                            </button>
                                        );
                                    })}
                                    {visible.length === 0 && (
                                        <p className="imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">{__('Ninguna plantilla coincide.')}</p>
                                    )}
                                </div>
                            )}
                        </div>

                        <aside className="imcrm-flex imcrm-w-full imcrm-shrink-0 imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3 md:imcrm-min-h-0 md:imcrm-w-1/2 md:imcrm-border-l md:imcrm-border-t-0 md:imcrm-pl-4 md:imcrm-pt-0">
                            {!selected ? (
                                <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-py-10 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                                    <Zap className="imcrm-h-6 imcrm-w-6 imcrm-opacity-50" />
                                    {__('Elegí una receta para ver qué hace.')}
                                </div>
                            ) : (
                                <>
                                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                                        <div className="imcrm-min-w-0">
                                            <h3 className="imcrm-text-sm imcrm-font-semibold">{selected.name}</h3>
                                            {selected.description && <p className="imcrm-text-xs imcrm-text-muted-foreground">{selected.description}</p>}
                                        </div>
                                        {selected.source === 'workspace' && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-text-muted-foreground"
                                                onClick={() => void handleDelete(selected)}
                                                aria-label={__('Borrar plantilla')}
                                                title={__('Borrar plantilla')}
                                            >
                                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </Button>
                                        )}
                                    </div>

                                    {/* Flujo: trigger → acciones */}
                                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-xs">
                                        <FlowChip highlight>{triggerMetaFor(selected.template.trigger_type).title}</FlowChip>
                                        {(selected.template.actions as Array<{ type: string }>).map((a, i) => {
                                            const meta = actionMetaFor(a.type);
                                            return (
                                                <span key={i} className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                                    <ArrowRight className="imcrm-h-3 imcrm-w-3 imcrm-text-muted-foreground/60" aria-hidden />
                                                    <FlowChip>
                                                        <meta.icon className="imcrm-h-3 imcrm-w-3 imcrm-text-muted-foreground" aria-hidden />
                                                        {meta.title}
                                                    </FlowChip>
                                                </span>
                                            );
                                        })}
                                    </div>

                                    {selected.template.fields.length > 0 && (
                                        <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
                                            <legend className="imcrm-px-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                                {__('Campos de esta lista')}
                                            </legend>
                                            <RoleFieldMapper
                                                idPrefix="auto-map"
                                                roles={selected.template.fields}
                                                fields={fields}
                                                value={mapping}
                                                onChange={setMapping}
                                            />
                                        </fieldset>
                                    )}

                                    <Button onClick={openInEditor} disabled={missingRequired.length > 0} className="imcrm-gap-2">
                                        <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />
                                        {__('Abrir en el editor')}
                                    </Button>
                                </>
                            )}
                        </aside>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'imcrm-shrink-0 imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-0.5 imcrm-text-xs imcrm-transition-colors',
                active
                    ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary'
                    : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-text-foreground',
            )}
        >
            {children}
        </button>
    );
}

function FlowChip({ children, highlight }: { children: React.ReactNode; highlight?: boolean }): JSX.Element {
    return (
        <span
            className={cn(
                'imcrm-inline-flex imcrm-max-w-full imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-1 imcrm-font-medium',
                highlight
                    ? 'imcrm-border-primary/25 imcrm-bg-primary/5 imcrm-text-primary'
                    : 'imcrm-border-border imcrm-bg-canvas imcrm-text-foreground/80',
            )}
        >
            {children}
        </span>
    );
}
