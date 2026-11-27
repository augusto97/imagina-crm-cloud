import { AlignLeft, Copy, Link2, ListChecks, ListTree, Sparkles, Timer, type LucideIcon } from 'lucide-react';
import type { ListFeatureKey } from '@imagina-base/shared';

import { __ } from '@/lib/i18n';

/**
 * v0.1.475 (ADR-S115) — Las funciones que cada lista enciende o apaga en
 * Configuración → Funciones, con lo que hace cada una en lenguaje claro.
 * El orden es el de la ficha: primero lo que se lee, después el trabajo.
 */
export interface ListFeatureInfo {
    key: ListFeatureKey;
    label: string;
    /** Qué hace, en una o dos líneas. */
    hint: string;
    /** Lo que pasa al apagarla (sólo cuando no es obvio). */
    offNote?: string;
    icon: LucideIcon;
}

export const LIST_FEATURE_CATALOG: readonly ListFeatureInfo[] = [
    {
        key: 'description',
        label: __('Descripción'),
        hint: __('Un documento con formato arriba de los campos de cada registro, para notas largas, listas e imágenes.'),
        icon: AlignLeft,
    },
    {
        key: 'ai_summary',
        label: __('Resumen con IA'),
        hint: __('El botón «Resumir con IA» de la ficha: en qué está el registro, lo pendiente y lo que viene.'),
        icon: Sparkles,
    },
    {
        key: 'subtasks',
        label: __('Subtareas'),
        hint: __('Registros que cuelgan de otro, con su flecha en la tabla para desplegarlos.'),
        offNote: __('Apagadas, las subtareas que ya existen se siguen viendo; sólo deja de ofrecerse crear nuevas.'),
        icon: ListTree,
    },
    {
        key: 'checklists',
        label: __('Checklists'),
        hint: __('Listas de pasos para marcar dentro de cada registro, con su avance («3/8») en la tabla.'),
        icon: ListChecks,
    },
    {
        key: 'dependencies',
        label: __('Dependencias'),
        hint: __('«Bloqueado por» y «Bloquea» entre registros: el candado en la tabla, las flechas del Gantt y la reprogramación en cadena.'),
        icon: Link2,
    },
    {
        key: 'time_tracking',
        label: __('Tiempo registrado'),
        hint: __('El cronómetro y las cargas de tiempo de cada registro.'),
        icon: Timer,
    },
    {
        key: 'duplicates',
        label: __('Aviso de duplicados'),
        hint: __('Avisa en la ficha y al crear cuando un registro se parece a otro (mismo correo, teléfono o documento). Las reglas se eligen en Personalizar vista → Buscar duplicados.'),
        offNote: __('Apágalo en listas donde repetir es normal, como pagos, anualidades o pedidos de un mismo cliente.'),
        icon: Copy,
    },
];
