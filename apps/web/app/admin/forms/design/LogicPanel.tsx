import { ArrowDown, ArrowUp, Braces, Eye, Flag, Plus, Route, Trash2 } from 'lucide-react';

import {
    FORM_MAX_ENDINGS,
    FORM_MAX_JUMPS,
    formConditionRules,
    isFormConditionGroup,
    type FormCondition,
    type FormConfig,
    type FormEnding,
    type FormJump,
    type FormShowIf,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { Field, Section } from '../../automations/email/EmailBlockInspector';
import {
    addEnding,
    addJump,
    allCandidates,
    endingName,
    jumpCandidates,
    jumpTargets,
    moveEnding,
    moveJump,
    pageChoices,
    recallChoices,
    removeEnding,
    removeJump,
    updateEnding,
    updateJump,
} from '../formDesignOps';
import { ConditionEditor, OP_LABELS } from './ConditionEditor';

/**
 * v0.1.356 — La lógica del formulario: adónde va cada persona según lo que
 * responde (saltos entre páginas) y qué ve al terminar (pantallas finales).
 * Las condiciones de cada pregunta se editan en la pregunta.
 */
export function LogicPanel({
    config,
    fields,
    fieldsById,
    onChange,
    previewEnding,
    onPreviewEnding,
    onOpenSettings,
}: {
    config: FormConfig;
    fields: FieldEntity[];
    fieldsById: Map<number, FieldEntity>;
    onChange: (next: FormConfig) => void;
    /** La pantalla final que se ve en la vista previa (`''` = la de siempre; null = el formulario). */
    previewEnding: string | null;
    onPreviewEnding: (id: string | null) => void;
    /** Abre los ajustes del formulario (donde está el «¡Gracias!» de siempre). */
    onOpenSettings: () => void;
}): JSX.Element {
    const pages = pageChoices(config);
    const { jumps, endings } = config.settings;
    const firstFor = (from: string): number | null => {
        const c = jumpCandidates(config, from).filter((x) => fieldsById.has(x.field_id));
        return c[c.length - 1]?.field_id ?? null;
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-p-4" data-testid="form-logic-panel" data-tour="form-logic">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <h2 className="imcrm-text-sm imcrm-font-semibold">{__('Lógica')}</h2>
                <p className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Decide adónde va cada persona según lo que responde y qué ve al terminar. Para mostrar u ocultar una pregunta, tócala y usa «Mostrar sólo si…».')}
                </p>
            </div>

            <Section title={__('Saltos entre páginas')}>
                {pages.length < 2 ? (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="form-logic-no-pages">
                        {__('Para saltar entre páginas, primero divide el formulario: en «Agregar» toca «Salto de página». Igual puedes terminar antes o elegir la pantalla final abajo.')}
                    </p>
                ) : null}
                {pages.map((page) => {
                    const own = jumps.filter((j) => j.from === page.key);
                    const isLast = page.index === pages.length - 1;
                    return (
                        <div key={page.key} className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="form-logic-page">
                            <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-medium">
                                <Route className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                                {__('Al terminar la %s').replace('%s', page.label.charAt(0).toLowerCase() + page.label.slice(1))}
                            </p>
                            {own.map((j, idx) => (
                                <JumpCard
                                    key={j.id}
                                    jump={j}
                                    config={config}
                                    fieldsById={fieldsById}
                                    canUp={idx > 0}
                                    canDown={idx < own.length - 1}
                                    onChange={onChange}
                                />
                            ))}
                            {jumps.length < FORM_MAX_JUMPS && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="imcrm-self-start"
                                    onClick={() => onChange(addJump(config, page.key, firstFor(page.key)))}
                                    data-testid="form-logic-add-jump"
                                >
                                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {isLast ? __('Elegir cómo termina') : __('Agregar un salto')}
                                </Button>
                            )}
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {own.length > 0 ? __('Si no se cumple ninguno: ') : ''}
                                {isLast ? __('se envía con la pantalla final que corresponda.') : __('sigue a la página siguiente.')}
                            </p>
                        </div>
                    );
                })}
            </Section>

            <Section title={__('Pantallas finales')}>
                <p className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Muestra un mensaje distinto según las respuestas. Se usa la primera cuya condición se cumple; si ninguna, la de siempre.')}
                </p>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                    <Flag className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                    <div className="imcrm-min-w-0 imcrm-flex-1">
                        <p className="imcrm-truncate imcrm-text-xs imcrm-font-medium">{__('La de siempre')}: «{config.settings.success_title || __('¡Gracias!')}»</p>
                        <button type="button" className="imcrm-text-[11px] imcrm-text-primary hover:imcrm-underline" onClick={onOpenSettings}>
                            {__('Se cambia en los ajustes del formulario')}
                        </button>
                    </div>
                    <PreviewToggle active={previewEnding === ''} onClick={() => onPreviewEnding(previewEnding === '' ? null : '')} />
                </div>
                {endings.map((e, idx) => (
                    <EndingCard
                        key={e.id}
                        ending={e}
                        index={idx}
                        config={config}
                        fields={fields}
                        fieldsById={fieldsById}
                        canUp={idx > 0}
                        canDown={idx < endings.length - 1}
                        previewing={previewEnding === e.id}
                        onPreview={() => onPreviewEnding(previewEnding === e.id ? null : e.id)}
                        onChange={onChange}
                    />
                ))}
                {endings.length < FORM_MAX_ENDINGS && (
                    <Button variant="outline" size="sm" className="imcrm-self-start" onClick={() => onChange(addEnding(config))} data-testid="form-logic-add-ending">
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Agregar una pantalla final')}
                    </Button>
                )}
            </Section>

            <Section title={__('Recordar respuestas')}>
                <p className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Escribe una respuesta dentro de un texto con su nombre entre llaves: «Gracias, {{nombre}}». Con una barra eliges qué mostrar si no respondió: {{nombre|amigo}}. Sirve en preguntas, ayudas, títulos, textos y pantallas finales.')}
                </p>
                <RecallList config={config} fields={fields} />
            </Section>
        </div>
    );
}

