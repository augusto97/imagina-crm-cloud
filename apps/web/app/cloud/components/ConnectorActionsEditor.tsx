import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import {
    CONNECTOR_ACTION_METHODS,
    CONNECTOR_CONTENT_TYPES,
    CONNECTOR_PARAM_LOCATION_LABEL,
    CONNECTOR_PARAM_LOCATIONS,
    CONNECTOR_PARAM_TYPE_LABEL,
    CONNECTOR_PARAM_TYPES,
    type ConnectorAction,
    type ConnectorParam,
    type ConnectorParamLocation,
    type ConnectorParamType,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { __ } from '@/lib/i18n';

/** Los tres que se escriben a mano (no tiene sentido una fila por dato). */
const RAW_TYPES = new Set(['text', 'xml', 'html']);

const CONTENT_LABEL: Record<string, string> = {
    json: 'JSON',
    form: 'Formulario (x-www-form-urlencoded)',
    multipart: 'Formulario con partes (multipart)',
    text: 'Texto plano',
    xml: 'XML',
    html: 'HTML',
};

function slugify(label: string): string {
    const base = label
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return /^[a-z]/.test(base) ? base.slice(0, 60) : `accion_${base}`.slice(0, 60);
}

function emptyAction(existing: ConnectorAction[]): ConnectorAction {
    let key = 'accion';
    let n = 1;
    while (existing.some((a) => a.key === key)) key = `accion_${++n}`;
    return {
        key,
        label: '',
        description: '',
        method: 'POST',
        path: '',
        content_type: 'json',
        params: [],
        body_template: '',
    };
}

function emptyParam(existing: ConnectorParam[]): ConnectorParam {
    let key = 'campo';
    let n = 1;
    while (existing.some((p) => p.key === key)) key = `campo_${++n}`;
    return {
        key,
        label: '',
        type: 'text',
        location: 'body',
        required: false,
        help: '',
        default: '',
        options: [],
    };
}

/**
 * Catálogo de acciones CON NOMBRE de una conexión (v0.1.198).
 *
 * Lo que se define acá es lo que después aparece en el menú de acciones del
 * editor de automatizaciones: "Enviar WhatsApp" con sus campos rotulados, en
 * vez de "POST /send" y adivinar el cuerpo. La clave técnica de cada acción
 * es estable a propósito — renombrar la etiqueta NUNCA rompe una
 * automatización guardada.
 */
export function ConnectorActionsEditor({
    actions,
    onChange,
}: {
    actions: ConnectorAction[];
    onChange: (next: ConnectorAction[]) => void;
}): JSX.Element {
    const [open, setOpen] = useState<string | null>(null);

    const patch = (index: number, changes: Partial<ConnectorAction>): void => {
        onChange(actions.map((a, i) => (i === index ? { ...a, ...changes } : a)));
    };

    return (
        <div className="imcrm-space-y-2" data-testid="imcrm-connector-actions">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                <div>
                    <Label>{__('Acciones de esta conexión')}</Label>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__(
                            'Cada acción aparece con su nombre en el editor de automatizaciones, con los campos que definas acá.',
                        )}
                    </p>
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    data-testid="imcrm-connector-action-add"
                    onClick={() => {
                        const next = emptyAction(actions);
                        onChange([...actions, next]);
                        setOpen(next.key);
                    }}
                >
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar acción')}
                </Button>
            </div>

            {actions.length === 0 && (
                <p className="imcrm-rounded imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-3 imcrm-text-xs imcrm-text-muted-foreground">
                    {__(
                        'Sin acciones, la conexión sirve igual para la acción genérica "Llamar webhook externo".',
                    )}
                </p>
            )}

            {actions.map((action, index) => {
                const expanded = open === action.key;
                const raw = RAW_TYPES.has(action.content_type);
                return (
                    <div
                        key={action.key}
                        className="imcrm-rounded imcrm-border imcrm-border-border"
                        data-testid={`imcrm-connector-action-${action.key}`}
                    >
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-p-2">
                            <button
                                type="button"
                                className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2 imcrm-text-left"
                                onClick={() => setOpen(expanded ? null : action.key)}
                            >
                                {expanded ? (
                                    <ChevronDown className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                ) : (
                                    <ChevronRight className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                )}
                                <span className="imcrm-min-w-0 imcrm-truncate imcrm-text-sm imcrm-font-medium">
                                    {action.label.trim() === '' ? __('(sin nombre)') : action.label}
                                </span>
                                <span className="imcrm-shrink-0 imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-[10px] imcrm-text-muted-foreground">
                                    {action.method} {action.path || '/'}
                                </span>
                            </button>
                            <Button
                                size="sm"
                                variant="ghost"
                                type="button"
                                aria-label={__('Eliminar acción')}
                                onClick={() => onChange(actions.filter((_, i) => i !== index))}
                            >
                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            </Button>
                        </div>

                        {expanded && (
                            <div className="imcrm-space-y-3 imcrm-border-t imcrm-border-border imcrm-p-3">
                                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                                    <div>
                                        <Label htmlFor={`act-label-${action.key}`}>{__('Nombre')}</Label>
                                        <Input
                                            id={`act-label-${action.key}`}
                                            value={action.label}
                                            placeholder={__('Enviar WhatsApp')}
                                            data-testid="imcrm-connector-action-label"
                                            onChange={(e) => {
                                                const label = e.target.value;
                                                // La clave se propone del nombre SÓLO mientras la
                                                // acción es nueva: después es la referencia que
                                                // guardaron las automatizaciones.
                                                const fresh =
                                                    action.label.trim() === '' &&
                                                    /^accion(_\d+)?$/.test(action.key);
                                                const key =
                                                    fresh && slugify(label) !== ''
                                                        ? slugify(label)
                                                        : action.key;
                                                patch(index, { label, key });
                                                if (key !== action.key) setOpen(key);
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <Label htmlFor={`act-key-${action.key}`}>
                                            {__('Clave interna')}
                                        </Label>
                                        <Input
                                            id={`act-key-${action.key}`}
                                            value={action.key}
                                            onChange={(e) => {
                                                patch(index, { key: e.target.value });
                                                setOpen(e.target.value);
                                            }}
                                        />
                                        <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {__('La guardan las automatizaciones: cambiarla las desconecta.')}
                                        </p>
                                    </div>
                                </div>

                                <div>
                                    <Label htmlFor={`act-desc-${action.key}`}>
                                        {__('Descripción (opcional)')}
                                    </Label>
                                    <Input
                                        id={`act-desc-${action.key}`}
                                        value={action.description}
                                        placeholder={__('Manda un mensaje al número indicado')}
                                        onChange={(e) => patch(index, { description: e.target.value })}
                                    />
                                </div>

                                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-3">
                                    <div>
                                        <Label htmlFor={`act-method-${action.key}`}>{__('Método')}</Label>
                                        <Select
                                            id={`act-method-${action.key}`}
                                            value={action.method}
                                            onChange={(e) =>
                                                patch(index, {
                                                    method: e.target.value as ConnectorAction['method'],
                                                })
                                            }
                                        >
                                            {CONNECTOR_ACTION_METHODS.map((m) => (
                                                <option key={m} value={m}>
                                                    {m}
                                                </option>
                                            ))}
                                        </Select>
                                    </div>
                                    <div className="sm:imcrm-col-span-2">
                                        <Label htmlFor={`act-path-${action.key}`}>{__('Ruta')}</Label>
                                        <Input
                                            id={`act-path-${action.key}`}
                                            value={action.path}
                                            placeholder="/send"
                                            data-testid="imcrm-connector-action-path"
                                            onChange={(e) => patch(index, { path: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <Label htmlFor={`act-ct-${action.key}`}>{__('Tipo de contenido')}</Label>
                                    <Select
                                        id={`act-ct-${action.key}`}
                                        value={action.content_type}
                                        onChange={(e) =>
                                            patch(index, {
                                                content_type: e.target
                                                    .value as ConnectorAction['content_type'],
                                            })
                                        }
                                    >
                                        {CONNECTOR_CONTENT_TYPES.map((t) => (
                                            <option key={t} value={t}>
                                                {__(CONTENT_LABEL[t] ?? t)}
                                            </option>
                                        ))}
                                    </Select>
                                </div>

                                {raw && (
                                    <div>
                                        <Label htmlFor={`act-body-${action.key}`}>
                                            {__('Cuerpo (usá {clave} para insertar un campo)')}
                                        </Label>
                                        <Textarea
                                            id={`act-body-${action.key}`}
                                            rows={4}
                                            value={action.body_template}
                                            onChange={(e) =>
                                                patch(index, { body_template: e.target.value })
                                            }
                                        />
                                    </div>
                                )}

                                <ParamsEditor
                                    params={action.params}
                                    onChange={(params) => patch(index, { params })}
                                />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function ParamsEditor({
    params,
    onChange,
}: {
    params: ConnectorParam[];
    onChange: (next: ConnectorParam[]) => void;
}): JSX.Element {
    const patch = (index: number, changes: Partial<ConnectorParam>): void => {
        onChange(params.map((p, i) => (i === index ? { ...p, ...changes } : p)));
    };
    return (
        <div className="imcrm-space-y-2">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                <Label>{__('Campos que se completan al usarla')}</Label>
                <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    data-testid="imcrm-connector-param-add"
                    onClick={() => onChange([...params, emptyParam(params)])}
                >
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar campo')}
                </Button>
            </div>
            {params.map((param, index) => (
                <div
                    key={index}
                    className="imcrm-space-y-2 imcrm-rounded imcrm-bg-muted/40 imcrm-p-2"
                    data-testid="imcrm-connector-param"
                >
                    <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                        <Input
                            value={param.label}
                            placeholder={__('Etiqueta (Destinatario)')}
                            aria-label={__('Etiqueta del campo')}
                            data-testid="imcrm-connector-param-label"
                            onChange={(e) => patch(index, { label: e.target.value })}
                        />
                        <Input
                            value={param.key}
                            placeholder={__('Clave que espera el servicio (recipient)')}
                            aria-label={__('Clave del campo')}
                            data-testid="imcrm-connector-param-key"
                            onChange={(e) => patch(index, { key: e.target.value })}
                        />
                    </div>
                    <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-3">
                        <Select
                            value={param.type}
                            aria-label={__('Tipo del campo')}
                            onChange={(e) =>
                                patch(index, { type: e.target.value as ConnectorParamType })
                            }
                        >
                            {CONNECTOR_PARAM_TYPES.map((t) => (
                                <option key={t} value={t}>
                                    {__(CONNECTOR_PARAM_TYPE_LABEL[t])}
                                </option>
                            ))}
                        </Select>
                        <Select
                            value={param.location}
                            aria-label={__('Dónde viaja')}
                            onChange={(e) =>
                                patch(index, { location: e.target.value as ConnectorParamLocation })
                            }
                        >
                            {CONNECTOR_PARAM_LOCATIONS.map((l) => (
                                <option key={l} value={l}>
                                    {__(CONNECTOR_PARAM_LOCATION_LABEL[l])}
                                </option>
                            ))}
                        </Select>
                        <Input
                            value={param.default}
                            placeholder={__('Valor por defecto')}
                            aria-label={__('Valor por defecto')}
                            onChange={(e) => patch(index, { default: e.target.value })}
                        />
                    </div>
                    {param.type === 'select' && (
                        <Input
                            value={param.options.map((o) => o.value).join(', ')}
                            placeholder={__('Opciones separadas por coma')}
                            aria-label={__('Opciones')}
                            onChange={(e) =>
                                patch(index, {
                                    options: e.target.value
                                        .split(',')
                                        .map((v) => v.trim())
                                        .filter((v) => v !== '')
                                        .map((v) => ({ value: v, label: v })),
                                })
                            }
                        />
                    )}
                    <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                        <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                            <input
                                type="checkbox"
                                checked={param.required}
                                onChange={(e) => patch(index, { required: e.target.checked })}
                            />
                            {__('Obligatorio')}
                        </label>
                        <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            aria-label={__('Quitar campo')}
                            onClick={() => onChange(params.filter((_, i) => i !== index))}
                        >
                            <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        </Button>
                    </div>
                </div>
            ))}
        </div>
    );
}
