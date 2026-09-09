import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AutomationTemplateSummary, CreateAutomationTemplateInput } from '@imagina-base/shared';

import { api } from '@/lib/api';

/**
 * Plantillas de automatización (v0.1.167). Aplicar es CLIENT-SIDE (se mapean
 * los roles a los campos con `remapAutomationSlugs` y se abre el editor
 * pre-cargado), así que acá sólo galería, guardar y borrar.
 */
export const automationTemplatesKeys = {
    all: ['automation-templates'] as const,
    list: () => [...automationTemplatesKeys.all, 'list'] as const,
};

export function useAutomationTemplates(enabled = true) {
    return useQuery({
        queryKey: automationTemplatesKeys.list(),
        queryFn: async () => {
            const res = await api.get<AutomationTemplateSummary[]>('/automation-templates');
            return res.data;
        },
        enabled,
        staleTime: 60_000,
    });
}

export function useCreateAutomationTemplate() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateAutomationTemplateInput) => {
            const res = await api.post<AutomationTemplateSummary>('/automation-templates', input);
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: automationTemplatesKeys.all });
        },
    });
}

export function useDeleteAutomationTemplate() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`/automation-templates/${id}`);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: automationTemplatesKeys.all });
        },
    });
}
