import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { useFields } from '@/hooks/useFields';
import { useCreateRecord } from '@/hooks/useRecords';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';

interface SubtaskPromptProps {
    listSlug: string;
    parentId: number;
    onClose: () => void;
    onCreated: (created: { id: number; label: string }) => void;
}

/**
 * Crear una subtarea desde el documento (v0.1.135).
 *
 * La subtarea es un REGISTRO de verdad (el modelo de v0.1.132), no un ítem
 * escondido dentro del texto: aparece en la tabla, se filtra, se exporta. En
 * el documento queda su chip enlazado — que es lo que hace falta para leerlo
 * de corrido.
 */
export function SubtaskPrompt({
    listSlug,
    parentId,
    onClose,
    onCreated,
}: SubtaskPromptProps): JSX.Element {
    const fields = useFields(listSlug);
    const create = useCreateRecord(listSlug);
    const [title, setTitle] = useState('');
    const [error, setError] = useState<string | null>(null);

    // El título va al campo primario (o al primer texto de la lista).
    const target =
        fields.data?.find((f) => f.is_primary)
        ?? fields.data?.find((f) => f.type === 'text' || f.type === 'long_text');

    const submit = async (): Promise<void> => {
        const clean = title.trim();
        if (clean === '') return;
        setError(null);
        try {
            const values = target === undefined ? {} : { [target.slug]: clean };
            const created = await create.mutateAsync({ values, parentId });
            onCreated({ id: created.id, label: clean });
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <Sheet open onOpenChange={(o) => !o && onClose()}>
            <SheetContent side="right" className="imcrm-w-[min(420px,94vw)]">
                <SheetHeader>
                    <SheetTitle>{__('Nueva subtarea')}</SheetTitle>
                    <SheetDescription>
                        {__('Se crea como registro hijo de este y se enlaza acá.')}
                    </SheetDescription>
                </SheetHeader>

                <form
                    className="imcrm-mt-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void submit();
                    }}
                >
                    <Input
                        autoFocus
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={__('¿Qué hay que hacer?')}
                        className="imcrm-h-9"
                    />
                    {target === undefined && (
                        <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-muted-foreground">
                            {__('La lista no tiene un campo de texto: la subtarea se crea vacía.')}
                        </p>
                    )}
                    {error !== null && (
                        <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-destructive">{error}</p>
                    )}

                    <SheetFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            {__('Cancelar')}
                        </Button>
                        <Button type="submit" disabled={title.trim() === '' || create.isPending}>
                            {create.isPending ? __('Creando…') : __('Crear subtarea')}
                        </Button>
                    </SheetFooter>
                </form>
            </SheetContent>
        </Sheet>
    );
}
