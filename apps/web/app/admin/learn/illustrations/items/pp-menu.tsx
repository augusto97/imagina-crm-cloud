import { BarChart3, Bot, Folder, GraduationCap, LayoutDashboard, List, ListChecks, Pin, Settings, Sparkles } from 'lucide-react';

import { At, Bar, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * El menú de la app: el riel de la izquierda cambia de sección (Listas, Mi
 * trabajo, Favoritos, Tableros) y el panel de al lado muestra lo de esa
 * sección; el área de trabajo, a la derecha, también.
 */

const CSS = `
@keyframes mn-hl{0%,20%{transform:translateY(0)}23%,43%{transform:translateY(31px)}46%,66%{transform:translateY(62px)}69%,92%{transform:translateY(93px)}97%,100%{transform:translateY(0)}}
@keyframes mn-s1{0%,20%{opacity:1}23%,93%{opacity:0}97%,100%{opacity:1}}
@keyframes mn-s2{0%,20%{opacity:0}23%,43%{opacity:1}46%,100%{opacity:0}}
@keyframes mn-s3{0%,43%{opacity:0}46%,66%{opacity:1}69%,100%{opacity:0}}
@keyframes mn-s4{0%,66%{opacity:0}69%,92%{opacity:1}96%,100%{opacity:0}}
@keyframes mn-cur{0%{transform:translate(70px,250px);opacity:0}6%{opacity:1}12%,16%{transform:translate(51px,62px)}21%,40%{transform:translate(51px,93px)}44%,63%{transform:translate(51px,124px)}67%,88%{transform:translate(51px,155px);opacity:1}94%,100%{transform:translate(70px,250px);opacity:0}}
@keyframes mn-ring{0%,20%{opacity:0;transform:scale(.4)}22%{opacity:1;transform:scale(1)}26%{opacity:0;transform:scale(1.6)}43%{opacity:0;transform:scale(.4)}45%{opacity:1;transform:scale(1)}49%{opacity:0;transform:scale(1.6)}66%{opacity:0;transform:scale(.4)}68%{opacity:1;transform:scale(1)}72%,100%{opacity:0;transform:scale(1.6)}}
`;

const RAIL = [
    { label: 'Listas', icon: List },
    { label: 'Mi trabajo', icon: ListChecks },
    { label: 'Favoritos', icon: Pin },
    { label: 'Tableros', icon: BarChart3 },
    { label: 'Agentes', icon: Bot },
    { label: 'Aprende', icon: GraduationCap },
    { label: 'Ajustes', icon: Settings },
];

const PANEL_X = 84;
const PANEL_W = 150;
const MAIN_X = 242;

function Caps({ children }: { children: string }): JSX.Element {
    return (
        <div style={{ display: 'flex', padding: '8px 10px 3px' }}>
            <T size={7} weight={700} color={C.mutedFg} style={{ letterSpacing: '.08em' }}>
                {children}
            </T>
        </div>
    );
}

function Item({ dot, label, active, right, indent = 0 }: { dot: string; label: string; active?: boolean; right?: JSX.Element; indent?: number }): JSX.Element {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 20,
                margin: '0 6px',
                padding: `0 6px 0 ${6 + indent}px`,
                borderRadius: 6,
                background: active ? C.card : 'transparent',
                boxShadow: active ? `0 0 0 1px ${C.border}` : 'none',
            }}
        >
            <span style={{ width: 9, height: 9, borderRadius: 3, background: dot, flexShrink: 0 }} />
            <T size={8.5} weight={active ? 650 : 500} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {label}
            </T>
            {right}
        </div>
    );
}

