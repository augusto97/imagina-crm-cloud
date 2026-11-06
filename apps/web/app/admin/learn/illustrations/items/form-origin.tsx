import { Globe, Tag, Zap } from 'lucide-react';

import { At, Bar, C, Cursor, Keyframes, Pill, Stage, T, Win, anim, primary, tone } from '../kit';

/**
 * v0.1.386 — Origen y etiquetas: el mismo formulario insertado en dos páginas
 * del sitio; cada registro llega con la página desde donde se envió, el nombre
 * del formulario y su etiqueta, y la automatización sólo corre para la página
 * que contiene «navidad».
 */

const CSS = `
@keyframes fo-cur{0%,8%{transform:translate(70px,280px)}20%,26%{transform:translate(118px,206px)}40%,56%{transform:translate(70px,280px)}66%,72%{transform:translate(118px,206px)}86%,100%{transform:translate(70px,280px)}}
@keyframes fo-ring{0%,21%{opacity:0;transform:scale(.4)}23%{opacity:1;transform:scale(1)}29%,67%{opacity:0;transform:scale(.4)}69%{opacity:1;transform:scale(1)}75%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fo-url1{0%,46%{opacity:1}50%,96%{opacity:0}100%{opacity:1}}
@keyframes fo-url2{0%,46%{opacity:0}50%,96%{opacity:1}100%{opacity:0}}
@keyframes fo-row1{0%,26%{opacity:0;transform:translateY(8px)}32%,94%{opacity:1;transform:none}100%{opacity:0}}
@keyframes fo-row2{0%,72%{opacity:0;transform:translateY(8px)}78%,94%{opacity:1;transform:none}100%{opacity:0}}
@keyframes fo-auto{0%,32%{opacity:0;transform:translateX(-10px)}38%,94%{opacity:1;transform:none}100%{opacity:0}}
@keyframes fo-skip{0%,78%{opacity:0}84%,94%{opacity:1}100%{opacity:0}}
`;

function Cell({ w, children, bold }: { w: number; children: string; bold?: boolean }): JSX.Element {
    return (
        <span style={{ width: w, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            <T size={6.8} weight={bold ? 700 : 500} color={bold ? undefined : C.mutedFg}>
                {children}
            </T>
        </span>
    );
}

function Row({ a, nombre, pagina, formulario, etiqueta, t }: { a: string; nombre: string; pagina: string; formulario: string; etiqueta: string; t: 'rose' | 'blue' }): JSX.Element {
    return (
        <span {...anim(a, { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderTop: `1px solid ${C.border}`, opacity: 0 })}>
            <Cell w={38} bold>
                {nombre}
            </Cell>
            <Cell w={62}>{pagina}</Cell>
            <Cell w={44}>{formulario}</Cell>
            <span style={{ width: 46 }}>
                <span style={{ display: 'inline-flex', padding: '1px 6px', borderRadius: 99, background: tone(t, 0.16), color: tone(t), fontSize: 6.5, fontWeight: 700 }}>{etiqueta}</span>
            </span>
        </span>
    );
}

export default function FormOrigin(): JSX.Element {
    return (
        <Stage
            label="El mismo formulario está en dos páginas del sitio. Cada registro llega con la página desde donde se envió, el nombre del formulario y su etiqueta, y la automatización sólo corre para la página de Navidad."
            tint="violet"
            cycle={10}
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                <Win
                    x={18}
                    y={18}
                    w={190}
                    h={232}
                    title={
                        <span style={{ position: 'relative', display: 'inline-block', width: 150, height: 12 }}>
                            <span {...anim('fo-url1', { position: 'absolute', left: 0, top: 0 })}>
                                <T size={7} color={C.mutedFg}>
                                    tusitio.com/navidad
                                </T>
                            </span>
                            <span {...anim('fo-url2', { position: 'absolute', left: 0, top: 0, opacity: 0 })}>
                                <T size={7} color={C.mutedFg}>
                                    tusitio.com/contacto
                                </T>
                            </span>
                        </span>
                    }
                >
                    <At x={12} y={12} w={166}>
                        <Bar w={120} h={7} />
                    </At>
                    <At x={12} y={30} w={166} h={170}>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card }}>
                            <T size={10} weight={800}>
                                Escríbenos
                            </T>
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <T size={6.8} weight={600}>
                                    Nombre
                                </T>
                                <span style={{ width: 128, height: 14, borderRadius: 4, border: `1px solid ${C.border}`, background: C.card }} />
                            </span>
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <T size={6.8} weight={600}>
                                    Correo
                                </T>
                                <span style={{ width: 128, height: 14, borderRadius: 4, border: `1px solid ${C.border}`, background: C.card }} />
                            </span>
                            <span style={{ alignSelf: 'flex-start', padding: '4px 10px', borderRadius: 5, background: primary(), color: C.primaryFg }}>
                                <T size={7.5} weight={700} color={C.primaryFg}>
                                    Enviar
                                </T>
                            </span>
                        </span>
                    </At>
                </Win>

                {/* La lista: cada registro con su origen */}
                <At x={222} y={22} w={240} style={{ borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: C.muted }}>
                        <Cell w={38} bold>
                            Nombre
                        </Cell>
                        <Cell w={62} bold>
                            Página
                        </Cell>
                        <Cell w={44} bold>
                            Formulario
                        </Cell>
                        <Cell w={46} bold>
                            Etiquetas
                        </Cell>
                    </span>
                    <Row a="fo-row1" nombre="Ana" pagina="/navidad" formulario="Escríbenos" etiqueta="Navidad" t="rose" />
                    <Row a="fo-row2" nombre="Beto" pagina="/contacto" formulario="Escríbenos" etiqueta="Web" t="blue" />
                </At>

                {/* La automatización: sólo para la página de Navidad */}
                <At x={222} y={142} w={240} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Zap size={10} color={C.mutedFg} />
                        <T size={7.5} weight={700} color={C.mutedFg}>
                            Si la página contiene «navidad»
                        </T>
                    </span>
                    <At x={0} y={20} a="fo-auto" style={{ opacity: 0 }}>
                        <Pill t="mint" icon={<Tag size={9} />} label="Ana · aviso a ventas de Navidad" />
                    </At>
                    <At x={0} y={46} a="fo-skip" style={{ opacity: 0 }}>
                        <Pill t="slate" icon={<Globe size={9} />} label="Beto · /contacto: no aplica" />
                    </At>
                </At>

                <Cursor a="fo-cur" click="fo-ring" rest={[70, 280]} />
            </At>
        </Stage>
    );
}