function PreviewToggle({ active, onClick }: { active: boolean; onClick: () => void }): JSX.Element {
    return (
        <Button
            variant={active ? 'secondary' : 'ghost'}
            size="sm"
            className="imcrm-h-7 imcrm-shrink-0 imcrm-px-2 imcrm-text-xs"
            onClick={onClick}
            aria-pressed={active}
            data-testid="form-logic-preview-ending"
        >
            <Eye className="imcrm-h-3.5 imcrm-w-3.5" />
            {active ? __('Viendo') : __('Ver')}
        </Button>
    );
}

function JumpCard({
    jump,
    config,
    fieldsById,
    canUp,
    canDown,
    onChange,
}: {
    jump: FormJump;
    config: FormConfig;
    fieldsById: Map<number, FieldEntity>;
    canUp: boolean;
    canDown: boolean;
    onChange: (next: FormConfig) => void;
}): JSX.Element {
    const targets = jumpTargets(config, jump.from);
    const known = targets.some((t) => t.value === jump.to);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-2" data-testid="form-logic-jump">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                <span className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Si')}</span>
                <CardActions
                    canUp={canUp}
                    canDown={canDown}
                    onUp={() => onChange(moveJump(config, jump.id, -1))}
                    onDown={() => onChange(moveJump(config, jump.id, 1))}
                    onRemove={() => onChange(removeJump(config, jump.id))}
                    removeLabel={__('Quitar este salto')}
                />
            </div>
            {jump.when === null && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Siempre (sin condición).')}</p>}
            <ConditionEditor
                value={jump.when}
                onChange={(when) => onChange(updateJump(config, jump.id, { when }))}
                candidates={jumpCandidates(config, jump.from)}
                fieldsById={fieldsById}
                emptyHint="Esta página no tiene preguntas antes de ella para decidir: el salto es siempre."
                testId="form-logic-jump-cond"
            />
            <Field label={__('Entonces')}>
                <Select value={jump.to} onChange={(e) => onChange(updateJump(config, jump.id, { to: e.target.value }))} aria-label={__('Adónde va')} data-testid="form-logic-jump-to">
                    {!known && <option value={jump.to}>{__('Un destino que ya no existe')}</option>}
                    {targets.map((t) => (
                        <option key={t.value} value={t.value}>
                            {__(t.label)}
                        </option>
                    ))}
                </Select>
            </Field>
        </div>
    );
}

