import { CalendarDays, FilePlus2, LayoutTemplate, Receipt, Sparkles, Stethoscope, Users, Zap } from 'lucide-react';

import { At, Btn, C, Cursor, IconSquare, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * «Empezar fácil»: se elige «Cuéntanos de tu negocio», se describe el
 * negocio y la IA propone las listas (con un tablero y automatizaciones)
 * para revisar antes de crear.
 */

const CSS = `
@keyframes em-a{0%,28%{opacity:1;transform:translateY(0)}32%,95%{opacity:0;transform:translateY(-6px)}99%,100%{opacity:1;transform:translateY(0)}}
@keyframes em-b{0%,30%{opacity:0;transform:translateY(8px)}34%,57%{opacity:1;transform:translateY(0)}61%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes em-c{0%,59%{opacity:0}63%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes em-type{0%,36%{width:0}50%,100%{width:198px}}
@keyframes em-pick{0%,20%{box-shadow:0 0 0 1px ${C.border}}24%,30%{box-shadow:0 0 0 2px ${primary()}}}
@keyframes em-l1{0%,62%{opacity:0;transform:translateY(8px)}67%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes em-l2{0%,66%{opacity:0;transform:translateY(8px)}71%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes em-l3{0%,70%{opacity:0;transform:translateY(8px)}75%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes em-sum{0%,76%{opacity:0}81%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes em-cur{0%{transform:translate(260px,260px);opacity:0}6%{opacity:1}18%,26%{transform:translate(132px,196px)}40%{transform:translate(300px,180px)}50%,55%{transform:translate(352px,252px)}70%,86%{transform:translate(440px,266px);opacity:1}92%,100%{transform:translate(440px,266px);opacity:0}}
@keyframes em-ring{0%,23%{opacity:0;transform:scale(.4)}25%{opacity:1;transform:scale(1)}29%{opacity:0;transform:scale(1.6)}52%{opacity:0;transform:scale(.4)}54%{opacity:1;transform:scale(1)}58%,100%{opacity:0;transform:scale(1.6)}}
`;

function Option({ x, icon, t, title, text, badge, a }: { x: number; icon: JSX.Element; t: 'violet' | 'blue' | 'slate'; title: string; text: string; badge?: string; a?: string }): JSX.Element {
    return (
        <At
            x={x}
            y={62}
            w={130}
            h={128}
            a={a}
            style={{ background: C.card, borderRadius: 10, boxShadow: `0 0 0 1px ${C.border}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}
        >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <IconSquare t={t} size={24}>
                    {icon}
                </IconSquare>
                {badge && (
                    <span style={{ fontSize: 7.5, fontWeight: 700, color: tone('mint'), background: tone('mint', 0.15), borderRadius: 99, padding: '2px 6px' }}>{badge}</span>
                )}
            </span>
            <T size={9.5} weight={700} style={{ whiteSpace: 'normal' }}>
                {title}
            </T>
            <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                {text}
            </T>
        </At>
    );
}

function ListCard({ y, icon, t, name, detail, a }: { y: number; icon: JSX.Element; t: 'blue' | 'violet' | 'mint'; name: string; detail: string; a: string }): JSX.Element {
    return (
        <At x={20} y={y} w={250} h={38} a={a} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.card }}>
            <IconSquare t={t} size={22}>
                {icon}
            </IconSquare>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
                <T size={9.5} weight={700}>
                    {name}
                </T>
                <T size={7.5} color={C.mutedFg}>
                    {detail}
                </T>
            </span>
            <span style={{ width: 13, height: 13, borderRadius: 4, background: primary(), color: C.primaryFg, fontSize: 8, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
        </At>
    );
}

export default function PpEmpezar(): JSX.Element {
    return (
        <Stage label="La bienvenida ofrece tres caminos; se elige «Cuéntanos de tu negocio», se escribe a qué se dedica una clínica dental y la IA propone tres listas, un tablero y automatizaciones para revisar antes de crear." tint="violet">
            <Keyframes css={CSS} />
            <Win x={18} y={16} w={444} h={268} title="Armemos tu espacio">
                {/* Fase A: los tres caminos */}
                <At x={0} y={0} w={444} h={242} a="em-a" style={{ opacity: 0 }}>
                    <At x={20} y={16}>
                        <T size={12} weight={700}>
                            ¿Cómo quieres empezar?
                        </T>
                    </At>
                    <At x={20} y={36}>
                        <T size={8.5} color={C.mutedFg}>
                            Todo lo que se cree se puede cambiar después.
                        </T>
                    </At>
                    <Option x={20} a="em-pick" icon={<Sparkles size={13} />} t="violet" title="Cuéntanos de tu negocio" text="La IA arma tus listas, vistas, un tablero y automatizaciones." badge="Recomendado" />
                    <Option x={157} icon={<LayoutTemplate size={13} />} t="blue" title="Elegir por tipo de negocio" text="Combina plantillas: ventas, facturación, citas…" />
                    <Option x={294} icon={<FilePlus2 size={13} />} t="slate" title="Empezar en blanco" text="Crea tu primera lista desde cero, campo por campo." />
                </At>

                {/* Fase B: describir el negocio */}
                <At x={0} y={0} w={444} h={242} a="em-b" style={{ opacity: 0 }}>
                    <At x={20} y={16}>
                        <T size={12} weight={700}>
                            Cuéntanos de tu negocio
                        </T>
                    </At>
                    <At x={20} y={34}>
                        <T size={8.5} weight={600}>
                            ¿A qué se dedica tu negocio?
                        </T>
                    </At>
                    <At x={20} y={58} w={404} h={62} style={{ borderRadius: 8, border: `1.5px solid ${primary()}`, padding: 9, boxShadow: `0 0 0 3px ${primary(0.15)}` }}>
                        <span data-a="" style={{ display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', animationName: 'em-type', width: 198, borderRight: `1.5px solid ${primary()}` }}>
                            <T size={9.5}>Clínica dental con citas, pacientes y cobros</T>
                        </span>
                    </At>
                    <At x={20} y={130} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <T size={8} color={C.mutedFg}>
                            Prueba con:
                        </T>
                        {['Agencia de marketing', 'Tienda online'].map((c) => (
                            <span key={c} style={{ fontSize: 8, padding: '2px 7px', borderRadius: 99, border: `1px solid ${C.border}`, color: C.fg }}>
                                {c}
                            </span>
                        ))}
                    </At>
                    <At x={20} y={160} style={{ display: 'flex', gap: 5 }}>
                        <T size={8} weight={600}>
                            ¿Qué quieres organizar primero?
                        </T>
                    </At>
                    <At x={20} y={176} style={{ display: 'flex', gap: 5 }}>
                        {['Citas', 'Clientes y ventas', 'Facturación y cobros'].map((c, i) => (
                            <span key={c} style={{ fontSize: 8, fontWeight: 600, padding: '3px 8px', borderRadius: 99, border: `1px solid ${i === 0 ? primary() : C.border}`, background: i === 0 ? primary(0.12) : 'transparent', color: i === 0 ? primary() : C.fg }}>
                                {c}
                            </span>
                        ))}
                    </At>
                    <At x={322} y={202}>
                        <Btn label={<><Sparkles size={10} /> Armar mi espacio</>} />
                    </At>
                </At>

                {/* Fase C: la propuesta */}
                <At x={0} y={0} w={444} h={242} a="em-c">
                    <At x={20} y={14}>
                        <T size={11.5} weight={700}>
                            Tu espacio para «Clínica Sonrisa»
                        </T>
                    </At>
                    <At x={20} y={32}>
                        <T size={8.5} color={C.mutedFg}>
                            Quita lo que no te sirva. Nada se crea hasta que confirmes.
                        </T>
                    </At>
                    <ListCard y={54} a="em-l1" icon={<Users size={12} />} t="blue" name="Pacientes" detail="8 campos · 2 vistas · 6 ejemplos" />
                    <ListCard y={98} a="em-l2" icon={<CalendarDays size={12} />} t="violet" name="Citas" detail="7 campos · calendario · 6 ejemplos" />
                    <ListCard y={142} a="em-l3" icon={<Receipt size={12} />} t="mint" name="Tratamientos y cobros" detail="9 campos · tablero por estado" />
                    <At x={286} y={54} w={140} h={126} a="em-sum" style={{ borderRadius: 9, background: C.muted, padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <T size={9} weight={700}>
                            Resumen
                        </T>
                        {[
                            [<Stethoscope key="a" size={10} />, '3 listas vinculadas'],
                            [<CalendarDays key="b" size={10} />, '1 tablero'],
                            [<Zap key="c" size={10} />, '2 automatizaciones'],
                        ].map(([ic, txt], i) => (
                            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, color: primary() }}>
                                {ic}
                                <T size={8.5}>{txt as string}</T>
                            </span>
                        ))}
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 11, height: 11, borderRadius: 3, background: primary(), color: C.primaryFg, fontSize: 7, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
                            <T size={8}>Datos de ejemplo</T>
                        </span>
                    </At>
                    <At x={286} y={204}>
                        <Btn label="Crear mi espacio (3 listas)" />
                    </At>
                </At>
            </Win>
            <Cursor a="em-cur" click="em-ring" rest={[440, 266]} />
        </Stage>
    );
}
