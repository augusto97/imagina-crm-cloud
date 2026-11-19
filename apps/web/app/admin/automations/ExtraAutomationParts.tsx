import { useState } from 'react';
import { Info, Plus, Trash2 } from 'lucide-react';
import {
    ASSIGN_MODE_LABELS,
    ASSIGN_MODES,
    COPY_RECORD_DEFAULT_NAME,
    FILE_KIND_LABELS,
    FILE_KINDS,
    FILE_VARIABLES,
    NOTIFY_IN_APP_MAX_RECIPIENTS,
    RECORD_MATCHES_SWEEP_MINUTES,
    autoMapCopyFields,
    readAssignRoundRobinConfig,
    readCopyRecordConfig,
    readFileAddedConfig,
    readNotifyInAppConfig,
    readRecordMatchesConfig,
} from '@imagina-base/shared';

import { FilterGroupView } from '@/admin/records/FilterGroupView';
import { FilterUserPicker } from '@/admin/records/FilterUserPicker';
import { emptyTree } from '@/admin/records/filterTree';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { useTeams } from '@/hooks/useTeams';
import { DERIVED_FIELD_TYPES } from '@/lib/fieldTypeCatalog';
import { __, sprintf } from '@/lib/i18n';
import type { ActionSpec, TriggerConfig } from '@/types/automation';
import type { FieldEntity } from '@/types/field';
import type { FilterTree } from '@/types/record';

import { FieldValueInput, readValueRows, useAutomationListId, valueRowsToConfig, type ValueRow } from './config-editors';
import { MergeTagInput } from './MergeTagInput';
import { ResultName } from './RecordActionsConfig';

/**
 * v0.1.455 — Editores de los dos disparadores («Cuando un registro empieza a
 * cumplir una condición», «Cuando se sube un archivo») y las tres acciones
 * («Avisar en la app», «Asignar por turno», «Copiar a otra lista»). Las reglas
 * (qué se lee, qué se valida, qué se copia solo) viven en `packages/shared`
 * (`automation-extras.ts`): lo que se ve aquí es lo que hace el motor.
 */

interface EditorProps {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
}

interface TriggerProps {
    config: TriggerConfig;
    onChange: (next: TriggerConfig) => void;
    fields: FieldEntity[];
}

const PERSON_FIELD_TYPES = new Set(['user', 'created_by', 'updated_by']);

function useSet(spec: ActionSpec, onChange: (next: ActionSpec) => void): (patch: Record<string, unknown>) => void {
    return (patch) => {
        const config: Record<string, unknown> = { ...spec.config, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete config[k];
        onChange({ ...spec, config });
    };
}

function Note({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-2 imcrm-text-[11px] imcrm-text-muted-foreground">
            <Info className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
            <div>{children}</div>
        </div>
    );
}

// ─────────────── Disparadores ───────────────

/** «Cuando un registro empieza a cumplir una condición». */
export function RecordMatchesTriggerConfig({ config, onChange, fields }: TriggerProps): JSX.Element {
    const listId = useAutomationListId();
    const c = readRecordMatchesConfig(config);
    const tree = (c.filter as FilterTree | null) ?? emptyTree();
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="trigger-record-matches">
            <Label>{__('La condición')}</Label>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Las mismas reglas de los filtros de la tabla. Dispara una sola vez cuando un registro EMPIEZA a cumplirlas; vuelve a disparar sólo si deja de cumplirlas y las cumple otra vez.')}
            </p>
            <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2" data-tour="automation-record-matches">
                <FilterGroupView root={tree} path={[]} fields={fields} listId={listId} onRootChange={(next) => onChange({ ...config, match_filter: next })} />
            </div>
            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                <input
                    type="checkbox"
                    checked={c.onCreate}
                    onChange={(e) => {
                        const next: TriggerConfig = { ...config };
                        if (e.target.checked) delete next.match_on_create;
                        else next.match_on_create = false;
                        onChange(next);
                    }}
                    data-testid="trigger-record-matches-on-create"
                />
                {__('También cuando un registro se crea ya cumpliéndola')}
            </label>
            <Note>
                {sprintf(
                    __('Al guardar (y cada vez que cambies la condición), los registros que YA la cumplen se toman como punto de partida y no disparan: así no llegan cien avisos de golpe. Se revisa al crear o cambiar un registro y, además, cada %d minutos, para lo que entra por el paso del tiempo (como «vence antes de hoy»).'),
                    RECORD_MATCHES_SWEEP_MINUTES,
                )}
            </Note>
        </div>
    );
}

