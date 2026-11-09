import { BarChart3, Megaphone } from 'lucide-react';

import { At, Bar, C, Cursor, Keyframes, Pill, Stage, T, Win, anim, primary, tone } from '../kit';

/**
 * v0.1.388 — Una etiqueta distinta por página: el mismo formulario está en la
 * landing de Navidad y en Contacto. Enviado desde la landing, se dispara la
 * conversión «Navidad»; desde Contacto, la de «las demás páginas».
 */

const CSS = `
@keyframes cpr-cur{0%,8%{transform:translate(70px,280px)}20%,26%{transform:translate(110px,206px)}40%,56%{transform:translate(70px,280px)}66%,72%{transform:translate(110px,206px)}86%,100%{transform:translate(70px,280px)}}
@keyframes cpr-ring{0%,21%{opacity:0;transform:scale(.4)}23%{opacity:1;transform:scale(1)}29%,67%{opacity:0;transform:scale(.4)}69%{opacity:1;transform:scale(1)}75%,100%{opacity:0;transform:scale(1.6)}}
@keyframes cpr-url1{0%,46%{opacity:1}50%,96%{opacity:0}100%{opacity:1}}
@keyframes cpr-url2{0%,46%{opacity:0}50%,96%{opacity:1}100%{opacity:0}}
@keyframes cpr-r1{0%,24%{background:transparent}28%,46%{background:var(--cpr-hit)}50%,100%{background:transparent}}
@keyframes cpr-r2{0%,70%{background:transparent}74%,94%{background:var(--cpr-hit)}100%{background:transparent}}
@keyframes cpr-o1{0%,26%{opacity:0;transform:translateY(8px)}32%,46%{opacity:1;transform:none}52%,100%{opacity:0}}
@keyframes cpr-o2{0%,72%{opacity:0;transform:translateY(8px)}78%,94%{opacity:1;transform:none}100%{opacity:0}}
`;

function Rule({ a, when, label }: { a: string; when: string; label: string }): JSX.Element {
    return (
        <span {...anim(a, { display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 9px', borderTop: `1px solid ${C.border}` })}>
            <T size={7} color={C.mutedFg}>
                {when}
            </T>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <BarChart3 size={9} color={C.mutedFg} />
                <T size={7.5} weight={700}>
                    {label}
                </T>
            </span>
        </span>
    );
}

export default function ConversionPageRules(): JSX.Element {
    return (
        <Stage
            label="El mismo formulario está en la landing de Navidad y en la página de Contacto. Enviado desde la landing, se registra la conversión «Navidad»; desde Contacto, la de las demás páginas."
            tint="blue"
            cycle={10}
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2, ['--cpr-hit' as string]: tone('mint', 0.16) }}>
                <Win
                    x={18}
                    y={18}
                    w={180}
                    h={232}
                    title={
                        <span style={{ position: 'relative', display: 'inline-block', width: 140, height: 12 }}>
                            <span {...anim('cpr-url1', { position: 'absolute', left: 0, top: 0 })}>
                                <T size={7} color={C.mutedFg}>
                                    tusitio.com/landing-navidad
                                </T>
                            </span>
                            <span {...anim('cpr-url2', { position: 'absolute', left: 0, top: 0, opacity: 0 })}>
                                <T size={7} color={C.mutedFg}>
                                    tusitio.com/contacto
                                </T>
                            </span>
                        </span>
                    }
                >
                    <At x={12} y={12} w={156}>
                        <Bar w={110} h={7} />
                    </At>
                    <At x={12} y={30} w={156} h={170}>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card }}>
                            <T size={10} weight={800}>
                                Pide tu cotización
                            </T>
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <T size={6.8} weight={600}>
                                    Nombre
                                </T>
                                <span style={{ width: 118, height: 14, borderRadius: 4, border: `1px solid ${C.border}`, background: C.card }} />
                            </span>
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <T size={6.8} weight={600}>
                                    Correo
                                </T>
                                <span style={{ width: 118, height: 14, borderRadius: 4, border: `1px solid ${C.border}`, background: C.card }} />
                            </span>
                            <span style={{ alignSelf: 'flex-start', padding: '4px 10px', borderRadius: 5, background: primary(), color: C.primaryFg }}>
                                <T size={7.5} weight={700} color={C.primaryFg}>
                                    Enviar
                                </T>
                            </span>
                        </span>
                    </At>
                </Win>

                {/* Las reglas: la primera que coincide gana */}
                <At x={214} y={22} w={248} style={{ borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <span style={{ padding: '6px 9px', background: C.muted }}>
                        <T size={7.5} weight={700}>
                            Medir conversiones
                        </T>
                    </span>
                    <Rule a="cpr-r1" when="Si la página contiene «landing-navidad»" label="Google Ads · Navidad" />
                    <Rule a="cpr-r2" when="En las demás páginas" label="Google Ads · Contacto general" />
                </At>

                <At x={214} y={150} w={248} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <At x={0} y={0} a="cpr-o1" style={{ opacity: 0 }}>
                        <Pill t="mint" icon={<Megaphone size={9} />} label="Conversión «Navidad» registrada" />
                    </At>
                    <At x={0} y={0} a="cpr-o2" style={{ opacity: 0 }}>
                        <Pill t="blue" icon={<Megaphone size={9} />} label="Conversión «Contacto general»" />
                    </At>
                </At>

                <Cursor a="cpr-cur" click="cpr-ring" rest={[70, 280]} />
            </At>
        </Stage>
    );
}
