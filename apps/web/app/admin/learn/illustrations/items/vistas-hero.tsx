import type { ReactNode } from 'react';
import { CalendarDays, ChartGantt, KanbanSquare, Table } from 'lucide-react';

import { At, C, Chip, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** Una lista, cuatro vistas: los mismos cuatro registros como tabla, tablero, calendario y Gantt. */

const CSS = `
@keyframes vh-s0{0%,21%{opacity:1;transform:translateY(0)}25%,94%{opacity:0;transform:translateY(6px)}98%,100%{opacity:1;transform:translateY(0)}}
@keyframes vh-s1{0%,22%{opacity:0;transform:translateY(6px)}27%,46%{opacity:1;transform:translateY(0)}50%,100%{opacity:0;transform:translateY(6px)}}
@keyframes vh-s2{0%,47%{opacity:0;transform:translateY(6px)}52%,71%{opacity:1;transform:translateY(0)}75%,100%{opacity:0;transform:translateY(6px)}}
@keyframes vh-s3{0%,72%{opacity:0;transform:translateY(6px)}77%,92%{opacity:1;transform:translateY(0)}96%,100%{opacity:0;transform:translateY(6px)}}
@keyframes vh-ink{0%,22%{transform:translateX(0);width:62px}27%,47%{transform:translateX(70px);width:70px}52%,72%{transform:translateX(148px);width:84px}77%,93%{transform:translateX(240px);width:62px}98%,100%{transform:translateX(0);width:62px}}
@keyframes vh-t0{0%,22%{color:${C.fg}}25%,95%{color:${C.mutedFg}}98%,100%{color:${C.fg}}}
@keyframes vh-t1{0%,24%{color:${C.mutedFg}}27%,47%{color:${C.fg}}50%,100%{color:${C.mutedFg}}}
@keyframes vh-t2{0%,49%{color:${C.mutedFg}}52%,72%{color:${C.fg}}75%,100%{color:${C.mutedFg}}}
@keyframes vh-t3{0%,74%{color:${C.mutedFg}}77%,93%{color:${C.fg}}96%,100%{color:${C.mutedFg}}}
`;

type Tn = 'violet' | 'amber' | 'mint' | 'blue';
const REC: Array<{ name: string; t: Tn; state: string; st: 'slate' | 'blue' | 'mint'; who: string; day: number; from: number; len: number }> = [
    { name: 'Diseño del logo', t: 'violet', state: 'En curso', st: 'blue', who: 'Ana', day: 1, from: 0, len: 3 },
    { name: 'Sesión de fotos', t: 'amber', state: 'Pendiente', st: 'slate', who: 'Juan', day: 3, from: 2, len: 2 },
    { name: 'Sitio web nuevo', t: 'mint', state: 'En curso', st: 'blue', who: 'Luis', day: 4, from: 3, len: 4 },
    { name: 'Campaña de redes', t: 'blue', state: 'Hecha', st: 'mint', who: 'Ana', day: 0, from: 5, len: 2 },
];

const TABS = [
    { label: 'Tabla', icon: <Table size={11} />, w: 62 },
    { label: 'Tablero', icon: <KanbanSquare size={11} />, w: 70 },
    { label: 'Calendario', icon: <CalendarDays size={11} />, w: 84 },
    { label: 'Gantt', icon: <ChartGantt size={11} />, w: 62 },
];

const Dot = ({ t }: { t: Tn }): JSX.Element => <span style={{ width: 8, height: 8, borderRadius: 3, background: tone(t), flexShrink: 0 }} />;

function Scene({ a, children }: { a: string; children: ReactNode }): JSX.Element {
    return (
        <At x={0} y={58} w={432} h={180} a={a} style={{ opacity: a === 'vh-s0' ? 1 : 0 }}>
            {children}
        </At>
    );
}

export default function VistasHero(): JSX.Element {
    return (
        <Stage label="Una lista de tareas que cambia de forma: los mismos cuatro registros se ven como tabla, como tablero por estado, en un calendario y en un Gantt." tint="violet">
            <Keyframes css={CSS} />
            <Win x={24} y={24} w={432} h={252} title="Tareas">
                {/* Pestañas de vistas */}
                <At x={12} y={8} w={410} h={26} style={{ display: 'flex', gap: 8, borderBottom: `1px solid ${C.border}` }}>
                    {TABS.map((tab, i) => (
                        <span
                            key={tab.label}
                            data-a=""
                            style={{
                                width: tab.w,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: 10,
                                fontWeight: 600,
                                color: i === 0 ? C.fg : C.mutedFg,
                                animationName: `vh-t${i}`,
                            }}
                        >
                            {tab.icon}
                            {tab.label}
                        </span>
                    ))}
                    <span style={{ display: 'flex', alignItems: 'center', fontSize: 10, color: C.mutedFg, fontWeight: 600 }}>+ Vista</span>
                </At>
                <At x={12} y={32} w={62} h={2} a="vh-ink" style={{ background: primary(), borderRadius: 2 }} />

                {/* 1 · Tabla */}
                <Scene a="vh-s0">
                    <div style={{ margin: '0 12px', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr .8fr', padding: '6px 10px', background: C.muted }}>
                            {['Tarea', 'Estado', 'Responsable'].map((h) => (
                                <T key={h} size={8.5} weight={700} color={C.mutedFg}>
                                    {h}
                                </T>
                            ))}
                        </div>
                        {REC.map((r) => (
                            <div key={r.name} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr .8fr', alignItems: 'center', padding: '0 10px', height: 32, borderTop: `1px solid ${C.border}` }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Dot t={r.t} />
                                    <T size={10} weight={600}>
                                        {r.name}
                                    </T>
                                </span>
                                <span>
                                    <Chip label={r.state} t={r.st} />
                                </span>
                                <T size={9.5} color={C.mutedFg}>
                                    {r.who}
                                </T>
                            </div>
                        ))}
                    </div>
                </Scene>

                {/* 2 · Tablero */}
                <Scene a="vh-s1">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, margin: '0 12px' }}>
                        {(['Pendiente', 'En curso', 'Hecha'] as const).map((col, i) => {
                            const t = (['slate', 'blue', 'mint'] as const)[i]!;
                            return (
                                <div key={col} style={{ background: tone(t, 0.08), borderTop: `3px solid ${tone(t)}`, borderRadius: 8, padding: 7, height: 170, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <Chip label={col} t={t} />
                                    {REC.filter((r) => r.state === col).map((r) => (
                                        <div key={r.name} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <Dot t={r.t} />
                                            <T size={9.5} weight={600}>
                                                {r.name}
                                            </T>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </Scene>

                {/* 3 · Calendario */}
                <Scene a="vh-s2">
                    <div style={{ margin: '0 12px', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', background: C.muted }}>
                            {['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE'].map((d) => (
                                <T key={d} size={8} weight={700} color={C.mutedFg} style={{ textAlign: 'center', padding: '5px 0' }}>
                                    {d}
                                </T>
                            ))}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
                            {[0, 1, 2, 3, 4].map((d) => (
                                <div key={d} style={{ height: 142, borderLeft: d ? `1px solid ${C.border}` : 'none', padding: 5, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <T size={8.5} weight={700} color={C.mutedFg}>
                                        {12 + d}
                                    </T>
                                    {REC.filter((r) => r.day === d).map((r) => (
                                        <span key={r.name} style={{ background: tone(r.t, 0.18), borderLeft: `3px solid ${tone(r.t)}`, borderRadius: 4, padding: '4px 5px', overflow: 'hidden', display: 'block', lineHeight: 1.2 }}>
                                            <T size={8} weight={600} style={{ whiteSpace: 'normal', display: 'block', lineHeight: 1.2 }}>
                                                {r.name}
                                            </T>
                                        </span>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </Scene>

                {/* 4 · Gantt */}
                <Scene a="vh-s3">
                    <div style={{ margin: '0 12px', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', position: 'relative', height: 170 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '110px repeat(8, 1fr)', background: C.muted, height: 22, alignItems: 'center' }}>
                            <T size={8.5} weight={700} color={C.mutedFg} style={{ paddingLeft: 8 }}>
                                Tarea
                            </T>
                            {[12, 13, 14, 15, 16, 17, 18, 19].map((d) => (
                                <T key={d} size={8} weight={700} color={C.mutedFg} style={{ textAlign: 'center' }}>
                                    {d}
                                </T>
                            ))}
                        </div>
                        {REC.map((r, i) => (
                            <div key={r.name} style={{ position: 'absolute', left: 0, right: 0, top: 22 + i * 36, height: 36, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center' }}>
                                <T size={9.5} weight={600} style={{ width: 110, paddingLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {r.name}
                                </T>
                                <span
                                    style={{
                                        position: 'absolute',
                                        left: 110 + r.from * 38.5 + 3,
                                        width: r.len * 38.5 - 6,
                                        height: 16,
                                        borderRadius: 5,
                                        background: tone(r.t),
                                        boxShadow: '0 2px 5px -2px rgba(15,23,42,.35)',
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                </Scene>
            </Win>
        </Stage>
    );
}
