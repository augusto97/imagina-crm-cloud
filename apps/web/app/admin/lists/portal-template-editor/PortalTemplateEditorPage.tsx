import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Monitor } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useFields } from '@/hooks/useFields';
import { useList, useUpdateList } from '@/hooks/useLists';
import { PAGE_FONT_STACKS, readPageSettings, type PortalPageSettings } from '@/lib/blockStyle';
import { __ } from '@/lib/i18n';

import { TemplateEditorShell } from '@/admin/template-editor-core';

import { PortalPageSettingsButton } from './PortalPageSettings';
import {
    blocksToPortalTemplate,
    portalRegistry,
    portalTemplateToBlocks,
    type PortalEditorBlock,
} from './portalRegistry';

/**
 * Editor visual de la plantilla del portal del cliente. Usa el
 * shell genérico `TemplateEditorShell` con un `portalRegistry`
 * que define los 9 tipos de bloque del portal.
 *
 * Fuente única con el editor CRM: el motor (grid, undo/redo,
 * paleta, drag, selección, multi-select, fullscreen, hotkeys) es
 * compartido. Cualquier mejora al shell se hereda automáticamente.
 */
export function PortalTemplateEditorPage(): JSX.Element {
    const { listSlug } = useParams<{ listSlug: string }>();
    const list = useList(listSlug);
    const fields = useFields(list.data?.id);
    const update = useUpdateList(list.data?.id ?? listSlug ?? '');

    const initialBlocks = useMemo<PortalEditorBlock[] | null>(() => {
        if (! list.data) return null;
        const settings = list.data.settings as { portal_template?: unknown };
        const raw = settings.portal_template;
        if (raw && typeof raw === 'object' && raw !== null && Array.isArray((raw as { blocks?: unknown }).blocks)) {
            return portalTemplateToBlocks((raw as { blocks: unknown[] }).blocks);
        }
        return [];
    }, [list.data]);

    // v0.1.94 — ajustes de PÁGINA del portal (fondo/ancho/tipografía),
    // persistidos junto a los bloques en `portal_template.page`.
    const [pageSettings, setPageSettings] = useState<PortalPageSettings | null>(null);
    const effectivePage: PortalPageSettings =
        pageSettings ??
        readPageSettings(
            (list.data?.settings as { portal_template?: { page?: unknown } } | undefined)
                ?.portal_template?.page,
        );

    if (list.isLoading || fields.isLoading || initialBlocks === null) {
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
                <p className="imcrm-text-sm imcrm-text-destructive">{__('Lista no encontrada.')}</p>
            </div>
        );
    }

    const handleSave = async (blocks: PortalEditorBlock[]): Promise<void> => {
        const template = {
            ...blocksToPortalTemplate(blocks),
            ...(Object.keys(effectivePage).length > 0 ? { page: effectivePage } : {}),
        };
        await update.mutateAsync({
            settings: {
                ...(list.data!.settings as Record<string, unknown>),
                portal_template: template,
            },
        });
    };

    return (
        <TemplateEditorShell<PortalEditorBlock>
            listId={list.data.id}
            listName={list.data.name}
            listSlug={list.data.slug}
            fields={fields.data}
            registry={portalRegistry}
            initialBlocks={initialBlocks}
            onSave={handleSave}
            saving={update.isPending}
            headerIcon={Monitor}
            headerTitle={__('Editor del portal del cliente')}
            backTo={`/lists/${list.data.slug}/settings`}
            toolbarExtra={
                <PortalPageSettingsButton value={effectivePage} onChange={setPageSettings} />
            }
            previewPage={{
                bg: effectivePage.bg,
                maxWidth: effectivePage.max_width,
                fontFamily:
                    effectivePage.font !== undefined
                        ? PAGE_FONT_STACKS[effectivePage.font]
                        : undefined,
            }}
        />
    );
}
