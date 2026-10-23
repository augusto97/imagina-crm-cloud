import { useMemo } from 'react';
import { Link } from 'react-router';
import {
    BUTTON_ICONS,
    BUTTON_MAX_ACTIONS,
    BUTTON_ROLES,
    BUTTON_SET_MODE_LABELS,
    BUTTON_TARGET_TYPES,
    buttonActionProblem,
    buttonSetModesFor,
    readButtonConfig,
    type ButtonAction,
    type ButtonActionType,
    type ButtonConfig,
    type ButtonIcon,
    type ButtonSetValue,
} from '@imagina-base/shared';
import { ChevronDown, ChevronUp, ExternalLink, FileText, Mail, MapPin, MessageCircle, Phone, PenLine, Plus, Trash2, Zap } from 'lucide-react';

import { FilterGroupView } from '@/admin/records/FilterGroupView';
import { makeGroup } from '@/admin/records/filterTree';
import { MergeTagInput } from '@/admin/automations/MergeTagInput';
import { FieldValueInput } from '@/admin/automations/config-editors';
import { useDocumentTemplates } from '@/admin/documents/useDocuments';
import { BUTTON_ICON_COMPONENTS, FieldButtonView } from '@/components/fields/FieldButtonView';
import { ROLE_LABELS } from '@/cloud/components/MemberControls';
import { Button } from '@/components/ui/button';
import { ColorPicker, type OptionColor } from '@/components/ui/color-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { UserPicker } from '@/components/ui/user-picker';
import { useAutomations } from '@/hooks/useAutomations';
import { useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { FilterTree } from '@/types/record';

const ACTION_META: Record<ButtonActionType, { label: string; hint: string; icon: typeof Zap }> = {
    open_url: {
        label: 'Abrir un enlace',
        hint: 'WhatsApp, un mapa, un correo u otra app, con datos del registro.',
        icon: ExternalLink,
    },
    update_fields: {
        label: 'Cambiar campos',
        hint: '«Marcar como pagado», poner la fecha de hoy, asignarte el registro.',
        icon: PenLine,
    },
    run_automation: {
        label: 'Correr una automatización',
        hint: 'Las que tienen el disparador «Al presionar el botón».',
        icon: Zap,
    },
    generate_pdf: {
        label: 'Generar un PDF',
        hint: 'Una cotización o cuenta de cobro con los datos del registro.',
        icon: FileText,
    },
};


function newAction(type: ButtonActionType): ButtonAction {
    switch (type) {
        case 'open_url':
            return { type, url: '' };
        case 'update_fields':
            return { type, values: [] };
        case 'run_automation':
            return { type, automation_id: null };
        case 'generate_pdf':
            return { type, document_template_id: null, mode: 'download', save_field_id: null, save_mode: 'append' };
    }
}

/**
 * Editor de la config de un campo «Botón»: cómo se ve, qué hace al
 * presionarlo (una o varias acciones en orden), cuándo se deshabilita, quién
 * lo puede presionar y qué hace en el portal. Lo que se guarda es exactamente
 * `buttonConfigSchema` (shared); el servidor vuelve a validar las referencias.
 */
export function ButtonFieldEditor({
    config: raw,
    onChange,
    listId,
    currentFieldId,
}: {
    config: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
    listId?: number;
    currentFieldId?: number;
}): JSX.Element {
    const config = useMemo(() => readButtonConfig(raw), [raw]);
    const fieldsQuery = useFields(listId);
    const fields = useMemo(() => (fieldsQuery.data ?? []).filter((f) => f.id !== currentFieldId), [fieldsQuery.data, currentFieldId]);

    const set = (patch: Partial<ButtonConfig>): void => {
        const next: Record<string, unknown> = { ...config, ...patch };
        for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
        onChange(next);
    };
    const setAction = (index: number, action: ButtonAction): void => {
        set({ actions: config.actions.map((a, i) => (i === index ? action : a)) });
    };
    const moveAction = (index: number, dir: -1 | 1): void => {
        const list = [...config.actions];
        const target = index + dir;
        if (target < 0 || target >= list.length) return;
        const [item] = list.splice(index, 1);
        list.splice(target, 0, item!);
        set({ actions: list });
    };

    const hasAutomation = config.actions.some((a) => a.type === 'run_automation');
    const roles = config.roles ?? [...BUTTON_ROLES];

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="button-field-editor">
            {/* Cómo se ve */}
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="button-label">{__('Texto del botón')}</Label>
                    <Input
                        id="button-label"
                        value={config.label ?? ''}
                        maxLength={60}
                        placeholder={__('Vacío = el nombre del campo')}
                        onChange={(e) => set({ label: e.target.value === '' ? undefined : e.target.value })}
                    />
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Color')}</Label>
                    <ColorPicker
                        value={(config.color ?? null) as OptionColor | null}
                        onChange={(c) => set({ color: c ?? undefined })}
                    />
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Icono')}</Label>
                    <div className="imcrm-grid imcrm-grid-cols-8 imcrm-gap-1" role="radiogroup" aria-label={__('Icono')}>
                        <IconChoice selected={!config.icon} label={__('Sin icono')} onSelect={() => set({ icon: undefined })}>
                            <span className="imcrm-text-[10px] imcrm-text-muted-foreground">—</span>
                        </IconChoice>
                        {BUTTON_ICONS.map((key) => {
                            const Icon = BUTTON_ICON_COMPONENTS[key as ButtonIcon];
                            return (
                                <IconChoice key={key} selected={config.icon === key} label={key} onSelect={() => set({ icon: key })}>
                                    <Icon className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                </IconChoice>
                            );
                        })}
                    </div>
                </div>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Así se ve:')}</span>
                    <FieldButtonView
                        label={config.label?.trim() || __('Botón')}
                        color={config.color}
                        icon={config.icon}
                        inert
                    />
                </div>
            </section>

            {/* Qué hace */}
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
                <div>
                    <Label>{__('Al presionarlo')}</Label>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Las acciones se ejecutan en este orden; si una falla, las siguientes no corren.')}
                    </p>
                </div>
                {config.actions.map((action, i) => (
                    <ActionCard
                        key={i}
                        index={i}
                        total={config.actions.length}
                        action={action}
                        fields={fields}
                        listId={listId}
                        currentFieldId={currentFieldId}
                        onChange={(a) => setAction(i, a)}
                        onMove={(dir) => moveAction(i, dir)}
                        onRemove={() => set({ actions: config.actions.filter((_, j) => j !== i) })}
                    />
                ))}
                {config.actions.length < BUTTON_MAX_ACTIONS && (
                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1.5" data-testid="button-add-action">
                        {(Object.keys(ACTION_META) as ButtonActionType[]).map((type) => {
                            const meta = ACTION_META[type];
                            const Icon = meta.icon;
                            return (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => set({ actions: [...config.actions, newAction(type)] })}
                                    className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-xs hover:imcrm-bg-accent"
                                >
                                    <Plus className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                                    <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                                    <span className="imcrm-truncate">{__(meta.label)}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Confirmación */}
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-border-t imcrm-border-border imcrm-pt-3">
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input
                        type="checkbox"
                        checked={config.confirm !== undefined}
                        onChange={(e) => set({ confirm: e.target.checked ? sprintf(__('¿%s?'), config.label?.trim() || __('Continuar')) : undefined })}
                    />
                    {__('Pedir confirmación antes')}
                </label>
                {config.confirm !== undefined && (
                    <Input
                        value={config.confirm}
                        maxLength={200}
                        placeholder={__('¿Marcar como pagado?')}
                        aria-label={__('Pregunta de confirmación')}
                        onChange={(e) => set({ confirm: e.target.value })}
                    />
                )}
            </section>

            {/* Deshabilitado si… */}
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-border-t imcrm-border-border imcrm-pt-3">
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input
                        type="checkbox"
                        data-testid="button-disabled-toggle"
                        checked={!!config.disabled_if}
                        onChange={(e) =>
                            set(
                                e.target.checked
                                    ? { disabled_if: makeGroup('and', []) as ButtonConfig['disabled_if'] }
                                    : { disabled_if: undefined, disabled_reason: undefined },
                            )
                        }
                    />
                    {__('Deshabilitarlo cuando el registro cumpla…')}
                </label>
                {config.disabled_if && (
                    <>
                        <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                            <FilterGroupView
                                root={config.disabled_if as FilterTree}
                                path={[]}
                                fields={fields}
                                listId={listId}
                                onRootChange={(next) => set({ disabled_if: next as ButtonConfig['disabled_if'] })}
                            />
                        </div>
                        <Label htmlFor="button-disabled-reason" className="imcrm-text-xs">
                            {__('Por qué (se ve al pasar el mouse)')}
                        </Label>
                        <Input
                            id="button-disabled-reason"
                            value={config.disabled_reason ?? ''}
                            maxLength={200}
                            placeholder={__('Ya está pagado')}
                            onChange={(e) => set({ disabled_reason: e.target.value === '' ? undefined : e.target.value })}
                        />
                    </>
                )}
            </section>

            {/* Quién */}
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-border-t imcrm-border-border imcrm-pt-3">
                <Label>{__('Quién puede presionarlo')}</Label>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-3">
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-text-muted-foreground">
                        <input type="checkbox" checked disabled />
                        {__(ROLE_LABELS.admin ?? 'Admin')}
                    </label>
                    {BUTTON_ROLES.map((role) => (
                        <label key={role} className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm">
                            <input
                                type="checkbox"
                                data-testid={`button-role-${role}`}
                                checked={roles.includes(role)}
                                onChange={(e) => {
                                    const next = e.target.checked ? [...roles, role] : roles.filter((r) => r !== role);
                                    set({ roles: next.length === BUTTON_ROLES.length ? undefined : BUTTON_ROLES.filter((r) => next.includes(r)) });
                                }}
                            />
                            {__(ROLE_LABELS[role] ?? role)}
                        </label>
                    ))}
                </div>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Si el botón cambia campos, además hay que poder editar el registro.')}
                </p>
            </section>

            {/* Portal */}
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-border-t imcrm-border-border imcrm-pt-3">
                <Label>{__('En el portal del cliente')}</Label>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Aparece si lo agregas al diseño del portal. Ahí sólo abre enlaces, cambia campos que el cliente puede editar y genera PDF publicados en el portal.')}
                </p>
                {hasAutomation && (
                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="checkbox"
                            className="imcrm-mt-0.5"
                            checked={config.portal_run_automation === true}
                            onChange={(e) => set({ portal_run_automation: e.target.checked ? true : undefined })}
                        />
                        <span>
                            {__('Permitir que el cliente corra la automatización')}
                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                {__('La automatización corre con los permisos del equipo: puede enviar correos o cambiar otros registros. Actívalo sólo si es seguro que un cliente la dispare.')}
                            </span>
                        </span>
                    </label>
                )}
            </section>
        </div>
    );
}

function IconChoice({
    selected,
    label,
    onSelect,
    children,
}: {
    selected: boolean;
    label: string;
    onSelect: () => void;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={onSelect}
            className={cn(
                'imcrm-flex imcrm-h-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-border imcrm-transition',
                selected
                    ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary'
                    : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
            )}
        >
            {children}
        </button>
    );
}

function ActionCard({
    index,
    total,
    action,
    fields,
    listId,
    currentFieldId,
    onChange,
    onMove,
    onRemove,
}: {
    index: number;
    total: number;
    action: ButtonAction;
    fields: FieldEntity[];
    listId?: number;
    currentFieldId?: number;
    onChange: (a: ButtonAction) => void;
    onMove: (dir: -1 | 1) => void;
    onRemove: () => void;
}): JSX.Element {
    const meta = ACTION_META[action.type];
    const Icon = meta.icon;
    const problem = buttonActionProblem(action);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2.5" data-testid={`button-action-${action.type}`}>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <span className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-[11px] imcrm-font-semibold">
                    {index + 1}
                </span>
                <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-sm imcrm-font-medium">{__(meta.label)}</span>
                <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" disabled={index === 0} onClick={() => onMove(-1)} aria-label={__('Subir')}>
                    <ChevronUp className="imcrm-h-3.5 imcrm-w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" disabled={index === total - 1} onClick={() => onMove(1)} aria-label={__('Bajar')}>
                    <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" onClick={onRemove} aria-label={__('Quitar la acción')}>
                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                </Button>
            </div>
            {action.type === 'open_url' && <OpenUrlEditor action={action} fields={fields} onChange={onChange} />}
            {action.type === 'update_fields' && <UpdateFieldsEditor action={action} fields={fields} onChange={onChange} />}
            {action.type === 'run_automation' && (
                <RunAutomationEditor action={action} listId={listId} currentFieldId={currentFieldId} onChange={onChange} />
            )}
            {action.type === 'generate_pdf' && <GeneratePdfEditor action={action} fields={fields} listId={listId} onChange={onChange} />}
            {problem && <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">{problem}</p>}
        </div>
    );
}

// ── Abrir un enlace ─────────────────────────────────────────────────────────

const ADDRESS_RE = /direcci|address|ubicaci|domicilio/i;

function OpenUrlEditor({
    action,
    fields,
    onChange,
}: {
    action: Extract<ButtonAction, { type: 'open_url' }>;
    fields: FieldEntity[];
    onChange: (a: ButtonAction) => void;
}): JSX.Element {
    const tag = (f: FieldEntity | undefined, fallback: string): string => `{{${f?.slug ?? fallback}}}`;
    const phone = fields.find((f) => f.type === 'phone');
    const email = fields.find((f) => f.type === 'email');
    const title = fields.find((f) => f.is_primary) ?? fields.find((f) => f.type === 'text');
    const address = fields.find((f) => (f.type === 'text' || f.type === 'long_text') && ADDRESS_RE.test(`${f.slug} ${f.label}`));
    const presets: Array<{ label: string; icon: typeof Zap; url: string }> = [
        { label: 'WhatsApp', icon: MessageCircle, url: `https://wa.me/${tag(phone, 'telefono')}?text=Hola ${tag(title, 'nombre')}` },
        { label: __('Llamar'), icon: Phone, url: `tel:${tag(phone, 'telefono')}` },
        { label: __('Correo'), icon: Mail, url: `mailto:${tag(email, 'email')}?subject=${tag(title, 'nombre')}` },
        { label: __('Mapa'), icon: MapPin, url: `https://www.google.com/maps/search/?api=1&query=${tag(address, 'direccion')}` },
    ];
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                {presets.map((p) => (
                    <button
                        key={p.label}
                        type="button"
                        onClick={() => onChange({ ...action, url: p.url })}
                        className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-px-2 imcrm-py-0.5 imcrm-text-xs hover:imcrm-bg-accent"
                    >
                        <p.icon className="imcrm-h-3 imcrm-w-3" aria-hidden />
                        {p.label}
                    </button>
                ))}
            </div>
            <MergeTagInput
                value={action.url}
                onChange={(url) => onChange({ ...action, url })}
                fields={fields}
                rows={1}
                autoGrow
                tagContext="document"
                placeholder="https://wa.me/{{telefono}}?text=Hola {{nombre}}"
                aria-label={__('Enlace')}
            />
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Empieza con https://, mailto: o tel:. Las variables se completan con los datos del registro; un teléfono va con su indicativo.')}
            </p>
        </div>
    );
}

// ── Cambiar campos ──────────────────────────────────────────────────────────

function UpdateFieldsEditor({
    action,
    fields,
    onChange,
}: {
    action: Extract<ButtonAction, { type: 'update_fields' }>;
    fields: FieldEntity[];
    onChange: (a: ButtonAction) => void;
}): JSX.Element {
    const targets = fields.filter((f) => BUTTON_TARGET_TYPES.includes(f.type));
    const setRow = (i: number, row: ButtonSetValue): void =>
        onChange({ ...action, values: action.values.map((r, j) => (j === i ? row : r)) });
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            {action.values.map((row, i) => {
                const field = targets.find((f) => f.id === row.field_id);
                const modes = field ? buttonSetModesFor(field.type) : [];
                return (
                    <div key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-muted/30 imcrm-p-2" data-testid="button-set-row">
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                            <Select
                                className="imcrm-min-w-0 imcrm-flex-1"
                                aria-label={__('Campo')}
                                value={String(row.field_id ?? 0)}
                                onChange={(e) => {
                                    const f = targets.find((x) => x.id === Number(e.target.value));
                                    if (!f) return;
                                    const nextModes = buttonSetModesFor(f.type);
                                    setRow(i, { field_id: f.id, mode: nextModes.includes(row.mode) ? row.mode : 'set', value: undefined });
                                }}
                            >
                                {!field && <option value="0">{__('Elige un campo…')}</option>}
                                {targets.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.label}
                                    </option>
                                ))}
                            </Select>
                            <Select
                                className="imcrm-w-[130px] imcrm-shrink-0"
                                aria-label={__('Cómo')}
                                value={row.mode}
                                disabled={!field}
                                onChange={(e) => setRow(i, { ...row, mode: e.target.value as ButtonSetValue['mode'], value: undefined })}
                            >
                                {modes.map((m) => (
                                    <option key={m} value={m}>
                                        {__(BUTTON_SET_MODE_LABELS[m])}
                                    </option>
                                ))}
                            </Select>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="imcrm-h-7 imcrm-w-7 imcrm-shrink-0"
                                aria-label={__('Quitar')}
                                onClick={() => onChange({ ...action, values: action.values.filter((_, j) => j !== i) })}
                            >
                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            </Button>
                        </div>
                        {field && row.mode === 'set' && (
                            field.type === 'user' ? (
                                <UserPicker
                                    value={typeof row.value === 'number' ? row.value : null}
                                    onChange={(id) => setRow(i, { ...row, value: id ?? undefined })}
                                />
                            ) : (
                                <FieldValueInput field={field} availableFields={fields} value={row.value} onChange={(v) => setRow(i, { ...row, value: v })} />
                            )
                        )}
                        {field && row.mode === 'add' && (
                            <Input
                                inputMode="decimal"
                                aria-label={__('Cuánto sumar')}
                                placeholder={field.type === 'duration' ? __('Minutos (negativo resta)') : __('1 (negativo resta)')}
                                value={row.value === undefined || row.value === null ? '' : String(row.value)}
                                onChange={(e) => {
                                    const raw = e.target.value.trim().replace(',', '.');
                                    const n = Number(raw);
                                    setRow(i, { ...row, value: raw === '' || raw === '-' || !Number.isFinite(n) ? raw : n });
                                }}
                            />
                        )}
                    </div>
                );
            })}
            {action.values.length < 20 && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="imcrm-gap-1.5 imcrm-self-start"
                    disabled={targets.length === 0}
                    onClick={() => {
                        const used = new Set(action.values.map((r) => r.field_id));
                        const f = targets.find((x) => !used.has(x.id)) ?? targets[0];
                        if (!f) return;
                        onChange({ ...action, values: [...action.values, { field_id: f.id, mode: 'set', value: undefined }] });
                    }}
                >
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar campo')}
                </Button>
            )}
            {targets.length === 0 && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Esta lista no tiene campos que un botón pueda cambiar.')}</p>
            )}
        </div>
    );
}

