import { Check, FileText, LayoutDashboard, Receipt, Target, Users, X } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * v0.1.385 — «Más usadas»: entrar a Facturas el lunes y el martes la sube a la
 * sección (al final, sin mover lo que ya estaba); abrir un registro un
 * momento no cuenta.
 */

const CSS = `
@keyframes mu-d1{0%,8%{opacity:0;transform:translateY(6px)}13%,92%{opacity:1;transform:none}97%,100%{opacity:0}}
@keyframes mu-d2{0%,30%{opacity:0;transform:translateY(6px)}35%,92%{opacity:1;transform:none}97%,100%{opacity:0}}
@keyframes mu-new{0%,44%{opacity:0;transform:translateX(-10px)}50%,92%{opacity:1;transform:none}97%,100%{opacity:0}}
@keyframes mu-glow{0%,48%{background:transparent}52%,62%{background:${primary(0.14)}}70%,100%{background:transparent}}
@keyframes mu-rec{0%,60%{opacity:0;transform:translateY(6px)}65%,92%{opacity:1;transform:none}97%,100%{opacity:0}}
`;

function Row({ y, icon, label, color, a, glow }: { y: number; icon: JSX.Element; label: string; color: string; a?: string; glow?: boolean }): JSX.Element {
    return (
        <At x={24} y={y} w={176} h={22} a={a} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', borderRadius: 6, ...(glow && a ? { animationName: `${a}, mu-glow` } : {}) }}>
            <span style={{ display: 'flex', color }}>{icon}</span>
            <T size={9}>{label}</T>
        </At>
    );
}

function Chip({ y, a, ok, title, sub }: { y: number; a: string; ok: boolean; title: string; sub: string }): JSX.Element {
    return (
        <At x={236} y={y} w={224} h={44} a={a} style={{ opacity: 0, display: 'flex', alignItems: 'center', gap: 9, padding: '0 11px', background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 8px 20px -14px rgba(15,23,42,.5)' }}>
            <span style={{ width: 22, height: 22, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: ok ? C.success : C.muted, color: ok ? '#fff' : C.mutedFg }}>
                {ok ? <Check size={12} /> : <X size={12} />}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <T size={9} weight={700}>
                    {title}
                </T>
                <T size={7.5} color={C.mutedFg}>
                    {sub}
                </T>
            </span>
        </At>
    );
}

export default function MasUsadas(): JSX.Element {
    return (
        <Stage
            label="Arriba del menú de Listas aparece «Más usadas» con Clientes y Oportunidades. Entrar a Facturas el lunes y el martes la suma al final de la sección; abrir un registro un momento no cuenta."
            tint="blue"
            cycle={8}
        >
            <Keyframes css={CSS} />
            <At x={16} y={18} w={192} h={264} style={{ background: C.muted, borderRadius: 12, border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', height: 30, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={10.5} weight={700}>
                        Café Aurora
                    </T>
                </div>
                <div style={{ display: 'flex', padding: '9px 14px 0' }}>
                    <T size={7.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.08em' }}>
                        MÁS USADAS
                    </T>
                </div>
            </At>
            <Row y={68} icon={<Users size={11} />} label="Clientes" color={tone('blue')} />
            <Row y={92} icon={<Target size={11} />} label="Oportunidades" color={tone('violet')} />
            <Row y={116} icon={<Receipt size={11} />} label="Facturas" color={tone('mint')} a="mu-new" glow />
            <At x={30} y={152} style={{ display: 'flex' }}>
                <T size={7.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.08em' }}>
                    ESPACIO DE TRABAJO
                </T>
            </At>
            <Row y={170} icon={<Users size={11} />} label="Clientes" color={tone('blue')} />
            <Row y={194} icon={<Receipt size={11} />} label="Facturas" color={tone('mint')} />
            <Row y={218} icon={<Target size={11} />} label="Oportunidades" color={tone('violet')} />
            <Row y={242} icon={<LayoutDashboard size={11} />} label="Ventas del mes" color={tone('amber')} />

            <At x={236} y={30} style={{ display: 'flex' }}>
                <T size={11} weight={700}>
                    Lo que cuenta
                </T>
            </At>
            <Chip y={58} a="mu-d1" ok title="Lunes · entraste a Facturas" sub="1 día" />
            <Chip y={112} a="mu-d2" ok title="Martes · otra vez Facturas" sub="2 días distintos: entra al final" />
            <Chip y={186} a="mu-rec" ok={false} title="Abriste un registro un momento" sub="No cuenta: el orden no se mueve" />
            <At x={236} y={240} w={224} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <FileText size={10} color={C.mutedFg} />
                <T size={7.5} color={C.mutedFg}>
                    El orden se renueva al día siguiente
                </T>
            </At>
        </Stage>
    );
}
