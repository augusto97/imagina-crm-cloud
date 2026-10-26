import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, FileText, GitBranch, ListTodo, Loader2, Plus, Trash2, X } from 'lucide-react';
import {
    jsonbKeyForField,
    type RecordTemplate,
    type RecordTemplateContent,
    type RecordTemplateKind,
    type TemplateChecklist,
    type TemplateChecklistItem,
    type TemplatePerson,
    type TemplateSubtask,
    type TemplateValue,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { useCreateRecordTemplate, useUpdateRecordTemplate } from '@/hooks/useRecordTemplates';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { CompactFieldRow } from '../crm/CompactFieldRow';
import { PersonControl, RelativeDateControl } from './TemplateControls';
import {
    EMPTY_CONTENT,
    RELATIVE_TODAY,
    cleanValues,
    initialValueFor,
    isDateField,
    isUserField,
    templateValueFields,
    titleFieldOf,
} from './templateModel';

interface RecordTemplateEditorProps {
    listId: number;
    fields: FieldEntity[];
    kind: RecordTemplateKind;
    /** La plantilla a editar; null = nueva. */
    template: RecordTemplate | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** Saca las personas fijas sin elegir (el selector deja `user_id: 0` hasta que se elige). */
function cleanPerson(p: TemplatePerson | null): TemplatePerson | null {
    return p && p.kind === 'user' && !(p.user_id > 0) ? null : p;
}

function cleanContent(c: RecordTemplateContent): RecordTemplateContent {
    const values = (vals: Record<string, TemplateValue>): Record<string, TemplateValue> => {
        const out: Record<string, TemplateValue> = {};
        for (const [k, v] of Object.entries(cleanValues(vals))) {
            if (v.mode === 'person' && cleanPerson(v.person) === null) continue;
            out[k] = v;
        }
        return out;
    };
    return {
        values: values(c.values),
        subtasks: c.subtasks.filter((s) => s.title.trim() !== '').map((s) => ({ title: s.title.trim(), values: values(s.values) })),
        checklists: c.checklists
            .map((cl) => ({
                name: cl.name.trim() === '' ? __('Checklist') : cl.name.trim(),
                items: cl.items.filter((i) => i.text.trim() !== '').map((i) => ({ ...i, text: i.text.trim(), assignee: cleanPerson(i.assignee) })),
            }))
            .filter((cl) => cl.items.length > 0 || c.checklists.length === 1),
        record_description: c.record_description,
    };
}

/**
 * C6 — Editor de una plantilla de REGISTRO (valores, subtareas, checklists)
 * o de CHECKLIST (un checklist con sus ítems). Los valores dinámicos —fecha
 * relativa en días o días hábiles, persona: quien crea, el valor de un campo
 * Persona o alguien fijo— se resuelven al crear el registro, en la zona de la
 * empresa.
 */
export function RecordTemplateEditor({ listId, fields, kind, template, open, onOpenChange }: RecordTemplateEditorProps): JSX.Element {
    const create = useCreateRecordTemplate(listId);
    const update = useUpdateRecordTemplate(listId);
    const toast = useToast();
    const [name, setName] = useState(template?.name ?? '');
    const [description, setDescription] = useState(template?.description ?? '');
    const [content, setContent] = useState<RecordTemplateContent>(() => {
        const base = template?.content ?? EMPTY_CONTENT;
        if (kind === 'checklist' && base.checklists.length === 0) return { ...base, checklists: [{ name: __('Checklist'), items: [] }] };
        return base;
    });
    const [error, setError] = useState<string | null>(null);
    const pending = create.isPending || update.isPending;

    const save = (): void => {
        setError(null);
        if (name.trim() === '') {
            setError(__('Ponle un nombre a la plantilla.'));
            return;
        }
        const body = cleanContent(content);
        if (kind === 'checklist' && (body.checklists[0]?.items.length ?? 0) === 0) {
            setError(__('Agrega al menos un ítem al checklist.'));
            return;
        }
        const onError = (err: unknown) => setError(err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo guardar la plantilla.'));
        const onSuccess = (t: RecordTemplate) => {
            toast.success(template ? sprintf(__('Se guardó «%s»'), t.name) : sprintf(__('Se creó la plantilla «%s»'), t.name));
            onOpenChange(false);
        };
        if (template) {
            update.mutate({ id: template.id, patch: { name: name.trim(), description: description.trim() || null, content: body } }, { onSuccess, onError });
        } else {
            create.mutate({ kind, name: name.trim(), description: description.trim() || null, content: body }, { onSuccess, onError });
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="sm:imcrm-w-[640px]" data-testid="imcrm-record-template-editor">
                <SheetHeader>
                    <div className="imcrm-min-w-0 imcrm-flex-1 imcrm-pr-8">
                    <SheetTitle>
                        {template
                            ? sprintf(__('Editar «%s»'), template.name)
                            : kind === 'checklist'
                              ? __('Nueva plantilla de checklist')
                              : __('Nueva plantilla de registro')}
                    </SheetTitle>
                    <SheetDescription>
                        {kind === 'checklist'
                            ? __('Un checklist listo para agregar a cualquier registro de la lista.')
                            : __('Crea el registro con sus valores, sus subtareas y sus checklists de una vez.')}
                    </SheetDescription>
                    </div>
                </SheetHeader>
                <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-5">
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="rte-name">{__('Nombre')}</Label>
                            <Input id="rte-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={kind === 'checklist' ? __('Ej.: Arranque de proyecto') : __('Ej.: Nuevo cliente')} data-testid="imcrm-rte-name" />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="rte-desc">{__('Descripción (opcional)')}</Label>
                            <Input id="rte-desc" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder={__('Para qué sirve')} />
                        </div>
                    </div>

                    {kind === 'record' && (
                        <>
                            <ValuesSection listId={listId} fields={fields} values={content.values} onChange={(values) => setContent((c) => ({ ...c, values }))} />
                            <SubtasksSection fields={fields} subtasks={content.subtasks} onChange={(subtasks) => setContent((c) => ({ ...c, subtasks }))} />
                        </>
                    )}

                    <ChecklistsSection
                        fields={fields}
                        single={kind === 'checklist'}
                        checklists={content.checklists}
                        onChange={(checklists) => setContent((c) => ({ ...c, checklists }))}
                    />

                    {kind === 'record' && content.record_description !== null && content.record_description !== undefined && (
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2 imcrm-text-sm">
                            <FileText className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                            <span className="imcrm-flex-1">{__('Incluye una descripción (la del registro del que salió).')}</span>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setContent((c) => ({ ...c, record_description: null }))}>
                                {__('Quitarla')}
                            </Button>
                        </div>
                    )}

                    {error && <p className="imcrm-text-sm imcrm-text-destructive" role="alert">{error}</p>}
                </SheetBody>
                <SheetFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {__('Cancelar')}
                    </Button>
                    <Button onClick={save} disabled={pending} className="imcrm-gap-2" data-testid="imcrm-rte-save">
                        {pending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                        {__('Guardar plantilla')}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}

// ─────────────────────────── Valores ───────────────────────────

function SectionTitle({ icon: Icon, title, hint }: { icon: typeof ListTodo; title: string; hint?: string }): JSX.Element {
    return (
        <div>
            <h4 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-semibold">
                <Icon className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                {title}
            </h4>
            {hint && <p className="imcrm-text-xs imcrm-text-muted-foreground">{hint}</p>}
        </div>
    );
}

function ValuesSection({
    listId,
    fields,
    values,
    onChange,
}: {
    listId: number;
    fields: FieldEntity[];
    values: Record<string, TemplateValue>;
    onChange: (next: Record<string, TemplateValue>) => void;
}): JSX.Element {
    const valueFields = useMemo(() => templateValueFields(fields), [fields]);
    const used = valueFields.filter((f) => values[jsonbKeyForField(f.id)] !== undefined);
    const free = valueFields.filter((f) => values[jsonbKeyForField(f.id)] === undefined);
    const set = (f: FieldEntity, v: TemplateValue | null): void => {
        const next = { ...values };
        if (v === null) delete next[jsonbKeyForField(f.id)];
        else next[jsonbKeyForField(f.id)] = v;
        onChange(next);
    };
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="imcrm-rte-values">
            <SectionTitle icon={FileText} title={__('Valores del registro')} hint={__('Lo que el registro trae puesto al nacer. En el alta se puede cambiar.')} />
            {used.length > 0 && (
                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border/60 imcrm-rounded-md imcrm-border imcrm-border-border">
                    {used.map((f) => (
                        <ValueRow key={f.id} listId={listId} field={f} fields={fields} value={values[jsonbKeyForField(f.id)]!} onChange={(v) => set(f, v)} onRemove={() => set(f, null)} />
                    ))}
                </ul>
            )}
            {free.length > 0 && (
                <Select
                    value=""
                    onChange={(e) => {
                        const f = free.find((x) => String(x.id) === e.target.value);
                        if (f) set(f, initialValueFor(f));
                    }}
                    className="imcrm-h-8 imcrm-w-auto imcrm-self-start"
                    aria-label={__('Agregar un valor')}
                    data-testid="imcrm-rte-add-value"
                >
                    <option value="">{__('+ Agregar un valor…')}</option>
                    {free.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.label}
                        </option>
                    ))}
                </Select>
            )}
        </section>
    );
}

function ValueRow({
    listId,
    field,
    fields,
    value,
    onChange,
    onRemove,
}: {
    listId: number;
    field: FieldEntity;
    fields: FieldEntity[];
    value: TemplateValue;
    onChange: (v: TemplateValue) => void;
    onRemove: () => void;
}): JSX.Element {
    const date = isDateField(field);
    const tools = (
        <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-pt-1.5">
            {date && (
                <Select
                    value={value.mode === 'relative_date' ? 'relative' : 'fixed'}
                    onChange={(e) => onChange(e.target.value === 'relative' ? { mode: 'relative_date', date: { ...RELATIVE_TODAY } } : { mode: 'fixed', value: null })}
                    className="imcrm-h-7 imcrm-w-auto imcrm-text-xs"
                    aria-label={__('Tipo de fecha')}
                    data-testid="imcrm-rte-date-mode"
                >
                    <option value="relative">{__('Relativa')}</option>
                    <option value="fixed">{__('Fija')}</option>
                </Select>
            )}
            <button type="button" onClick={onRemove} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive" aria-label={sprintf(__('Quitar «%s»'), field.label)}>
                <X className="imcrm-h-3.5 imcrm-w-3.5" />
            </button>
        </div>
    );
    if (value.mode === 'fixed') {
        // Valor fijo: la MISMA fila de la ficha (selector de opciones, fecha, número…).
        return (
            <li className="imcrm-flex imcrm-items-start imcrm-gap-1 imcrm-pr-2" data-testid="imcrm-rte-value" data-field={field.slug}>
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <CompactFieldRow field={field} listId={listId} value={value.value ?? null} onChange={(v) => onChange({ mode: 'fixed', value: v })} />
                </div>
                {tools}
            </li>
        );
    }
    return (
        <li className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-px-3 imcrm-py-2" data-testid="imcrm-rte-value" data-field={field.slug}>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{field.label}</span>
                {tools}
            </div>
            {value.mode === 'relative_date' ? (
                <RelativeDateControl value={value.date} onChange={(d) => onChange({ mode: 'relative_date', date: d })} fields={fields} withTime={field.type === 'datetime'} excludeFieldId={field.id} />
            ) : (
                <PersonControl value={value.person} onChange={(p) => onChange({ mode: 'person', person: p ?? { kind: 'creator' } })} fields={fields} allowNone={false} excludeFieldId={field.id} />
            )}
        </li>
    );
}

// ─────────────────────────── Subtareas ───────────────────────────

function SubtasksSection({
    fields,
    subtasks,
    onChange,
}: {
    fields: FieldEntity[];
    subtasks: TemplateSubtask[];
    onChange: (next: TemplateSubtask[]) => void;
}): JSX.Element {
    const userFields = fields.filter(isUserField);
    const dateFields = fields.filter(isDateField);
    const firstKey = (list: FieldEntity[], pred: (k: string) => boolean): number | null => {
        for (const s of subtasks) for (const k of Object.keys(s.values)) if (pred(k)) return Number(k.slice(1));
        return list[0]?.id ?? null;
    };
    const [userFieldId, setUserFieldId] = useState<number | null>(() => firstKey(userFields, (k) => userFields.some((f) => jsonbKeyForField(f.id) === k)));
    const [dateFieldId, setDateFieldId] = useState<number | null>(() => firstKey(dateFields, (k) => dateFields.some((f) => jsonbKeyForField(f.id) === k)));
    const title = titleFieldOf(fields);

    const moveKey = (from: number | null, to: number | null): void => {
        if (from === null || to === null || from === to) return;
        onChange(
            subtasks.map((s) => {
                const v = { ...s.values };
                const old = v[jsonbKeyForField(from)];
                delete v[jsonbKeyForField(from)];
                if (old) v[jsonbKeyForField(to)] = old;
                return { ...s, values: v };
            }),
        );
    };
    const setAt = (i: number, patch: Partial<TemplateSubtask>): void => onChange(subtasks.map((s, n) => (n === i ? { ...s, ...patch } : s)));
    const setValue = (i: number, fieldId: number, v: TemplateValue | null): void => {
        const s = subtasks[i]!;
        const values = { ...s.values };
        if (v === null) delete values[jsonbKeyForField(fieldId)];
        else values[jsonbKeyForField(fieldId)] = v;
        setAt(i, { values });
    };
    const move = (i: number, d: -1 | 1): void => {
        const j = i + d;
        if (j < 0 || j >= subtasks.length) return;
        const next = [...subtasks];
        [next[i], next[j]] = [next[j]!, next[i]!];
        onChange(next);
    };

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="imcrm-rte-subtasks">
            <SectionTitle icon={GitBranch} title={__('Subtareas')} hint={title ? sprintf(__('Cada una nace como un registro hijo; su título va a «%s».'), title.label) : undefined} />
            {subtasks.length > 0 && (userFields.length > 1 || dateFields.length > 1) && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                    {userFields.length > 1 && (
                        <label className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                            {__('Responsable en')}
                            <Select
                                value={userFieldId ?? ''}
                                onChange={(e) => {
                                    const next = Number(e.target.value);
                                    moveKey(userFieldId, next);
                                    setUserFieldId(next);
                                }}
                                className="imcrm-h-7 imcrm-w-auto imcrm-text-xs"
                            >
                                {userFields.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.label}
                                    </option>
                                ))}
                            </Select>
                        </label>
                    )}
                    {dateFields.length > 1 && (
                        <label className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                            {__('Fecha en')}
                            <Select
                                value={dateFieldId ?? ''}
                                onChange={(e) => {
                                    const next = Number(e.target.value);
                                    moveKey(dateFieldId, next);
                                    setDateFieldId(next);
                                }}
                                className="imcrm-h-7 imcrm-w-auto imcrm-text-xs"
                            >
                                {dateFields.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.label}
                                    </option>
                                ))}
                            </Select>
                        </label>
                    )}
                </div>
            )}
            {subtasks.length > 0 && (
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    {subtasks.map((s, i) => {
                        const person = userFieldId !== null ? s.values[jsonbKeyForField(userFieldId)] : undefined;
                        const due = dateFieldId !== null ? s.values[jsonbKeyForField(dateFieldId)] : undefined;
                        const dateField = fields.find((f) => f.id === dateFieldId);
                        return (
                            <li key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2.5" data-testid="imcrm-rte-subtask">
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                    <span className="imcrm-w-5 imcrm-text-right imcrm-text-xs imcrm-tabular-nums imcrm-text-muted-foreground">{i + 1}.</span>
                                    <Input value={s.title} maxLength={500} onChange={(e) => setAt(i, { title: e.target.value })} placeholder={__('Título de la subtarea')} className="imcrm-h-8 imcrm-flex-1" />
                                    <RowActions index={i} count={subtasks.length} onMove={(d) => move(i, d)} onRemove={() => onChange(subtasks.filter((_, n) => n !== i))} />
                                </div>
                                {(userFieldId !== null || dateFieldId !== null) && (
                                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1.5 imcrm-pl-6">
                                        {userFieldId !== null && (
                                            <PersonControl
                                                value={person?.mode === 'person' ? person.person : null}
                                                onChange={(p) => setValue(i, userFieldId, p ? { mode: 'person', person: p } : null)}
                                                fields={fields}
                                                allowNone
                                            />
                                        )}
                                        {dateFieldId !== null &&
                                            (due?.mode === 'relative_date' ? (
                                                <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                                    <RelativeDateControl value={due.date} onChange={(d) => setValue(i, dateFieldId, { mode: 'relative_date', date: d })} fields={fields} withTime={dateField?.type === 'datetime'} />
                                                    <button type="button" onClick={() => setValue(i, dateFieldId, null)} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-text-destructive" aria-label={__('Quitar la fecha')}>
                                                        <X className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setValue(i, dateFieldId, { mode: 'relative_date', date: { ...RELATIVE_TODAY, days: 1 } })}
                                                    className="imcrm-text-xs imcrm-text-primary hover:imcrm-underline"
                                                >
                                                    {dateField ? sprintf(__('+ Fecha en «%s»'), dateField.label) : __('+ Fecha')}
                                                </button>
                                            ))}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ol>
            )}
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="imcrm-gap-1.5 imcrm-self-start"
                onClick={() => onChange([...subtasks, { title: '', values: {} }])}
                data-testid="imcrm-rte-add-subtask"
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Agregar subtarea')}
            </Button>
        </section>
    );
}

function RowActions({ index, count, onMove, onRemove }: { index: number; count: number; onMove: (d: -1 | 1) => void; onRemove: () => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center">
            <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-30" aria-label={__('Subir')}>
                <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
            </button>
            <button type="button" disabled={index === count - 1} onClick={() => onMove(1)} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-30" aria-label={__('Bajar')}>
                <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
            </button>
            <button type="button" onClick={onRemove} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive" aria-label={__('Quitar')}>
                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
            </button>
        </div>
    );
}

// ─────────────────────────── Checklists ───────────────────────────

function ChecklistsSection({
    fields,
    single,
    checklists,
    onChange,
}: {
    fields: FieldEntity[];
    /** Plantilla de checklist: uno solo, sin título de sección extra. */
    single: boolean;
    checklists: TemplateChecklist[];
    onChange: (next: TemplateChecklist[]) => void;
}): JSX.Element {
    const setAt = (i: number, patch: Partial<TemplateChecklist>): void => onChange(checklists.map((c, n) => (n === i ? { ...c, ...patch } : c)));
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="imcrm-rte-checklists">
            {!single && <SectionTitle icon={ListTodo} title={__('Checklists')} hint={__('Cada ítem puede llevar responsable y fecha relativa.')} />}
            {checklists.map((cl, i) => (
                <div key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2.5" data-testid="imcrm-rte-checklist">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                        <ListTodo className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                        <Input value={cl.name} maxLength={120} onChange={(e) => setAt(i, { name: e.target.value })} placeholder={__('Nombre del checklist')} className="imcrm-h-8 imcrm-flex-1 imcrm-font-medium" />
                        {!single && (
                            <button type="button" onClick={() => onChange(checklists.filter((_, n) => n !== i))} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive" aria-label={__('Quitar el checklist')}>
                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            </button>
                        )}
                    </div>
                    <ItemsEditor fields={fields} items={cl.items} onChange={(items) => setAt(i, { items })} />
                </div>
            ))}
            {!single && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="imcrm-gap-1.5 imcrm-self-start"
                    onClick={() => onChange([...checklists, { name: checklists.length === 0 ? __('Checklist') : sprintf(__('Checklist %d'), checklists.length + 1), items: [] }])}
                    data-testid="imcrm-rte-add-checklist"
                >
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar checklist')}
                </Button>
            )}
        </section>
    );
}

function ItemsEditor({ fields, items, onChange }: { fields: FieldEntity[]; items: TemplateChecklistItem[]; onChange: (next: TemplateChecklistItem[]) => void }): JSX.Element {
    const [draft, setDraft] = useState('');
    const setAt = (i: number, patch: Partial<TemplateChecklistItem>): void => onChange(items.map((it, n) => (n === i ? { ...it, ...patch } : it)));
    const add = (): void => {
        const text = draft.trim();
        if (text === '') return;
        onChange([...items, { text, assignee: null, due: null }]);
        setDraft('');
    };
    const move = (i: number, d: -1 | 1): void => {
        const j = i + d;
        if (j < 0 || j >= items.length) return;
        const next = [...items];
        [next[i], next[j]] = [next[j]!, next[i]!];
        onChange(next);
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-pl-5">
            {items.map((it, i) => (
                <div key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-border-b imcrm-border-border/50 imcrm-pb-1.5 last:imcrm-border-b-0" data-testid="imcrm-rte-item">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                        <span className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-rounded-sm imcrm-border imcrm-border-input" aria-hidden />
                        <Input value={it.text} maxLength={500} onChange={(e) => setAt(i, { text: e.target.value })} className="imcrm-h-7 imcrm-flex-1 imcrm-text-sm" aria-label={__('Texto del ítem')} />
                        <RowActions index={i} count={items.length} onMove={(d) => move(i, d)} onRemove={() => onChange(items.filter((_, n) => n !== i))} />
                    </div>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-pl-5">
                        <PersonControl value={it.assignee} onChange={(p) => setAt(i, { assignee: p })} fields={fields} allowNone />
                        {it.due ? (
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                <RelativeDateControl value={it.due} onChange={(d) => setAt(i, { due: d })} fields={fields} withTime />
                                <button type="button" onClick={() => setAt(i, { due: null })} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-text-destructive" aria-label={__('Quitar la fecha')}>
                                    <X className="imcrm-h-3.5 imcrm-w-3.5" />
                                </button>
                            </div>
                        ) : (
                            <button type="button" onClick={() => setAt(i, { due: { ...RELATIVE_TODAY, days: 1 } })} className="imcrm-text-xs imcrm-text-primary hover:imcrm-underline">
                                {__('+ Fecha')}
                            </button>
                        )}
                    </div>
                </div>
            ))}
            <div className={cn('imcrm-flex imcrm-items-center imcrm-gap-1.5', items.length > 0 && 'imcrm-pt-1')}>
                <Plus className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            add();
                        }
                    }}
                    onPaste={(e) => {
                        const text = e.clipboardData.getData('text/plain');
                        if (!text.includes('\n')) return;
                        e.preventDefault();
                        const lines = text.split(/\r?\n/).map((l) => l.replace(/^(?:[-*•]|\d{1,3}[.)])\s+/, '').trim()).filter(Boolean);
                        onChange([...items, ...lines.map((t) => ({ text: t.slice(0, 500), assignee: null, due: null }))]);
                    }}
                    onBlur={add}
                    placeholder={__('Agregar un ítem (Enter)')}
                    className="imcrm-h-7 imcrm-min-w-0 imcrm-flex-1 imcrm-bg-transparent imcrm-text-sm imcrm-outline-none placeholder:imcrm-text-muted-foreground/70"
                    data-testid="imcrm-rte-add-item"
                />
            </div>
        </div>
    );
}