function EndingCard({
    ending,
    index,
    config,
    fields,
    fieldsById,
    canUp,
    canDown,
    previewing,
    onPreview,
    onChange,
}: {
    ending: FormEnding;
    index: number;
    config: FormConfig;
    fields: FieldEntity[];
    fieldsById: Map<number, FieldEntity>;
    canUp: boolean;
    canDown: boolean;
    previewing: boolean;
    onPreview: () => void;
    onChange: (next: FormConfig) => void;
}): JSX.Element {
    const set = (patch: Partial<FormEnding>): void => onChange(updateEnding(config, ending.id, patch));
    const urlBad = !!ending.redirect_url && !/^https:\/\/\S+$/.test(ending.redirect_url);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2" data-testid="form-logic-ending">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                <Flag className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-primary" />
                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-xs imcrm-font-medium">{endingName(ending, index)}</span>
                <PreviewToggle active={previewing} onClick={onPreview} />
                <CardActions
                    canUp={canUp}
                    canDown={canDown}
                    onUp={() => onChange(moveEnding(config, ending.id, -1))}
                    onDown={() => onChange(moveEnding(config, ending.id, 1))}
                    onRemove={() => onChange(removeEnding(config, ending.id))}
                    removeLabel={__('Quitar esta pantalla final')}
                />
            </div>
            <Field label={__('Nombre (sólo lo ves tú)')}>
                <Input value={ending.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label={__('Título')}>
                <Input value={ending.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} data-testid="form-logic-ending-title" />
                <RecallPicker config={config} fields={fields} onPick={(t) => set({ title: withToken(ending.title, t) })} />
            </Field>
            <Field label={__('Mensaje')}>
                <Textarea rows={3} value={ending.message} maxLength={2000} onChange={(e) => set({ message: e.target.value })} data-testid="form-logic-ending-message" />
                <RecallPicker config={config} fields={fields} onPick={(t) => set({ message: withToken(ending.message, t) })} />
            </Field>
            <Field label={__('Llevar a una dirección (opcional)')} hint={urlBad ? __('Tiene que empezar con https://') : __('Al enviar, abre esta página en vez de mostrar el mensaje.')}>
                <Input
                    value={ending.redirect_url ?? ''}
                    placeholder="https://"
                    onChange={(e) => set({ redirect_url: e.target.value.trim() === '' ? null : e.target.value.trim() })}
                    aria-invalid={urlBad}
                />
            </Field>
            <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Se muestra si')}</p>
            {ending.when === null && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Sin condición, sólo se muestra si un salto lleva a ella.')}</p>}
            <ConditionEditor
                value={ending.when}
                onChange={(when) => set({ when })}
                candidates={allCandidates(config)}
                fieldsById={fieldsById}
                emptyHint="Agrega preguntas al formulario para poder elegir cuándo se muestra."
                testId="form-logic-ending-cond"
            />
        </div>
    );
}

function CardActions({
    canUp,
    canDown,
    onUp,
    onDown,
    onRemove,
    removeLabel,
}: {
    canUp: boolean;
    canDown: boolean;
    onUp: () => void;
    onDown: () => void;
    onRemove: () => void;
    removeLabel: string;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center">
            <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" aria-label={__('Subir')} disabled={!canUp} onClick={onUp}>
                <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" aria-label={__('Bajar')} disabled={!canDown} onClick={onDown}>
                <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" aria-label={removeLabel} onClick={onRemove}>
                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
            </Button>
        </div>
    );
}

/** Los nombres que se pueden usar entre llaves (las respuestas que el formulario pide). */
function RecallList({ config, fields }: { config: FormConfig; fields: FieldEntity[] }): JSX.Element {
    const choices = recallChoices(config, fields);
    if (choices.length === 0) return <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Agrega preguntas para poder recordar sus respuestas.')}</p>;
    return (
        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="form-recall-list">
            {choices.map((c) => (
                <li key={c.slug} className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-text-xs">
                    <span className="imcrm-min-w-0 imcrm-truncate">{c.label}</span>
                    <code className="imcrm-shrink-0 imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px]">{`{{${c.slug}}}`}</code>
                </li>
            ))}
        </ul>
    );
}

/** Suma `{{nombre}}` al final de un texto, con un espacio si hace falta. */
export function withToken(text: string, token: string): string {
    return text && !/\s$/.test(text) ? `${text} ${token}` : `${text}${token}`;
}

/** Un botón para agregar una respuesta recordada al final de un texto. */
export function RecallPicker({
    config,
    fields,
    onPick,
    exceptFieldId,
}: {
    config: FormConfig;
    fields: FieldEntity[];
    onPick: (token: string) => void;
    exceptFieldId?: number;
}): JSX.Element | null {
    const choices = recallChoices(config, fields).filter((c) => c.id !== exceptFieldId);
    if (choices.length === 0) return null;
    return (
        <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-self-start imcrm-text-[11px] imcrm-text-muted-foreground">
            <Braces className="imcrm-h-3 imcrm-w-3" />
            <select
                value=""
                onChange={(e) => {
                    if (e.target.value) onPick(`{{${e.target.value}}}`);
                }}
                className="imcrm-cursor-pointer imcrm-rounded imcrm-border-0 imcrm-bg-transparent imcrm-p-0 imcrm-text-[11px] imcrm-text-primary focus:imcrm-outline-none focus:imcrm-ring-2 focus:imcrm-ring-ring"
                aria-label={__('Agregar una respuesta al texto')}
                data-testid="form-recall-pick"
            >
                <option value="">{__('Agregar una respuesta')}</option>
                {choices.map((c) => (
                    <option key={c.slug} value={c.slug}>
                        {c.label}
                    </option>
                ))}
            </select>
        </label>
    );
}

/** «Tipo es Empresa y Edad es mayor que 17», para leer la lógica de un vistazo. */
export function describeCondition(c: FormShowIf | null, fieldsById: Map<number, FieldEntity>): string {
    const rules = formConditionRules(c);
    if (rules.length === 0) return __('Siempre');
    const one = (r: FormCondition): string => {
        const f = fieldsById.get(r.field_id);
        const name = f?.label ?? __('Pregunta borrada');
        const op = __(OP_LABELS[r.op]);
        if (r.op === 'is_empty' || r.op === 'is_not_empty') return `${name} ${op}`;
        const opts = (f?.config.options as Array<{ value: string; label?: string }> | undefined) ?? [];
        const v = f?.type === 'checkbox' ? (r.value === true ? __('marcada') : __('sin marcar')) : (opts.find((o) => o.value === String(r.value))?.label ?? String(r.value ?? ''));
        return `${name} ${op} ${v || '…'}`;
    };
    const joiner = isFormConditionGroup(c) && c.match === 'any' ? ` ${__('o')} ` : ` ${__('y')} `;
    return rules.map(one).join(joiner);
}

/** El mapa de la lógica (panel izquierdo): qué pasa al terminar cada página y cada pantalla final. */
export function LogicMap({ config, fieldsById }: { config: FormConfig; fieldsById: Map<number, FieldEntity> }): JSX.Element {
    const pages = pageChoices(config);
    const { jumps, endings } = config.settings;
    const targetLabel = (from: string, to: string): string => jumpTargets(config, from).find((t) => t.value === to)?.label ?? __('Un destino que ya no existe');
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-p-3 imcrm-text-xs" data-testid="form-logic-map">
            <p className="imcrm-leading-snug imcrm-text-muted-foreground">{__('Así recorre el formulario cada persona. Se edita a la derecha.')}</p>
            {pages.map((p) => {
                const own = jumps.filter((j) => j.from === p.key);
                return (
                    <div key={p.key} className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <p className="imcrm-font-medium">{p.label}</p>
                        {own.length === 0 ? (
                            <p className="imcrm-text-muted-foreground">{p.index === pages.length - 1 ? __('→ Se envía') : __('→ Sigue a la página siguiente')}</p>
                        ) : (
                            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                                {own.map((j) => (
                                    <li key={j.id} className="imcrm-leading-snug">
                                        <span className="imcrm-text-muted-foreground">{j.when ? `${__('Si')} ${describeCondition(j.when, fieldsById)}` : __('Siempre')}</span> → {__(targetLabel(j.from, j.to))}
                                    </li>
                                ))}
                                <li className="imcrm-text-muted-foreground">{p.index === pages.length - 1 ? __('Si no: se envía') : __('Si no: sigue a la página siguiente')}</li>
                            </ul>
                        )}
                    </div>
                );
            })}
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-border-t imcrm-border-border imcrm-pt-2">
                <p className="imcrm-font-medium">{__('Pantallas finales')}</p>
                {endings.length === 0 ? (
                    <p className="imcrm-text-muted-foreground">{__('Sólo la de siempre.')}</p>
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                        {endings.map((e, i) => (
                            <li key={e.id} className="imcrm-leading-snug">
                                «{endingName(e, i)}» <span className="imcrm-text-muted-foreground">{e.when ? `${__('si')} ${describeCondition(e.when, fieldsById)}` : __('sólo por un salto')}</span>
                            </li>
                        ))}
                        <li className="imcrm-text-muted-foreground">{__('Si ninguna: la de siempre')}</li>
                    </ul>
                )}
            </div>
        </div>
    );
}
