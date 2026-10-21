import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useFields } from '@/hooks/useFields';
import { useRelationPaths } from '@/hooks/useRelationPaths';
import type { ActionSpec } from '@/types/automation';

import { pathKey, type NodePath } from './actionsTree';
import { itemSection, variablesAt, type LoopItemInfo } from './flowVariables';
import type { MergeTagSection } from './MergeTagInput';

/**
 * v0.1.288 — Contexto del FLUJO para los editores de cada paso: el árbol
 * completo (para saber qué corrió antes), las respuestas reales que se
 * obtuvieron al probar, la ruta del paso que se edita y el vinculado de un
 * bucle. Con eso el selector de variables ofrece, en cada paso, sólo lo que
 * existe en ese punto del flujo.
 */

export interface AutomationFlowValue {
    actions: ActionSpec[];
    /** Cuerpos de respuestas reales por ruta del paso (`2.then.0`). */
    samples: Record<string, unknown>;
    setSample: (path: string, body: unknown) => void;
}

export const AutomationFlowContext = createContext<AutomationFlowValue | null>(null);

export const StepPathContext = createContext<NodePath | null>(null);

export const LoopItemContext = createContext<LoopItemInfo | null>(null);

export const StepVariablesContext = createContext<MergeTagSection[]>([]);

export function useAutomationFlow(): AutomationFlowValue | null {
    return useContext(AutomationFlowContext);
}

export function useStepPath(): NodePath | null {
    return useContext(StepPathContext);
}

export function useLoopItem(): LoopItemInfo | null {
    return useContext(LoopItemContext);
}

export function useStepVariables(): MergeTagSection[] {
    return useContext(StepVariablesContext);
}

/** Guarda la respuesta real de un paso (del probador) como muestra de variables. */
export function useRememberSample(): ((body: unknown) => void) | null {
    const flow = useContext(AutomationFlowContext);
    const path = useContext(StepPathContext);
    if (!flow || !path) return null;
    return (body: unknown) => flow.setSample(pathKey(path), body);
}

/** Envuelve el editor de un paso: fija su ruta y calcula sus variables extra. */
export function StepScope({ path, children }: { path: NodePath; children: ReactNode }): JSX.Element {
    const flow = useContext(AutomationFlowContext);
    const item = useContext(LoopItemContext);
    const key = pathKey(path);
    const sections = useMemo(
        () => (flow ? variablesAt(flow.actions, path, flow.samples, item) : item ? [itemSection(item)] : []),
        // `path` se compara por su clave: el array es nuevo en cada render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [flow?.actions, flow?.samples, item, key],
    );
    const stablePath = useMemo(() => path, [key]); // eslint-disable-line react-hooks/exhaustive-deps
    return (
        <StepPathContext.Provider value={stablePath}>
            <StepVariablesContext.Provider value={sections}>{children}</StepVariablesContext.Provider>
        </StepPathContext.Provider>
    );
}

/**
 * Lo que va DENTRO de un «Repetir por cada registro vinculado»: resuelve la
 * lista vinculada por la relación (en cualquier sentido) y sus campos.
 */
export function LoopItemProvider({
    listId,
    relationFieldId,
    children,
}: {
    listId: number | undefined;
    relationFieldId: number;
    children: ReactNode;
}): JSX.Element {
    const paths = useRelationPaths(listId);
    const path = paths.data?.find((p) => p.relation_field_id === relationFieldId) ?? null;
    const other = useFields(path?.other_list_id);
    const value = useMemo<LoopItemInfo | null>(
        () =>
            path
                ? {
                      listId: path.other_list_id,
                      listName: path.other_list_name,
                      relationLabel: path.relation_label,
                      fields: other.data ?? [],
                  }
                : null,
        [path, other.data],
    );
    return <LoopItemContext.Provider value={value}>{children}</LoopItemContext.Provider>;
}
