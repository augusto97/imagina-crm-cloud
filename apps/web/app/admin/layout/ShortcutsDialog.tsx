import * as Dialog from '@radix-ui/react-dialog';
import { Keyboard, X } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { GO_CHORDS, PALETTE_SHORTCUT_LABEL } from '@/lib/shortcuts';

interface ShortcutRow {
    keys: string[];
    label: string;
    /** Qué va entre las teclas: «luego» (una tras otra), «+» (juntas) o «·» (alternativas). */
    sep?: string;
}

function mod(key: string): string {
    const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
    return mac ? `⌘${key}` : `Ctrl+${key}`;
}

/**
 * v0.1.286 — ayuda de atajos de teclado (tecla `?` o el menú de la persona).
 */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element {
    const rows: ShortcutRow[] = [
        { keys: [PALETTE_SHORTCUT_LABEL], label: __('Buscar y abrir cualquier cosa') },
        { keys: ['?'], label: __('Mostrar estos atajos') },
        ...GO_CHORDS.map((c) => ({ keys: ['g', c.key], label: __(c.label) })),
        { keys: ['Esc'], label: __('Cerrar un panel o diálogo') },
    ];
    // v0.1.294 — la tabla funciona como una hoja de cálculo.
    const tableRows: ShortcutRow[] = [
        { keys: [__('Clic')], label: __('Elegir una celda') },
        { keys: ['Enter'], label: __('Editar la celda (o doble clic, o empezar a escribir)') },
        { keys: [__('Mayús'), __('Clic')], label: __('Elegir un rango (o arrastrar, o Mayús + flechas)'), sep: '+' },
        { keys: [mod('C'), mod('X'), mod('V')], label: __('Copiar, cortar y pegar (también desde Excel o Sheets)'), sep: '·' },
        { keys: [mod('D')], label: __('Rellenar hacia abajo') },
        { keys: [__('Supr')], label: __('Borrar el contenido') },
        { keys: [mod('Z'), mod('Y')], label: __('Deshacer y rehacer'), sep: '·' },
        { keys: [__('Clic derecho')], label: __('Todas las acciones de la celda') },
    ];
    // B4 — el calendario.
    const calendarRows: ShortcutRow[] = [
        { keys: ['M', 'S', 'D', 'A'], label: __('Ver mes, semana, día o agenda'), sep: '·' },
        { keys: ['H'], label: __('Volver a hoy') },
        { keys: ['←', '→'], label: __('Período anterior o siguiente'), sep: '·' },
        { keys: [__('Arrastrar')], label: __('Reprogramar un evento (o estirar su borde para cambiar el fin)') },
        { keys: [mod('Z')], label: __('Deshacer el último movimiento') },
    ];
    const renderRows = (list: ShortcutRow[]): JSX.Element => (
        <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border">
            {list.map((r) => (
                <li key={r.label} className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-py-2 imcrm-text-sm">
                    <span>{r.label}</span>
                    <span className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1">
                        {r.keys.map((k, i) => (
                            <span key={`${k}-${i}`} className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                {i > 0 && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{r.sep ?? __('luego')}</span>}
                                <kbd className="imcrm-min-w-[1.5rem] imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-center imcrm-text-[11px] imcrm-font-medium">
                                    {k}
                                </kbd>
                            </span>
                        ))}
                    </span>
                </li>
            ))}
        </ul>
    );
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40" />
                <Dialog.Content
                    data-testid="shortcuts-dialog"
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-[8vh] imcrm-z-50 imcrm-max-h-[84vh] imcrm-overflow-y-auto imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md imcrm--translate-x-1/2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg"
                >
                    <div className="imcrm-mb-3 imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                        <Dialog.Title className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                            <Keyboard className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                            {__('Atajos de teclado')}
                        </Dialog.Title>
                        <Dialog.Close
                            aria-label={__('Cerrar')}
                            className="imcrm-inline-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                        >
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>
                    <Dialog.Description className="imcrm-mb-3 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Los atajos de una sola tecla no funcionan mientras escribes en un campo.')}
                    </Dialog.Description>
                    {renderRows(rows)}
                    <h3 className="imcrm-mb-1 imcrm-mt-4 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {__('En la tabla')}
                    </h3>
                    {renderRows(tableRows)}
                    <h3 className="imcrm-mb-1 imcrm-mt-4 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {__('En el calendario')}
                    </h3>
                    {renderRows(calendarRows)}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
