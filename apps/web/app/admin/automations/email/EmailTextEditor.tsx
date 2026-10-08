import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import { StarterKit } from '@tiptap/starter-kit';
import {
    Bold,
    Braces,
    Heading2,
    Italic,
    Link2,
    List,
    ListOrdered,
    Quote,
    Strikethrough,
    Underline as UnderlineIcon,
} from 'lucide-react';
import type { EmailRichDoc } from '@imagina-base/shared';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { MergeTagPicker } from '../MergeTagInput';

/**
 * v0.1.265 — Editor de texto de un bloque del correo (ADR-S34). TipTap con
 * SÓLO lo que el renderizador de correos sabe traducir a HTML compatible:
 * párrafos, títulos, listas, cita, negrita/cursiva/subrayado/tachado, enlaces
 * y color. Las variables se insertan como texto `{{slug}}` (el motor las
 * resuelve al enviar). Guarda el ÁRBOL del documento, nunca HTML.
 */
const TEXT_COLORS: Array<{ label: string; value: string | null }> = [
    { label: 'Normal', value: null },
    { label: 'Gris', value: '#6b7280' },
    { label: 'Rojo', value: '#dc2626' },
    { label: 'Naranja', value: '#ea580c' },
    { label: 'Verde', value: '#16a34a' },
    { label: 'Azul', value: '#2563eb' },
    { label: 'Violeta', value: '#7c3aed' },
];

export function EmailTextEditor({
    value,
    onChange,
    fields,
}: {
    value: EmailRichDoc | null;
    onChange: (doc: EmailRichDoc) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [2, 3] },
                codeBlock: false,
                code: false,
                horizontalRule: false,
                link: {
                    openOnClick: false,
                    autolink: true,
                    protocols: ['http', 'https', 'mailto', 'tel'],
                },
            }),
            TextStyle,
            Color,
            Highlight.configure({ multicolor: true }),
        ],
        content: value ?? { type: 'doc', content: [{ type: 'paragraph' }] },
        editorProps: {
            attributes: {
                class: 'imcrm-prose imcrm-min-h-[110px] imcrm-px-3 imcrm-py-2 imcrm-text-sm focus:imcrm-outline-none',
                'data-testid': 'email-text-editor',
            },
        },
        onUpdate: ({ editor: ed }) => onChangeRef.current(ed.getJSON() as EmailRichDoc),
    });

    // Un bloque distinto con el editor ya montado (el padre usa `key` por id,
    // pero un deshacer puede cambiar el contenido del MISMO bloque).
    const lastExternal = useRef(value);
    useEffect(() => {
        if (!editor || value === lastExternal.current) return;
        lastExternal.current = value;
        const current = JSON.stringify(editor.getJSON());
        if (value && JSON.stringify(value) !== current) editor.commands.setContent(value, { emitUpdate: false });
    }, [editor, value]);

    return (
        <div className="imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background focus-within:imcrm-ring-2 focus-within:imcrm-ring-ring">
            {editor && <Toolbar editor={editor} fields={fields} />}
            <EditorContent editor={editor} />
        </div>
    );
}

function Toolbar({ editor, fields }: { editor: Editor; fields: FieldEntity[] }): JSX.Element {
    const [, force] = useState(0);
    useEffect(() => {
        const rerender = (): void => force((n) => n + 1);
        editor.on('selectionUpdate', rerender);
        editor.on('transaction', rerender);
        return () => {
            editor.off('selectionUpdate', rerender);
            editor.off('transaction', rerender);
        };
    }, [editor]);
    const [tagsOpen, setTagsOpen] = useState(false);
    const [colorOpen, setColorOpen] = useState(false);

    const setLink = (): void => {
        const prev = (editor.getAttributes('link').href as string | undefined) ?? 'https://';
        const url = window.prompt(__('Dirección del enlace (https://…, mailto:… o una variable {{campo}})'), prev);
        if (url === null) return;
        if (url.trim() === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
    };

    return (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-0.5 imcrm-border-b imcrm-border-border imcrm-bg-muted/40 imcrm-px-1 imcrm-py-1">
            <Tool label={__('Negrita')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} icon={Bold} />
            <Tool label={__('Cursiva')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} icon={Italic} />
            <Tool label={__('Subrayado')} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} icon={UnderlineIcon} />
            <Tool label={__('Tachado')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} icon={Strikethrough} />
            <Sep />
            <Tool label={__('Subtítulo')} active={editor.isActive('heading')} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} icon={Heading2} />
            <Tool label={__('Lista')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} icon={List} />
            <Tool label={__('Lista numerada')} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} icon={ListOrdered} />
            <Tool label={__('Cita')} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} icon={Quote} />
            <Sep />
            <Tool label={__('Enlace')} active={editor.isActive('link')} onClick={setLink} icon={Link2} />
            <Popover open={colorOpen} onOpenChange={setColorOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        title={__('Color del texto')}
                        aria-label={__('Color del texto')}
                        className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded hover:imcrm-bg-accent"
                    >
                        <span
                            className="imcrm-h-3.5 imcrm-w-3.5 imcrm-rounded-full imcrm-border imcrm-border-border"
                            style={{ background: (editor.getAttributes('textStyle').color as string | undefined) ?? 'currentColor' }}
                        />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="imcrm-w-40 imcrm-p-1" align="start">
                    {TEXT_COLORS.map((c) => (
                        <button
                            key={c.label}
                            type="button"
                            onClick={() => {
                                if (c.value === null) editor.chain().focus().unsetColor().run();
                                else editor.chain().focus().setColor(c.value).run();
                                setColorOpen(false);
                            }}
                            className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-left imcrm-text-xs hover:imcrm-bg-accent"
                        >
                            <span
                                className="imcrm-h-3.5 imcrm-w-3.5 imcrm-rounded imcrm-border imcrm-border-border"
                                style={c.value ? { background: c.value } : undefined}
                            />
                            {__(c.label)}
                        </button>
                    ))}
                </PopoverContent>
            </Popover>
            <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className="imcrm-ml-auto imcrm-flex imcrm-h-7 imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-2 imcrm-text-[11px] imcrm-font-medium imcrm-text-primary hover:imcrm-bg-primary/10"
                    >
                        <Braces className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Variable')}
                    </button>
                </PopoverTrigger>
                <PopoverContent className="imcrm-w-[340px] imcrm-p-0" align="end">
                    <MergeTagPicker
                        fields={fields.filter((f) => f.type !== 'relation')}
                        onPick={(tag) => {
                            editor.chain().focus().insertContent(`{{${tag}}}`).run();
                            setTagsOpen(false);
                        }}
                    />
                </PopoverContent>
            </Popover>
        </div>
    );
}

function Tool({
    label,
    active,
    onClick,
    icon: Icon,
}: {
    label: string;
    active: boolean;
    onClick: () => void;
    icon: typeof Bold;
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
                'imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-foreground/80 hover:imcrm-bg-accent',
                active && 'imcrm-bg-primary/15 imcrm-text-primary',
            )}
        >
            <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
        </button>
    );
}

function Sep(): JSX.Element {
    return <span className="imcrm-mx-0.5 imcrm-h-4 imcrm-w-px imcrm-bg-border" />;
}
