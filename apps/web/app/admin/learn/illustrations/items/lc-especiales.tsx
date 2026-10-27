import { Hash, MessageCircle, Sparkles } from 'lucide-react';

import { At, C, Chip, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Campos especiales: el «ID automático» numera solo cada ticket nuevo
 * (TCK-0044), el «Campo con IA» clasifica el asunto y un campo «Botón»
 * abre WhatsApp con el mensaje armado.
 */

const CSS = `
@keyframes es-row{0%,8%{opacity:0;transform:translateY(-8px)}14%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes es-id{0%,14%{opacity:0;transform:scale(.5)}20%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes es-idglow{0%,16%{box-shadow:0 0 0 0 ${primary(0)}}22%{box-shadow:0 0 0 4px ${primary(0.25)}}34%,100%{box-shadow:0 0 0 0 ${primary(0)}}}
@keyframes es-think{0%,22%{opacity:0}26%,40%{opacity:1}43%,100%{opacity:0}}
@keyframes es-ai{0%,41%{opacity:0;transform:scale(.6)}46%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes es-press{0%,61%{transform:scale(1)}63%{transform:scale(.92)}66%,100%{transform:scale(1)}}
@keyframes es-wa{0%,64%{opacity:0;transform:translateY(8px)}70%,90%{opacity:1;transform:translateY(0)}95%,100%{opacity:0}}
@keyframes es-cur{0%{transform:translate(300px,290px);opacity:0}46%{opacity:0;transform:translate(300px,290px)}50%{opacity:1}58%,64%{transform:translate(362px,66px)}86%,90%{transform:translate(362px,66px);opacity:1}95%,100%{opacity:0}}
@keyframes es-ring{0%,60%{opacity:0;transform:scale(.4)}62%{opacity:1;transform:scale(1)}66%,100%{opacity:0;transform:scale(1.6)}}
`;

const COLS = [
    { l: 'ID', w: 62, icon: <Hash key="h" size={8} /> },
    { l: 'Asunto', w: 150 },
    { l: 'Categoría', w: 96, icon: <Sparkles key="s" size={8} /> },
    { l: 'Avisar', w: 70 },
];

function Cell({ w, children }: { w: number; children: JSX.Element }): JSX.Element {
    return <span style={{ width: w, display: 'flex', alignItems: 'center', position: 'relative', height: '100%' }}>{children}</span>;
}

function WaBtn({ a }: { a?: string }): JSX.Element {
    return (
        <span data-a={a ? '' : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 17, padding: '0 7px', borderRadius: 6, background: tone('mint'), color: '#fff', fontSize: 7.5, fontWeight: 700, animationName: a }}>
            <MessageCircle size={8} />
            WhatsApp
        </span>
    );
}

function AiChip({ label, t }: { label: string; t: 'violet' | 'amber' | 'blue' }): JSX.Element {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <Sparkles size={8} color={tone('violet')} />
            <Chip label={label} t={t} style={{ height: 15, fontSize: 7.5 }} />
        </span>
    );
}

const ROW = { display: 'flex', alignItems: 'center', height: 36, padding: '0 12px', borderBottom: `1px solid ${C.border}` } as const;

