import { CalendarClock, GitBranch, Hourglass, Mail, PenLine, Plus } from 'lucide-react';

import { At, C, Cursor, IconSquare, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * El Lienzo del editor: se toca el «+» de una conexión, se elige «Esperar» y
 * el paso nuevo aparece justo ahí; después el recorrido baja por el flujo y
 * toma la rama «Sí» de la condición.
 */

const CSS = `
@keyframes al-cur{0%{transform:translate(420px,290px);opacity:0}6%{opacity:1}16%,21%{transform:translate(240px,137px)}29%,33%{transform:translate(300px,139px)}44%,90%{transform:translate(440px,150px);opacity:1}96%,100%{transform:translate(440px,150px);opacity:0}}
@keyframes al-ring{0%,18%{opacity:0;transform:scale(.4)}20%{opacity:1;transform:scale(1)}24%{opacity:0;transform:scale(1.6)}30%{opacity:0;transform:scale(.4)}32%{opacity:1;transform:scale(1)}36%,100%{opacity:0;transform:scale(1.6)}}
@keyframes al-plus{0%,17%{box-shadow:0 0 0 0 transparent;background:${C.card}}20%,32%{box-shadow:0 0 0 3px ${primary(0.3)};background:${primary(0.12)}}36%,100%{box-shadow:0 0 0 0 transparent;background:${C.card}}}
@keyframes al-menu{0%,21%{opacity:0;transform:translateY(-4px) scale(.97)}24%,33%{opacity:1;transform:translateY(0) scale(1)}36%,100%{opacity:0;transform:translateY(-4px) scale(.97)}}
@keyframes al-item{0%,27%{background:transparent}29%,34%{background:${primary(0.12)}}36%,100%{background:transparent}}
@keyframes al-shift{0%,35%{transform:translateY(-48px)}44%,100%{transform:translateY(0)}}
@keyframes al-new{0%,36%{opacity:0;transform:scale(.85)}44%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes al-dot{0%,49%{opacity:0;transform:translate(0,0)}50%{opacity:1;transform:translate(0,0)}54%{opacity:1;transform:translate(0,18px)}55%,57%{opacity:0;transform:translate(0,18px)}58%{opacity:1;transform:translate(0,52px)}61%{opacity:1;transform:translate(0,66px)}62%,64%{opacity:0;transform:translate(0,66px)}65%{opacity:1;transform:translate(0,100px)}68%{opacity:1;transform:translate(0,114px)}69%,71%{opacity:0;transform:translate(0,114px)}72%{opacity:1;transform:translate(0,148px)}78%{opacity:1;transform:translate(-100px,164px)}79%,100%{opacity:0;transform:translate(-100px,164px)}}
@keyframes al-yes{0%,77%{box-shadow:0 0 0 0 transparent}80%,90%{box-shadow:0 0 0 3px ${tone('mint', 0.45)}}96%,100%{box-shadow:0 0 0 0 transparent}}
`;

const W = 178;

function Node({ x, y, kicker, title, icon, t, a, accent }: { x: number; y: number; kicker: string; title: string; icon: JSX.Element; t: 'amber' | 'blue' | 'violet' | 'mint' | 'rose' | 'slate'; a?: string; accent?: boolean }): JSX.Element {
    return (
        <At
            x={x}
            y={y}
            w={W}
            h={34}
            a={a}
            style={{
                background: C.card,
                border: `1px solid ${accent ? primary(0.35) : C.border}`,
                borderRadius: 9,
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '0 8px',
                boxShadow: '0 6px 16px -12px rgba(15,23,42,.45)',
            }}
        >
            <IconSquare t={t} size={20}>
                {icon}
            </IconSquare>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <T size={6.8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {kicker}
                </T>
                <T size={8.6} weight={600}>
                    {title}
                </T>
            </span>
        </At>
    );
}

function VLine({ y1, y2 }: { y1: number; y2: number }): JSX.Element {
    return <At x={219} y={y1} w={2} h={y2 - y1} style={{ background: C.border }} />;
}

function Pill({ x, y, label, t }: { x: number; y: number; label: string; t: 'mint' | 'rose' }): JSX.Element {
    return (
        <At x={x} y={y} style={{ height: 14, padding: '0 6px', borderRadius: 99, fontSize: 7.5, fontWeight: 700, color: tone(t), background: tone(t, 0.15), border: `1px solid ${tone(t, 0.35)}`, display: 'flex', alignItems: 'center' }}>
            {label}
        </At>
    );
}

export default function AutoLienzo(): JSX.Element {
    return (
        <Stage label="El lienzo de una automatización: se toca el más de una conexión, se elige Esperar y el paso aparece en ese lugar; después el recorrido baja y toma la rama Sí de la condición." tint="blue">
            <Keyframes css={CSS} />
            <Win x={20} y={14} w={440} h={276} title="Cobro de facturas vencidas · Lienzo">
                <div style={{ position: 'absolute', inset: 0, backgroundImage: `radial-gradient(${C.border} 1px, transparent 1px)`, backgroundSize: '14px 14px', opacity: 0.7 }} />
                {/* Fijos arriba */}
                <VLine y1={42} y2={56} />
                <VLine y1={90} y2={104} />
                <Node x={131} y={8} kicker="Cuando" title="Vence la factura (1 día después)" icon={<CalendarClock size={11} />} t="amber" accent />
                <Node x={131} y={56} kicker="Enviar un correo" title="Recordatorio al cliente" icon={<Mail size={11} />} t="blue" />
                {/* El paso que se inserta */}
                <At x={0} y={0} w={440} h={250} a="al-new">
                    <VLine y1={138} y2={152} />
                    <Node x={131} y={104} kicker="Esperar" title="Espera 3 días" icon={<Hourglass size={11} />} t="slate" accent />
                </At>
                {/* Lo de abajo: baja cuando entra el paso nuevo */}
                <At x={0} y={0} w={440} h={250} a="al-shift">
                    <Node x={131} y={152} kicker="Condición" title="¿Monto mayor a $ 1.000.000?" icon={<GitBranch size={11} />} t="violet" />
                    <svg width={440} height={250} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
                        <path d="M 220 186 C 220 198, 120 194, 120 206" fill="none" stroke={tone('mint', 0.7)} strokeWidth="1.6" />
                        <path d="M 220 186 C 220 198, 320 194, 320 206" fill="none" stroke={tone('rose', 0.6)} strokeWidth="1.6" />
                    </svg>
                    <Pill x={150} y={189} label="Sí" t="mint" />
                    <Pill x={274} y={189} label="No" t="rose" />
                    <Node x={31} y={206} kicker="Enviar un correo" title="Avisar a cartera" icon={<Mail size={11} />} t="blue" a="al-yes" />
                    <Node x={231} y={206} kicker="Actualizar campos" title="Estado → Vencida" icon={<PenLine size={11} />} t="rose" />
                </At>
                {/* El «+» de la conexión */}
                <At x={213} y={90} w={14} h={14} a="al-plus" style={{ borderRadius: 99, border: `1px solid ${C.border}`, background: C.card, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.mutedFg, zIndex: 3 }}>
                    <Plus size={9} />
                </At>
                {/* Menú de acciones */}
                <At x={234} y={78} w={138} a="al-menu" style={{ opacity: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: 4, boxShadow: '0 12px 26px -12px rgba(15,23,42,.45)', zIndex: 6 }}>
                    {[
                        { l: 'Esperar', i: <Hourglass size={10} />, a: 'al-item' },
                        { l: 'Si / sino (condicional)', i: <GitBranch size={10} /> },
                        { l: 'Enviar email', i: <Mail size={10} /> },
                    ].map((it) => (
                        <div key={it.l} data-a={it.a ? '' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 20, padding: '0 6px', borderRadius: 6, animationName: it.a }}>
                            <span style={{ color: C.mutedFg, display: 'flex' }}>{it.i}</span>
                            <T size={8.4} weight={500}>
                                {it.l}
                            </T>
                        </div>
                    ))}
                </At>
            </Win>
            <At x={236} y={78} a="al-dot" style={{ opacity: 0, zIndex: 8 }}>
                <span style={{ display: 'block', width: 8, height: 8, borderRadius: 99, background: primary(), boxShadow: `0 0 0 4px ${primary(0.2)}` }} />
            </At>
            <Cursor a="al-cur" click="al-ring" rest={[440, 150]} />
        </Stage>
    );
}
