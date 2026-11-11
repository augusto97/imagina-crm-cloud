import { __ } from '@/lib/i18n';

/** Los disparadores que van juntos bajo «WhatsApp» en el selector. */
const WHATSAPP_TRIGGERS = ['whatsapp_message_received', 'whats_event'];

/**
 * v0.1.402 — Las opciones del selector de disparador. Los de WhatsApp van
 * juntos en su grupo (el mensaje que te escriben y lo que avisa Whats); el
 * resto, en el orden del catálogo.
 */
export function TriggerOptions({ triggers }: { triggers: ReadonlyArray<{ slug: string; label: string }> }): JSX.Element {
    const rest = triggers.filter((t) => !WHATSAPP_TRIGGERS.includes(t.slug));
    const wa = triggers.filter((t) => WHATSAPP_TRIGGERS.includes(t.slug));
    return (
        <>
            {rest.map((t) => (
                <option key={t.slug} value={t.slug}>
                    {t.label}
                </option>
            ))}
            {wa.length > 0 && (
                <optgroup label={__('WhatsApp')}>
                    {wa.map((t) => (
                        <option key={t.slug} value={t.slug}>
                            {t.label}
                        </option>
                    ))}
                </optgroup>
            )}
        </>
    );
}
