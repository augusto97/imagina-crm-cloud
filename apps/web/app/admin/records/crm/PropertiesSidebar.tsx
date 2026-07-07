import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ResolvedLayout, SidebarGroup } from '@/lib/crmTemplates';
import { OTHER_GROUP_ICON } from '@/lib/crmTemplates';
import type { FieldEntity } from '@/types/field';

import { CompactFieldRow } from './CompactFieldRow';

interface PropertiesSidebarProps {
    layout: ResolvedLayout;
    listId: number | string;
    values: Record<string, unknown>;
    onChange: (values: Record<string, unknown>) => void;
    fieldErrors?: Record<string, string>;
}

/**
 * Sidebar de propiedades del layout CRM. Renderea los grupos definidos
 * por la plantilla activa (`ResolvedLayout.sidebarGroups`) y un grupo
 * "Otros" automático con los fields que la plantilla no asignó.
 *
 * Cada bloque colapsable reusa `RecordFieldsForm` para el inline edit
 * — sin duplicar la lógica de input por tipo de campo.
 */
export function PropertiesSidebar({
    layout,
    listId,
    values,
    onChange,
    fieldErrors,
}: PropertiesSidebarProps): JSX.Element {
    const groups: SidebarGroup[] = [...layout.sidebarGroups];
    if (layout.leftover.length > 0) {
        groups.push({
            id: '__leftover',
            label: __('Otros'),
            icon: OTHER_GROUP_ICON,
            fields: layout.leftover,
            collapsedByDefault: true,
        });
    }

    return (
        <aside className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {groups.map((g) => (
                <PropertyGroup
                    key={g.id}
                    group={g}
                    listId={listId}
                    values={values}
                    onChange={onChange}
                    fieldErrors={fieldErrors}
                />
            ))}
        </aside>
    );
}

interface PropertyGroupProps {
    group: SidebarGroup;
    listId: number | string;
    values: Record<string, unknown>;
    onChange: (values: Record<string, unknown>) => void;
    fieldErrors?: Record<string, string>;
}

function PropertyGroup({ group, listId, values, onChange, fieldErrors }: PropertyGroupProps): JSX.Element {
    const [open, setOpen] = useState(! group.collapsedByDefault);
    const Icon = group.icon;

    const setValue = (slug: string, v: unknown): void => onChange({ ...values, [slug]: v });

    return (
        <section className="imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
            <button
                type="button"
                onClick={() => setOpen((v) => ! v)}
                aria-expanded={open}
                className={cn(
                    'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-4 imcrm-py-2.5 imcrm-text-left imcrm-text-sm imcrm-font-medium imcrm-transition-colors',
                    'hover:imcrm-bg-accent/40',
                )}
            >
                {open ? (
                    <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                ) : (
                    <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                )}
                <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                <span className="imcrm-flex-1">{__(group.label)}</span>
                <span className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-semibold imcrm-text-muted-foreground">
                    {group.fields.length}
                </span>
            </button>

            {open && (
                <div className="imcrm-border-t imcrm-border-border">
                    {group.fields.map((f) => (
                        <CompactFieldRow
                            key={f.id}
                            field={f}
                            listId={listId}
                            value={values[f.slug]}
                            onChange={(v) => setValue(f.slug, v)}
                            error={fieldErrors?.[f.slug]}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

/** @deprecated kept for backward import compat — real type comes from crmTemplates. */
export type SidebarGroupSpec = SidebarGroup;
/** @deprecated */
export type SidebarFieldGroup = { fields: FieldEntity[] };
