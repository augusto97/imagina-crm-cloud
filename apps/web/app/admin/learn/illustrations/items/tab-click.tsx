import { ArrowRight, Filter, X } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, Chip, tone } from '../kit';

/**
 * Del número al detalle: un clic en una porción de la dona abre la lista ya
 * filtrada por ese valor, con los registros que la forman.
 */

type Tn = 'cyan' | 'mint' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';

const SLICES: Array<{ label: string; t: Tn; len: number; off: number; n: number }> = [
    { label: 'Web', t: 'cyan', len: 62, off: 0, n: 6 },
    { label: 'Referido', t: 'amber', len: 48, off: -62, n: 5 },
    { label: 'Feria', t: 'mint', len: 33, off: -110, n: 3 },
    { label: 'Redes', t: 'violet', len: 20, off: -143, n: 2 },
];

const rowKeys = [0, 1, 2, 3]
    .map((i) => `@keyframes tk-row${i}{0%,${50 + i * 4}%{opacity:0;transform:translateY(5px)}${56 + i * 4}%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}`)
    .join('\n');

const CSS = `
${rowKeys}
@keyframes tk-pulse{0%,26%{stroke-width:12}30%,34%{stroke-width:16}40%,100%{stroke-width:12}}
@keyframes tk-tip{0%,18%{opacity:0;transform:translateY(4px)}22%,34%{opacity:1;transform:translateY(0)}38%,100%{opacity:0;transform:translateY(0)}}
@keyframes tk-list{0%,36%{opacity:0;transform:translateX(24px)}46%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}
@keyframes tk-arrow{0%,34%{opacity:0;transform:translateX(-6px)}40%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}
@keyframes tk-cursor{0%,4%{transform:translate(240px,270px);opacity:0}10%{opacity:1}22%,34%{transform:translate(150px,140px);opacity:1}46%,88%{transform:translate(380px,150px);opacity:1}94%,100%{transform:translate(380px,150px);opacity:0}}
@keyframes tk-ring{0%,28%{opacity:0;transform:scale(.4)}30%{opacity:1;transform:scale(1)}34%,100%{opacity:0;transform:scale(1.6)}}
`;

const ROWS: Array<[string, string, Tn, string]> = [
    ['Proyecto web · Café Bahía', 'Propuesta', 'violet', '$ 3,6 M'],
    ['Plan anual · Óptica Visión', 'Nuevo', 'cyan', '$ 2,1 M'],
    ['Consultoría · Gimnasio Fénix', 'Ganado', 'mint', '$ 4,8 M'],
    ['Mantenimiento · Hotel Brisas', 'Contactado', 'blue', '$ 1,2 M'],
];

export default function TabClick(): JSX.Element {
    return (
        <Stage label="Un clic en la porción «Web» de la dona abre la lista de oportunidades ya filtrada por ese origen, con los registros que forman el número." tint="amber">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <Win x={12} y={30} w={196} h={240} title="Tablero · Ventas">
                    <At x={12} y={10}>
                        <T size={9} weight={700} style={{ display: 'block' }}>
                            Por origen
                        </T>
                        <T size={7} color={C.mutedFg} style={{ display: 'block', marginTop: 1 }}>
                            Conteo · Oportunidades
                        </T>
                    </At>
                    <At x={34} y={40} w={124} h={124}>
                        <svg width="124" height="124" viewBox="0 0 66 66" style={{ transform: 'rotate(-90deg)' }}>
                            {SLICES.map((s, i) => (
                                <circle
                                    key={s.label}
                                    cx="33"
                                    cy="33"
                                    r="26"
                                    fill="none"
                                    stroke={tone(s.t)}
                                    strokeWidth="12"
                                    strokeDasharray={`${s.len - 1} 163`}
                                    strokeDashoffset={s.off}
                                    data-a={i === 0 ? '' : undefined}
                                    style={i === 0 ? { animationName: 'tk-pulse' } : undefined}
                                />
                            ))}
                        </svg>
                        <span style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                            <T size={15} weight={800}>
                                16
                            </T>
                            <T size={6} weight={700} color={C.mutedFg} style={{ letterSpacing: '.08em' }}>
                                TOTAL
                            </T>
                        </span>
                    </At>
                    <At x={14} y={176} w={168} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                        {SLICES.map((s) => (
                            <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ width: 7, height: 7, borderRadius: 2, background: tone(s.t) }} />
                                <T size={7.5} color={C.mutedFg}>
                                    {s.label}
                                </T>
                                <T size={7.5} weight={700}>
                                    {s.n}
                                </T>
                            </span>
                        ))}
                    </At>
                </Win>
                {/* Globo al pasar el mouse */}
                <At
                    x={160}
                    y={112}
                    a="tk-tip"
                    style={{ opacity: 0, zIndex: 6, background: C.fg, borderRadius: 6, padding: '4px 7px', boxShadow: '0 8px 18px -8px rgba(15,23,42,.5)' }}
                >
                    <T size={8} weight={700} color={C.card}>
                        Web · 6 (38 %)
                    </T>
                </At>

                <At x={214} y={140} a="tk-arrow" style={{ color: C.mutedFg }}>
                    <ArrowRight size={18} />
                </At>

                <Win x={238} y={30} w={230} h={240} title="Oportunidades" a="tk-list">
                    <At x={10} y={9} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                height: 18,
                                padding: '0 7px',
                                borderRadius: 99,
                                background: tone('cyan', 0.14),
                                border: `1px solid ${tone('cyan', 0.45)}`,
                            }}
                        >
                            <Filter size={9} color={tone('cyan')} />
                            <T size={8} weight={700} color={tone('cyan')}>
                                Origen es Web
                            </T>
                            <X size={9} color={tone('cyan')} />
                        </span>
                        <T size={7.5} color={C.mutedFg}>
                            6 registros
                        </T>
                    </At>
                    <At x={10} y={36} w={208} style={{ display: 'flex', flexDirection: 'column' }}>
                        {ROWS.map(([name, st, t, v], i) => (
                            <div
                                key={name}
                                data-a=""
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 4,
                                    padding: '7px 2px',
                                    borderBottom: `1px solid ${C.border}`,
                                    animationName: `tk-row${i}`,
                                }}
                            >
                                <T size={8.5} weight={600}>
                                    {name}
                                </T>
                                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <Chip label={st} t={t} />
                                    <T size={8} weight={700} color={C.mutedFg}>
                                        {v}
                                    </T>
                                </span>
                            </div>
                        ))}
                    </At>
                </Win>
                <Cursor a="tk-cursor" click="tk-ring" rest={[380, 150]} />
            </div>
        </Stage>
    );
}
