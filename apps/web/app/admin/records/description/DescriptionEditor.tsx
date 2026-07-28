import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
    Baseline,
    Bold,
    Code,
    Highlighter,
    Italic,
    Link2,
    Link2Off,
    RemoveFormatting,
    Strikethrough,
    Underline as UnderlineIcon,
} from 'lucide-react';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { HIGHLIGHT_COLORS, TEXT_COLORS, descriptionExtensions } from './editorSetup';
import { filterCommands, type SlashCommand } from './slashCommands';

interface DescriptionEditorProps {
    value: JSONContent | null;
    editable: boolean;
    /**
     * `fromUser` distingue una edición real de la normalización que hace el
     * propio editor al cargar (agrega el párrafo final, completa atributos por
     * defecto). Sin esa distinción, abrir una ficha guardaba sola — y con el
     * documento vacío, lo BORRABA.
     */
    onChange: (doc: JSONContent | null, fromUser: boolean) => void;
    /** Se llama al perder el foco para forzar el guardado pendiente. */
    onBlurFlush?: () => void;
}

interface SlashState {
    open: boolean;
    query: string;
    /** Posición del `/` en el documento (para reemplazarlo al elegir). */
    from: number;
    index: number;
    rect: { top: number; left: number } | null;
}

const CLOSED: SlashState = { open: false, query: '', from: 0, index: 0, rect: null };

/**
 * Editor de bloques de la descripción del registro (v0.1.133) — el equivalente
 * al cuerpo de una tarea de ClickUp: se escribe como en un documento, con
 * atajos markdown (`## `, `- `, `1. `, `> `, ```), menú `/` para insertar
 * bloques y barra flotante de formato al seleccionar texto.
 *
 * El contenido se emite como JSON de ProseMirror; quien lo monta decide cuándo
 * persistirlo (acá sólo se avisa que cambió).
 */
