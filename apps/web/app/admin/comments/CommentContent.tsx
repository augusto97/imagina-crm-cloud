/**
 * Renderer del contenido de un comentario con menciones `@usuario`
 * resaltadas como chips. La regex coincide con la del backend
 * (MentionParser.php) — un cambio en una requiere el cambio en la otra.
 *
 * No resolvemos el login a un display_name aquí; el chip muestra
 * `@login` literal. La resolución requeriría un endpoint extra y la
 * UX gana muy poco con eso a este nivel.
 */
const MENTION_RE = /(^|\s)@([A-Za-z0-9._-]{1,60})/g;

export function CommentContent({ content }: { content: string }): JSX.Element {
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
