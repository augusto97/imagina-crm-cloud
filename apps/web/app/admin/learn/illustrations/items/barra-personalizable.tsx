import { BarChart3, Bell, List, ListChecks, Lock, Menu, ScanLine, Search, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary } from '../kit';

/**
 * v0.1.347 — La barra de abajo del celular, personalizable. En el editor se
 * cambia «Mi trabajo» por «Tableros» y se sube la cantidad de 5 a 6 botones
 * (sumando «Escanear»); la barra del teléfono cambia al instante.
 */

// El editor: tarjeta en (20, 22).
const EX = 20;
const EY = 22;
const EW = 250;
const SEG_X = 14;
const SEG_Y = 50;
const SEG_W = 222;
const CELL = SEG_W / 4;
const ROW_Y = (i: number): number => 84 + i * 28;

// El teléfono: marco en (310, 10), pantalla interior de 140 × 270.
const PX = 310;
const PY = 10;
const TAB_Y = 232;

const CSS = `
@keyframes bp-a{0%,28%{opacity:1}32%,92%{opacity:0}96%,100%{opacity:1}}
@keyframes bp-b{0%,28%{opacity:0}32%,58%{opacity:1}62%,100%{opacity:0}}
@keyframes bp-c{0%,58%{opacity:0}62%,92%{opacity:1}96%,100%{opacity:0}}
@keyframes bp-ab{0%,28%{opacity:0}32%,92%{opacity:1}96%,100%{opacity:0}}
@keyframes bp-s5{0%,58%{opacity:1}62%,92%{opacity:0}96%,100%{opacity:1}}
@keyframes bp-cur{0%{transform:translate(300px,290px);opacity:0}8%{opacity:1}22%,28%{transform:translate(${EX + EW - 24}px,${EY + ROW_Y(1) + 13}px)}50%,58%{transform:translate(${EX + SEG_X + 3 * CELL + CELL / 2}px,${EY + SEG_Y + 11}px)}90%{opacity:1}100%{opacity:0;transform:translate(${EX + SEG_X + 3 * CELL + CELL / 2}px,${EY + SEG_Y + 11}px)}}
@keyframes bp-ring{0%,26%{opacity:0;transform:scale(.4)}27%{opacity:1;transform:scale(1)}32%{opacity:0;transform:scale(1.7)}56%{opacity:0;transform:scale(.4)}57%{opacity:1;transform:scale(1)}62%,100%{opacity:0;transform:scale(1.7)}}
`;

type Tab = { icon: LucideIcon; label: string };

const BAR_A: Tab[] = [
    { icon: List, label: 'Listas' },
    { icon: ListChecks, label: 'Trabajo' },
    { icon: Search, label: 'Buscar' },
    { icon: Bell, label: 'Avisos' },
    { icon: Menu, label: 'Más' },
];
const BAR_B: Tab[] = [
    { icon: List, label: 'Listas' },
    { icon: BarChart3, label: 'Tableros' },
    { icon: Search, label: 'Buscar' },
    { icon: Bell, label: 'Avisos' },
    { icon: Menu, label: 'Más' },
];
const BAR_C: Tab[] = [
    { icon: List, label: 'Listas' },
    { icon: BarChart3, label: 'Tableros' },
    { icon: Search, label: 'Buscar' },
    { icon: Bell, label: 'Avisos' },
    { icon: ScanLine, label: 'Escanear' },
    { icon: Menu, label: 'Más' },
];

