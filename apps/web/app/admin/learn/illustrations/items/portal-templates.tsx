import { Headphones, Package, Receipt, UserCheck, Workflow } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/** Las cinco plantillas del portal: al recorrer la galería, la vista previa muestra la composición de cada una. */

const CSS = `
@keyframes ptp-sel{0%,17%{transform:translateY(0)}20%,37%{transform:translateY(34px)}40%,57%{transform:translateY(68px)}60%,77%{transform:translateY(102px)}80%,97%{transform:translateY(136px)}100%{transform:translateY(0)}}
@keyframes ptp-v0{0%,17%{opacity:1;transform:translateY(0)}20%,97%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:translateY(0)}}
@keyframes ptp-v1{0%,17%{opacity:0;transform:translateY(6px)}20%,37%{opacity:1;transform:translateY(0)}40%,100%{opacity:0;transform:translateY(6px)}}
@keyframes ptp-v2{0%,37%{opacity:0;transform:translateY(6px)}40%,57%{opacity:1;transform:translateY(0)}60%,100%{opacity:0;transform:translateY(6px)}}
@keyframes ptp-v3{0%,57%{opacity:0;transform:translateY(6px)}60%,77%{opacity:1;transform:translateY(0)}80%,100%{opacity:0;transform:translateY(6px)}}
@keyframes ptp-v4{0%,77%{opacity:0;transform:translateY(6px)}80%,97%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(6px)}}
`;

const TPL: Array<{ name: string; desc: string; icon: JSX.Element; t: 'blue' | 'mint' | 'violet' | 'rose' | 'amber' }> = [
    { name: 'Mi cuenta', desc: 'Sus datos y lo que tiene', icon: <UserCheck size={11} />, t: 'blue' },
    { name: 'Estado de cuenta', desc: 'Saldo, vencimientos, facturas', icon: <Receipt size={11} />, t: 'mint' },
    { name: 'Seguimiento de proyecto', desc: 'Etapas, avance y entrega', icon: <Workflow size={11} />, t: 'violet' },
    { name: 'Mis solicitudes', desc: 'Abiertas, resueltas, por estado', icon: <Headphones size={11} />, t: 'rose' },
    { name: 'Mi pedido', desc: 'Estado, total y lo que pidió', icon: <Package size={11} />, t: 'amber' },
];

const box = (extra: React.CSSProperties = {}): React.CSSProperties => ({ borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, ...extra });
const bar = (w: number | string, c: string = C.muted, h = 5): JSX.Element => <span style={{ display: 'block', width: w, height: h, borderRadius: 99, background: c }} />;

function Kpis({ colors }: { colors: string[] }): JSX.Element {
    return (
        <span style={{ display: 'flex', gap: 5 }}>
            {colors.map((c, i) => (
                <span key={i} style={box({ flex: 1, padding: '5px 6px', display: 'flex', flexDirection: 'column', gap: 4 })}>
                    {bar('60%')}
                    {bar('80%', c, 7)}
                </span>
            ))}
        </span>
    );
}

function Stages({ n, done, c }: { n: number; done: number; c: string }): JSX.Element {
    return (
        <span style={{ display: 'flex', gap: 3 }}>
            {Array.from({ length: n }, (_, i) => (
                <span key={i} style={{ flex: 1, height: 14, borderRadius: 4, background: i < done ? c : C.border, clipPath: 'polygon(0 0, 88% 0, 100% 50%, 88% 100%, 0 100%, 12% 50%)' }} />
            ))}
        </span>
    );
}

function Board({ colors }: { colors: string[] }): JSX.Element {
    return (
        <span style={{ display: 'flex', gap: 5 }}>
            {colors.map((c, i) => (
                <span key={i} style={{ flex: 1, padding: 4, borderRadius: 6, background: C.muted, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ display: 'block', width: 28, height: 7, borderRadius: 3, background: c }} />
                    {Array.from({ length: 3 - (i % 2) }, (_, k) => (
                        <span key={k} style={box({ height: 14, padding: 3 })}>
                            {bar('70%')}
                        </span>
                    ))}
                </span>
            ))}
        </span>
    );
}

function Rows({ n, chip }: { n: number; chip?: string[] }): JSX.Element {
    return (
        <span style={box({ display: 'flex', flexDirection: 'column' })}>
            {Array.from({ length: n }, (_, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 15, padding: '0 6px', borderTop: i ? `1px solid ${C.border}` : undefined }}>
                    {bar(40)}
                    {bar(30)}
                    <span style={{ marginLeft: 'auto', width: 26, height: 8, borderRadius: 3, background: chip ? chip[i % chip.length] : C.muted }} />
                </span>
            ))}
        </span>
    );
}