/** «Cuando se sube un archivo»: qué campo y qué tipo. */
export function FileAddedTriggerConfig({ config, onChange, fields }: TriggerProps): JSX.Element {
    const c = readFileAddedConfig(config);
    const fileFields = fields.filter((f) => f.type === 'file');
    const set = (key: string, value: unknown): void => {
        const next: TriggerConfig = { ...config };
        if (value === undefined) delete next[key];
        else next[key] = value;
        onChange(next);
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="trigger-file-added">
            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{__('En el campo')}</Label>
                    <Select
                        value={c.fieldId !== null ? String(c.fieldId) : ''}
                        onChange={(e) => {
                            const id = Number(e.target.value);
                            set('file_field_id', Number.isInteger(id) && id > 0 ? id : undefined);
                        }}
                        aria-label={__('En el campo')}
                        className="imcrm-h-8"
                        data-testid="trigger-file-field"
                    >
                        <option value="">{__('Cualquier campo de archivos')}</option>
                        {fileFields.map((f) => (
                            <option key={f.id} value={String(f.id)}>
                                {f.label}
                            </option>
                        ))}
                    </Select>
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{__('Qué archivos')}</Label>
                    <Select value={c.kind} onChange={(e) => set('file_kind', e.target.value === 'any' ? undefined : e.target.value)} aria-label={__('Qué archivos')} className="imcrm-h-8" data-testid="trigger-file-kind">
                        {FILE_KINDS.map((k) => (
                            <option key={k} value={k}>
                                {__(FILE_KIND_LABELS[k])}
                            </option>
                        ))}
                    </Select>
                </div>
            </div>
            {fileFields.length === 0 && <p className="imcrm-text-[11px] imcrm-text-destructive">{__('Esta lista no tiene campos de archivos todavía: agrega uno para que este disparador tenga qué mirar.')}</p>}
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Dispara una vez por guardado, aunque lleguen varios archivos juntos. En las acciones puedes usar:')}{' '}
                {FILE_VARIABLES.map((v) => (
                    <code key={v.key} className="imcrm-mr-1 imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-font-mono">{`{{archivo.${v.key}}}`}</code>
                ))}
            </p>
        </div>
    );
}

// ─────────────── «Avisar en la app» ───────────────

export function NotifyInAppConfig({ spec, onChange, fields }: EditorProps): JSX.Element {
    const c = readNotifyInAppConfig(spec.config);
    const set = useSet(spec, onChange);
    const teams = useTeams();
    const personFields = fields.filter((f) => PERSON_FIELD_TYPES.has(f.type));
    const toggleIn = (key: string, list: number[], id: number, on: boolean): void => {
        const next = on ? [...list, id] : list.filter((x) => x !== id);
        set({ [key]: next.length > 0 ? next : undefined });
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="action-notify-in-app">
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Llega a la campana de la app (y al celular, si la persona activó las notificaciones) con un enlace al registro. Ideal para avisos internos que no merecen un correo.')}
            </p>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <Label className="imcrm-text-xs">{__('Título')}</Label>
                <MergeTagInput value={c.title} onChange={(v) => set({ title: v === '' ? undefined : v })} fields={fields} placeholder={__('Nuevo pedido de {{cliente}}')} aria-label={__('Título')} />
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <Label className="imcrm-text-xs">{__('Mensaje (opcional)')}</Label>
                <MergeTagInput value={c.message} onChange={(v) => set({ message: v === '' ? undefined : v })} fields={fields} rows={2} autoGrow placeholder={__('Total: {{total}}. Revísalo antes de las 5.')} aria-label={__('Mensaje')} />
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-2" data-tour="automation-notify-recipients">
                <Label className="imcrm-text-xs">{__('A quién')}</Label>
                {personFields.length > 0 && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('La persona del registro')}</span>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                            {personFields.map((f) => (
                                <label key={f.id} className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1 imcrm-text-xs">
                                    <input type="checkbox" checked={c.personFieldIds.includes(f.id)} onChange={(e) => toggleIn('person_field_ids', c.personFieldIds, f.id, e.target.checked)} />
                                    {f.label}
                                </label>
                            ))}
                        </div>
                    </div>
                )}
                {(teams.data ?? []).length > 0 && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Equipos (sus personas de ese momento)')}</span>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                            {(teams.data ?? []).map((t) => (
                                <label key={t.id} className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1 imcrm-text-xs">
                                    <input type="checkbox" checked={c.teamIds.includes(t.id)} onChange={(e) => toggleIn('notify_team_ids', c.teamIds, t.id, e.target.checked)} />
                                    {t.name}
                                </label>
                            ))}
                        </div>
                    </div>
                )}
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Personas puntuales')}</span>
                    <FilterUserPicker mode="multi" value={c.userIds} onChange={(next) => set({ notify_user_ids: Array.isArray(next) && next.length > 0 ? next : undefined })} />
                </div>
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                    <input type="checkbox" checked={c.includeActor} onChange={(e) => set({ include_actor: e.target.checked ? true : undefined })} />
                    {__('También a quien hizo el cambio que disparó la automatización')}
                </label>
            </div>
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {sprintf(
                    __('Sólo lo reciben quienes pueden ver el registro (nunca invitados ni clientes del portal), hasta %d personas. Si el aviso usa un campo que alguien no puede ver, a esa persona le llega sin ese dato.'),
                    NOTIFY_IN_APP_MAX_RECIPIENTS,
                )}
            </p>
        </div>
    );
}

