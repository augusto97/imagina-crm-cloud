import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Heading1, Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateField } from '@/hooks/useFields';
import { useFieldTypes } from '@/hooks/useFieldTypes';
import { useListPermissions, useUpdateListPermissions } from '@/hooks/usePermissions';
import { ApiError } from '@/lib/api';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { riskOf } from '@/lib/fieldTypeMigration';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity, FieldTypeSlug } from '@/types/field';

import { FieldConfigEditor } from './FieldConfigEditor';
import { FieldTypeSelect } from './FieldTypeSelect';
import { SlugEditor } from './SlugEditor';

/**
 * Columna derecha del administrador de campos (v0.1.163).
 *
 * Es donde vive TODO lo que se puede ajustar de un campo, que es bastante
 * más que su nombre — el equivalente honesto al panel de ClickUp:
 *
 *   - **Nombre** y **descripción** ("cómo se usa este campo", se muestra
 *     como ayuda bajo el campo en los formularios).
 *   - **Tipo** (con conversión de datos y su aviso de riesgo) y **nombre
 *     interno** (el slug: etiqueta humana editable, regla de oro nº 1).
 *   - **Configuración del tipo** (opciones, decimales, moneda, país…).
 *   - **Comportamiento**: obligatorio, sin repetidos, indexar, y usar el
 *     campo como título del registro.
 *   - **Quién lo ve**: qué roles NO deben ver este campo. No es un invento:
 *     se guarda en `settings.permissions[rol].fields_hidden` de la lista —
 *     el mismo ACL que aplica el backend al leer registros — sólo que
 *     visto desde el campo en vez de desde el rol.
 */
interface Props {
    listId: number;
    field: FieldEntity;
    onDelete: () => void;
    /** Sólo si el campo puede ser título y todavía no lo es. */
    onMakeTitle?: () => void;
}

export function FieldSettingsPanel({ listId, field, onDelete, onMakeTitle }: Props): JSX.Element {
    const update = useUpdateField(listId);
    const { data: fieldTypes } = useFieldTypes();

    const [label, setLabel] = useState(field.label);
    const [description, setDescription] = useState(field.description ?? '');
    const [type, setType] = useState<FieldTypeSlug>(field.type);
    const [slug, setSlug] = useState(field.slug);
    const [slugDirty, setSlugDirty] = useState(true);
    const [isRequired, setIsRequired] = useState(field.is_required);
    const [isUnique, setIsUnique] = useState(field.is_unique);
    const [isIndexed, setIsIndexed] = useState(field.is_indexed);
    const [config, setConfig] = useState<Record<string, unknown>>(field.config ?? {});
    const [error, setError] = useState<string | null>(null);

    // El panel se monta con `key={field.id}`, así que el estado arranca del
    // campo elegido; este efecto sólo re-sincroniza si el MISMO campo cambia
    // por fuera (otra pestaña, realtime).
    useEffect(() => {
        setLabel(field.label);
        setDescription(field.description ?? '');
        setType(field.type);
        setSlug(field.slug);
        setIsRequired(field.is_required);
        setIsUnique(field.is_unique);
        setIsIndexed(field.is_indexed);
        setConfig(field.config ?? {});
    }, [field]);

    const supportsUnique = useMemo(
        () => fieldTypes?.find((t) => t.slug === type)?.supports_unique ?? false,
        [fieldTypes, type],
    );

    const dirty =
        label !== field.label
        || description !== (field.description ?? '')
        || type !== field.type
        || slug !== field.slug
        || isRequired !== field.is_required
        || isUnique !== field.is_unique
        || isIndexed !== field.is_indexed
        || JSON.stringify(config) !== JSON.stringify(field.config ?? {});

    const save = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        if (label.trim() === '') return;
        setError(null);
        if (type !== field.type && riskOf(field.type, type) === 'destructive') {
            const ok = window.confirm(
                __('Esta conversión puede perder datos en los registros existentes. ¿Continuar?'),
            );
            if (!ok) return;
        }
        try {
            await update.mutateAsync({
                id: field.id,
                input: {
                    label: label.trim(),
                    description: description.trim() === '' ? null : description.trim(),
                    slug: slug || undefined,
                    ...(type !== field.type ? { type } : {}),
                    is_required: isRequired,
                    is_unique: supportsUnique ? isUnique : false,
                    is_indexed: isIndexed,
                    config,
                },
            });
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    const Icon = fieldTypeIcon(field.type);

    return (
        <form
            onSubmit={save}
            className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4"
        >
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <Icon className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                <p className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-sm imcrm-font-semibold">
                    {field.label}
                </p>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="fsp-label">{__('Nombre del campo')}</Label>
                <Input id="fsp-label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="fsp-desc">{__('Descripción')}</Label>
                <Textarea
                    id="fsp-desc"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={__('Contale al equipo cómo se usa este campo')}
                />
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Se muestra como ayuda debajo del campo en los formularios.')}
                </p>
            </div>

            <Section title={__('Tipo y nombre interno')}>
                <FieldTypeSelect
                    value={type}
                    onChange={(next) => {
                        if (!next) return;
                        setType(next);
                        setConfig({});
                    }}
                    editingFromType={field.type}
                />
                {type !== field.type && <TypeRiskNote fromType={field.type} toType={type} />}
                <SlugEditor
                    type="field"
                    label={__('Nombre interno')}
                    currentSlug={field.slug}
                    listId={listId}
                    value={slug}
                    onChange={setSlug}
                    isDirty={slugDirty}
                    onDirty={() => setSlugDirty(true)}
                />
            </Section>

            <Section title={__('Configuración')}>
                <FieldConfigEditor
                    type={type}
                    config={config}
                    onChange={setConfig}
                    listId={listId}
                    currentFieldId={field.id}
                />
            </Section>

            <Section title={__('Comportamiento')}>
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input
                        type="checkbox"
                        checked={isRequired}
                        onChange={(e) => setIsRequired(e.target.checked)}
                    />
                    {__('Obligatorio')}
                </label>
                <label
                    className={cn(
                        'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm',
                        !supportsUnique && 'imcrm-opacity-50',
                    )}
                >
                    <input
                        type="checkbox"
                        checked={isUnique}
                        disabled={!supportsUnique}
                        onChange={(e) => setIsUnique(e.target.checked)}
                    />
                    {__('Sin repetidos')}
                    {!supportsUnique && ' ' + __('(no aplica a este tipo)')}
                </label>
                <label
                    className={cn(
                        'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm',
                        isUnique && 'imcrm-opacity-50',
                    )}
                    title={__('Crea un índice sobre la columna: acelera filtros y orden en listas grandes, a cambio de algo más de espacio y escrituras un poco más lentas.')}
                >
                    <input
                        type="checkbox"
                        checked={isIndexed}
                        disabled={isUnique}
                        onChange={(e) => setIsIndexed(e.target.checked)}
                    />
                    {__('Indexar')}
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('(rápido a gran escala)')}
                    </span>
                </label>
                {onMakeTitle && (
                    <Button type="button" variant="outline" size="sm" className="imcrm-gap-1.5" onClick={onMakeTitle}>
                        <Heading1 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Usar como título del registro')}
                    </Button>
                )}
            </Section>

            <RoleVisibility listId={listId} fieldSlug={field.slug} />

            {error !== null && (
                <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-2.5 imcrm-text-xs imcrm-text-destructive">
                    {error}
                </div>
            )}

            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="imcrm-gap-1.5 imcrm-text-destructive"
                    onClick={onDelete}
                >
                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Eliminar')}
                </Button>
                <Button type="submit" size="sm" disabled={!dirty || update.isPending || label.trim() === ''}>
                    {update.isPending ? __('Guardando…') : __('Guardar')}
                </Button>
            </div>
        </form>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
            <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {title}
            </p>
            {children}
        </div>
    );
}

