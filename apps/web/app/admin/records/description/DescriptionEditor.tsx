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

import { resolveEmbed } from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { FLOATING_MENU_ATTR } from '@/lib/escapeGuard';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { SubtaskPrompt } from './SubtaskPrompt';
import { RecordPickerDialog } from './RecordPickerDialog';
import { UserMentionMenu } from './UserMentionMenu';

import { HIGHLIGHT_COLORS, TEXT_COLORS, descriptionExtensions } from './editorSetup';
import { filterCommands, type SlashCommand } from './slashCommands';

interface DescriptionEditorProps {
    value: JSONContent | null;
    editable: boolean;
    /** Lista del registro: arranca seleccionada al mencionar otro registro. */
    listSlug?: string;
    /** Registro dueño del documento (para crear subtareas desde el menú). */
    recordId?: number;
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

/** Marca de menú flotante propio: Esc lo cierra a él, no a la ficha. */
const FLOATING = { [FLOATING_MENU_ATTR]: '' } as Record<string, string>;

/** Lo que pide una dirección (enlace o contenido insertado). */
interface UrlPromptState {
    kind: 'link' | 'embed';
    top: number;
    left: number;
}

/**
 * Editor de bloques de la descripción del registro (v0.1.133) — el equivalente
 * al cuerpo de una tarea de ClickUp: se escribe como en un documento, con
 * atajos markdown (`## `, `- `, `1. `, `> `, ```), menú `/` para insertar
 * bloques y barra flotante de formato al seleccionar texto.
 *
 * El contenido se emite como JSON de ProseMirror; quien lo monta decide cuándo
 * persistirlo (aquí sólo se avisa que cambió).
 */
export function DescriptionEditor({
    value,
    editable,
    listSlug,
    recordId,
    onChange,
    onBlurFlush,
}: DescriptionEditorProps): JSX.Element {
    // Bloques "vivos" (v0.1.134): lo que no se resuelve con el editor solo.
    const fileInput = useRef<HTMLInputElement>(null);
    const [uploadKind, setUploadKind] = useState<'image' | 'file'>('file');
    const [uploading, setUploading] = useState(false);
    const [pickRecord, setPickRecord] = useState(false);
    /**
     * Inserciones que hace la propia UI (mención, archivo, embed, subtarea).
     * El autosave sólo cuenta los cambios "del usuario" y los mide por el foco
     * del editor — pero al volver de un diálogo el foco todavía no está ahí, y
     * sin esta marca el bloque recién insertado NO se guardaba.
     */
    const uiEdit = useRef(false);
    /** Título tipeado de la subtarea a crear (null = diálogo cerrado). */
    const [newSubtask, setNewSubtask] = useState<string | null>(null);
    const [userQuery, setUserQuery] = useState<string | null>(null);
    /** Cuadrito para escribir una dirección (antes era `window.prompt`). */
    const [urlPrompt, setUrlPrompt] = useState<UrlPromptState | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
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

    /** Corre una inserción de la UI marcándola como edición real. */
    const applyUiEdit = useCallback((run: () => void) => {
        uiEdit.current = true;
        try {
            run();
        } finally {
            // El update de ProseMirror es síncrono, pero el flag se limpia en
            // el próximo tick por si alguna extensión encadena otro cambio.
            setTimeout(() => {
                uiEdit.current = false;
            }, 0);
        }
    }, []);

    /** Ejecuta un comando: borra el `/consulta` tipeado y aplica el bloque. */
    const runCommand = useCallback((editor: Editor, cmd: SlashCommand, from: number, query: string) => {
        editor
            .chain()
            .focus()
            .deleteRange({ from, to: from + query.length + 1 })
            .run();
        setSlash(CLOSED);
        // Los bloques vivos necesitan pedir algo antes de existir.
        if (cmd.action === 'image' || cmd.action === 'file') {
            setUploadKind(cmd.action);
            // Un tick: el input tiene que tener ya el `accept` correcto.
            setTimeout(() => fileInput.current?.click(), 0);
            return;
        }
        if (cmd.action === 'mentionRecord') {
            setPickRecord(true);
            return;
        }
        if (cmd.action === 'embed') {
            setUrlPrompt({ kind: 'embed', ...promptPosition(editor) });
            return;
        }
        if (cmd.action === 'subtask') {
            setNewSubtask('');
            return;
        }
        if (cmd.action === 'mentionUser') {
            // Se escribe el `@` y el propio trigger abre el buscador.
            editor.chain().focus().insertContent('@').run();
            return;
        }
        cmd.run(editor);
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
                onChange(isDocEmpty(ed) ? null : ed.getJSON(), ed.isFocused || uiEdit.current);
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
     * Esc con el menú «/» abierto: el modal de la ficha (Radix) escucha Escape
     * en el `document` en fase de captura y lo marca como manejado, así que a
     * ProseMirror (que ignora los eventos ya marcados) nunca le llegaba y el
     * menú quedaba abierto. La `window` captura ANTES que el `document`: aquí
     * se cierra el menú y la ficha, al ver el menú todavía montado, no se
     * cierra.
     */
    useEffect(() => {
        if (!slash.open) return;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') setSlash(CLOSED);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [slash.open]);

    /**
     * Detecta el patrón `/consulta` inmediatamente antes del cursor y ubica el
     * menú. Sólo dispara si el `/` arranca palabra — así una fecha `12/8` o
     * una URL no abren el menú.
     */
    const syncSlash = useCallback((ed: Editor) => {
        const { state } = ed;
        const { from, empty } = state.selection;
        // Sólo con el editor ENFOCADO: si no, un documento que ya terminaba en
        // "/" abría el menú con sólo abrir la ficha (y su capa de "click
        // afuera" bloqueaba media pantalla).
        if (!empty || !ed.isEditable || !ed.isFocused) {
            setSlash(CLOSED);
            setUserQuery(null);
            return;
        }
        const $from = state.selection.$from;
        const textBefore = $from.parent.textBetween(
            Math.max(0, $from.parentOffset - 60),
            $from.parentOffset,
            undefined,
            '￼',
        );
        // `@` → buscador de personas (v0.1.134). Se maneja aparte del menú de
        // bloques porque sus opciones vienen del servidor.
        const atMatch = /(?:^|\s)@([^\s@]{0,40})$/.exec(textBefore);
        if (atMatch !== null) {
            const q = atMatch[1] ?? '';
            const atPos = from - q.length - 1;
            const c = ed.view.coordsAtPos(atPos);
            const bb = wrapperRef.current?.getBoundingClientRect();
            setUserQuery(q);
            setSlash({
                open: false,
                query: q,
                from: atPos,
                index: 0,
                rect: { top: c.bottom - (bb?.top ?? 0) + 6, left: c.left - (bb?.left ?? 0) },
            });
            return;
        }
        setUserQuery(null);

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

    /**
     * El documento se SIEMBRA una sola vez por registro.
     *
     * Antes se re-sincronizaba con cada respuesta del servidor, y eso pisaba
     * ediciones locales: al insertar un bloque desde un diálogo (subtarea,
     * archivo), la respuesta del autosave anterior volvía a montar el
     * documento viejo y se perdía lo insertado. Mientras el editor está
     * montado, la fuente de verdad es lo que hay en pantalla; lo que llega del
     * servidor sólo importa al cambiar de registro (y ahí el componente se
     * remonta con `key`).
     */
    const seeded = useRef(false);
    useEffect(() => {
        if (!editor || seeded.current) return;
        seeded.current = true;
        if (value === null) return;
        if (JSON.stringify(editor.getJSON()) === JSON.stringify(value)) return;
        editor.commands.setContent(value, { emitUpdate: false });
    }, [editor, value]);

    useEffect(() => {
        editor?.setEditable(editable);
    }, [editor, editable]);

    if (!editor) return <div className="imcrm-h-20" />;

    return (
        <div ref={wrapperRef} className="imcrm-relative">
            <EditorContent editor={editor} className="imcrm-imcrm-editor" />

            {/* Zona clicable al final: con un bloque atómico grande abajo (un
                embed, el índice) el click "en el editor" cae sobre ese bloque
                —el iframe hasta se come el evento— y el cursor no entra al
                documento. Este espacio lo pone al final, como en cualquier
                editor serio. */}
            {editable && (
                <div
                    aria-hidden
                    onMouseDown={(e) => {
                        e.preventDefault();
                        editor.chain().focus('end').run();
                    }}
                    className="imcrm-h-6 imcrm-cursor-text"
                    data-imcrm-editor-tail
                />
            )}

            {/* ——— Barra flotante de formato (al seleccionar texto) ——— */}
            {editable && (
                <BubbleMenu
                    editor={editor}
                    options={{ placement: 'top' }}
                    // Siempre montada (se oculta sola): NO cuenta como menú
                    // abierto para Esc, pero un click en ella no es "afuera".
                    data-imcrm-popup=""
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
                            setUrlPrompt({ kind: 'link', ...promptPosition(editor) });
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
                    {...FLOATING}
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
            {/* ——— Buscador de personas («@») ——— */}
            {editable && userQuery !== null && slash.rect !== null && (
                <UserMentionMenu
                    query={userQuery}
                    top={slash.rect.top}
                    left={slash.rect.left}
                    onPick={(user) => {
                        applyUiEdit(() => editor
                            .chain()
                            .focus()
                            .deleteRange({ from: slash.from, to: slash.from + userQuery.length + 1 })
                            .insertContent([
                                user.kind === 'team'
                                    ? { type: 'mentionTeam', attrs: { id: user.id, label: user.display_name } }
                                    : { type: 'mentionUser', attrs: { id: user.id, label: user.display_name } },
                                { type: 'text', text: ' ' },
                            ])
                            .run());
                        setUserQuery(null);
                    }}
                    onClose={() => setUserQuery(null)}
                />
            )}

            {/* Subida de imagen / adjunto (el input vive oculto). */}
            <input
                ref={fileInput}
                type="file"
                hidden
                accept={uploadKind === 'image' ? 'image/*' : undefined}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file === undefined) return;
                    setUploadError(null);
                    setUploading(true);
                    void api
                        .uploadFile(file)
                        .then(({ id }) => {
                            applyUiEdit(() => editor
                                .chain()
                                .focus()
                                .insertContent(
                                    uploadKind === 'image'
                                        ? { type: 'imageBlock', attrs: { fileId: id, alt: file.name } }
                                        : {
                                              type: 'fileBlock',
                                              attrs: { fileId: id, name: file.name, size: file.size },
                                          },
                                )
                                .run());
                        })
                        .catch((err: unknown) => {
                            setUploadError(err instanceof Error && err.message !== '' ? err.message : __('No se pudo subir el archivo.'));
                        })
                        .finally(() => setUploading(false));
                }}
            />
            {uploading && (
                <span className="imcrm-mt-1 imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Subiendo…')}
                </span>
            )}
            {uploadError !== null && (
                <span className="imcrm-mt-1 imcrm-block imcrm-text-[11px] imcrm-text-destructive" role="alert">
                    {uploadError}
                </span>
            )}

            {/* Dirección de un enlace o de un contenido a insertar. */}
            {urlPrompt !== null && (
                <UrlPrompt
                    kind={urlPrompt.kind}
                    top={urlPrompt.top}
                    left={urlPrompt.left}
                    onCancel={() => {
                        setUrlPrompt(null);
                        editor.chain().focus().run();
                    }}
                    onSubmit={(url, asPlainLink) => {
                        setUrlPrompt(null);
                        if (urlPrompt.kind === 'link') {
                            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
                            return;
                        }
                        const resolved = asPlainLink ? null : resolveEmbed(url);
                        if (resolved === null) {
                            // Honestidad: si no se sabe insertar, queda como enlace
                            // en vez de dibujar un marco vacío.
                            applyUiEdit(() => editor
                                .chain()
                                .focus()
                                .insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] })
                                .run());
                            return;
                        }
                        applyUiEdit(() => editor
                            .chain()
                            .focus()
                            .insertContent({ type: 'embedBlock', attrs: { url, provider: resolved.provider } })
                            .run());
                    }}
                />
            )}

            {/* Selector de registro a mencionar. */}
            {pickRecord && (
                <RecordPickerDialog
                    open={pickRecord}
                    onOpenChange={setPickRecord}
                    defaultListSlug={listSlug}
                    onPick={(pick) => {
                        applyUiEdit(() => editor
                            .chain()
                            .focus()
                            .insertContent([
                                {
                                    type: 'mentionRecord',
                                    attrs: { id: pick.id, listSlug: pick.listSlug, label: pick.label },
                                },
                                { type: 'text', text: ' ' },
                            ])
                            .run());
                    }}
                />
            )}

            {/* Crear una subtarea REAL y enlazarla (v0.1.135). */}
            {newSubtask !== null && listSlug !== undefined && recordId !== undefined && (
                <SubtaskPrompt
                    listSlug={listSlug}
                    parentId={recordId}
                    onClose={() => setNewSubtask(null)}
                    onCreated={(created) => {
                        setNewSubtask(null);
                        applyUiEdit(() => editor
                            .chain()
                            .focus()
                            .insertContent([
                                {
                                    type: 'mentionRecord',
                                    attrs: {
                                        id: created.id,
                                        listSlug,
                                        label: created.label,
                                    },
                                },
                                { type: 'text', text: ' ' },
                            ])
                            .run());
                    }}
                />
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
                <div {...FLOATING} className="imcrm-absolute imcrm-left-0 imcrm-top-8 imcrm-z-50 imcrm-grid imcrm-w-40 imcrm-grid-cols-1 imcrm-gap-0.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-1 imcrm-shadow-imcrm-lg">
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

/** Dónde abrir el cuadrito de la dirección: debajo de la selección. */
function promptPosition(editor: Editor): { top: number; left: number } {
    const dom = editor.view.dom as HTMLElement;
    const box = (dom.closest('.imcrm-relative') as HTMLElement | null)?.getBoundingClientRect() ?? dom.getBoundingClientRect();
    try {
        const c = editor.view.coordsAtPos(editor.state.selection.from);
        return { top: c.bottom - box.top + 6, left: Math.max(0, Math.min(c.left - box.left, box.width - 300)) };
    } catch {
        return { top: 0, left: 0 };
    }
}

/**
 * Cuadrito para escribir una dirección (enlace o contenido de YouTube, Loom,
 * Figma, Drive o Vimeo). Reemplaza al `window.prompt` nativo, que bloquea la
 * página, no respeta el tema y en el teléfono sale fuera de contexto.
 */
function UrlPrompt({
    kind,
    top,
    left,
    onSubmit,
    onCancel,
}: {
    kind: 'link' | 'embed';
    top: number;
    left: number;
    onSubmit: (url: string, asPlainLink: boolean) => void;
    onCancel: () => void;
}): JSX.Element {
    const [value, setValue] = useState('https://');
    const [unsupported, setUnsupported] = useState(false);
    const clean = value.trim();
    const valid = /^(https?:\/\/|mailto:)\S+$/i.test(clean) && clean !== 'https://';

    const submit = (): void => {
        if (!valid) return;
        if (kind === 'embed' && !unsupported && resolveEmbed(clean) === null) {
            setUnsupported(true);
            return;
        }
        onSubmit(clean, unsupported);
    };

    return (
        <div
            {...FLOATING}
            role="dialog"
            aria-label={kind === 'link' ? __('Agregar enlace') : __('Insertar contenido')}
            className="imcrm-absolute imcrm-z-50 imcrm-flex imcrm-w-[300px] imcrm-max-w-[calc(100vw-2rem)] imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-2.5 imcrm-shadow-imcrm-lg"
            style={{ top, left }}
            data-testid="imcrm-url-prompt"
        >
            <label className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                {kind === 'link' ? __('Dirección del enlace') : __('Pega el enlace de YouTube, Loom, Figma, Drive o Vimeo')}
            </label>
            <input
                autoFocus
                value={value}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                    setValue(e.target.value);
                    setUnsupported(false);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        submit();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        onCancel();
                    }
                }}
                className="imcrm-h-8 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm imcrm-outline-none focus:imcrm-border-primary"
                inputMode="url"
            />
            {unsupported && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Ese enlace no se puede mostrar como contenido. ¿Lo insertamos como enlace normal?')}
                </p>
            )}
            <div className="imcrm-flex imcrm-justify-end imcrm-gap-1.5">
                <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={onCancel}
                    className="imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-accent"
                >
                    {__('Cancelar')}
                </button>
                <button
                    type="button"
                    disabled={!valid}
                    onClick={submit}
                    className="imcrm-rounded-md imcrm-bg-primary imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary-foreground disabled:imcrm-opacity-50"
                >
                    {unsupported ? __('Insertar como enlace') : kind === 'link' ? __('Agregar') : __('Insertar')}
                </button>
            </div>
        </div>
    );
}
