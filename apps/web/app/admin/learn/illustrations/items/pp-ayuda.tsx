import { Bell, BookOpen, CircleHelp, GraduationCap, Keyboard, ListChecks, Megaphone, Moon, PlayCircle, Plus, Search, Sparkles } from 'lucide-react';

import { At, Avatar, Bar, Btn, C, Chip, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * La ayuda dentro de la app: el botón «?» abre el panel de Ayuda; desde
 * «Empieza aquí» arranca el recorrido, que ilumina cada parte de la pantalla
 * y la explica en un globo.
 */

const CSS = `
@keyframes ay-panel{0%,8%{transform:translateX(200px)}14%,38%{transform:translateX(0)}44%,100%{transform:translateX(200px)}}
@keyframes ay-help{0%,6%{background:transparent}8%,40%{background:${primary(0.16)}}44%,100%{background:transparent}}
@keyframes ay-row{0%,30%{background:transparent}33%,40%{background:${primary(0.12)}}44%,100%{background:transparent}}
@keyframes ay-s1{0%,44%{opacity:0}48%,66%{opacity:1}69%,100%{opacity:0}}
@keyframes ay-s2{0%,67%{opacity:0}71%,92%{opacity:1}96%,100%{opacity:0}}
@keyframes ay-cur{0%{transform:translate(300px,250px);opacity:0}4%{opacity:1}6%,9%{transform:translate(410px,30px)}24%{transform:translate(392px,160px)}32%,36%{transform:translate(372px,172px)}46%{transform:translate(330px,250px);opacity:1}52%,100%{transform:translate(330px,250px);opacity:0}}
@keyframes ay-ring{0%,6%{opacity:0;transform:scale(.4)}8%{opacity:1;transform:scale(1)}12%{opacity:0;transform:scale(1.6)}33%{opacity:0;transform:scale(.4)}35%{opacity:1;transform:scale(1)}39%,100%{opacity:0;transform:scale(1.6)}}
`;

const TOP_Y = 16;

function TopIcon({ x, children, a }: { x: number; children: JSX.Element; a?: string }): JSX.Element {
    return (
        <At x={x} y={TOP_Y + 6} w={22} h={22} a={a} style={{ borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.mutedFg }}>
            {children}
        </At>
    );
}

function Spot({ x, y, w, h, a, step, title, text, bx, by }: { x: number; y: number; w: number; h: number; a: string; step: string; title: string; text: string; bx: number; by: number }): JSX.Element {
    return (
        <At x={0} y={0} w={480} h={300} a={a} style={{ opacity: 0, zIndex: 20 }}>
            <At x={x} y={y} w={w} h={h} style={{ borderRadius: 8, boxShadow: `0 0 0 3px ${primary()}, 0 0 0 1000px rgba(15,23,42,.55)` }} />
            <At x={bx} y={by} w={196} style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 16px 36px -14px rgba(15,23,42,.7)', padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <T size={7.5} weight={700} color={primary()}>
                    {step}
                </T>
                <T size={10} weight={700}>
                    {title}
                </T>
                <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                    {text}
                </T>
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
                    <T size={8} color={C.mutedFg}>
                        Saltar recorrido
                    </T>
                    <span style={{ display: 'flex', gap: 4 }}>
                        <Btn kind="outline" label="Anterior" style={{ height: 18, fontSize: 8 }} />
                        <Btn label="Siguiente" style={{ height: 18, fontSize: 8 }} />
                    </span>
                </span>
            </At>
        </At>
    );
}

export default function PpAyuda(): JSX.Element {
    return (
        <Stage label="Se toca el botón de Ayuda en la barra superior, se abre el panel con «Empieza aquí» y al elegir «Recorrido por la app» la pantalla se oscurece e ilumina cada parte con un globo que la explica." tint="violet">
            <Keyframes css={CSS} />
            <At x={12} y={TOP_Y - 4} w={456} h={276} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                {/* riel */}
                <div style={{ position: 'absolute', left: 6, top: 6, bottom: 6, width: 36, borderRadius: 9, background: primary(), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 10, color: 'rgba(255,255,255,.9)' }}>
                    <Sparkles size={12} />
                    <ListChecks size={11} />
                    <GraduationCap size={11} />
                </div>
                {/* barra superior */}
                <div style={{ position: 'absolute', left: 48, right: 0, top: 0, height: 34, borderBottom: `1px solid ${C.border}` }} />
                <At x={52} y={9} w={150} h={18} style={{ borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 5, padding: '0 6px', background: C.muted }}>
                    <Search size={9} color={C.mutedFg} />
                    <T size={8} color={C.mutedFg}>
                        Buscar listas, registros…
                    </T>
                </At>
                {/* contenido */}
                <At x={56} y={46} style={{ display: 'flex' }}>
                    <T size={12} weight={700}>
                        Clientes
                    </T>
                </At>
                <At x={334} y={44} style={{ display: "flex" }}>
                    <Btn label={<><Plus size={10} /> Nuevo registro</>} />
                </At>
                <div style={{ position: 'absolute', left: 56, right: 14, top: 74 }}>
                    {[
                        ['Café Bahía', 'Activo', 'mint'],
                        ['Clínica Norte', 'Nuevo', 'blue'],
                        ['Hotel Brisas', 'VIP', 'violet'],
                        ['Óptica Visión', 'Activo', 'mint'],
                        ['Ferretería Sol', 'Nuevo', 'blue'],
                        ['Colegio Andino', 'Activo', 'mint'],
                    ].map(([n, s, t]) => (
                        <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 30, borderBottom: `1px solid ${C.border}` }}>
                            <T size={9} weight={600} style={{ width: 110 }}>
                                {n}
                            </T>
                            <Chip label={s!} t={t as 'mint'} />
                            <Bar w={70} h={5} />
                        </div>
                    ))}
                </div>
            </At>
            <TopIcon x={330}>
                <Sparkles size={12} color={primary()} />
            </TopIcon>
            <TopIcon x={354}>
                <Megaphone size={12} />
            </TopIcon>
            <TopIcon x={378}>
                <Bell size={12} />
            </TopIcon>
            <TopIcon x={402} a="ay-help">
                <CircleHelp size={12} />
            </TopIcon>
            <TopIcon x={426}>
                <Moon size={12} />
            </TopIcon>
            <At x={448} y={TOP_Y + 7}>
                <Avatar initials="LG" t="cyan" size={18} />
            </At>

            {/* Panel de ayuda */}
            <At x={276} y={TOP_Y + 31} w={192} h={238} a="ay-panel" style={{ transform: 'translateX(200px)', background: C.card, borderLeft: `1px solid ${C.border}`, boxShadow: '-14px 0 30px -18px rgba(15,23,42,.5)', zIndex: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <T size={11} weight={700}>
                        Ayuda
                    </T>
                    <T size={7.5} color={C.mutedFg}>
                        Guías rápidas, recorridos y soporte.
                    </T>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, height: 22, padding: '0 7px', borderRadius: 6, border: `1px solid ${C.border}` }}>
                    <Search size={9} color={C.mutedFg} />
                    <T size={7.5} color={C.mutedFg}>
                        ¿Qué quieres hacer?
                    </T>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 7, borderRadius: 8, background: primary(0.1) }}>
                    <GraduationCap size={12} color={primary()} />
                    <T size={8.5} weight={700}>
                        Centro de aprendizaje
                    </T>
                </span>
                <T size={7.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                    EMPIEZA AQUÍ
                </T>
                {[
                    [<PlayCircle key="a" size={11} />, 'Recorrido por la app', '2 minutos', 'ay-row'],
                    [<ListChecks key="b" size={11} />, 'Primeros pasos', 'Lo que te falta', undefined],
                    [<Keyboard key="c" size={11} />, 'Atajos de teclado', 'Tecla ?', undefined],
                    [<Megaphone key="d" size={11} />, 'Novedades', 'Lo nuevo', undefined],
                ].map(([ic, l, h, a]) => (
                    <span key={l as string} data-a={a ? '' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 22, padding: '0 5px', borderRadius: 6, animationName: a as string | undefined }}>
                        <span style={{ color: primary(), display: 'flex' }}>{ic}</span>
                        <T size={8.5} weight={600} style={{ flex: 1 }}>
                            {l as string}
                        </T>
                        <T size={7} color={C.mutedFg}>
                            {h as string}
                        </T>
                    </span>
                ))}
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    <BookOpen size={10} color={tone('violet')} />
                    <T size={7.5} color={C.mutedFg}>
                        Guías por tema
                    </T>
                </span>
            </At>

            {/* Recorrido */}
            <Spot a="ay-s1" x={343} y={52} w={100} h={28} step="3 DE 13" title="Crea un registro" text="Cada cliente, pedido o tarea es un registro. Agrégalo aquí." bx={140} by={92} />
            <Spot a="ay-s2" x={374} y={18} w={30} h={30} step="4 DE 13" title="Tus avisos" text="La campana te cuenta cuando te mencionan o te asignan algo." bx={176} by={62} />

            <Cursor a="ay-cur" click="ay-ring" rest={[330, 250]} />
        </Stage>
    );
}
