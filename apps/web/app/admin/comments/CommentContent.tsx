/**
 * Renderer del contenido de un comentario con menciones `@usuario`
 * resaltadas como chips. El backend extrae las menciones como `@email`
 * (`comments.service.ts → storeMentions`), así que el chip acepta el email
 * COMPLETO (`@beto@test.local`); antes cortaba en `@beto` y dejaba
 * `@test.local` suelto. Se conserva el `@login` corto para los viejos.
 */
export const MENTION_RE = /(^|\s)@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Za-z0-9._-]{1,60})/g;

export function CommentContent({ content: rawContent }: { content: string }): JSX.Element {
    // Blindaje: comentarios legados/sistémicos pueden venir sin body —
    // sin esto, `.length` sobre undefined tiraba TODA la página del
    // registro (error boundary en cascada, 5+ crashes por render).
    const content = typeof rawContent === 'string' ? rawContent : '';
    const parts: Array<JSX.Element | string> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;

    // Reset stateful regex.
    MENTION_RE.lastIndex = 0;
    while ((match = MENTION_RE.exec(content)) !== null) {
        const fullMatch = match[0];
        const leading = match[1] ?? '';
        const login = match[2];
        const start = match.index + leading.length;

        if (start > lastIndex) {
            parts.push(content.slice(lastIndex, start));
        }
        parts.push(
            <span
                key={`m-${key++}`}
                className="imcrm-rounded imcrm-bg-primary/10 imcrm-px-1 imcrm-py-px imcrm-text-primary imcrm-font-medium"
            >
                @{login}
            </span>,
        );
        lastIndex = match.index + fullMatch.length;
    }
    if (lastIndex < content.length) {
        parts.push(content.slice(lastIndex));
    }

    return (
        <p className="imcrm-mt-2 imcrm-whitespace-pre-wrap imcrm-text-sm imcrm-text-foreground">
            {parts}
        </p>
    );
}