export default function LcEspeciales(): JSX.Element {
    return (
        <Stage label="Llega un ticket nuevo: el ID automático le pone TCK-0044 solo, el campo con IA lee el asunto y lo clasifica como Facturación, y el botón WhatsApp abre la conversación con el mensaje ya escrito." tint="violet">
            <Keyframes css={CSS} />
            <At x={12} y={22} w={456} h={206} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 14px 34px -22px rgba(15,23,42,.5)', overflow: 'hidden' }}>
                <div style={{ ...ROW, height: 28 }}>
                    {COLS.map((c) => (
                        <span key={c.l} style={{ width: c.w, display: 'flex', alignItems: 'center', gap: 3, color: c.l === 'Categoría' ? tone('violet') : C.mutedFg }}>
                            {c.icon}
                            <T size={8} weight={600} color={c.l === 'Categoría' ? tone('violet') : C.mutedFg}>
                                {c.l}
                            </T>
                        </span>
                    ))}
                </div>
                {/* Fila nueva */}
                <div data-a="" style={{ ...ROW, background: primary(0.05), animationName: 'es-row' }}>
                    <Cell w={62}>
                        <span data-a="" style={{ display: 'flex', borderRadius: 5, padding: '1px 4px', marginLeft: -4, animationName: 'es-id' }}>
                            <span data-a="" style={{ display: 'flex', borderRadius: 5, animationName: 'es-idglow' }}>
                                <T size={8.5} weight={700} color={primary()}>
                                    TCK-0044
                                </T>
                            </span>
                        </span>
                    </Cell>
                    <Cell w={150}>
                        <T size={8.5} weight={600}>
                            No me llegó la factura de octubre
                        </T>
                    </Cell>
                    <Cell w={96}>
                        <>
                            <span data-a="" style={{ position: 'absolute', left: 0, display: 'flex', alignItems: 'center', gap: 3, animationName: 'es-think', opacity: 0 }}>
                                <Sparkles size={8} color={tone('violet')} />
                                <T size={7.5} color={C.mutedFg}>
                                    Calculando…
                                </T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', left: 0, display: 'flex', animationName: 'es-ai' }}>
                                <AiChip label="Facturación" t="amber" />
                            </span>
                        </>
                    </Cell>
                    <Cell w={70}>
                        <WaBtn a="es-press" />
                    </Cell>
                </div>
                {[
                    ['TCK-0043', 'Cambiar la dirección de entrega', 'Envíos', 'blue'],
                    ['TCK-0042', 'La app no me deja entrar', 'Acceso', 'violet'],
                    ['TCK-0041', 'Quiero el plan anual', 'Ventas', 'amber'],
                ].map(([id, as, cat, t]) => (
                    <div key={id} style={ROW}>
                        <Cell w={62}>
                            <T size={8.5} weight={600} color={C.mutedFg}>
                                {id!}
                            </T>
                        </Cell>
                        <Cell w={150}>
                            <T size={8.5}>{as!}</T>
                        </Cell>
                        <Cell w={96}>
                            <AiChip label={cat!} t={t as 'blue'} />
                        </Cell>
                        <Cell w={70}>
                            <WaBtn />
                        </Cell>
                    </div>
                ))}
            </At>
            {/* Leyenda */}
            <At x={12} y={238} w={300} style={{ display: 'flex', gap: 6 }}>
                {[
                    ['ID automático', 'numera solo', 'blue'],
                    ['Campo con IA', 'clasifica', 'violet'],
                    ['Botón', 'hace algo', 'mint'],
                ].map(([n, d, t]) => (
                    <span key={n} style={{ display: 'flex', flexDirection: 'column', padding: '5px 8px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${tone(t as 'blue')}` }}>
                        <T size={8} weight={700}>
                            {n}
                        </T>
                        <T size={7} color={C.mutedFg}>
                            {d}
                        </T>
                    </span>
                ))}
            </At>
            {/* WhatsApp abierto */}
            <At x={318} y={150} w={150} a="es-wa" style={{ opacity: 0, zIndex: 6, background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 18px 40px -14px rgba(15,23,42,.6)', overflow: 'hidden' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, height: 24, padding: '0 8px', background: tone('mint'), color: '#fff' }}>
                    <MessageCircle size={10} />
                    <T size={8} weight={700} color="#fff">
                        WhatsApp
                    </T>
                </span>
                <span style={{ display: 'flex', padding: 8 }}>
                    <span style={{ padding: '6px 8px', borderRadius: 8, background: tone('mint', 0.16), fontSize: 7.5, lineHeight: 1.35, color: C.fg }}>Hola, recibimos tu caso TCK&#8209;0044. Ya lo estamos revisando.</span>
                </span>
            </At>
            <Cursor a="es-cur" click="es-ring" rest={[362, 66]} />
        </Stage>
    );
}