function Preview({ i }: { i: number }): JSX.Element {
    const P = primary();
    const G = tone('mint');
    const R = tone('rose');
    const A = tone('amber');
    const B = tone('blue');
    const V = tone('violet');
    const head = (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 22, height: 22, borderRadius: 99, background: primary(0.18) }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {bar(80, C.fg, 6)}
                {bar(54)}
            </span>
        </span>
    );
    const blocks: JSX.Element[] = [
        // Mi cuenta
        <>
            {head}
            <span style={{ padding: 6, borderRadius: 7, background: primary(0.08) }}>
                <Kpis colors={[P, B, V]} />
            </span>
            <span style={{ display: 'flex', gap: 5 }}>
                {[0, 1].map((k) => (
                    <span key={k} style={box({ flex: 1, height: 40, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 })}>
                        {bar('70%', C.fg, 5)}
                        {bar('50%')}
                        {bar('60%')}
                    </span>
                ))}
            </span>
            <span style={box({ height: 30, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 })}>
                {bar('40%', C.fg)}
                {bar('80%')}
            </span>
        </>,
        // Estado de cuenta
        <>
            {head}
            <Kpis colors={[R, G, B]} />
            <span style={{ display: 'flex', gap: 5 }}>
                <span style={box({ width: 60, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                    <span style={{ width: 36, height: 36, borderRadius: 99, background: `conic-gradient(${G} 0 60%, ${A} 60% 85%, ${R} 85% 100%)`, WebkitMask: 'radial-gradient(circle, transparent 10px, #000 11px)', mask: 'radial-gradient(circle, transparent 10px, #000 11px)' }} />
                </span>
                <span style={box({ flex: 1, height: 52, padding: 6, display: 'flex', alignItems: 'flex-end', gap: 4 })}>
                    {[22, 30, 18, 36, 26, 40].map((h, k) => (
                        <span key={k} style={{ flex: 1, height: h, borderRadius: 2, background: k === 5 ? P : primary(0.35) }} />
                    ))}
                </span>
            </span>
            <Rows n={3} chip={[A, G, G]} />
        </>,
        // Seguimiento de proyecto
        <>
            {head}
            <Stages n={5} done={3} c={V} />
            <span style={{ display: 'flex', gap: 5 }}>
                <span style={box({ width: 60, height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                    <span style={{ width: 34, height: 34, borderRadius: 99, background: `conic-gradient(${V} 0 68%, ${C.muted} 68% 100%)`, WebkitMask: 'radial-gradient(circle, transparent 11px, #000 12px)', mask: 'radial-gradient(circle, transparent 11px, #000 12px)' }} />
                </span>
                <span style={box({ flex: 1, height: 50, padding: 6, display: 'flex', flexDirection: 'column', gap: 5 })}>
                    {bar('50%')}
                    {bar('70%', V, 9)}
                    {bar('40%')}
                </span>
            </span>
            <Board colors={[C.mutedFg, B, V]} />
        </>,
        // Mis solicitudes
        <>
            {head}
            <span style={{ padding: 6, borderRadius: 7, background: C.muted }}>
                <Kpis colors={[R, G, B]} />
            </span>
            <Board colors={[R, A, G]} />
            <span style={box({ height: 24, padding: 6, display: 'flex', alignItems: 'center', gap: 6 })}>
                {bar('50%')}
                <span style={{ marginLeft: 'auto', width: 40, height: 12, borderRadius: 4, background: P }} />
            </span>
        </>,
        // Mi pedido
        <>
            {head}
            <Stages n={4} done={2} c={A} />
            <span style={{ display: 'flex', gap: 5 }}>
                <span style={box({ flex: 1, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 })}>
                    {bar('50%')}
                    {bar('70%', C.fg, 8)}
                </span>
                <span style={box({ flex: 1, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 })}>
                    {bar('50%')}
                    {bar('60%', A, 8)}
                </span>
            </span>
            <Rows n={4} />
        </>,
    ];
    return <>{blocks[i]}</>;
}

export default function PortalTemplates(): JSX.Element {
    return (
        <Stage label="La galería de plantillas del portal: Mi cuenta, Estado de cuenta, Seguimiento de proyecto, Mis solicitudes y Mi pedido, cada una con su vista previa." tint="violet">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                <At
                    x={18}
                    y={22}
                    w={444}
                    h={256}
                    style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: '0 16px 38px -18px rgba(15,23,42,.5)', overflow: 'hidden' }}
                >
                    <div style={{ padding: '9px 12px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={9.5} weight={800}>
                            Plantillas del portal del cliente
                        </T>
                    </div>
                    {/* Lista de plantillas */}
                    <At x={8} y={40} w={186} h={176}>
                        <At x={0} y={0} w={186} h={30} a="ptp-sel" style={{ borderRadius: 8, background: primary(0.1), boxShadow: `inset 0 0 0 1.5px ${primary(0.5)}`, transform: 'translateY(136px)' }} />
                        {TPL.map((tp, i) => (
                            <At key={tp.name} x={6} y={i * 34 + 4} w={176} h={22} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                <span style={{ width: 22, height: 22, borderRadius: 6, background: tone(tp.t), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{tp.icon}</span>
                                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <T size={8.5} weight={700}>
                                        {tp.name}
                                    </T>
                                    <T size={7} color={C.mutedFg}>
                                        {tp.desc}
                                    </T>
                                </span>
                            </At>
                        ))}
                    </At>
                    {/* Vista previa */}
                    <At x={206} y={40} w={226} h={206} style={{ borderRadius: 10, background: C.canvas, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                        {[0, 1, 2, 3, 4].map((i) => (
                            <At key={i} x={10} y={10} w={206} a={`ptp-v${i}`} style={{ opacity: i === 4 ? 1 : 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                                <Preview i={i} />
                            </At>
                        ))}
                    </At>
                    <At x={20} y={222} w={170} h={22} style={{ borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={8.5} weight={700} color={C.primaryFg}>
                            Usar esta plantilla
                        </T>
                    </At>
                </At>
            </At>
        </Stage>
    );
}
