import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Plus, X } from 'lucide-react';
import type { PortalBoot, PortalCreatableList } from '@imagina-base/shared';

import { portalApi } from '@/cloud-portal/portalClient';
import { CloudApiError } from '@/lib/cloud/client';

type Field = PortalCreatableList['fields'][number];

/**
 * El cliente crea registros desde su portal (abrir un ticket, pedir algo) en
 * las listas que la empresa habilitó. Sólo completa los datos permitidos; el
 * vínculo con su registro lo pone el servidor y el equipo recibe el aviso.
 */
export function PortalCreateRecords({ boot }: { boot: PortalBoot }): JSX.Element | null {
    const lists = boot.creatable_lists ?? [];
    if (lists.length === 0) return null;
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="portal-create-records">
            {lists.map((l) => (
                <CreateOne key={l.list_id} list={l} />
            ))}
        </section>
    );
}

function CreateOne({ list }: { list: PortalCreatableList }): JSX.Element {
    const qc = useQueryClient();
    const [open, setOpen] = useState(false);
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [done, setDone] = useState(false);
    const create = useMutation({
        mutationFn: () => portalApi.portalCreateRecord(list.list_id, values),
        onSuccess: () => {
            setValues({});
            setErrors({});
            setOpen(false);
            setDone(true);
            // Lo nuevo aparece en las tablas y gráficos del diseño.
            void qc.invalidateQueries({ queryKey: ['portal-me'] });
        },
        onError: (err) => {
            if (err instanceof CloudApiError && Object.keys(err.errors).length > 0) setErrors(err.errors);
            else setErrors({ _: err instanceof Error ? err.message : 'No se pudo enviar.' });
        },
    });

    if (!open) {
        return (
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                <button
                    type="button"
                    onClick={() => {
                        setOpen(true);
                        setDone(false);
                    }}
                    className="imcrm-inline-flex imcrm-h-10 imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-primary imcrm-px-4 imcrm-text-sm imcrm-font-medium imcrm-text-primary-foreground"
                    data-testid="portal-create-open"
                >
                    <Plus className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    {list.label}
                </button>
                {done && (
                    <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-text-emerald-700 dark:imcrm-text-emerald-300" role="status">
                        <CheckCircle2 className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        ¡Listo! Lo recibimos.
                    </span>
                )}
            </div>
        );
    }

    return (
        <form
            className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5"
            onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
            }}
        >
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3">
                <h2 className="imcrm-text-base imcrm-font-semibold">{list.label}</h2>
                <button type="button" aria-label="Cerrar" onClick={() => setOpen(false)} className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                    <X className="imcrm-h-4 imcrm-w-4" />
                </button>
            </div>
            {list.fields.map((f) => (
                <label key={f.id} className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                    <span className="imcrm-font-medium">
                        {f.label}
                        {f.is_required && <span className="imcrm-ml-0.5 imcrm-text-destructive">*</span>}
                    </span>
                    {f.description && <span className="imcrm-text-xs imcrm-text-muted-foreground">{f.description}</span>}
                    <FieldInput field={f} value={values[String(f.id)]} onChange={(v) => setValues((p) => ({ ...p, [String(f.id)]: v }))} />
                    {errors[String(f.id)] && <span className="imcrm-text-xs imcrm-text-destructive">{errors[String(f.id)]}</span>}
                </label>
            ))}
            {errors._ && (
                <p className="imcrm-text-sm imcrm-text-destructive" role="alert">
                    {errors._}
                </p>
            )}
            <div className="imcrm-flex imcrm-justify-end">
                <button
                    type="submit"
                    disabled={create.isPending}
                    className="imcrm-h-10 imcrm-rounded-md imcrm-bg-primary imcrm-px-4 imcrm-text-sm imcrm-font-medium imcrm-text-primary-foreground disabled:imcrm-opacity-60"
                >
                    {create.isPending ? 'Enviando…' : 'Enviar'}
                </button>
            </div>
        </form>
    );
}

const INPUT = 'imcrm-h-10 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-sm';

function FieldInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }): JSX.Element {
    const options = Array.isArray((field.config as { options?: unknown }).options)
        ? ((field.config as { options: Array<{ value: string; label?: string }> }).options)
        : [];
    switch (field.type) {
        case 'long_text':
            return <textarea rows={4} className={`${INPUT} imcrm-h-auto imcrm-py-2`} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
        case 'checkbox':
            return <input type="checkbox" className="imcrm-h-4 imcrm-w-4 imcrm-self-start" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
        case 'select':
            return (
                <select className={INPUT} value={String(value ?? '')} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
                    <option value="">Elige…</option>
                    {options.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label || o.value}
                        </option>
                    ))}
                </select>
            );
        case 'multi_select': {
            const cur = Array.isArray(value) ? (value as string[]) : [];
            return (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-4 imcrm-gap-y-1">
                    {options.map((o) => (
                        <label key={o.value} className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                            <input
                                type="checkbox"
                                checked={cur.includes(o.value)}
                                onChange={(e) => onChange(e.target.checked ? [...cur, o.value] : cur.filter((x) => x !== o.value))}
                            />
                            {o.label || o.value}
                        </label>
                    ))}
                </div>
            );
        }
        case 'number':
        case 'currency':
        case 'percent':
        case 'rating':
        case 'duration':
            return (
                <input
                    type="number"
                    inputMode="decimal"
                    className={INPUT}
                    value={typeof value === 'number' ? value : ''}
                    onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
                />
            );
        case 'date':
            return <input type="date" className={INPUT} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)} />;
        case 'datetime':
            return (
                <input
                    type="datetime-local"
                    className={INPUT}
                    value={typeof value === 'string' ? value.slice(0, 16) : ''}
                    onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
                />
            );
        case 'email':
            return <input type="email" className={INPUT} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
        case 'url':
            return <input type="url" className={INPUT} placeholder="https://" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
        case 'phone':
            return <input type="tel" className={INPUT} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
        default:
            return <input type="text" className={INPUT} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    }
}
