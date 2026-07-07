import { ArrowDown, ArrowUp, RotateCcw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { CRM_TEMPLATES, type CustomTemplateConfigV2 } from '@/lib/crmTemplates';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

interface TemplateSettingsPanelProps {
    fields: FieldEntity[];
    config: CustomTemplateConfigV2;
    onChange: (next: CustomTemplateConfigV2) => void;
    onResetFromBuiltin: (builtinId: string) => void;
}

/**
 * Panel del inspector cuando NO hay bloque seleccionado (Fase 11.A+).
 * Muestra los ajustes globales del template: slots del header
 * (título, subtítulos, badges, acciones) y un quick-access a
 * "Restaurar desde plantilla" built-in.
 *
 * Reemplaza al `HeaderEditor` colapsable que vivía arriba del canvas
 * en el editor v2 — la información es la misma pero ahora vive en
 * la columna derecha permanente.
 */
export function TemplateSettingsPanel({
    fields,
    config,
    onChange,
    onResetFromBuiltin,
}: TemplateSettingsPanelProps): JSX.Element {
    const isPhoneLike = (f: FieldEntity): boolean =>
        f.type === 'text'
        && /\b(phone|tel|telefono|teléfono|celular|movil|móvil|whatsapp|wsp|sms|fax)\b/i.test(
            f.slug + ' ' + f.label,
        );

    const updateHeader = (patch: Partial<CustomTemplateConfigV2['header']>): void => {
        onChange({ ...config, header: { ...config.header, ...patch } });
    };

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col">
            <header className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-border-b imcrm-border-border imcrm-py-3 imcrm-pl-12 imcrm-pr-4">
                <p className="imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                    {__('Plantilla')}
                </p>
                <h3 className="imcrm-text-sm imcrm-font-semibold imcrm-tracking-tight">
                    {__('Ajustes de la plantilla')}
                </h3>
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Seleccioná un bloque para configurarlo. Acá vivien los ajustes globales del panel.')}
                </p>
            </header>

            <div className="imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-4 imcrm-py-4">
                <section className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <h4 className="imcrm-text-xs imcrm-font-semibold">
                            {__('Encabezado del panel')}
                        </h4>
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {__('Avatar, título, subtítulos, badges y acciones rápidas. Zona fija arriba del panel CRM.')}
                        </p>
                    </div>

                    <SingleSlot
                        label={__('Título principal')}
                        description={__('Vacío = primary auto-detectado.')}
                        fields={fields}
                        valueSlug={config.header.title_field_slug}
                        onChange={(slug) => updateHeader({ title_field_slug: slug })}
                    />
                    <MultiSlot
                        label={__('Subtítulo')}
                        description={__('Hasta 3 campos. Aparecen separados por · debajo del título.')}
                        fields={fields}
                        valueSlugs={config.header.subtitle_field_slugs}
                        onChange={(slugs) => updateHeader({ subtitle_field_slugs: slugs })}
                    />
                    <MultiSlot
                        label={__('Badges de estado')}
                        description={__('Pills coloreadas. Solo select / multi_select / checkbox.')}
                        fields={fields.filter((f) =>
                            f.type === 'select' || f.type === 'multi_select' || f.type === 'checkbox',
                        )}
                        valueSlugs={config.header.status_field_slugs}
                        onChange={(slugs) => updateHeader({ status_field_slugs: slugs })}
                    />
                    <MultiSlot
                        label={__('Acciones rápidas')}
                        description={__('Botones mailto / tel / abrir URL. Solo email, url o text con slug tipo phone.')}
                        fields={fields.filter((f) =>
                            f.type === 'email' || f.type === 'url' || isPhoneLike(f),
                        )}
                        valueSlugs={config.header.quick_action_field_slugs}
                        onChange={(slugs) => updateHeader({ quick_action_field_slugs: slugs })}
                    />
                </section>

                <section className="imcrm-mt-6 imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-5">
                    <h4 className="imcrm-text-xs imcrm-font-semibold">{__('Restaurar')}</h4>
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Reemplaza el contenido actual con una plantilla built-in. No es reversible.')}
                    </p>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="imcrm-w-full imcrm-justify-start imcrm-gap-2">
                                <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Restaurar desde plantilla…')}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="imcrm-min-w-[260px]">
                            {CRM_TEMPLATES.map((t) => (
                                <DropdownMenuItem
                                    key={t.id}
                                    onSelect={() => onResetFromBuiltin(t.id)}
                                >
                                    <span className="imcrm-flex imcrm-flex-col imcrm-items-start">
                                        <span className="imcrm-font-medium">{t.name}</span>
                                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {t.description}
                                        </span>
                                    </span>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </section>

                <section className="imcrm-mt-6 imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-5">
                    <h4 className="imcrm-text-xs imcrm-font-semibold">{__('Atajos de teclado')}</h4>
                    <ul className="imcrm-space-y-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                        <ShortcutRow label={__('Command palette')} keys="⌘K" />
                        <ShortcutRow label={__('Guardar plantilla')} keys="⌘S" />
                        <ShortcutRow label={__('Toggle Editor / Preview')} keys="⌘P" />
                        <ShortcutRow label={__('Toggle full-screen')} keys="⌘J" />
                        <ShortcutRow label={__('Deshacer')} keys="⌘Z" />
                        <ShortcutRow label={__('Rehacer')} keys="⌘⇧Z" />
                        <ShortcutRow label={__('Sumar a la selección')} keys="⇧ click" />
                        <ShortcutRow label={__('Duplicar seleccionados')} keys="⌘D" />
                        <ShortcutRow label={__('Eliminar seleccionados')} keys="⌫" />
                        <ShortcutRow label={__('Deseleccionar')} keys="Esc" />
                    </ul>
                </section>
            </div>
        </div>
    );
}

function ShortcutRow({ label, keys }: { label: string; keys: string }): JSX.Element {
    return (
        <li className="imcrm-flex imcrm-items-center imcrm-justify-between">
            <span>{label}</span>
            <kbd className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-mono">
                {keys}
            </kbd>
        </li>
    );
}

function SingleSlot({
    label,
    description,
    fields,
    valueSlug,
    onChange,
}: {
    label: string;
    description: string;
    fields: FieldEntity[];
    valueSlug: string | undefined;
    onChange: (slug: string | undefined) => void;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <Label className="imcrm-text-xs imcrm-font-medium">{label}</Label>
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{description}</p>
            <select
                value={valueSlug ?? ''}
                onChange={(e) => onChange(e.target.value || undefined)}
                className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
            >
                <option value="">{__('— Auto —')}</option>
                {fields.map((f) => (
                    <option key={f.id} value={f.slug}>
                        {f.label} ({f.type})
                    </option>
                ))}
            </select>
        </div>
    );
}

function MultiSlot({
    label,
    description,
    fields,
    valueSlugs,
    onChange,
}: {
    label: string;
    description: string;
    fields: FieldEntity[];
    valueSlugs: string[];
    onChange: (slugs: string[]) => void;
}): JSX.Element {
    const bySlug = new Map(fields.map((f) => [f.slug, f]));
    const available = fields.filter((f) => ! valueSlugs.includes(f.slug));

    const remove = (slug: string): void => onChange(valueSlugs.filter((s) => s !== slug));
    const move = (slug: string, dir: -1 | 1): void => {
        const idx = valueSlugs.indexOf(slug);
        const next = idx + dir;
        if (idx < 0 || next < 0 || next >= valueSlugs.length) return;
        const out = [...valueSlugs];
        [out[idx], out[next]] = [out[next]!, out[idx]!];
        onChange(out);
    };
    const add = (slug: string): void => {
        if (! slug || valueSlugs.includes(slug)) return;
        onChange([...valueSlugs, slug]);
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label className="imcrm-text-xs imcrm-font-medium">{label}</Label>
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{description}</p>
            {valueSlugs.length === 0 ? (
                <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-2 imcrm-py-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Vacío')}
                </p>
            ) : (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    {valueSlugs.map((slug, i) => {
                        const f = bySlug.get(slug);
                        return (
                            <li
                                key={slug}
                                className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-px-2.5 imcrm-py-1.5 imcrm-text-xs"
                            >
                                <span className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-overflow-hidden">
                                    <span className="imcrm-truncate imcrm-font-medium">{f ? f.label : slug}</span>
                                    <span className="imcrm-truncate imcrm-text-[10px] imcrm-text-muted-foreground">
                                        {f ? f.type : __('campo no encontrado')}
                                    </span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => move(slug, -1)}
                                    disabled={i === 0}
                                    className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-30"
                                    aria-label={__('Subir')}
                                >
                                    <ArrowUp className="imcrm-h-3 imcrm-w-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => move(slug, 1)}
                                    disabled={i === valueSlugs.length - 1}
                                    className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-30"
                                    aria-label={__('Bajar')}
                                >
                                    <ArrowDown className="imcrm-h-3 imcrm-w-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => remove(slug)}
                                    className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                                    aria-label={__('Quitar')}
                                >
                                    <X className="imcrm-h-3 imcrm-w-3" />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            <select
                onChange={(e) => {
                    add(e.target.value);
                    e.target.value = '';
                }}
                disabled={available.length === 0}
                defaultValue=""
                className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-xs"
            >
                <option value="">
                    {available.length === 0 ? __('— Sin disponibles —') : __('+ Agregar…')}
                </option>
                {available.map((f) => (
                    <option key={f.id} value={f.slug}>
                        {f.label} ({f.type})
                    </option>
                ))}
            </select>
        </div>
    );
}