// ─────────────── «Asignar por turno» ───────────────

export function AssignRoundRobinConfig({ spec, onChange, fields }: EditorProps): JSX.Element {
    const c = readAssignRoundRobinConfig(spec.config);
    const set = useSet(spec, onChange);
    const teams = useTeams();
    const userFields = fields.filter((f) => f.type === 'user');
    const [among, setAmong] = useState<'people' | 'team'>(c.teamId !== null ? 'team' : 'people');
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="action-assign-round-robin">
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Reparte los registros entre varias personas llenando un campo Persona. Quien no puede ver y editar el registro (o tiene la cuenta desactivada) se salta.')}
            </p>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <Label className="imcrm-shrink-0 imcrm-text-xs">{__('Llenar el campo')}</Label>
                <Select
                    value={c.personFieldId !== null ? String(c.personFieldId) : ''}
                    onChange={(e) => {
                        const id = Number(e.target.value);
                        set({ person_field_id: Number.isInteger(id) && id > 0 ? id : undefined });
                    }}
                    aria-label={__('Llenar el campo')}
                    className="imcrm-h-8 imcrm-flex-1"
                    data-testid="assign-field"
                >
                    <option value="">{__('— Campo Persona —')}</option>
                    {userFields.map((f) => (
                        <option key={f.id} value={String(f.id)}>
                            {f.label}
                        </option>
                    ))}
                </Select>
            </div>
            {userFields.length === 0 && <p className="imcrm-text-[11px] imcrm-text-destructive">{__('Esta lista no tiene un campo Persona: agrega uno («Responsable», «Vendedor») para poder repartir.')}</p>}

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-2">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Label className="imcrm-shrink-0 imcrm-text-xs">{__('Entre')}</Label>
                    <Select
                        value={among}
                        onChange={(e) => {
                            const v = e.target.value === 'team' ? 'team' : 'people';
                            setAmong(v);
                            if (v === 'team') set({ assignee_user_ids: undefined });
                            else set({ team_id: undefined });
                        }}
                        aria-label={__('Entre')}
                        className="imcrm-h-8 imcrm-flex-1"
                        data-testid="assign-among"
                    >
                        <option value="people">{__('Estas personas')}</option>
                        <option value="team">{__('Las personas de un equipo')}</option>
                    </Select>
                </div>
                {among === 'team' ? (
                    <Select
                        value={c.teamId !== null ? String(c.teamId) : ''}
                        onChange={(e) => {
                            const id = Number(e.target.value);
                            set({ team_id: Number.isInteger(id) && id > 0 ? id : undefined });
                        }}
                        aria-label={__('Equipo')}
                        className="imcrm-h-8"
                        data-testid="assign-team"
                    >
                        <option value="">{__('— Equipo —')}</option>
                        {(teams.data ?? []).map((t) => (
                            <option key={t.id} value={String(t.id)}>
                                {sprintf(__('%1$s (%2$d)'), t.name, t.members.length)}
                            </option>
                        ))}
                    </Select>
                ) : (
                    <FilterUserPicker mode="multi" value={c.userIds} onChange={(next) => set({ assignee_user_ids: Array.isArray(next) && next.length > 0 ? next : undefined })} />
                )}
                {among === 'team' && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Se usa quién está en el equipo al momento de asignar: si entra alguien nuevo, ya recibe registros.')}</p>}
            </div>

            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <Label className="imcrm-shrink-0 imcrm-text-xs">{__('Cómo')}</Label>
                <Select value={c.mode} onChange={(e) => set({ assign_mode: e.target.value === 'round_robin' ? undefined : e.target.value })} aria-label={__('Cómo')} className="imcrm-h-8 imcrm-flex-1" data-testid="assign-mode">
                    {ASSIGN_MODES.map((m) => (
                        <option key={m} value={m}>
                            {__(ASSIGN_MODE_LABELS[m])}
                        </option>
                    ))}
                </Select>
            </div>
            {c.mode === 'least_open' && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('«Abiertos» son los registros de esta lista asignados a cada persona que no están terminados (el mismo criterio de «Mi trabajo»). Con un empate, gana la primera de la lista.')}</p>
            )}
            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                <input type="checkbox" checked={c.onlyIfEmpty} onChange={(e) => set({ only_if_empty: e.target.checked ? undefined : false })} data-testid="assign-only-if-empty" />
                {__('Sólo si el campo está vacío (no le quita el registro a nadie)')}
            </label>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                {['nombre', 'email', 'id'].map((k) => (
                    <code key={k} className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground">{`{{asignado.${k}}}`}</code>
                ))}
            </div>
        </div>
    );
}