function TypeRiskNote({ fromType, toType }: { fromType: string; toType: string }): JSX.Element | null {
    const risk = riskOf(fromType, toType);
    if (risk === null || risk === 'safe') return null;
    return (
        <p
            className={cn(
                'imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-py-2 imcrm-text-xs',
                risk === 'destructive'
                    ? 'imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-text-destructive'
                    : 'imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-text-warning-foreground',
            )}
        >
            {risk === 'destructive'
                ? __('Al convertir se puede perder información de los registros existentes.')
                : __('Al convertir se pueden modificar algunos valores existentes.')}
        </p>
    );
}

/**
 * "Quién lo ve": los roles que NO deben ver este campo.
 *
 * Escribe en `settings.permissions[rol].fields_hidden` de la lista — el
 * MISMO ACL que el backend aplica al leer registros (v0.1.126). Acá se ve
 * desde el campo; en Ajustes → Permisos, desde el rol. Los administradores
 * ven todo siempre y por eso no aparecen.
 */
function RoleVisibility({ listId, fieldSlug }: { listId: number; fieldSlug: string }): JSX.Element | null {
    const query = useListPermissions(listId);
    const update = useUpdateListPermissions(listId);

    const roles = (query.data?.roles ?? []).filter((r) => r.can_configure);
    if (query.isLoading) {
        return (
            <Section title={__('Quién lo ve')}>
                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                    {__('Cargando permisos…')}
                </p>
            </Section>
        );
    }
    if (roles.length === 0) return null;

    const perms = query.data?.permissions ?? {};

    const toggle = (role: string, hide: boolean): void => {
        const current = perms[role];
        if (!current) return;
        const hidden = new Set(current.fields_hidden ?? []);
        if (hide) hidden.add(fieldSlug);
        else hidden.delete(fieldSlug);
        update.mutate({ permissions: { [role]: { ...current, fields_hidden: Array.from(hidden) } } });
    };

    return (
        <Section title={__('Quién lo ve')}>
            {roles.map((r) => {
                const hidden = (perms[r.slug]?.fields_hidden ?? []).includes(fieldSlug);
                return (
                    <button
                        key={r.slug}
                        type="button"
                        disabled={update.isPending}
                        onClick={() => toggle(r.slug, !hidden)}
                        className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-1.5 imcrm-py-1 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent/50"
                    >
                        {hidden ? (
                            <EyeOff className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-destructive" aria-hidden />
                        ) : (
                            <Eye className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                        )}
                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{r.label}</span>
                        <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground">
                            {hidden ? __('Oculto') : __('Lo ve')}
                        </span>
                    </button>
                );
            })}
        </Section>
    );
}
