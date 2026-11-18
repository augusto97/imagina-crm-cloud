import { useContext, useMemo } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
    REQUEST_SIGNATURE_OUTPUTS,
    SIGNATURE_EVENT_LABELS,
    SIGNATURE_EVENTS,
    readRequestSignatureConfig,
    readSignatureTriggerEvents,
    type RequestSignatureSignerConfig,
    type SignatureEvent,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { __, sprintf } from '@/lib/i18n';
import type { ActionSpec, TriggerConfig } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

import { useDocumentTemplates } from '../documents/useDocuments';
import { AutomationEditorListContext } from './config-editors';
import { MergeTagInput } from './MergeTagInput';

/**
 * v0.1.447 (D6, ADR-S107) — Piezas del editor de automatizaciones para la
 * firma electrónica: qué dispara «Cuando cambia una firma» y la acción «Pedir
 * firma de un documento». Las reglas (lectura tolerante, qué falta para
 * guardar) viven en `packages/shared` (`signature-automations.ts`).
 */

export function SignatureTriggerConfig({ config, onChange }: { config: TriggerConfig; onChange: (next: TriggerConfig) => void }): JSX.Element {
    const listId = useContext(AutomationEditorListContext);
    const templates = useDocumentTemplates(listId);
    const events = readSignatureTriggerEvents(config);
    const chosen: readonly SignatureEvent[] = events.length === 0 ? SIGNATURE_EVENTS : events;
    const templateIds = Array.isArray(config.signature_template_ids) ? (config.signature_template_ids as unknown[]).map(Number).filter((n) => n > 0) : [];
    const setEvents = (next: SignatureEvent[]): void => {
        const out = { ...config };
        // Todos marcados = sin filtro (un evento nuevo de una versión futura también dispara).
        if (next.length === 0 || next.length === SIGNATURE_EVENTS.length) delete out.signature_events;
        else out.signature_events = SIGNATURE_EVENTS.filter((e) => next.includes(e));
        onChange(out);
    };
    const list = templates.data ?? [];
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="trigger-signature-config">
            <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <legend className="imcrm-mb-1 imcrm-text-sm imcrm-font-medium">{__('Qué la dispara')}</legend>
                {SIGNATURE_EVENTS.map((ev) => (
                    <label key={ev} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="checkbox"
                            checked={chosen.includes(ev)}
                            onChange={(e) => {
                                const next = e.target.checked ? [...new Set([...chosen, ev])] : chosen.filter((x) => x !== ev);
                                if (next.length > 0) setEvents(next);
                            }}
                            data-signature-event={ev}
                        />
                        {__(SIGNATURE_EVENT_LABELS[ev])}
                    </label>
                ))}
            </fieldset>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Documentos')}</Label>
                {list.length === 0 ? (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Cualquier documento: el de una plantilla o un PDF del registro.')}</p>
                ) : (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        {list.map((t) => {
                            const on = templateIds.includes(t.id);
                            return (
                                <label key={t.id} className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1 imcrm-text-xs">
                                    <input
                                        type="checkbox"
                                        checked={on}
                                        onChange={(e) => {
                                            const next = e.target.checked ? [...templateIds, t.id] : templateIds.filter((x) => x !== t.id);
                                            const out = { ...config };
                                            if (next.length === 0) delete out.signature_template_ids;
                                            else out.signature_template_ids = next;
                                            onChange(out);
                                        }}
                                    />
                                    {t.name}
                                </label>
                            );
                        })}
                    </div>
                )}
                {templateIds.length === 0 && list.length > 0 && (
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Sin marcar ninguna: cualquier documento (también los PDF que se mandan a firmar desde un campo del registro).')}</p>
                )}
            </div>
        </div>
    );
}

const EMPTY_SIGNER: RequestSignatureSignerConfig = { name: '', email: '', role: '' };