// ─────────────── «Copiar a otra lista» ───────────────

export function CopyRecordConfig({ spec, onChange, fields }: EditorProps): JSX.Element {
    const c = readCopyRecordConfig(spec.config);
    const set = useSet(spec, onChange);
    const lists = useLists();
    const currentListId = useAutomationListId();
    const targetFieldsQ = useFields(c.listId ?? undefined);
    const targetFields = c.listId !== null ? targetFieldsQ.data ?? [] : [];
    const [valueRows, setValueRows] = useState<ValueRow[]>(() => readValueRows(spec.config.values));
    const commitValues = (next: ValueRow[]): void => {
        setValueRows(next);
        const values = valueRowsToConfig(next);
        set({ values: Object.keys(values).length > 0 ? values : undefined });
    };
    const auto = c.autoMap ? autoMapCopyFields(fields, targetFields, { copyFiles: c.copyFiles }) : [];
    const manual = new Set(Object.keys(c.values));
    const targetOf = (f: FieldEntity): number => Number((f.config as { target_list_id?: unknown }).target_list_id ?? 0);
    const linkOptions = [
        ...targetFields.filter((f) => f.type === 'relation' && targetOf(f) === currentListId).map((f) => ({ id: f.id, label: sprintf(__('«%s» de la copia (apunta a este registro)'), f.label) })),
        ...fields.filter((f) => f.type === 'relation' && targetOf(f) === c.listId).map((f) => ({ id: f.id, label: sprintf(__('«%s» de este registro (apunta a la copia)'), f.label) })),
    ];
    const targetName = lists.data?.find((l) => l.id === c.listId)?.name;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="action-copy-record">
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Crea un registro nuevo en otra lista con los datos de éste: un negocio ganado pasa a «Proyectos», un ticket a «Garantías». El original no cambia.')}
            </p>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <Label className="imcrm-shrink-0 imcrm-text-xs">{__('Copiar a la lista')}</Label>
                <Select
                    value={c.listId !== null ? String(c.listId) : ''}
                    onChange={(e) => {
                        const id = Number(e.target.value);
                        setValueRows([]);
                        set({ target_list_id: Number.isInteger(id) && id > 0 ? id : undefined, values: undefined, link_field_id: undefined });
                    }}
                    aria-label={__('Copiar a la lista')}
                    className="imcrm-h-8 imcrm-flex-1"
                    data-testid="copy-record-list"
                >
                    <option value="">{__('— Elige la lista —')}</option>
                    {(lists.data ?? []).map((l) => (
                        <option key={l.id} value={String(l.id)}>
                            {l.id === currentListId ? sprintf(__('%s (esta misma lista)'), l.name) : l.name}
                        </option>
                    ))}
                </Select>
            </div>

            {c.listId !== null && (
                <>
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                        <input type="checkbox" checked={c.autoMap} onChange={(e) => set({ auto_map: e.target.checked ? undefined : false })} data-testid="copy-record-auto-map" />
                        {__('Copiar solos los campos que se llaman igual')}
                    </label>
                    {c.autoMap && (
                        <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-2 imcrm-text-[11px]" data-testid="copy-record-auto-preview">
                            {targetFieldsQ.isLoading ? (
                                <span className="imcrm-text-muted-foreground">{__('Cargando campos…')}</span>
                            ) : auto.length === 0 ? (
                                <span className="imcrm-text-muted-foreground">{sprintf(__('«%s» no tiene campos con el mismo nombre y un tipo compatible: elige abajo qué copiar.'), targetName ?? '')}</span>
                            ) : (
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                    <span className="imcrm-text-muted-foreground">{sprintf(__('Se copian solos (%d):'), auto.length)}</span>
                                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                                        {auto.map((p) => (
                                            <span key={p.to.id} className={`imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-1.5 imcrm-py-0.5 ${manual.has((p.to as FieldEntity).slug) ? 'imcrm-line-through imcrm-opacity-60' : ''}`}>
                                                {p.to.label}
                                            </span>
                                        ))}
                                    </div>
                                    <span className="imcrm-text-muted-foreground">{__('Una opción de selección se copia por su nombre; si no existe en la otra lista, ese campo queda vacío.')}</span>
                                </div>
                            )}
                        </div>
                    )}
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                        <input type="checkbox" checked={c.copyFiles} onChange={(e) => set({ copy_files: e.target.checked ? undefined : false })} />
                        {__('Copiar también los archivos')}
                    </label>

                    <Label className="imcrm-text-xs">{__('Valores a mano (ganan sobre los copiados)')}</Label>
                    {valueRows.map((v, i) => {
                        const selected = targetFields.find((f) => f.slug === v.slug);
                        return (
                            <div key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-2">
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                    <Select
                                        value={v.slug}
                                        onChange={(e) => {
                                            const next = [...valueRows];
                                            next[i] = { slug: e.target.value, value: '' };
                                            commitValues(next);
                                        }}
                                        aria-label={__('Campo')}
                                        className="imcrm-h-8 imcrm-flex-1"
                                    >
                                        <option value="">{__('— Campo de la copia —')}</option>
                                        {targetFields
                                            .filter((f) => !DERIVED_FIELD_TYPES.has(f.type) && f.type !== 'relation')
                                            .map((f) => (
                                                <option key={f.id} value={f.slug}>
                                                    {f.label}
                                                </option>
                                            ))}
                                    </Select>
                                    <Button type="button" variant="ghost" size="icon" onClick={() => commitValues(valueRows.filter((_, j) => j !== i))} aria-label={__('Eliminar')} className="imcrm-h-8 imcrm-w-8 imcrm-shrink-0">
                                        <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                    </Button>
                                </div>
                                <FieldValueInput
                                    field={selected}
                                    availableFields={fields}
                                    value={v.value}
                                    onChange={(nv) => {
                                        const arr = [...valueRows];
                                        arr[i] = { ...arr[i]!, value: nv };
                                        commitValues(arr);
                                    }}
                                />
                            </div>
                        );
                    })}
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => commitValues([...valueRows, { slug: '', value: '' }])}
                        disabled={targetFieldsQ.data === undefined}
                        className="imcrm-self-start imcrm-gap-2"
                        data-testid="copy-record-add-value"
                    >
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Añadir valor')}
                    </Button>

                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label className="imcrm-text-xs">{__('Vincular la copia con el original (opcional)')}</Label>
                        <Select
                            value={c.linkFieldId !== null ? String(c.linkFieldId) : ''}
                            onChange={(e) => {
                                const id = Number(e.target.value);
                                set({ link_field_id: Number.isInteger(id) && id > 0 ? id : undefined });
                            }}
                            aria-label={__('Vincular la copia con el original')}
                            className="imcrm-h-8"
                            data-testid="copy-record-link"
                        >
                            <option value="">{__('Sin vincular')}</option>
                            {linkOptions.map((o) => (
                                <option key={o.id} value={String(o.id)}>
                                    {o.label}
                                </option>
                            ))}
                        </Select>
                        {linkOptions.length === 0 && (
                            <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Para vincularlas hace falta un campo de relación entre las dos listas (en cualquiera de las dos).')}</span>
                        )}
                    </div>
                </>
            )}

            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Respeta el límite de registros del plan. En una lista que viene de una tienda o de un sitio no copia nada: allá es donde se crea lo nuevo.')}
            </p>
            <ResultName spec={spec} onChange={onChange} fallback={COPY_RECORD_DEFAULT_NAME} outputs={['id', 'titulo', 'lista']} />
        </div>
    );
}