function Section({ a, base, title, children, main }: { a: string; base: number; title: string; children: JSX.Element; main: JSX.Element }): JSX.Element {
    return (
        <>
            <At x={PANEL_X} y={14} w={PANEL_W} h={272} a={a} style={{ opacity: base }}>
                <div style={{ display: 'flex', alignItems: 'center', height: 30, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={10} weight={700}>
                        {title}
                    </T>
                </div>
                {children}
            </At>
            <At x={MAIN_X} y={14} w={224} h={272} a={a} style={{ opacity: base }}>
                {main}
            </At>
        </>
    );
}

const dueChip = (label: string, t: 'rose' | 'amber' | 'blue'): JSX.Element => (
    <span style={{ fontSize: 7.5, fontWeight: 700, color: tone(t), background: tone(t, 0.14), borderRadius: 99, padding: '1px 5px', whiteSpace: 'nowrap' }}>{label}</span>
);

export default function PpMenu(): JSX.Element {
    return (
        <Stage label="El riel del menú cambia de sección —Listas, Mi trabajo, Favoritos y Tableros— y el panel de al lado muestra el contenido de cada una." tint="cyan">
            <Keyframes css={CSS} />
            {/* Riel */}
            <At x={14} y={14} w={64} h={272} style={{ background: primary(), borderRadius: 12, boxShadow: '0 12px 28px -16px rgba(15,23,42,.6)' }}>
                <span style={{ position: 'absolute', left: 17, top: 10, width: 30, height: 30, borderRadius: 8, background: 'rgba(255,255,255,.16)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Sparkles size={14} />
                </span>
                <At x={6} y={46} w={52} h={29} a="mn-hl" style={{ borderRadius: 8, background: 'rgba(255,255,255,.2)' }} />
                {RAIL.map((r, i) => {
                    const Icon = r.icon;
                    return (
                        <At key={r.label} x={0} y={46 + i * 31} w={64} h={29} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: '#fff' }}>
                            <Icon size={12} />
                            <T size={6.5} weight={600} color="rgba(255,255,255,.92)">
                                {r.label}
                            </T>
                        </At>
                    );
                })}
            </At>
            {/* Fondo del panel y del área de trabajo */}
            <At x={PANEL_X} y={14} w={PANEL_W} h={272} style={{ background: C.muted, borderRadius: 12, border: `1px solid ${C.border}` }} />
            <At x={MAIN_X} y={14} w={224} h={272} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -18px rgba(15,23,42,.45)' }} />

            <Section
                a="mn-s1"
                base={1}
                title="Café Aurora"
                main={
                    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <T size={11} weight={700}>
                            Clientes
                        </T>
                        {['Café Bahía', 'Clínica Norte', 'Hotel Brisas', 'Óptica Visión', 'Ferretería Sol', 'Colegio Andino'].map((n, i) => (
                            <div key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 22, borderBottom: `1px solid ${C.border}` }}>
                                <T size={8.5} weight={600}>
                                    {n}
                                </T>
                                <Bar w={40 + ((i * 13) % 30)} h={5} />
                            </div>
                        ))}
                    </div>
                }
            >
                <div>
                    <Caps>RECIENTES</Caps>
                    <Item dot={tone('blue')} label="Clientes" />
                    <Caps>ESPACIO DE TRABAJO</Caps>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 20, margin: '0 6px', padding: '0 6px' }}>
                        <span style={{ width: 12, height: 12, borderRadius: 3, background: tone('violet'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Folder size={8} />
                        </span>
                        <T size={8.5} weight={650}>
                            Ventas
                        </T>
                    </div>
                    <Item dot={tone('violet')} label="Oportunidades" indent={10} />
                    <Item dot={tone('blue')} label="Clientes" indent={10} active />
                    <Item dot={tone('mint')} label="Facturas" />
                    <Item dot={tone('amber')} label="Tareas" />
                    <Item dot={tone('rose')} label="Tickets" />
                </div>
            </Section>

            <Section
                a="mn-s2"
                base={0}
                title="Mi trabajo"
                main={
                    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <T size={11} weight={700}>
                            Asignado a mí
                        </T>
                        {[
                            ['Vencido', 'rose', ['Llamar a Clínica Norte']],
                            ['Hoy', 'amber', ['Enviar cotización', 'Revisar contrato']],
                            ['Próximos 7 días', 'blue', ['Visita a Hotel Brisas']],
                        ].map(([g, t, items]) => (
                            <div key={g as string} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <T size={8} weight={700} color={tone(t as 'rose')}>
                                    {g as string}
                                </T>
                                {(items as string[]).map((it) => (
                                    <div key={it} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 20, padding: '0 7px', borderRadius: 6, border: `1px solid ${C.border}` }}>
                                        <span style={{ width: 9, height: 9, borderRadius: 99, border: `1.5px solid ${C.mutedFg}` }} />
                                        <T size={8.5} weight={600}>
                                            {it}
                                        </T>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                }
            >
                <div>
                    <div style={{ display: 'flex', gap: 5, padding: '8px 8px 2px' }}>
                        {[
                            ['2', 'Vencido', 'rose'],
                            ['3', 'Hoy', 'amber'],
                            ['5', 'Semana', 'blue'],
                        ].map(([n, l, t]) => (
                            <div key={l} style={{ flex: 1, borderRadius: 7, background: C.card, border: `1px solid ${C.border}`, padding: '4px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <T size={11} weight={800} color={tone(t as 'rose')}>
                                    {n}
                                </T>
                                <T size={6.5} color={C.mutedFg}>
                                    {l}
                                </T>
                            </div>
                        ))}
                    </div>
                    <Caps>LO MÁS URGENTE</Caps>
                    <Item dot={tone('rose')} label="Llamar a Clínica…" right={dueChip('Vencido', 'rose')} />
                    <Item dot={tone('amber')} label="Enviar cotización" right={dueChip('Hoy', 'amber')} />
                    <Item dot={tone('amber')} label="Revisar contrato" right={dueChip('Hoy', 'amber')} />
                    <Caps>RECORDATORIOS (2)</Caps>
                    <Item dot={tone('violet')} label="Pagar proveedor" />
                </div>
            </Section>

            <Section
                a="mn-s3"
                base={0}
                title="Favoritos"
                main={
                    <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {[
                            ['Oportunidades', 'violet'],
                            ['Facturas', 'mint'],
                            ['Ventas del mes', 'blue'],
                            ['Por etapa', 'amber'],
                        ].map(([n, t]) => (
                            <div key={n} style={{ height: 52, borderRadius: 8, border: `1px solid ${C.border}`, padding: 8, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                <span style={{ width: 16, height: 16, borderRadius: 5, background: tone(t as 'mint') }} />
                                <T size={8.5} weight={650}>
                                    {n}
                                </T>
                            </div>
                        ))}
                    </div>
                }
            >
                <div>
                    <Caps>LISTAS</Caps>
                    <Item dot={tone('violet')} label="Oportunidades" right={<Pin size={8} color={C.mutedFg} />} />
                    <Item dot={tone('mint')} label="Facturas" right={<Pin size={8} color={C.mutedFg} />} />
                    <Caps>DASHBOARDS</Caps>
                    <Item dot={tone('blue')} label="Ventas del mes" right={<Pin size={8} color={C.mutedFg} />} />
                    <Caps>VISTAS</Caps>
                    <Item dot={tone('amber')} label="Por etapa" right={<Pin size={8} color={C.mutedFg} />} />
                </div>
            </Section>

            <Section
                a="mn-s4"
                base={0}
                title="Tableros"
                main={
                    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <T size={11} weight={700}>
                            Ventas del mes
                        </T>
                        <div style={{ display: 'flex', gap: 6 }}>
                            {['$ 48 M', '126', '92 %'].map((k) => (
                                <div key={k} style={{ flex: 1, borderRadius: 7, border: `1px solid ${C.border}`, padding: '6px 7px' }}>
                                    <T size={11} weight={800}>
                                        {k}
                                    </T>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9, height: 120, padding: '0 6px', borderBottom: `1px solid ${C.border}` }}>
                            {[0.4, 0.65, 0.5, 0.85, 0.7, 0.95].map((h, i) => (
                                <span key={i} style={{ flex: 1, height: `${h * 100}%`, borderRadius: '3px 3px 0 0', background: i === 5 ? primary() : tone('blue', 0.45) }} />
                            ))}
                        </div>
                    </div>
                }
            >
                <div>
                    <div style={{ padding: '8px 0 0' }}>
                        <Item dot={C.mutedFg} label="Todos los dashboards" />
                    </div>
                    <Caps>TUS DASHBOARDS</Caps>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {[
                            ['Ventas del mes', 'blue', true],
                            ['Cartera y cobros', 'mint', false],
                            ['Soporte', 'rose', false],
                        ].map(([n, t, act]) => (
                            <div key={n as string} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 20, margin: '0 6px', padding: '0 6px', borderRadius: 6, background: act ? C.card : 'transparent', boxShadow: act ? `0 0 0 1px ${C.border}` : 'none' }}>
                                <LayoutDashboard size={9} color={tone(t as 'blue')} />
                                <T size={8.5} weight={act ? 650 : 500}>
                                    {n as string}
                                </T>
                            </div>
                        ))}
                    </div>
                </div>
            </Section>

            <Cursor a="mn-cur" click="mn-ring" rest={[70, 250]} />
        </Stage>
    );
}
