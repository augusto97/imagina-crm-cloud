import { lazy, Suspense, useContext, useState } from 'react';
import { FileText, Paintbrush, Plus } from 'lucide-react';
import type { DocDesign } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import type { ActionSpec } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

import { AutomationEditorListContext } from '../automations/config-editors';
import { MergeTagInput } from '../automations/MergeTagInput';
import { DocumentStarterDialog } from './DocumentStarterDialog';
import { useDocumentTemplates } from './useDocuments';

const DocumentDesigner = lazy(() => import('./DocumentDesigner'));

type Editing = { id: number | null; initial?: { name: string; filename: string; design: DocDesign } } | null;

/** Diseñador + galería, para abrirlos desde una acción sin salir del editor. */
function useDesignerLauncher(listId: number | undefined, fields: FieldEntity[], onSaved: (id: number) => void) {
    const [starterOpen, setStarterOpen] = useState(false);
    const [editing, setEditing] = useState<Editing>(null);
    const ui =
        listId === undefined ? null : (
            <>
                <DocumentStarterDialog
                    open={starterOpen}
                    onOpenChange={setStarterOpen}
                    listId={listId}
                    fields={fields}
                    onCreate={(initial) => {
                        setStarterOpen(false);
                        setEditing({ id: null, initial });
                    }}
                />
                {editing && (
                    <Suspense fallback={null}>
                        <DocumentDesigner
                            open
                            onOpenChange={(o) => !o && setEditing(null)}
                            listId={listId}
                            templateId={editing.id}
                            initial={editing.initial}
                            fields={fields}
                            onSaved={(tpl) => onSaved(tpl.id)}
                        />
                    </Suspense>
                )}
            </>
        );
    return { ui, create: () => setStarterOpen(true), edit: (id: number) => setEditing({ id }) };
}

/**
 * v0.1.266 — Acción «Generar un PDF» (ADR-S35): elige la plantilla de
 * documento de la lista, opcionalmente la guarda en un campo Archivo del
 * registro y deja `{{pdf.link}}` / `{{pdf.nombre}}` para lo que sigue
 * (v0.1.268: sin guardarlo, el enlace arma el PDF al abrirlo)
 * (un WhatsApp con el enlace, un correo).
 */
export function GeneratePdfConfig({
    spec,
    onChange,
    fields,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const listId = useContext(AutomationEditorListContext);
    const templates = useDocumentTemplates(listId);
    const cfg = spec.config as Record<string, unknown>;
    const set = (patch: Record<string, unknown>): void => onChange({ ...spec, config: { ...cfg, ...patch } });
    const templateId = Number(cfg.document_template_id) || 0;
    const fileFields = fields.filter((f) => f.type === 'file');
    const launcher = useDesignerLauncher(listId, fields, (id) => set({ document_template_id: id }));
    const list = templates.data ?? [];
    const missing = templateId > 0 && templates.data !== undefined && !list.some((t) => t.id === templateId);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="generate-pdf-config">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Plantilla del documento')}</Label>
                <div className="imcrm-flex imcrm-gap-2">
                    <Select value={templateId ? String(templateId) : ''} onChange={(e) => set({ document_template_id: e.target.value ? Number(e.target.value) : null })} aria-label={__('Plantilla del documento')}>
                        <option value="">{list.length === 0 ? __('Todavía no hay plantillas') : __('Elige una plantilla…')}</option>
                        {list.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                            </option>
                        ))}
                    </Select>
                    {templateId > 0 && !missing && (
                        <Button type="button" variant="outline" size="sm" className="imcrm-shrink-0 imcrm-gap-1.5" onClick={() => launcher.edit(templateId)}>
                            <Paintbrush className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Diseñar')}
                        </Button>
                    )}
                </div>
                {missing && <p className="imcrm-text-[11px] imcrm-text-destructive">{__('La plantilla elegida ya no existe: elige otra.')}</p>}
                <Button type="button" variant="ghost" size="sm" className="imcrm-self-start imcrm-gap-1.5 imcrm-px-1 imcrm-text-primary" onClick={launcher.create} disabled={listId === undefined}>
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Nueva plantilla (cuenta de cobro, recibo…)')}
                </Button>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Guardarlo en el registro (opcional)')}</Label>
                <Select value={typeof cfg.save_field === 'string' ? cfg.save_field : ''} onChange={(e) => set({ save_field: e.target.value || null })} aria-label={__('Campo Archivo')}>
                    <option value="">{__('No guardar: sólo para adjuntarlo o mandarlo')}</option>
                    {fileFields.map((f) => (
                        <option key={f.id} value={f.slug}>
                            {__('En')} «{f.label}»
                        </option>
                    ))}
                </Select>
                {fileFields.length === 0 && (
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Para guardarlo, crea en la lista un campo de tipo Archivo.')}</p>
                )}
                {typeof cfg.save_field === 'string' && cfg.save_field !== '' && (
                    <Select value={cfg.save_mode === 'replace' ? 'replace' : 'append'} onChange={(e) => set({ save_mode: e.target.value })} aria-label={__('Si ya hay archivos')}>
                        <option value="append">{__('Sumarlo a los archivos que ya tenga')}</option>
                        <option value="replace">{__('Reemplazar lo que haya')}</option>
                    </Select>
                )}
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Sin guardar no ocupa espacio: {{pdf.link}} es un enlace de 30 días que arma el PDF al abrirlo (con los datos de ese momento). Guardado queda como archivo del registro: ocupa espacio del plan, salvo que la empresa use su propio almacenamiento (Ajustes → Almacenamiento).')}
                </p>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Nombre del archivo (opcional)')}</Label>
                <MergeTagInput
                    value={typeof cfg.filename === 'string' ? cfg.filename : ''}
                    onChange={(v) => set({ filename: v })}
                    fields={fields}
                    placeholder={__('El de la plantilla')}
                />
            </div>
            {launcher.ui}
        </div>
    );
}

/**
 * v0.1.266 — «Adjuntar PDF» en «Enviar email»: las plantillas de documento
 * cuyos PDF van adjuntos (si una acción anterior ya generó la misma
 * plantilla, se reusa ese PDF).
 */
export function EmailPdfAttachments({
    value,
    onChange,
    fields,
}: {
    value: number[];
    onChange: (ids: number[]) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const listId = useContext(AutomationEditorListContext);
    const templates = useDocumentTemplates(listId);
    const launcher = useDesignerLauncher(listId, fields, (id) => !value.includes(id) && onChange([...value, id]));
    const list = templates.data ?? [];
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="email-pdf-attachments">
            <Label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs">
                <FileText className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Adjuntar PDF')}
            </Label>
            {list.length === 0 ? (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Diseña una plantilla de documento (cuenta de cobro, recibo) y mándala adjunta en este correo.')}</p>
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-1">
                    {list.map((t) => (
                        <label key={t.id} className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-xs hover:imcrm-bg-accent">
                            <input
                                type="checkbox"
                                checked={value.includes(t.id)}
                                onChange={(e) => onChange(e.target.checked ? [...value, t.id] : value.filter((x) => x !== t.id))}
                            />
                            <span className="imcrm-flex-1 imcrm-truncate">{t.name}</span>
                            <span className="imcrm-text-[10px] imcrm-text-muted-foreground">PDF</span>
                        </label>
                    ))}
                </div>
            )}
            <Button type="button" variant="ghost" size="sm" className="imcrm-self-start imcrm-gap-1.5 imcrm-px-1 imcrm-text-primary" onClick={launcher.create} disabled={listId === undefined}>
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Nueva plantilla de documento')}
            </Button>
            {launcher.ui}
        </div>
    );
}
