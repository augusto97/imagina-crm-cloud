import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ClipboardList, FilePlus2, LayoutTemplate, Loader2, Search, X } from 'lucide-react';
import {
    FORM_TEMPLATE_CATEGORIES,
    FORM_TEMPLATE_CATEGORY_LABELS,
    FORM_TEMPLATES,
    buildFormFromTemplate,
    publicThemePresets,
    type FieldType,
    type FormDto,
    type FormTemplate,
    type FormTemplateCategory,
    type FormTemplateMapping,
} from '@imagina-base/shared';

import { TemplateCard } from '@/admin/templates/TemplateCard';
import { suggestRoleMapping } from '@/admin/templates/roleMapping';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useBrandingData } from '@/hooks/useBranding';
import { useCreateField, useFields } from '@/hooks/useFields';
import { ApiError } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { listColor, listIcon } from '@/lib/listIcons';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { useCreateForm } from './useForms';

type Mode = 'template' | 'blank';

/** Qué responde a cada rol: un campo de la lista, crear uno nuevo o no preguntar. */
type Choice = { kind: 'field'; id: number } | { kind: 'new' } | { kind: 'skip' };

const FIELD_TYPE_LABELS: Partial<Record<FieldType, string>> = {
    text: 'texto',
    long_text: 'texto largo',
    email: 'correo',
    phone: 'teléfono',
    number: 'número',
    currency: 'moneda',
    select: 'selección',
    multi_select: 'varias opciones',
    date: 'fecha',
    checkbox: 'casilla',
    file: 'archivos',
    url: 'enlace',
    rating: 'calificación',
};

/**
 * v0.1.359 — «Nuevo formulario»: desde una PLANTILLA (por defecto) o con los
 * campos de la lista (lo de siempre). La plantilla pide un campo de la lista
 * para cada dato y, si falta, lo crea con su tipo y sus opciones.
 */
