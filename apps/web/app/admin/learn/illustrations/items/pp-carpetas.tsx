import type { CSSProperties } from 'react';

import { ChevronDown, ChevronRight, FilePlus2, Folder, FolderPlus, Plus, Receipt, Wallet } from 'lucide-react';

import { At, C, Cursor, IconSquare, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Carpetas: se arrastra la lista «Facturas» sobre la carpeta «Finanzas»; la
 * carpeta se abre con la lista adentro y la página de la carpeta, a la
 * derecha, suma su tarjeta.
 */

const CSS = `
@keyframes cp-drag{0%,14%{opacity:1;transform:translate(0,0);box-shadow:none}18%{transform:translate(2px,-3px);box-shadow:0 12px 24px -10px rgba(15,23,42,.45)}40%{transform:translate(4px,-22px);box-shadow:0 12px 24px -10px rgba(15,23,42,.45);opacity:1}46%,94%{transform:translate(4px,-22px) scale(.92);opacity:0}97%{transform:translate(0,0);opacity:0}100%{opacity:1;transform:translate(0,0)}}
@keyframes cp-in{0%,44%{opacity:0;transform:translateY(-4px)}50%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes cp-shift{0%,44%{transform:translateY(0)}50%,92%{transform:translateY(22px)}97%,100%{transform:translateY(0)}}
@keyframes cp-folder{0%,30%{box-shadow:inset 0 0 0 0 transparent;background:transparent}34%,46%{box-shadow:inset 0 0 0 2px ${primary(0.7)};background:${primary(0.1)}}52%,100%{box-shadow:inset 0 0 0 0 transparent;background:transparent}}
@keyframes cp-open{0%,44%{transform:rotate(0)}50%,92%{transform:rotate(90deg)}97%,100%{transform:rotate(0)}}
@keyframes cp-card{0%,48%{opacity:0;transform:scale(.85)}56%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes cp-one{0%,48%{opacity:1}54%,94%{opacity:0}98%,100%{opacity:1}}
@keyframes cp-two{0%,48%{opacity:0}54%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes cp-cur{0%{transform:translate(330px,260px);opacity:0}5%{opacity:1}11%,14%{transform:translate(110px,168px)}40%{transform:translate(114px,146px)}46%{transform:translate(114px,146px)}66%,88%{transform:translate(404px,128px);opacity:1}94%,100%{transform:translate(404px,128px);opacity:0}}
@keyframes cp-ring{0%,12%{opacity:0;transform:scale(.4)}14%{opacity:1;transform:scale(1)}18%{opacity:0;transform:scale(1.6)}42%{opacity:0;transform:scale(.4)}44%{opacity:1;transform:scale(1)}48%,100%{opacity:0;transform:scale(1.6)}}
`;

const PX = 18;
const PW = 196;

function Row({ y, label, dot, indent = 0, a, style }: { y: number; label: string; dot: string; indent?: number; a?: string; style?: CSSProperties }): JSX.Element {
    return (
        <At x={PX + 6} y={y} w={PW - 12} h={20} a={a} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: `0 8px 0 ${8 + indent}px`, borderRadius: 6, ...style }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: dot, flexShrink: 0 }} />
            <T size={9}>{label}</T>
        </At>
    );
}

function FolderHead({ y, label, t, open, a, count }: { y: number; label: string; t: 'violet' | 'amber'; open: boolean; a?: string; count: JSX.Element }): JSX.Element {
    return (
        <At x={PX + 6} y={y} w={PW - 12} h={20} a={a} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', borderRadius: 6 }}>
            <span data-a={open ? undefined : ''} style={{ display: 'flex', color: C.mutedFg, animationName: open ? undefined : 'cp-open', transform: open ? undefined : 'rotate(90deg)' }}>
                <ChevronRight size={10} />
            </span>
            <IconSquare t={t} size={14}>
                <Folder size={8} />
            </IconSquare>
            <T size={9} weight={650} style={{ flex: 1 }}>
                {label}
            </T>
            <span style={{ position: 'relative', width: 10, height: 12 }}>{count}</span>
        </At>
    );
}

