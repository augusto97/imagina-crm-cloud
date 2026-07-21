import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useUpdateRecord } from '@/hooks/useRecords';
import { ApiError } from '@/lib/api';
import { blockStyleClass, blockStyleCss, readBlockStyle, wrapperStyleCss } from '@/lib/blockStyle';
import { getResolvedV2 } from '@/lib/crmTemplates';
import { __ } from '@/lib/i18n';
import { groupBlocksByRowsAndColumns } from '@/lib/rowsLayout';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';
import type { RecordEntity } from '@/types/record';

import { BlockRenderer } from './BlockRenderer';
import { PortalAccessButton } from './PortalAccessButton';

interface RecordCrmLayoutProps {
    list: ListSummary;
    record: RecordEntity;
    fields: FieldEntity[];
    currentUserId: number;
    isAdmin: boolean;
    onDelete: () => void;
    deleting: boolean;
}

/**
 * Layout estilo CRM panel (HubSpot/Pipedrive). Activado opt-in
 * cuando la lista tiene `settings.record_layout === 'crm'`.
 *
 * 0.35.0: rendering basado en grid de 12 columnas usando
 * `react-grid-layout` en modo static (read-only). El header sigue
 * fijo arriba (full width); todo lo demás (properties groups,
 * timeline, stats, related, notes) son bloques en el grid con
 * posiciones declaradas por la plantilla activa (built-in o custom
 * del editor visual).
 *
 * El editor visual (`/lists/:slug/template-editor`) muestra el mismo
 * grid en modo `isDraggable + isResizable`, así "lo que ves al editar
 * es lo que ves en la ficha".
 */
export function RecordCrmLayout({
    list,
    record,
    fields,
    currentUserId,
    isAdmin,
    onDelete,
    deleting,
}: RecordCrmLayoutProps): JSX.Element {
    const update = useUpdateRecord(list.id);
    const toast = useToast();

    const initialValues = useMemo<Record<string, unknown>>(
        () => ({ ...record.fields, ...record.relations }),
        [record],
    );
    const [values, setValues] = useState<Record<string, unknown>>(initialValues);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        setValues(initialValues);
        setFieldErrors({});
    }, [initialValues]);

    const resolved = useMemo(
        () => getResolvedV2(list.settings as Parameters<typeof getResolvedV2>[0], fields),
        [list.settings, fields],
    );

    // 0.57.24 — Layout filas → columnas → bloques apilados (idéntico al portal).
    const rows = useMemo(
        () => groupBlocksByRowsAndColumns(resolved.blocks),
        [resolved.blocks],
    );

    const dirty = JSON.stringify(values) !== JSON.stringify(initialValues);

    const handleSave = async (): Promise<void> => {
        setFieldErrors({});
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(values)) {
            if (JSON.stringify(v) !== JSON.stringify(initialValues[k])) {
                patch[k] = v;
            }
        }
        if (Object.keys(patch).length === 0) return;
        try {
            await update.mutateAsync({ id: record.id, values: patch });
            toast.success(__('Cambios guardados'));
        } catch (err) {
            if (err instanceof ApiError) {
                setFieldErrors(err.errors);
                toast.error(__('No se pudo guardar'), err.message);
            } else if (err instanceof Error) {
                toast.error(__('No se pudo guardar'), err.message);
            }
        }
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            {/* Toolbar superior: navegación + acciones del registro.
             * Los botones Guardar/Eliminar viven acá, FUERA del template,
             * para no acoplar la UI de acciones del registro con el bloque
             * `header` (que es solo presentación). */}
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3">
                <Button asChild variant="ghost" size="sm" className="imcrm-gap-2 imcrm-text-muted-foreground">
                    <Link to={`/lists/${list.slug}/records`}>
                        <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                        {list.name}
                    </Link>
                </Button>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="imcrm-gap-2 imcrm-text-destructive hover:imcrm-text-destructive"
                        onClick={onDelete}
                        disabled={deleting}
                    >
                        <Trash2 className="imcrm-h-4 imcrm-w-4" />
                        {__('Eliminar')}
                    </Button>
                    <Button
                        size="sm"
                        className="imcrm-gap-2"
                        onClick={() => void handleSave()}
                        disabled={! dirty || update.isPending}
                    >
                        <Save className="imcrm-h-4 imcrm-w-4" />
                        {update.isPending ? __('Guardando…') : __('Guardar')}
                    </Button>
                </div>
            </div>

            <PortalAccessButton list={list} record={record} />

            {resolved.blocks.length === 0 ? (
                <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-8 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                    {__('La plantilla activa no tiene bloques. Editá la plantilla en "Editar lista → Apariencia del registro".')}
                </p>
            ) : (
                <div className="imcrm-rows-layout">
                    {rows.map((row) => {
                        // 0.57.29 — spacing (y desde v0.1.93 fondo) leído del
                        // primer bloque (consistente entre hermanos).
                        const firstBlockOfSec = row.columns[0]?.blocks[0];
                        const sectionStyle = wrapperStyleCss({
                            bg: firstBlockOfSec?.secBg,
                            padding: firstBlockOfSec?.secPadding,
                            margin: firstBlockOfSec?.secMargin,
                        });
                        return (
                        <div
                            key={`row-${row.index}`}
                            className="imcrm-row"
                            style={sectionStyle}
                        >
                            {row.columns.map((col) => {
                                // 0.57.38 — `flex: w w 0`: reparte el ancho
                                // disponible (tras restar gaps) proporcional
                                // al width. Sin overflow ni calc().
                                const firstBlockOfCol = col.blocks[0];
                                const colStyle: React.CSSProperties = {
                                    flex: `${col.width} ${col.width} 0`,
                                    ...wrapperStyleCss({
                                        bg: firstBlockOfCol?.colBg,
                                        padding: firstBlockOfCol?.colPadding,
                                        margin: firstBlockOfCol?.colMargin,
                                    }),
                                };
                                return (
                                    <div
                                        key={`col-${row.index}-${col.colIdx}`}
                                        className="imcrm-row__cell"
                                        style={colStyle}
                                    >
                                        {col.blocks.map((b) => (
                                            // v0.1.93 — wrapper de estilo del bloque
                                            // (config.style), idéntico al del editor.
                                            <div
                                                key={b.id}
                                                className={blockStyleClass(readBlockStyle({ style: b.style }))}
                                                style={blockStyleCss(readBlockStyle({ style: b.style }))}
                                            >
                                                <BlockRenderer
                                                    block={b}
                                                    listId={list.id}
                                                    recordId={record.id}
                                                    currentUserId={currentUserId}
                                                    isAdmin={isAdmin}
                                                    values={values}
                                                    onChange={setValues}
                                                    fieldErrors={fieldErrors}
                                                    record={record}
                                                    headerData={resolved.header}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
