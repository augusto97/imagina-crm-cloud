import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { CreateFieldInput } from '@imagina-base/shared';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Wizard de primer uso: arranca una lista desde una plantilla (lista + campos
 * en cadena sobre los endpoints existentes — sin backend nuevo) o desde cero.
 * Se muestra en el estado vacío del workspace. El slug lo resuelve el backend;
 * navegamos por slug al terminar (el ID sigue siendo la verdad interna).
 */

interface Template {
    id: string;
    name: string;
    description: string;
    listName: string;
    fields: CreateFieldInput[];
}

const TEMPLATES: Template[] = [
    {
        id: 'crm',
        name: 'CRM de ventas',
        description: 'Contactos, empresa, etapa del pipeline y monto.',
        listName: 'Oportunidades',
        fields: [
            { label: 'Nombre', type: 'text' },
            { label: 'Empresa', type: 'text' },
            { label: 'Email', type: 'email' },
            {
                label: 'Etapa',
                type: 'select',
                config: {
                    options: [
                        { value: 'nuevo', label: 'Nuevo', color: 'sky' },
                        { value: 'contactado', label: 'Contactado', color: 'amber' },
                        { value: 'propuesta', label: 'Propuesta', color: 'violet' },
                        { value: 'ganado', label: 'Ganado', color: 'emerald' },
                        { value: 'perdido', label: 'Perdido', color: 'rose' },
                    ],
                },
            },
            { label: 'Monto', type: 'currency' },
            { label: 'Cierre estimado', type: 'date' },
        ],
    },
    {
        id: 'projects',
        name: 'Gestión de proyectos',
        description: 'Tareas con estado, responsable y fecha límite.',
        listName: 'Tareas',
        fields: [
            { label: 'Tarea', type: 'text' },
            {
                label: 'Estado',
                type: 'select',
                config: {
                    options: [
                        { value: 'todo', label: 'Por hacer', color: 'slate' },
                        { value: 'doing', label: 'En curso', color: 'blue' },
                        { value: 'done', label: 'Hecho', color: 'green' },
                    ],
                },
            },
            {
                label: 'Prioridad',
                type: 'select',
                config: {
                    options: [
                        { value: 'baja', label: 'Baja', color: 'gray' },
                        { value: 'media', label: 'Media', color: 'amber' },
                        { value: 'alta', label: 'Alta', color: 'red' },
                    ],
                },
            },
            { label: 'Responsable', type: 'text' },
            { label: 'Vence', type: 'date' },
        ],
    },
    {
        id: 'contacts',
        name: 'Directorio de contactos',
        description: 'Agenda simple: nombre, teléfono, email y notas.',
        listName: 'Contactos',
        fields: [
            { label: 'Nombre', type: 'text' },
            { label: 'Teléfono', type: 'text' },
            { label: 'Email', type: 'email' },
            { label: 'Sitio web', type: 'url' },
            { label: 'Notas', type: 'long_text' },
        ],
    },
];

export function OnboardingWizard(): JSX.Element {
    const qc = useQueryClient();
    const navigate = useNavigate();
    const tenantId = useSession((s) => s.activeTenantId);
    const [custom, setCustom] = useState('');
    const [error, setError] = useState<string | null>(null);

    const create = useMutation({
        mutationFn: async (tpl: Template | { blank: string }) => {
            const name = 'blank' in tpl ? tpl.blank : tpl.listName;
            const list = await api.createList({ name });
            if (!('blank' in tpl)) {
                // Los campos se crean en serie: el orden de posición importa y
                // evitamos ráfagas concurrentes contra el mismo tenant.
                for (const f of tpl.fields) await api.createField(list.id, f);
            }
            return list;
        },
        onSuccess: (list) => {
            void qc.invalidateQueries({ queryKey: ['lists', tenantId] });
            navigate(`/lists/${list.slug}`);
        },
        onError: (e) => setError(e instanceof CloudApiError ? e.message : 'No se pudo crear la lista'),
    });

    return (
        <div className="imcrm-mx-auto imcrm-max-w-3xl imcrm-space-y-6 imcrm-p-8">
            <div className="imcrm-space-y-1 imcrm-text-center">
                <h1 className="imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight">
                    Creá tu primera lista
                </h1>
                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                    Empezá desde una plantilla o armá una lista en blanco.
                </p>
            </div>

            {error && <p className="imcrm-text-center imcrm-text-sm imcrm-text-destructive">{error}</p>}

            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-3">
                {TEMPLATES.map((tpl) => (
                    <button
                        key={tpl.id}
                        onClick={() => create.mutate(tpl)}
                        disabled={create.isPending}
                        className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 imcrm-text-left hover:imcrm-border-primary/50 hover:imcrm-shadow disabled:imcrm-opacity-50"
                    >
                        <span className="imcrm-text-sm imcrm-font-semibold">{tpl.name}</span>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{tpl.description}</span>
                        <span className="imcrm-mt-auto imcrm-text-xs imcrm-text-primary">
                            {tpl.fields.length} campos · lista “{tpl.listName}”
                        </span>
                    </button>
                ))}
            </div>

            <form
                className="imcrm-flex imcrm-items-end imcrm-justify-center imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-6"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (custom.trim()) create.mutate({ blank: custom.trim() });
                }}
            >
                <div className="imcrm-space-y-1">
                    <label className="imcrm-text-xs imcrm-text-muted-foreground" htmlFor="blank-list">
                        …o una lista en blanco
                    </label>
                    <Input
                        id="blank-list"
                        value={custom}
                        onChange={(e) => setCustom(e.target.value)}
                        placeholder="Nombre de la lista…"
                        className="imcrm-w-64"
                    />
                </div>
                <Button type="submit" variant="secondary" disabled={!custom.trim() || create.isPending}>
                    Crear
                </Button>
            </form>
        </div>
    );
}