// ── Correr una automatización ───────────────────────────────────────────────

function RunAutomationEditor({
    action,
    listId,
    currentFieldId,
    onChange,
}: {
    action: Extract<ButtonAction, { type: 'run_automation' }>;
    listId?: number;
    currentFieldId?: number;
    onChange: (a: ButtonAction) => void;
}): JSX.Element {
    const automations = useAutomations(listId);
    const lists = useLists();
    const slug = lists.data?.find((l) => l.id === listId)?.slug;
    const listening = (automations.data ?? []).filter((a) => {
        if (a.trigger_type !== 'button_pressed') return false;
        const wanted = Number((a.trigger_config as Record<string, unknown>).button_field_id);
        return !Number.isInteger(wanted) || wanted <= 0 || wanted === currentFieldId;
    });
    const current = action.automation_id ?? 0;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Select
                aria-label={__('Automatización')}
                value={String(current)}
                onChange={(e) => {
                    const id = Number(e.target.value);
                    onChange({ ...action, automation_id: id > 0 ? id : null });
                }}
            >
                <option value="0">{__('Todas las que escuchan este botón')}</option>
                {listening.map((a) => (
                    <option key={a.id} value={a.id}>
                        {a.name}
                        {a.is_active ? '' : ` (${__('pausada')})`}
                    </option>
                ))}
                {current > 0 && !listening.some((a) => a.id === current) && !automations.isLoading && (
                    <option value={current}>{__('Automatización que ya no escucha este botón')}</option>
                )}
            </Select>
            {!automations.isLoading && listening.length === 0 && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Todavía no hay automatizaciones con el disparador «Al presionar el botón».')}
                </p>
            )}
            {slug && currentFieldId !== undefined ? (
                <Link
                    to={`/lists/${slug}/automations/new?trigger=button_pressed&button=${currentFieldId}`}
                    target="_blank"
                    rel="noopener"
                    className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-self-start imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                >
                    <Plus className="imcrm-h-3 imcrm-w-3" aria-hidden />
                    {__('Crear una automatización para este botón')}
                </Link>
            ) : (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Crea el campo primero; después puedes armar su automatización desde aquí o desde el menú de la columna.')}
                </p>
            )}
        </div>
    );
}

