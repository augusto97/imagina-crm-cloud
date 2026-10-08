import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { Image } from '@tiptap/extension-image';
import { StarterKit } from '@tiptap/starter-kit';
import { Bold, ImagePlus, Italic, Link2, Loader2, Underline as UnderlineIcon } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/components/ui/toast';
import { api } from '@/cloud/session';
import { api as restApi } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * v0.1.265 — Editor VISUAL de la firma de email (ADR-S34). Antes la firma se
 * escribía en HTML crudo; ahora se escribe como en Gmail: negrita, colores,
 * enlaces y una imagen (el logo). Sigue guardándose como HTML (compatible
 * con las firmas ya cargadas); las imágenes subidas llevan una URL pública
 * de larga vida para que no se rompan en los correos viejos.
 */
const COLORS = ['#111827', '#6b7280', '#0e7490', '#2563eb', '#16a34a', '#dc2626', '#7c3aed'];

export function SignatureEditor({ value, onChange }: { value: string; onChange: (html: string) => void }): JSX.Element {
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: false,
                codeBlock: false,
                code: false,
                blockquote: false,
                horizontalRule: false,
                link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto', 'tel'] },
            }),
            TextStyle,
            Color,
            Image.configure({
                inline: false,
                HTMLAttributes: { style: 'max-width:220px;height:auto;border:0;' },
            }),
        ],
        content: value || '<p></p>',
        editorProps: {
            attributes: {
                class: 'imcrm-prose imcrm-min-h-[120px] imcrm-px-3 imcrm-py-2 imcrm-text-sm focus:imcrm-outline-none',
                'data-testid': 'signature-editor',
            },
        },
        onUpdate: ({ editor: ed }) => onChangeRef.current(ed.isEmpty ? '' : ed.getHTML()),
    });

    // Descartar / cargar desde el servidor: el valor externo cambia.
    useEffect(() => {
        if (!editor) return;
        const current = editor.isEmpty ? '' : editor.getHTML();
        if (value !== current) editor.commands.setContent(value || '<p></p>', { emitUpdate: false });
    }, [editor, value]);

    return (
        <div className="imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background focus-within:imcrm-ring-2 focus-within:imcrm-ring-ring">
            {editor && <SignatureToolbar editor={editor} />}
            <EditorContent editor={editor} />
        </div>
    );
}

function SignatureToolbar({ editor }: { editor: Editor }): JSX.Element {
    const toast = useToast();
    const [, force] = useState(0);
    const [colorOpen, setColorOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
        const rerender = (): void => force((n) => n + 1);
        editor.on('transaction', rerender);
        return () => {
            editor.off('transaction', rerender);
        };
    }, [editor]);

    const setLink = (): void => {
        const prev = (editor.getAttributes('link').href as string | undefined) ?? 'https://';
        const url = window.prompt(__('Dirección del enlace (https://… o mailto:…)'), prev);
        if (url === null) return;
        if (url.trim() === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
        else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
    };

    const upload = async (file: File): Promise<void> => {
        setUploading(true);
        try {
            const { id } = await api.uploadFile(file);
            const res = await restApi.post<{ url: string }>(`/files/${id}/public-url`, {});
            editor.chain().focus().setImage({ src: res.data.url, alt: file.name.replace(/\.[^.]+$/, '') }).run();
        } catch (err) {
            toast.error(__('No se pudo subir la imagen'), err instanceof Error ? err.message : String(err));
        } finally {
            setUploading(false);
        }
    };

    const btn = (active: boolean): string =>
        cn(
            'imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-foreground/80 hover:imcrm-bg-accent',
            active && 'imcrm-bg-primary/15 imcrm-text-primary',
        );

    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-0.5 imcrm-border-b imcrm-border-border imcrm-bg-muted/40 imcrm-px-1 imcrm-py-1">
            <button type="button" title={__('Negrita')} aria-label={__('Negrita')} className={btn(editor.isActive('bold'))} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()}>
                <Bold className="imcrm-h-3.5 imcrm-w-3.5" />
            </button>
            <button type="button" title={__('Cursiva')} aria-label={__('Cursiva')} className={btn(editor.isActive('italic'))} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()}>
                <Italic className="imcrm-h-3.5 imcrm-w-3.5" />
            </button>
            <button type="button" title={__('Subrayado')} aria-label={__('Subrayado')} className={btn(editor.isActive('underline'))} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleUnderline().run()}>
                <UnderlineIcon className="imcrm-h-3.5 imcrm-w-3.5" />
            </button>
            <button type="button" title={__('Enlace')} aria-label={__('Enlace')} className={btn(editor.isActive('link'))} onClick={setLink}>
                <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
            </button>
            <Popover open={colorOpen} onOpenChange={setColorOpen}>
                <PopoverTrigger asChild>
                    <button type="button" title={__('Color del texto')} aria-label={__('Color del texto')} className={btn(false)}>
                        <span className="imcrm-h-3.5 imcrm-w-3.5 imcrm-rounded-full imcrm-border imcrm-border-border" style={{ background: (editor.getAttributes('textStyle').color as string | undefined) ?? 'currentColor' }} />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="imcrm-flex imcrm-w-auto imcrm-gap-1 imcrm-p-1.5" align="start">
                    {COLORS.map((c) => (
                        <button
                            key={c}
                            type="button"
                            aria-label={c}
                            className="imcrm-h-6 imcrm-w-6 imcrm-rounded imcrm-border imcrm-border-border"
                            style={{ background: c }}
                            onClick={() => {
                                editor.chain().focus().setColor(c).run();
                                setColorOpen(false);
                            }}
                        />
                    ))}
                </PopoverContent>
            </Popover>
            <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="imcrm-hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = '';
                }}
            />
            <button type="button" title={__('Agregar una imagen (logo)')} aria-label={__('Agregar una imagen')} className={cn(btn(false), 'imcrm-w-auto imcrm-gap-1 imcrm-px-2 imcrm-text-[11px]')} disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <ImagePlus className="imcrm-h-3.5 imcrm-w-3.5" />}
                {__('Imagen')}
            </button>
        </div>
    );
}