export function DescriptionEditor({
    value,
    editable,
    onChange,
    onBlurFlush,
}: DescriptionEditorProps): JSX.Element {
    const [slash, setSlash] = useState<SlashState>(CLOSED);
    const slashRef = useRef(slash);
    slashRef.current = slash;
    const commands = useMemo(() => filterCommands(slash.query), [slash.query]);
    const commandsRef = useRef(commands);
    commandsRef.current = commands;
    const wrapperRef = useRef<HTMLDivElement>(null);

    const extensions = useMemo(
        () => descriptionExtensions(__('Escribe algo o «/» para insertar bloques')),
        [],
    );

    const closeSlash = useCallback(() => setSlash(CLOSED), []);

    /** Ejecuta un comando: borra el `/consulta` tipeado y aplica el bloque. */
    const runCommand = useCallback((editor: Editor, cmd: SlashCommand, from: number, query: string) => {
        editor
            .chain()
            .focus()
            .deleteRange({ from, to: from + query.length + 1 })
            .run();
        cmd.run(editor);
        setSlash(CLOSED);
    }, []);

    const editor = useEditor(
        {
            extensions,
            content: value ?? undefined,
            editable,
            // v0.1.133 — SSR off: el editor sólo vive en el navegador.
            immediatelyRender: false,
            editorProps: {
                attributes: {
                    class: cn(
                        'imcrm-prose imcrm-max-w-none imcrm-outline-none',
                        'imcrm-min-h-[80px] imcrm-py-1',
                    ),
                },
                handleKeyDown: (_view, event) => {
                    const state = slashRef.current;
                    if (!state.open) return false;
                    const list = commandsRef.current;
                    if (event.key === 'Escape') {
                        setSlash(CLOSED);
                        return true;
                    }
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        if (list.length === 0) return false;
                        const dir = event.key === 'ArrowDown' ? 1 : -1;
                        setSlash((s) => ({
                            ...s,
                            index: (s.index + dir + list.length) % list.length,
                        }));
                        return true;
                    }
                    if (event.key === 'Enter' || event.key === 'Tab') {
                        const cmd = list[state.index];
                        if (cmd === undefined) return false;
                        // El editor de la ref existe siempre que haya menú.
                        const ed = editorRef.current;
                        if (ed) runCommand(ed, cmd, state.from, state.query);
                        return true;
                    }
                    return false;
                },
            },
            onUpdate: ({ editor: ed }) => {
                onChange(isDocEmpty(ed) ? null : ed.getJSON(), ed.isFocused);
                syncSlash(ed);
            },
            onSelectionUpdate: ({ editor: ed }) => syncSlash(ed),
            onBlur: () => {
                // El menú se cierra al salir, pero el guardado pendiente se
                // fuerza (el usuario espera que su texto quede al cambiar de
                // pantalla, no dentro de 800 ms).
                setSlash(CLOSED);
                onBlurFlush?.();
            },
        },
        [extensions],
    );

    const editorRef = useRef<Editor | null>(null);
    editorRef.current = editor;

    /**
     * Detecta el patrón `/consulta` inmediatamente antes del cursor y ubica el
     * menú. Sólo dispara si el `/` arranca palabra — así una fecha `12/8` o
     * una URL no abren el menú.
     */
    const syncSlash = useCallback((ed: Editor) => {
        const { state } = ed;
        const { from, empty } = state.selection;
        if (!empty || !ed.isEditable) {
            setSlash(CLOSED);
            return;
        }
        const $from = state.selection.$from;
        const textBefore = $from.parent.textBetween(
            Math.max(0, $from.parentOffset - 60),
            $from.parentOffset,
            undefined,
            '￼',
        );
        const match = /(?:^|\s)\/([^\s/]{0,30})$/.exec(textBefore);
        if (match === null) {
            setSlash(CLOSED);
            return;
        }
        const query = match[1] ?? '';
        const slashPos = from - query.length - 1;
        const coords = ed.view.coordsAtPos(slashPos);
        const box = wrapperRef.current?.getBoundingClientRect();
        setSlash((prev) => ({
            open: true,
            query,
            from: slashPos,
            // Si la consulta cambió, el resaltado vuelve al primero.
            index: prev.open && prev.query === query ? prev.index : 0,
            rect: {
                top: coords.bottom - (box?.top ?? 0) + 6,
                left: coords.left - (box?.left ?? 0),
            },
        }));
    }, []);

    // Contenido externo (cambió el registro, o llegó del servidor): se
    // reemplaza sin ensuciar el historial ni mover el cursor del usuario si es
    // el mismo documento.
    useEffect(() => {
        if (!editor) return;
        const current = editor.getJSON();
        const next = value ?? { type: 'doc', content: [{ type: 'paragraph' }] };
        if (JSON.stringify(current) === JSON.stringify(next)) return;
        if (editor.isFocused) return; // no pisar lo que se está tipeando
        editor.commands.setContent(next, { emitUpdate: false });
    }, [editor, value]);

    useEffect(() => {
        editor?.setEditable(editable);
    }, [editor, editable]);

    if (!editor) return <div className="imcrm-h-20" />;

    return (
        <div ref={wrapperRef} className="imcrm-relative">
            <EditorContent editor={editor} className="imcrm-imcrm-editor" />

            {/* ——— Barra flotante de formato (al seleccionar texto) ——— */}
            {editable && (
                <BubbleMenu
                    editor={editor}
                    options={{ placement: 'top' }}
                    className="imcrm-z-50 imcrm-flex imcrm-items-center imcrm-gap-0.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-1 imcrm-shadow-imcrm-lg"
                    shouldShow={({ editor: ed, from, to }) =>
                        from !== to && ed.isEditable && !ed.isActive('codeBlock')
                    }
                >
                    <MarkButton
                        icon={Bold}
                        label={__('Negrita')}
                        active={editor.isActive('bold')}
                        onClick={() => editor.chain().focus().toggleBold().run()}
                    />
                    <MarkButton
                        icon={Italic}
                        label={__('Cursiva')}
                        active={editor.isActive('italic')}
                        onClick={() => editor.chain().focus().toggleItalic().run()}
                    />
                    <MarkButton
                        icon={UnderlineIcon}
                        label={__('Subrayado')}
                        active={editor.isActive('underline')}
                        onClick={() => editor.chain().focus().toggleUnderline().run()}
                    />
                    <MarkButton
                        icon={Strikethrough}
                        label={__('Tachado')}
                        active={editor.isActive('strike')}
                        onClick={() => editor.chain().focus().toggleStrike().run()}
                    />
                    <MarkButton
                        icon={Code}
                        label={__('Código')}
                        active={editor.isActive('code')}
                        onClick={() => editor.chain().focus().toggleCode().run()}
                    />
                    <span className="imcrm-mx-0.5 imcrm-h-4 imcrm-w-px imcrm-bg-border" />
                    <ColorMenu
                        icon={Baseline}
                        label={__('Color del texto')}
                        colors={TEXT_COLORS}
                        onPick={(color) => {
                            if (color === null) editor.chain().focus().unsetColor().run();
                            else editor.chain().focus().setColor(color).run();
                        }}
                    />
                    <ColorMenu
                        icon={Highlighter}
                        label={__('Resaltado')}
                        colors={HIGHLIGHT_COLORS}
                        onPick={(color) => {
                            if (color === null) editor.chain().focus().unsetHighlight().run();
                            else editor.chain().focus().setHighlight({ color }).run();
                        }}
                    />
                    <span className="imcrm-mx-0.5 imcrm-h-4 imcrm-w-px imcrm-bg-border" />
                    <MarkButton
                        icon={editor.isActive('link') ? Link2Off : Link2}
                        label={editor.isActive('link') ? __('Quitar enlace') : __('Enlace')}
                        active={editor.isActive('link')}
                        onClick={() => {
                            if (editor.isActive('link')) {
                                editor.chain().focus().unsetLink().run();
                                return;
                            }
                            const url = window.prompt(__('Dirección del enlace'), 'https://');
                            if (url === null || url.trim() === '') return;
                            editor.chain().focus().setLink({ href: url.trim() }).run();
                        }}
                    />
                    <MarkButton
                        icon={RemoveFormatting}
                        label={__('Borrar formato')}
                        active={false}
                        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
                    />
                </BubbleMenu>
            )}

            {/* ——— Menú «/» ——— */}
            {slash.open && slash.rect !== null && commands.length > 0 && (
                <div
                    role="listbox"
                    aria-label={__('Insertar bloque')}
                    className="imcrm-absolute imcrm-z-50 imcrm-max-h-72 imcrm-w-72 imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-1 imcrm-shadow-imcrm-lg"
                    style={{ top: slash.rect.top, left: slash.rect.left }}
                >
                    {commands.map((cmd, i) => {
                        const prev = commands[i - 1];
                        const Icon = cmd.icon;
                        return (
                            <div key={cmd.id}>
                                {(prev === undefined || prev.group !== cmd.group) && (
                                    <div className="imcrm-px-2 imcrm-pb-1 imcrm-pt-2 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                        {cmd.group}
                                    </div>
                                )}
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={i === slash.index}
                                    // mousedown (no click): el click ya habría
                                    // sacado el foco del editor y perdido la
                                    // selección donde hay que insertar.
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        runCommand(editor, cmd, slash.from, slash.query);
                                    }}
                                    onMouseEnter={() => setSlash((s) => ({ ...s, index: i }))}
                                    className={cn(
                                        'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left',
                                        i === slash.index ? 'imcrm-bg-accent' : 'hover:imcrm-bg-accent/60',
                                    )}
                                >
                                    <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted imcrm-text-muted-foreground">
                                        <Icon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                    </span>
                                    <span className="imcrm-min-w-0">
                                        <span className="imcrm-block imcrm-truncate imcrm-text-[13px] imcrm-font-medium">
                                            {cmd.label}
                                        </span>
                                        <span className="imcrm-block imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {cmd.hint}
                                        </span>
                                    </span>
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
            {/* Cerrar el menú al hacer click afuera del editor. */}
            {slash.open && (
                <div
                    className="imcrm-fixed imcrm-inset-0 imcrm-z-40"
                    onMouseDown={closeSlash}
                    aria-hidden
                />
            )}
        </div>
    );
}

function MarkButton({
    icon: Icon,
    label,
    active,
    onClick,
}: {
    icon: typeof Bold;
    label: string;
    active: boolean;
    onClick: () => void;
}): JSX.Element {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
            className={cn(
                'imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-transition-colors',
                active ? 'imcrm-bg-accent imcrm-text-foreground' : 'imcrm-text-muted-foreground hover:imcrm-bg-accent/60',
            )}
        >
            <Icon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
        </button>
    );
}

function ColorMenu({
    icon: Icon,
    label,
    colors,
    onPick,
}: {
    icon: typeof Baseline;
    label: string;
    colors: Array<{ label: string; value: string | null }>;
    onPick: (value: string | null) => void;
}): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <span className="imcrm-relative">
            <MarkButton icon={Icon} label={label} active={open} onClick={() => setOpen((v) => !v)} />
            {open && (
                <div className="imcrm-absolute imcrm-left-0 imcrm-top-8 imcrm-z-50 imcrm-grid imcrm-w-40 imcrm-grid-cols-1 imcrm-gap-0.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-1 imcrm-shadow-imcrm-lg">
                    {colors.map((c) => (
                        <button
                            key={c.label}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                                onPick(c.value);
                                setOpen(false);
                            }}
                            className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-left imcrm-text-xs hover:imcrm-bg-accent/60"
                        >
                            <span
                                className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-rounded imcrm-border imcrm-border-border"
                                style={c.value === null ? undefined : { background: c.value }}
                            />
                            {c.label}
                        </button>
                    ))}
                </div>
            )}
        </span>
    );
}

/** ¿El documento quedó sin contenido? (mismo criterio que el backend). */
function isDocEmpty(editor: Editor): boolean {
    if (!editor.isEmpty) return false;
    return editor.getText().trim() === '';
}