/** La acción «Pedir firma de un documento». */
export function RequestSignatureConfig({ spec, onChange, fields }: { spec: ActionSpec; onChange: (next: ActionSpec) => void; fields: FieldEntity[] }): JSX.Element {
    const listId = useContext(AutomationEditorListContext);
    const templates = useDocumentTemplates(listId);
    const raw = (spec.config ?? {}) as Record<string, unknown>;
    const c = readRequestSignatureConfig(raw);
    const set = (patch: Record<string, unknown>): void => onChange({ ...spec, config: { ...raw, ...patch } });
    // Sin personas guardadas, se ve una fila vacía para empezar a escribir.
    const signers = c.signers.length > 0 ? c.signers : [EMPTY_SIGNER];
    const setSigners = (rows: RequestSignatureSignerConfig[]): void => set({ signers: rows });
    const setSigner = (i: number, patch: Partial<RequestSignatureSignerConfig>): void => setSigners(signers.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    const move = (i: number, d: -1 | 1): void => {
        const j = i + d;
        if (j < 0 || j >= signers.length) return;
        const next = [...signers];
        [next[i], next[j]] = [next[j]!, next[i]!];
        setSigners(next);
    };

    const fileFields = fields.filter((f) => f.type === 'file');
    const selectFields = fields.filter((f) => f.type === 'select');
    const dateFields = fields.filter((f) => f.type === 'date' || f.type === 'datetime');
    const statusOptions = useMemo(() => {
        const f = selectFields.find((x) => x.slug === c.status_field);
        const opts = (f?.config as { options?: Array<{ value: string; label: string }> } | undefined)?.options ?? [];
        return Array.isArray(opts) ? opts : [];
    }, [selectFields, c.status_field]);
    const list = templates.data ?? [];
    const missingTemplate = c.source === 'template' && c.template_id !== null && templates.data !== undefined && !list.some((t) => t.id === c.template_id);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="request-signature-config">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Documento que se firma')}</Label>
                <Select value={c.source} onChange={(e) => set({ source: e.target.value })} aria-label={__('De dónde sale el documento')} data-testid="request-signature-source">
                    <option value="template">{__('Una plantilla de documento de la lista')}</option>
                    <option value="file">{__('El PDF que está en un campo Archivo del registro')}</option>
                </Select>
                {c.source === 'template' ? (
                    <>
                        <Select
                            value={c.template_id ? String(c.template_id) : ''}
                            onChange={(e) => set({ template_id: e.target.value ? Number(e.target.value) : null })}
                            aria-label={__('Plantilla del documento')}
                            data-testid="request-signature-template"
                        >
                            <option value="">{list.length === 0 ? __('Todavía no hay plantillas') : __('Elige una plantilla…')}</option>
                            {list.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.name}
                                </option>
                            ))}
                        </Select>
                        {missingTemplate && <p className="imcrm-text-[11px] imcrm-text-destructive">{__('La plantilla elegida ya no existe: elige otra.')}</p>}
                        {list.length === 0 && (
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Las plantillas se arman en Configuración de la lista → Documentos.')}</p>
                        )}
                    </>
                ) : (
                    <>
                        <Select value={c.file_field} onChange={(e) => set({ file_field: e.target.value })} aria-label={__('Campo Archivo')} data-testid="request-signature-file-field">
                            <option value="">{fileFields.length === 0 ? __('La lista no tiene campos Archivo') : __('Elige el campo…')}</option>
                            {fileFields.map((f) => (
                                <option key={f.id} value={f.slug}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Se toma el último PDF del campo. Si el registro no tiene ninguno, la acción se salta y lo dice en el historial.')}</p>
                    </>
                )}
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Nombre del documento (opcional)')}</Label>
                <MergeTagInput value={c.title} onChange={(v) => set({ title: v })} fields={fields} placeholder={__('El de la plantilla o del archivo')} aria-label={__('Nombre del documento')} />
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <Label className="imcrm-text-xs">{__('Quiénes firman')}</Label>
                {signers.map((s, i) => (
                    <div key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2" data-testid="request-signature-signer">
                        <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                            <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                                {c.order === 'sequential' ? sprintf(__('Firma %d'), i + 1) : sprintf(__('Persona %d'), i + 1)}
                            </span>
                            <span className="imcrm-flex imcrm-items-center imcrm-gap-0.5">
                                {c.order === 'sequential' && signers.length > 1 && (
                                    <>
                                        <Button type="button" variant="ghost" size="sm" className="imcrm-h-7 imcrm-w-7 imcrm-p-0" disabled={i === 0} onClick={() => move(i, -1)} aria-label={__('Subir')}>
                                            <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" className="imcrm-h-7 imcrm-w-7 imcrm-p-0" disabled={i === signers.length - 1} onClick={() => move(i, 1)} aria-label={__('Bajar')}>
                                            <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                                        </Button>
                                    </>
                                )}
                                {signers.length > 1 && (
                                    <Button type="button" variant="ghost" size="sm" className="imcrm-h-7 imcrm-w-7 imcrm-p-0" onClick={() => setSigners(signers.filter((_, j) => j !== i))} aria-label={__('Quitar')}>
                                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </Button>
                                )}
                            </span>
                        </div>
                        <MergeTagInput value={s.name} onChange={(v) => setSigner(i, { name: v })} fields={fields} placeholder={__('Nombre o {{nombre}}')} aria-label={__('Nombre de quien firma')} />
                        <MergeTagInput value={s.email} onChange={(v) => setSigner(i, { email: v })} fields={fields} placeholder={__('Correo o {{correo}}')} aria-label={__('Correo de quien firma')} />
                        <Input value={s.role} onChange={(e) => setSigner(i, { role: e.target.value })} placeholder={__('Rol (opcional): Cliente, Representante legal…')} className="imcrm-h-8" aria-label={__('Rol de quien firma')} />
                    </div>
                ))}
                {signers.length < 10 && (
                    <Button type="button" variant="ghost" size="sm" className="imcrm-self-start imcrm-gap-1.5 imcrm-px-1 imcrm-text-primary" onClick={() => setSigners([...signers, EMPTY_SIGNER])} data-testid="request-signature-add-signer">
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Agregar otra persona')}
                    </Button>
                )}
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Un campo Persona en el correo ({{responsable}}) usa el correo de esa persona. Si un correo queda vacío o no es válido al correr, la acción falla y lo dice en el historial.')}
                </p>
            </div>

            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{__('Cómo firman')}</Label>
                    <Select value={c.order} onChange={(e) => set({ order: e.target.value })} aria-label={__('Cómo firman')} className="imcrm-h-8">
                        <option value="parallel">{__('Todos a la vez')}</option>
                        <option value="sequential">{__('En orden (uno después del otro)')}</option>
                    </Select>
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{__('Para firmar piden')}</Label>
                    <Select value={c.verify} onChange={(e) => set({ verify: e.target.value })} aria-label={__('Para firmar piden')} className="imcrm-h-8">
                        <option value="email">{__('Un código que llega al correo (recomendado)')}</option>
                        <option value="none">{__('Sólo el enlace')}</option>
                    </Select>
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{__('Vence en (días)')}</Label>
                    <Input type="number" min={1} max={180} value={String(c.expires_days)} onChange={(e) => set({ expires_days: Number(e.target.value) })} className="imcrm-h-8" aria-label={__('Vence en días')} />
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{__('Recordar cada (días, 0 = no)')}</Label>
                    <Input type="number" min={0} max={30} value={String(c.remind_days)} onChange={(e) => set({ remind_days: Number(e.target.value) })} className="imcrm-h-8" aria-label={__('Recordar cada días')} />
                </div>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Mensaje para quienes firman (opcional)')}</Label>
                <MergeTagInput value={c.message} onChange={(v) => set({ message: v })} fields={fields} rows={3} autoGrow placeholder={__('Hola {{nombre}}, te mandamos el contrato para firmar.')} aria-label={__('Mensaje')} />
            </div>

            <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                <input type="checkbox" className="imcrm-mt-0.5" checked={c.send_email} onChange={(e) => set({ send_email: e.target.checked })} data-testid="request-signature-send-email" />
                <span>
                    {__('Mandarles el enlace por correo')}
                    <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Sin marcar, no sale ningún correo: manda {{firma.enlace}} en un paso siguiente (por WhatsApp, por ejemplo). Con «En orden», el siguiente enlace llega cuando firma el anterior.')}
                    </span>
                </span>
            </label>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-2">
                <span className="imcrm-text-xs imcrm-font-medium">{__('Cuando firmen todos (opcional)')}</span>
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label className="imcrm-text-[11px]">{__('Guardar el PDF firmado en')}</Label>
                        <Select value={c.save_field} onChange={(e) => set({ save_field: e.target.value })} aria-label={__('Guardar el PDF firmado en')} className="imcrm-h-8">
                            <option value="">{__('No guardarlo en un campo')}</option>
                            {fileFields.map((f) => (
                                <option key={f.id} value={f.slug}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label className="imcrm-text-[11px]">{__('Poner la fecha en')}</Label>
                        <Select value={c.date_field} onChange={(e) => set({ date_field: e.target.value })} aria-label={__('Poner la fecha en')} className="imcrm-h-8">
                            <option value="">{__('No poner la fecha')}</option>
                            {dateFields.map((f) => (
                                <option key={f.id} value={f.slug}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label className="imcrm-text-[11px]">{__('Cambiar el campo')}</Label>
                        <Select value={c.status_field} onChange={(e) => set({ status_field: e.target.value, status_value: '' })} aria-label={__('Campo de estado')} className="imcrm-h-8">
                            <option value="">{__('No cambiar ningún campo')}</option>
                            {selectFields.map((f) => (
                                <option key={f.id} value={f.slug}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label className="imcrm-text-[11px]">{__('A')}</Label>
                        <Select value={c.status_value} onChange={(e) => set({ status_value: e.target.value })} disabled={c.status_field === ''} aria-label={__('Opción del estado')} className="imcrm-h-8">
                            <option value="">{__('Elige la opción…')}</option>
                            {statusOptions.map((o) => (
                                <option key={o.value} value={o.value}>
                                    {o.label}
                                </option>
                            ))}
                        </Select>
                    </div>
                </div>
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('También puedes hacerlo con otra automatización: «Cuando cambia una firma» → «Firmaron todos».')}
                </p>
            </div>

            <div className="imcrm-rounded-md imcrm-bg-muted/50 imcrm-p-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                <span className="imcrm-font-medium imcrm-text-foreground">{__('Para los pasos siguientes:')}</span>{' '}
                {REQUEST_SIGNATURE_OUTPUTS.map((o) => `{{${o.tag}}}`).join(' · ')}
            </div>
        </div>
    );
}
