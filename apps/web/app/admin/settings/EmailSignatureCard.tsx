import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import {
    useEmailSignature,
    useUpdateEmailSignature,
} from '@/hooks/useEmailSignature';
import { __ } from '@/lib/i18n';

/**
 * Card en Settings para que el usuario edite su firma de email.
 *
 * Persistida en `user_meta:imcrm_email_signature` (per-usuario; cada
 * admin ve la suya). El backend hace `wp_kses_post` así que se acepta
 * HTML básico (links, formato, imágenes con src http(s)) — no
 * scripts.
 *
 * Insertable en el body de cualquier email automatizado vía:
 *  - El botón "+ Agregar firma" en `MergeTagInput`.
 *  - El merge tag `{{signature}}`.
 */
export function EmailSignatureCard(): JSX.Element {
    const query = useEmailSignature();
    const update = useUpdateEmailSignature();
    const toast = useToast();

    const [draft, setDraft] = useState('');
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (query.data !== undefined && !dirty) {
            setDraft(query.data);
        }
    }, [query.data, dirty]);

    const save = async (): Promise<void> => {
        try {
            await update.mutateAsync(draft);
            setDirty(false);
            toast.success(__('Firma guardada'));
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo guardar la firma'), err.message);
        }
    };

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div>
                <h2 className="imcrm-text-base imcrm-font-semibold">
                    {__('Firma de email')}
                </h2>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__(
                        'Tu firma se inserta automáticamente al usar "+ Agregar firma" en el body de los emails de automatizaciones, o vía el merge tag {{signature}}. Acepta HTML básico (links, negritas, imágenes).',
                    )}
                </p>
            </div>

            <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4">
                {query.isLoading ? (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {__('Cargando…')}
                    </div>
                ) : (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                        <Textarea
                            rows={6}
                            value={draft}
                            onChange={(e) => {
                                setDraft(e.target.value);
                                setDirty(true);
                            }}
                            placeholder={__(
                                '<p>Saludos,</p>\n<p><strong>Tu nombre</strong><br/>Empresa · sitio.com</p>',
                            )}
                            className="imcrm-font-mono imcrm-text-xs"
                        />

                        {draft.trim() !== '' && (
                            <div className="imcrm-rounded imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
                                <div className="imcrm-mb-1 imcrm-text-[10px] imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                    {__('Vista previa')}
                                </div>
                                {/* eslint-disable-next-line react/no-danger */}
                                <div
                                    className="imcrm-text-sm"
                                    dangerouslySetInnerHTML={{ __html: draft }}
                                />
                            </div>
                        )}

                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            {dirty && (
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        setDraft(query.data ?? '');
                                        setDirty(false);
                                    }}
                                >
                                    {__('Descartar')}
                                </Button>
                            )}
                            <Button
                                onClick={() => void save()}
                                disabled={!dirty || update.isPending}
                                className="imcrm-gap-2"
                            >
                                {update.isPending ? (
                                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                                ) : (
                                    <Save className="imcrm-h-4 imcrm-w-4" />
                                )}
                                {__('Guardar firma')}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
