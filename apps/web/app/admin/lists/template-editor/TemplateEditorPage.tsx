import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useFields } from '@/hooks/useFields';
import { useList, useUpdateList } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import {
    CUSTOM_TEMPLATE_ID,
    customConfigV2FromBuiltin,
    ensureV2,
    type CustomTemplateConfigV2,
    type V2Block,
} from '@/lib/crmTemplates';
import { __ } from '@/lib/i18n';

import { TemplateEditorShell } from '@/admin/template-editor-core';

import { CrmTemplateSettingsPanel } from './CrmTemplateSettingsPanel';
import { crmRegistry } from './crmRegistry';
import {
    extractBlocks,
    extractHeader,
    defaultConfig,
} from './crmBlockAdapter';

/**
 * Editor visual de la plantilla del CRM (record detail page).
 *
 * Desde 0.57.16 usa el mismo `TemplateEditorShell` que el editor
 * del portal del cliente. La única diferencia entre los dos es el
 * `registry` (`crmRegistry` aquí, `portalRegistry` allá) — el motor
 * (grid, undo/redo, paleta, drag, selección, multi-select,
 * fullscreen, hotkeys, paneles colapsables) es compartido. Cualquier
 * mejora al shell se hereda automáticamente.
 *
 * Diferencias del shape persistido vs el shell:
 *
 *   Shell maneja:  V2Block[] (los bloques del grid)
 *   CRM persiste:  CustomTemplateConfigV2 { v: 2, header, blocks }
 *
 * El `header` global (qué fields se usan como título / subtítulos /
 * status pills / acciones rápidas en la pestaña de detalle) NO es
 * un bloque del grid. Lo mantenemos en estado local y lo
 * reconstruimos al guardar via `rebuildConfig()`.
 *
 * El config persiste en `list.settings.crm_template_custom`.
 */
export function TemplateEditorPage(): JSX.Element {
    const { listSlug } = useParams<{ listSlug: string }>();
    const list = useList(listSlug);
    const fields = useFields(list.data?.id);
    const update = useUpdateList(list.data?.id ?? listSlug ?? '');
    const toast = useToast();

    /**
     * Config inicial: hay tres escenarios.
     *  1. La lista tiene `crm_template_custom` ⇒ deserializamos.
     *  2. La lista tiene `crm_template_id` (built-in) ⇒ generamos
     *     un V2 desde el built-in con los fields actuales.
     *  3. Lista nueva sin config ⇒ default vacío.
     */
    const initialConfig = useMemo<CustomTemplateConfigV2 | null>(() => {
        if (! list.data || ! fields.data) return null;
        const settings = list.data.settings as {
            crm_template_id?: string;
            crm_template_custom?: unknown;
        };
        if (settings.crm_template_custom) {
            return ensureV2(settings.crm_template_custom);
        }
        if (settings.crm_template_id) {
            return customConfigV2FromBuiltin(settings.crm_template_id, fields.data);
        }
        return defaultConfig();
    }, [list.data, fields.data]);

    // Header global (extraído del config; el shell no lo maneja).
    // Vive separado para que el `TemplateSettingsPanel` (renderizado
    // como `emptySelectionPanel` cuando no hay bloque seleccionado)
    // pueda editarlo sin tocar los blocks del shell.
    const [header, setHeader] = useState<CustomTemplateConfigV2['header'] | null>(null);

    // Trigger para remontar el shell cuando hacemos "Restaurar
    // desde plantilla" — el shell tiene su propio history y la única
    // manera limpia de reset desde fuera es cambiar su `key`.
    const [resetKey, setResetKey] = useState(0);
    // Override de los blocks usados como `initialBlocks` después
    // de un reset (porque `initialConfig` está memoizado y no
    // se vuelve a leer hasta el próximo mount del componente).
    const [resetBlocks, setResetBlocks] = useState<V2Block[] | null>(null);

    // Sync del header al config inicial cuando carga (una sola vez).
    if (initialConfig && header === null) {
        setHeader(extractHeader(initialConfig));
    }

    if (list.isLoading || fields.isLoading || initialConfig === null || header === null) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-12 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando editor…')}
            </div>
        );
    }

    if (! list.data || ! fields.data) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-3">
                <Button asChild variant="ghost" size="sm" className="imcrm-gap-2">
                    <Link to="/lists">
                        <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                        {__('Listas')}
                    </Link>
                </Button>
                <p className="imcrm-text-sm imcrm-text-destructive">
                    {__('Lista no encontrada.')}
                </p>
            </div>
        );
    }

    const handleSave = async (blocks: V2Block[]): Promise<void> => {
        if (! list.data) return;
        const nextConfig: CustomTemplateConfigV2 = {
            v: 2,
            header,
            blocks,
        };
        try {
            await update.mutateAsync({
                settings: {
                    ...list.data.settings,
                    record_layout: 'crm',
                    crm_template_id: CUSTOM_TEMPLATE_ID,
                    crm_template_custom: nextConfig,
                },
            });
            toast.success(__('Plantilla guardada'));
        } catch (err) {
            const msg = err instanceof ApiError || err instanceof Error ? err.message : 'Error';
            toast.error(__('No se pudo guardar'), msg);
        }
    };

    const handleResetFromBuiltin = (builtinId: string): void => {
        if (! fields.data) return;
        const fresh = customConfigV2FromBuiltin(builtinId, fields.data);
        setHeader(fresh.header);
        setResetBlocks(fresh.blocks);
        setResetKey((k) => k + 1);
        toast.info(__('Restaurada — recordá guardar para aplicar.'));
    };

    const initialBlocks = resetBlocks ?? extractBlocks(initialConfig);

    return (
        <TemplateEditorShell<V2Block>
            key={resetKey}
            listId={list.data.id}
            listName={list.data.name}
            listSlug={list.data.slug}
            fields={fields.data}
            registry={crmRegistry}
            initialBlocks={initialBlocks}
            onSave={handleSave}
            saving={update.isPending}
            headerIcon={Pencil}
            headerTitle={__('Editor de plantilla')}
            backTo={`/lists/${list.data.slug}/records`}
            emptySelectionPanel={
                <CrmTemplateSettingsPanel
                    fields={fields.data}
                    header={header}
                    onHeaderChange={setHeader}
                    onResetFromBuiltin={handleResetFromBuiltin}
                />
            }
        />
    );
}
