import { Check, ClipboardList } from 'lucide-react';

import { At, Avatar, C, Chip, Cursor, Keyframes, Pill, Stage, T, Win, primary, tone } from '../kit';

/** Portada de Formularios: alguien llena el formulario en su celular y la respuesta llega como fila nueva de la lista. */

const CSS = `
@keyframes fh-type1{0%,8%{width:0}22%,100%{width:62px}}
@keyframes fh-type2{0%,22%{width:0}32%,100%{width:66px}}
@keyframes fh-pick{0%,33%{box-shadow:0 0 0 0 transparent;background:${C.card}}36%,100%{box-shadow:0 0 0 1.5px ${primary()};background:${primary(0.1)}}}
@keyframes fh-form{0%,44%{opacity:1;transform:translateY(0)}48%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes fh-thanks{0%,46%{opacity:0;transform:scale(.92)}52%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes fh-dot{0%,33%{background:transparent;border-color:${C.mutedFg}}36%,100%{background:${primary()};border-color:${primary()}}}
@keyframes fh-btn{0%,39%{transform:scale(1)}41%{transform:scale(.94)}44%,100%{transform:scale(1)}}
@keyframes fh-cursor{0%{transform:translate(150px,260px);opacity:0}5%{opacity:1}30%{transform:translate(100px,205px)}34%{transform:translate(100px,205px)}40%,44%{transform:translate(110px,243px);opacity:1}52%,100%{transform:translate(110px,243px);opacity:0}}
@keyframes fh-ring{0%,33%{opacity:0;transform:scale(.4)}35%{opacity:1;transform:scale(1)}38%{opacity:0;transform:scale(1.6)}40%{opacity:0;transform:scale(.4)}42%{opacity:1;transform:scale(1)}46%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fh-fly{0%,50%{opacity:0;transform:translate(0,0) scale(.6)}53%{opacity:1;transform:translate(10px,-6px) scale(1)}62%{opacity:1;transform:translate(76px,-138px) scale(1)}65%,100%{opacity:0;transform:translate(80px,-140px) scale(.6)}}
@keyframes fh-push{0%,61%{transform:translateY(-27px)}67%,100%{transform:translateY(0)}}
@keyframes fh-new{0%,61%{opacity:0;transform:translateX(18px)}67%,100%{opacity:1;transform:translateX(0)}}
@keyframes fh-glow{0%,64%{background:${primary(0.16)}}88%,100%{background:transparent}}
@keyframes fh-badge{0%,64%{opacity:0;transform:scale(.6)}69%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

function Phone({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <At
            x={30}
            y={18}
            w={160}
            h={266}
            style={{
                borderRadius: 24,
                background: C.card,
                border: `5px solid ${C.fg}`,
                overflow: 'hidden',
                boxShadow: '0 18px 40px -18px rgba(15,23,42,.55)',
            }}
        >
            <div style={{ position: 'absolute', left: 58, top: 5, width: 34, height: 5, borderRadius: 99, background: C.fg, opacity: 0.85 }} />
            {children}
        </At>
    );
}

function FieldBox({ label, children, y }: { label: string; children?: React.ReactNode; y: number }): JSX.Element {
    return (
        <At x={12} y={y} w={126}>
            <T size={7.5} weight={700}>
                {label}
            </T>
            <div
                style={{
                    marginTop: 3,
                    height: 20,
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 6px',
                    overflow: 'hidden',
                }}
            >
                {children}
            </div>
        </At>
    );
}

const ROWS: Array<{ name: string; need: string; t: 'violet' | 'amber' | 'cyan'; origin: string; ot: 'blue' | 'mint' | 'rose' }> = [
    { name: 'Óptica Visión', need: 'Instalación', t: 'amber', origin: 'Sitio web', ot: 'blue' },
    { name: 'Hotel Brisas', need: 'Mantenimiento', t: 'cyan', origin: 'WhatsApp', ot: 'mint' },
    { name: 'Clínica Norte', need: 'Instalación', t: 'violet', origin: 'Instagram', ot: 'rose' },
];

export default function FormHero(): JSX.Element {
    return (
        <Stage label="Una persona llena el formulario «Pide tu cotización» desde su celular, toca Enviar y la respuesta aparece como una fila nueva en la lista de oportunidades." tint="violet">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
            <Phone>
                {/* El formulario */}
                <At x={0} y={14} w={150} h={240} a="fh-form" style={{ opacity: 0 }}>
                    <div style={{ height: 3, background: primary(), margin: '6px 10px 0', borderRadius: 99 }} />
                    <At x={12} y={14}>
                        <T size={10.5} weight={800}>
                            Pide tu cotización
                        </T>
                    </At>
                    <At x={12} y={30}>
                        <T size={7} color={C.mutedFg}>
                            Te respondemos hoy mismo.
                        </T>
                    </At>
                    <FieldBox label="Nombre" y={46}>
                        <span data-a="" style={{ display: 'inline-block', overflow: 'hidden', whiteSpace: 'nowrap', width: 62, animationName: 'fh-type1' }}>
                            <T size={8.5}>Laura Pérez</T>
                        </span>
                    </FieldBox>
                    <FieldBox label="Teléfono" y={84}>
                        <span data-a="" style={{ display: 'inline-block', overflow: 'hidden', whiteSpace: 'nowrap', width: 66, animationName: 'fh-type2' }}>
                            <T size={8.5}>+57 310 455 2…</T>
                        </span>
                    </FieldBox>
                    <At x={12} y={122}>
                        <T size={7.5} weight={700}>
                            ¿Qué necesitas?
                        </T>
                    </At>
                    {['Instalación', 'Mantenimiento'].map((o, i) => (
                        <At
                            key={o}
                            x={12}
                            y={135 + i * 23}
                            w={126}
                            h={19}
                            a={i === 1 ? 'fh-pick' : undefined}
                            style={{
                                borderRadius: 6,
                                border: `1px solid ${C.border}`,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                padding: '0 6px',
                                ...(i === 1 ? { boxShadow: `0 0 0 1.5px ${primary()}`, background: primary(0.1) } : null),
                            }}
                        >
                            <span
                                data-a={i === 1 ? '' : undefined}
                                style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: 99,
                                    border: `1.5px solid ${i === 1 ? primary() : C.mutedFg}`,
                                    background: i === 1 ? primary() : 'transparent',
                                    boxShadow: `inset 0 0 0 1.5px ${C.card}`,
                                    animationName: i === 1 ? 'fh-dot' : undefined,
                                }}
                            />
                            <T size={8}>{o}</T>
                        </At>
                    ))}
                    <At
                        x={12}
                        y={192}
                        w={126}
                        h={24}
                        a="fh-btn"
                        style={{ borderRadius: 7, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <T size={9} weight={700} color={C.primaryFg}>
                            Enviar
                        </T>
                    </At>
                </At>
                {/* Gracias */}
                <At x={0} y={70} w={150} a="fh-thanks" style={{ opacity: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                    <span
                        style={{
                            width: 38,
                            height: 38,
                            borderRadius: 99,
                            background: tone('mint', 0.18),
                            color: tone('mint'),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Check size={20} strokeWidth={3} />
                    </span>
                    <T size={12} weight={800}>
                        ¡Gracias!
                    </T>
                    <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', textAlign: 'center', width: 110 }}>
                        Recibimos tu solicitud. Te escribimos hoy.
                    </T>
                    <span style={{ marginTop: 8, padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.border}` }}>
                        <T size={8} weight={600}>
                            Enviar otra respuesta
                        </T>
                    </span>
                </At>
            </Phone>

            {/* La respuesta que viaja */}
            <At x={150} y={250} a="fh-fly" style={{ opacity: 0, zIndex: 6 }}>
                <span
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        background: primary(),
                        color: C.primaryFg,
                        boxShadow: `0 6px 16px -4px ${primary(0.6)}`,
                    }}
                >
                    <ClipboardList size={14} />
                </span>
            </At>

            {/* La lista */}
            <Win x={212} y={52} w={250} h={196} title="Oportunidades">
                <div style={{ display: 'flex', padding: '7px 10px 5px', borderBottom: `1px solid ${C.border}`, gap: 6 }}>
                    <T size={7.5} weight={700} color={C.mutedFg} style={{ width: 92 }}>
                        Cliente
                    </T>
                    <T size={7.5} weight={700} color={C.mutedFg} style={{ width: 68 }}>
                        Necesita
                    </T>
                    <T size={7.5} weight={700} color={C.mutedFg}>
                        Origen
                    </T>
                </div>
                {/* Fila nueva */}
                <At x={0} y={24} w={248} h={27} a="fh-new" style={{ zIndex: 2 }}>
                    <div data-a="" style={{ height: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', animationName: 'fh-glow', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 92, display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Avatar initials="LP" t="blue" size={15} />
                            <T size={8.5} weight={700}>
                                Laura Pérez
                            </T>
                        </span>
                        <span style={{ width: 68 }}>
                            <Chip label="Manten." t="cyan" />
                        </span>
                        <Pill label="Formulario" t="violet" style={{ height: 16, fontSize: 8, padding: '0 6px' }} />
                    </div>
                </At>
                {/* Filas que ya estaban */}
                <At x={0} y={51} w={248} a="fh-push">
                    {ROWS.map((r) => (
                        <div key={r.name} style={{ height: 27, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                            <span style={{ width: 92, display: 'flex', alignItems: 'center', gap: 5 }}>
                                <Avatar initials={r.name.slice(0, 2).toUpperCase()} t={r.t} size={15} />
                                <T size={8.5}>{r.name}</T>
                            </span>
                            <span style={{ width: 68 }}>
                                <Chip label={r.need === 'Instalación' ? 'Instal.' : 'Manten.'} t={r.need === 'Instalación' ? 'amber' : 'cyan'} />
                            </span>
                            <Pill label={r.origin} t={r.ot} style={{ height: 16, fontSize: 8, padding: '0 6px' }} />
                        </div>
                    ))}
                </At>
                <At x={148} y={140} a="fh-badge" style={{ opacity: 1 }}>
                    <span
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 8px',
                            borderRadius: 99,
                            background: C.card,
                            border: `1px solid ${C.border}`,
                            boxShadow: '0 6px 16px -8px rgba(15,23,42,.4)',
                        }}
                    >
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: C.success }} />
                        <T size={8} weight={700}>
                            Registro nuevo
                        </T>
                    </span>
                </At>
            </Win>
            <Cursor a="fh-cursor" click="fh-ring" rest={[110, 243]} />
            </At>
        </Stage>
    );
}