export function FormCreateDialog({
    open,
    onOpenChange,
    listId,
    listName,
    defaultName,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    listName: string;
    defaultName: string;
    onCreated: (form: FormDto) => void;
}): JSX.Element {
    const [mode, setMode] = useState<Mode>('template');
    useEffect(() => {
        if (!open) setMode('template');
    }, [open]);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-flex-col',
                        mode === 'template' ? 'imcrm-max-w-5xl' : 'imcrm-max-w-md',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg sm:imcrm-p-6',
                    )}
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="form-create-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Nuevo formulario')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {mode === 'template'
                                    ? __('Elige una plantilla completa —preguntas, pasos, diseño y mensajes— y conéctala con los campos de la lista.')
                                    : __('Arranca con los campos de la lista ya puestos: saca los que no quieras preguntar y publícalo.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <div className="imcrm-mt-4 imcrm-grid imcrm-grid-cols-2 imcrm-gap-1 imcrm-rounded-lg imcrm-bg-muted imcrm-p-1">
                        <ModeButton active={mode === 'template'} onClick={() => setMode('template')} icon={LayoutTemplate} label={__('Plantilla')} testId="form-create-mode-template" />
                        <ModeButton active={mode === 'blank'} onClick={() => setMode('blank')} icon={FilePlus2} label={__('Con los campos de la lista')} testId="form-create-mode-blank" />
                    </div>

                    <div className="imcrm-mt-4 imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col">
                        {mode === 'template' ? (
                            <FormTemplateGallery listId={listId} onCreated={onCreated} />
                        ) : (
                            <BlankForm listId={listId} listName={listName} defaultName={defaultName} onCreated={onCreated} />
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function BlankForm({ listId, defaultName, onCreated }: { listId: number; listName: string; defaultName: string; onCreated: (form: FormDto) => void }): JSX.Element {
    const create = useCreateForm(listId);
    const [name, setName] = useState(defaultName);
    const [error, setError] = useState<string | null>(null);
    return (
        <form
            className="imcrm-flex imcrm-flex-col imcrm-gap-3"
            onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                create.mutate(
                    { name: name.trim() || defaultName },
                    { onSuccess: onCreated, onError: (err) => setError(err instanceof Error ? err.message : String(err)) },
                );
            }}
        >
            <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-text-sm">
                {__('Nombre del formulario')}
                <Input value={name} maxLength={150} onChange={(e) => setName(e.target.value)} data-testid="form-create-blank-name" />
            </label>
            {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}
            <Button type="submit" disabled={create.isPending} className="imcrm-gap-2" data-testid="form-create-blank">
                {create.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <ClipboardList className="imcrm-h-4 imcrm-w-4" />}
                {__('Crear formulario')}
            </Button>
        </form>
    );
}

function questionCount(t: FormTemplate): number {
    return t.items.filter((i) => 'q' in i).length;
}

/** La sugerencia inicial: el campo que mejor encaja, si no crear uno, si no saltarlo. */
function initialChoices(t: FormTemplate, fields: readonly FieldEntity[], canCreate: boolean): Record<string, Choice> {
    const suggested = suggestRoleMapping(
        t.roles.map((r) => ({ key: r.key, label: r.label, types: r.types, required: !r.optional })),
        fields.map((f) => ({ id: f.id, label: f.label, slug: f.slug, type: f.type })),
    );
    const out: Record<string, Choice> = {};
    for (const r of t.roles) {
        const id = suggested[r.key];
        out[r.key] = id !== undefined ? { kind: 'field', id } : canCreate ? { kind: 'new' } : { kind: 'skip' };
    }
    return out;
}

function FormTemplateGallery({ listId, onCreated }: { listId: number; onCreated: (form: FormDto) => void }): JSX.Element {
    const fields = useFields(listId);
    const createField = useCreateField(listId);
    const createForm = useCreateForm(listId);
    const branding = useBrandingData();
    const canCreateFields = useCan(CAP.MANAGE_FIELDS);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<FormTemplateCategory | 'all'>('all');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [choices, setChoices] = useState<Record<string, Choice>>({});
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const visible = useMemo(() => {
        const q = search
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '');
        return FORM_TEMPLATES.filter((t) => {
            if (category !== 'all' && t.category !== category) return false;
            if (!q) return true;
            const hay = `${t.name} ${t.description} ${FORM_TEMPLATE_CATEGORY_LABELS[t.category]}`
                .toLowerCase()
                .normalize('NFD')
                .replace(/[̀-ͯ]/g, '');
            return hay.includes(q);
        });
    }, [search, category]);
    const categories = FORM_TEMPLATE_CATEGORIES.filter((c) => FORM_TEMPLATES.some((t) => t.category === c));
    const selected = selectedId ? FORM_TEMPLATES.find((t) => t.id === selectedId) ?? null : null;
    const listFields = fields.data ?? [];

    const pick = (t: FormTemplate): void => {
        setSelectedId(t.id);
        setName(t.name);
        setChoices(initialChoices(t, listFields, canCreateFields));
        setError(null);
    };

    // Lo que falta para poder crearlo.
    const problems = useMemo(() => {
        if (!selected) return [] as string[];
        const out: string[] = [];
        const seen = new Map<number, string>();
        for (const r of selected.roles) {
            const c = choices[r.key];
            if ((!c || c.kind === 'skip') && !r.optional) out.push(sprintf(__('Falta un campo para «%s».'), r.label));
            if (c?.kind === 'field') {
                const prev = seen.get(c.id);
                if (prev) out.push(sprintf(__('«%1$s» y «%2$s» usan el mismo campo.'), prev, r.label));
                seen.set(c.id, r.label);
            }
        }
        return out;
    }, [selected, choices]);

    const create = async (): Promise<void> => {
        if (!selected || problems.length) return;
        setBusy(true);
        setError(null);
        try {
            // 1. Los campos que faltan, con el tipo y las opciones de la plantilla.
            const byId = new Map(listFields.map((f) => [f.id, f]));
            const mapping: FormTemplateMapping = {};
            for (const r of selected.roles) {
                const c = choices[r.key];
                if (!c || c.kind === 'skip') {
                    mapping[r.key] = null;
                } else if (c.kind === 'field') {
                    const f = byId.get(c.id);
                    mapping[r.key] = f ? { id: f.id, type: f.type, slug: f.slug, config: f.config as Record<string, unknown> } : null;
                } else {
                    const created = await createField.mutateAsync({ label: r.label, type: r.create.type, ...(r.create.config ? { config: r.create.config } : {}) });
                    mapping[r.key] = { id: created.id, type: created.type, slug: created.slug, config: created.config as Record<string, unknown> };
                }
            }
            // 2. El formulario, con el diseño de la plantilla en el color de la marca.
            const brand = branding.data?.primary_color ?? '#0e7490';
            const theme = selected.settings.theme ? publicThemePresets(brand).find((p) => p.id === selected.settings.theme)?.theme ?? null : null;
            const slugs = [...listFields.map((f) => f.slug), ...Object.values(mapping).flatMap((f) => (f ? [f.slug] : []))];
            const config = buildFormFromTemplate(selected, mapping, { theme, slugs });
            const form = await createForm.mutateAsync({ name: name.trim() || selected.name, config });
            onCreated(form);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-3 imcrm-overflow-y-auto md:imcrm-flex-row md:imcrm-gap-0 md:imcrm-overflow-visible" data-testid="form-templates">
            <div className="imcrm-flex imcrm-min-w-0 imcrm-shrink-0 imcrm-flex-col imcrm-gap-3 md:imcrm-min-h-0 md:imcrm-flex-1 md:imcrm-shrink md:imcrm-pr-4">
                <div className="imcrm-relative">
                    <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-2.5 imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={__('Buscar plantillas')} className="imcrm-pl-8" data-testid="form-templates-search" />
                </div>
                <div className="imcrm-flex imcrm-shrink-0 imcrm-gap-1.5 imcrm-overflow-x-auto imcrm-overflow-y-hidden imcrm-px-0.5 imcrm-py-1">
                    <Chip active={category === 'all'} onClick={() => setCategory('all')}>{__('Todas')}</Chip>
                    {categories.map((c) => (
                        <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{__(FORM_TEMPLATE_CATEGORY_LABELS[c])}</Chip>
                    ))}
                </div>
                {visible.length === 0 ? (
                    <p className="imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">{__('Ninguna plantilla coincide.')}</p>
                ) : (
                    <div className="imcrm-grid imcrm-min-h-0 imcrm-gap-2 sm:imcrm-grid-cols-2 md:imcrm-overflow-y-auto">
                        {visible.map((t) => (
                            <div key={t.id} data-form-template={t.id}>
                                <TemplateCard
                                    icon={listIcon(t.icon) ?? ClipboardList}
                                    color={listColor(t.color) ?? t.color}
                                    name={__(t.name)}
                                    subtitle={__(FORM_TEMPLATE_CATEGORY_LABELS[t.category])}
                                    description={__(t.description)}
                                    meta={sprintf(_n('%d pregunta', '%d preguntas', questionCount(t)), questionCount(t))}
                                    active={t.id === selectedId}
                                    onClick={() => pick(t)}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <aside className="imcrm-flex imcrm-w-full imcrm-shrink-0 imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3 md:imcrm-min-h-0 md:imcrm-w-[24rem] md:imcrm-border-l md:imcrm-border-t-0 md:imcrm-pl-4 md:imcrm-pt-0">
                {!selected ? (
                    <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-py-10 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                        <LayoutTemplate className="imcrm-h-6 imcrm-w-6 imcrm-opacity-50" />
                        {__('Elige una plantilla para ver qué pregunta y conectarla con tu lista.')}
                    </div>
                ) : fields.isLoading ? (
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {__('Cargando los campos…')}
                    </p>
                ) : (
                    <>
                        <div>
                            <h3 className="imcrm-text-sm imcrm-font-semibold">{__(selected.name)}</h3>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__(selected.description)}</p>
                            <TemplateHighlights t={selected} />
                        </div>
                        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-col imcrm-gap-2 md:imcrm-overflow-y-auto" data-testid="form-template-roles">
                            <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Dónde se guarda cada respuesta')}</p>
                            {selected.roles.map((r) => (
                                <RoleRow
                                    key={`${selected.id}:${r.key}`}
                                    role={r}
                                    fields={listFields}
                                    canCreate={canCreateFields}
                                    value={choices[r.key]}
                                    onChange={(c) => setChoices((prev) => ({ ...prev, [r.key]: c }))}
                                />
                            ))}
                            {!canCreateFields && (
                                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {__('Para crear los campos que faltan hace falta poder administrar los campos de la lista: pídeselo a un administrador.')}
                                </p>
                            )}
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
                            <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-text-sm">
                                {__('Nombre del formulario')}
                                <Input value={name} maxLength={150} onChange={(e) => setName(e.target.value)} data-testid="form-template-name" />
                            </label>
                            {problems.map((p) => (
                                <p key={p} className="imcrm-text-xs imcrm-text-destructive">{p}</p>
                            ))}
                            {error && (
                                <p className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-2 imcrm-text-xs imcrm-text-destructive">{error}</p>
                            )}
                            <Button onClick={() => void create()} disabled={busy || problems.length > 0} className="imcrm-gap-2" data-testid="form-template-create">
                                {busy ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />}
                                {busy ? __('Creando…') : __('Usar esta plantilla')}
                            </Button>
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Se abre en el constructor para revisarlo antes de publicar.')}</p>
                        </div>
                    </>
                )}
            </aside>
        </div>
    );
}

/** Lo que trae la plantilla, en una línea de chips. */
function TemplateHighlights({ t }: { t: FormTemplate }): JSX.Element {
    const chips: string[] = [];
    const pages = t.items.filter((i) => 'page' in i).length;
    if (pages > 1) chips.push(sprintf(__('%d pasos'), pages));
    if (t.settings.layout === 'conversational') chips.push(__('Una pregunta por pantalla'));
    if (t.settings.welcome) chips.push(__('Bienvenida'));
    if (t.items.some((i) => 'q' in i && i.show_if)) chips.push(__('Preguntas que aparecen solas'));
    if (t.calcs?.length) chips.push(__('Puntaje'));
    if (t.endings?.length) chips.push(sprintf(__('%d pantallas finales'), t.endings.length));
    if (t.settings.save_progress) chips.push(__('Guardar el avance'));
    if (t.settings.theme) chips.push(__('Diseño incluido'));
    return (
        <div className="imcrm-mt-2 imcrm-flex imcrm-flex-wrap imcrm-gap-1">
            {chips.map((c) => (
                <span key={c} className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-muted-foreground">{c}</span>
            ))}
        </div>
    );
}

function RoleRow({
    role,
    fields,
    canCreate,
    value,
    onChange,
}: {
    role: FormTemplate['roles'][number];
    fields: readonly FieldEntity[];
    canCreate: boolean;
    value: Choice | undefined;
    onChange: (c: Choice) => void;
}): JSX.Element {
    const compatible = fields.filter((f) => role.types.includes(f.type as FieldType));
    const current = value?.kind === 'field' ? `f:${value.id}` : value?.kind === 'new' ? 'new' : 'skip';
    const typeLabel = FIELD_TYPE_LABELS[role.create.type] ?? role.create.type;
    return (
        <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-xs" data-role={role.key}>
            <span className="imcrm-font-medium">
                {__(role.label)}
                {role.optional && <span className="imcrm-font-normal imcrm-text-muted-foreground"> · {__('opcional')}</span>}
            </span>
            <Select
                aria-label={__(role.label)}
                value={current}
                onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'new') onChange({ kind: 'new' });
                    else if (v === 'skip') onChange({ kind: 'skip' });
                    else onChange({ kind: 'field', id: Number(v.slice(2)) });
                }}
                className="imcrm-h-8 imcrm-text-xs"
            >
                {compatible.map((f) => (
                    <option key={f.id} value={`f:${f.id}`}>{f.label}</option>
                ))}
                {canCreate && <option value="new">{sprintf(__('+ Crear el campo «%1$s» (%2$s)'), __(role.label), __(typeLabel))}</option>}
                {(role.optional || current === 'skip') && <option value="skip">{role.optional ? __('No preguntarlo') : __('— Elige un campo —')}</option>}
            </Select>
        </label>
    );
}

function ModeButton({
    active,
    onClick,
    icon: Icon,
    label,
    testId,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    testId: string;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            data-testid={testId}
            className={cn(
                'imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-rounded-md imcrm-px-3 imcrm-py-1.5 imcrm-text-sm imcrm-transition-colors',
                active ? 'imcrm-bg-card imcrm-font-medium imcrm-shadow-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
            )}
        >
            <Icon className="imcrm-h-4 imcrm-w-4" />
            <span className="imcrm-truncate">{label}</span>
        </button>
    );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'imcrm-shrink-0 imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-0.5 imcrm-text-xs imcrm-transition-colors',
                active ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary' : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-text-foreground',
            )}
        >
            {children}
        </button>
    );
}