function TabBar({ tabs, a, visible }: { tabs: Tab[]; a: string; visible: boolean }): JSX.Element {
    const w = 140 / tabs.length;
    return (
        <At x={0} y={TAB_Y} w={140} h={38} a={a} style={{ display: 'flex', borderTop: `1px solid ${C.border}`, background: C.card, opacity: visible ? 1 : 0 }}>
            {tabs.map((tab, i) => {
                const Icon = tab.icon;
                const on = i === 0;
                return (
                    <span key={tab.label} style={{ position: 'relative', width: w, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                        {on && <span style={{ position: 'absolute', top: 5, width: 20, height: 13, borderRadius: 99, background: primary(0.14) }} />}
                        <span style={{ position: 'relative', display: 'flex' }}>
                            <Icon size={10} color={on ? primary() : C.mutedFg} />
                        </span>
                        <T size={4.8} weight={600} color={C.mutedFg}>
                            {tab.label}
                        </T>
                    </span>
                );
            })}
        </At>
    );
}

function Row({ i, icon: Icon, label, a, hidden, fixed }: { i: number; icon: LucideIcon; label: string; a?: string; hidden?: boolean; fixed?: boolean }): JSX.Element {
    return (
        <At
            x={14}
            y={ROW_Y(i)}
            w={EW - 28}
            h={24}
            a={a}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 6px',
                borderRadius: 7,
                background: fixed ? C.muted : C.card,
                border: `1px solid ${C.border}`,
                opacity: hidden ? 0 : 1,
            }}
        >
            <T size={6} color={C.mutedFg} style={{ width: 7, textAlign: 'center' }}>
                {i + 1}
            </T>
            <span style={{ width: 14, height: 14, borderRadius: 4, background: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={8} color={C.fg} />
            </span>
            <T size={7.4} style={{ flex: 1 }}>
                {label}
            </T>
            {fixed ? <Lock size={8} color={C.mutedFg} /> : <X size={8} color={C.mutedFg} />}
        </At>
    );
}

export default function BarraPersonalizable(): JSX.Element {
    return (
        <Stage
            label="El editor de la barra de abajo: se cambia «Mi trabajo» por «Tableros» y se sube la cantidad de botones de 5 a 6, sumando «Escanear». La barra del teléfono, a la derecha, cambia al instante."
            tint="cyan"
            cycle={10}
        >
            <Keyframes css={CSS} />

            {/* El editor */}
            <At x={EX} y={EY} w={EW} h={258} style={{ borderRadius: 14, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 18px 36px -22px rgba(15,23,42,.5)' }}>
                <At x={14} y={8}>
                    <T size={9.5} weight={700}>
                        Barra de abajo
                    </T>
                </At>
                <At x={14} y={30}>
                    <T size={6.4} weight={700} color={C.mutedFg}>
                        Cantidad de botones
                    </T>
                </At>
                <At x={SEG_X} y={SEG_Y} w={SEG_W} h={22} style={{ borderRadius: 7, background: C.muted }} />
                <At x={SEG_X + 2 * CELL + 2} y={SEG_Y + 2} w={CELL - 4} h={18} a="bp-s5" style={{ borderRadius: 5, background: C.card, boxShadow: '0 1px 2px rgba(15,23,42,.18)' }} />
                <At x={SEG_X + 3 * CELL + 2} y={SEG_Y + 2} w={CELL - 4} h={18} a="bp-c" style={{ borderRadius: 5, background: C.card, boxShadow: '0 1px 2px rgba(15,23,42,.18)', opacity: 0 }} />
                {[3, 4, 5, 6].map((n, i) => (
                    <At key={n} x={SEG_X + i * CELL} y={SEG_Y} w={CELL} h={22} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={7.6} weight={600}>
                            {n}
                        </T>
                    </At>
                ))}

                <Row i={0} icon={List} label="Listas" />
                <Row i={1} icon={ListChecks} label="Mi trabajo" a="bp-a" />
                <Row i={1} icon={BarChart3} label="Tableros" a="bp-ab" hidden />
                <Row i={2} icon={Search} label="Buscar" />
                <Row i={3} icon={Bell} label="Avisos" />
                {/* «Más»: fija al final; con 6 botones baja un lugar. */}
                <Row i={4} icon={Menu} label="Más" fixed a="bp-s5" />
                <Row i={4} icon={ScanLine} label="Escanear" a="bp-c" hidden />
                <Row i={5} icon={Menu} label="Más" fixed a="bp-c" hidden />
            </At>

            {/* El teléfono */}
            <At x={PX} y={PY} w={150} h={280} style={{ borderRadius: 24, background: C.card, border: `5px solid ${C.fg}`, boxShadow: '0 22px 44px -20px rgba(15,23,42,.6)', overflow: 'hidden' }}>
                <At x={0} y={0} w={140} h={26} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ width: 12, height: 12, borderRadius: 4, background: primary() }} />
                    <T size={7.6} weight={700}>
                        Café Aurora
                    </T>
                </At>
                <At x={9} y={36}>
                    <T size={9} weight={700}>
                        Listas
                    </T>
                </At>
                {[56, 84, 112, 140].map((y) => (
                    <At key={y} x={8} y={y} w={124} h={22} style={{ borderRadius: 7, background: C.card, border: `1px solid ${C.border}` }} />
                ))}
                <TabBar tabs={BAR_A} a="bp-a" visible />
                <TabBar tabs={BAR_B} a="bp-b" visible={false} />
                <TabBar tabs={BAR_C} a="bp-c" visible={false} />
            </At>

            <Cursor a="bp-cur" click="bp-ring" rest={[EX + SEG_X + 3 * CELL + CELL / 2, EY + SEG_Y + 11]} />
        </Stage>
    );
}