export default function PpCarpetas(): JSX.Element {
    return (
        <Stage label="En el menú lateral se arrastra la lista Facturas sobre la carpeta Finanzas: la carpeta se abre con la lista adentro y su página suma la tarjeta de Facturas." tint="amber">
            <Keyframes css={CSS} />
            {/* Panel lateral */}
            <At x={PX} y={18} w={PW} h={264} style={{ background: C.muted, border: `1px solid ${C.border}`, borderRadius: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', height: 30, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={10.5} weight={700}>
                        Café Aurora
                    </T>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px 0' }}>
                    <T size={7.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.08em' }}>
                        ESPACIO DE TRABAJO
                    </T>
                    <span style={{ display: 'flex', gap: 6, color: C.mutedFg }}>
                        <Plus size={10} />
                        <FolderPlus size={10} />
                    </span>
                </div>
            </At>
            <At x={PX + 6} y={72} w={PW - 12} h={20} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px' }}>
                <span style={{ display: 'flex', color: C.mutedFg }}>
                    <ChevronDown size={10} />
                </span>
                <IconSquare t="violet" size={14}>
                    <Folder size={8} />
                </IconSquare>
                <T size={9} weight={650} style={{ flex: 1 }}>
                    Ventas
                </T>
                <T size={8} color={C.mutedFg}>
                    2
                </T>
            </At>
            <Row y={94} label="Oportunidades" dot={tone('violet')} indent={16} />
            <Row y={116} label="Clientes" dot={tone('blue')} indent={16} />
            <FolderHead y={138} label="Finanzas" t="amber" open={false} a="cp-folder" count={
                    <>
                        <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', opacity: 0, animationName: 'cp-one' }}>
                            <T size={8} color={C.mutedFg}>
                                1
                            </T>
                        </span>
                        <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', animationName: 'cp-two' }}>
                            <T size={8} color={C.mutedFg}>
                                2
                            </T>
                        </span>
                    </>
                }
            />
            {/* lo que aparece adentro de Finanzas al soltar */}
            <Row y={160} label="Gastos" dot={tone('amber')} indent={16} a="cp-in" />
            <Row y={182} label="Facturas" dot={tone('mint')} indent={16} a="cp-in" />
            {/* raíz: Tareas y Tickets bajan para hacer lugar */}
            <At x={0} y={0} a="cp-shift" style={{ transform: 'translateY(22px)' }}>
                <Row y={182} label="Tareas" dot={tone('amber')} />
                <Row y={204} label="Tickets" dot={tone('rose')} />
            </At>
            {/* la que se arrastra (antes, en la raíz) */}
            <Row y={160} label="Facturas" dot={tone('mint')} a="cp-drag" style={{ background: C.card, opacity: 0, zIndex: 4, boxShadow: `0 0 0 1px ${C.border}` }} />

            {/* Página de la carpeta */}
            <At x={232} y={18} w={232} h={264} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 14px 34px -20px rgba(15,23,42,.5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 14px 4px' }}>
                    <IconSquare t="amber" size={26}>
                        <Folder size={14} />
                    </IconSquare>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <T size={7.5} color={C.mutedFg}>
                            Listas › Finanzas
                        </T>
                        <T size={12} weight={700}>
                            Finanzas
                        </T>
                    </span>
                </div>
                <div style={{ position: 'relative', height: 16, margin: '2px 14px 8px' }}>
                    <At x={0} y={0} a="cp-one" style={{ opacity: 0 }}>
                        <T size={8.5} color={C.mutedFg}>
                            1 lista
                        </T>
                    </At>
                    <At x={0} y={0} a="cp-two">
                        <T size={8.5} color={C.mutedFg}>
                            2 listas · 1 actualizada esta semana
                        </T>
                    </At>
                </div>
                <div style={{ display: 'flex', gap: 8, padding: '0 14px' }}>
                    {[
                        { name: 'Gastos', icon: <Wallet size={11} />, t: 'amber' as const, a: undefined, n: '42 registros' },
                        { name: 'Facturas', icon: <Receipt size={11} />, t: 'mint' as const, a: 'cp-card', n: '128 registros' },
                    ].map((c) => (
                        <div key={c.name} data-a={c.a ? '' : undefined} style={{ flex: 1, height: 86, borderRadius: 10, border: `1px solid ${C.border}`, padding: 9, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', animationName: c.a }}>
                            <IconSquare t={c.t} size={22}>
                                {c.icon}
                            </IconSquare>
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <T size={9.5} weight={700}>
                                    {c.name}
                                </T>
                                <T size={8} color={C.mutedFg}>
                                    {c.n}
                                </T>
                            </span>
                        </div>
                    ))}
                </div>
                <div style={{ margin: '12px 14px 0', height: 30, borderRadius: 8, border: `1.5px dashed ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, color: C.mutedFg }}>
                    <FilePlus2 size={10} />
                    <T size={8.5} color={C.mutedFg}>
                        Nueva lista aquí
                    </T>
                </div>
            </At>
            <Cursor a="cp-cur" click="cp-ring" rest={[404, 128]} />
        </Stage>
    );
}