// ── Generar un PDF ──────────────────────────────────────────────────────────

function GeneratePdfEditor({
    action,
    fields,
    listId,
    onChange,
}: {
    action: Extract<ButtonAction, { type: 'generate_pdf' }>;
    fields: FieldEntity[];
    listId?: number;
    onChange: (a: ButtonAction) => void;
}): JSX.Element {
    const templates = useDocumentTemplates(listId);
    const fileFields = fields.filter((f) => f.type === 'file');
    const current = action.document_template_id ?? 0;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Select
                aria-label={__('Plantilla')}
                value={String(current)}
                onChange={(e) => {
                    const id = Number(e.target.value);
                    onChange({ ...action, document_template_id: id > 0 ? id : null });
                }}
            >
                <option value="0">{__('Elige una plantilla…')}</option>
                {(templates.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                        {t.name}
                    </option>
                ))}
            </Select>
            {!templates.isLoading && (templates.data ?? []).length === 0 && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Esta lista no tiene plantillas de documento: créalas en Ajustes de la lista → Documentos.')}
                </p>
            )}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-3 imcrm-text-sm">
                <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <input
                        type="radio"
                        checked={action.mode === 'download'}
                        onChange={() => onChange({ ...action, mode: 'download', save_field_id: null })}
                    />
                    {__('Descargarlo')}
                </label>
                <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <input
                        type="radio"
                        checked={action.mode === 'save'}
                        onChange={() => onChange({ ...action, mode: 'save', save_field_id: action.save_field_id ?? fileFields[0]?.id ?? null })}
                    />
                    {__('Guardarlo en un campo')}
                </label>
            </div>
            {action.mode === 'save' && (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <Select
                        className="imcrm-min-w-0 imcrm-flex-1"
                        aria-label={__('Campo Archivo')}
                        value={String(action.save_field_id ?? 0)}
                        onChange={(e) => {
                            const id = Number(e.target.value);
                            onChange({ ...action, save_field_id: id > 0 ? id : null });
                        }}
                    >
                        <option value="0">{__('Elige un campo Archivo…')}</option>
                        {fileFields.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.label}
                            </option>
                        ))}
                    </Select>
                    <Select
                        className="imcrm-w-[150px] imcrm-shrink-0"
                        aria-label={__('Si ya hay archivos')}
                        value={action.save_mode}
                        onChange={(e) => onChange({ ...action, save_mode: e.target.value as 'append' | 'replace' })}
                    >
                        <option value="append">{__('Agregarlo')}</option>
                        <option value="replace">{__('Reemplazar')}</option>
                    </Select>
                </div>
            )}
        </div>
    );
}
