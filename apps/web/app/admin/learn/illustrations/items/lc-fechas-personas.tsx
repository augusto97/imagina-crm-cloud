import { ChevronLeft, ChevronRight, FileText, Image } from 'lucide-react';

import { At, Avatar, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Fechas, personas, equipos y archivos en la tabla: una fecha vencida (en
 * rojo) se corrige con el calendario y a una tarea sin responsable se le
 * asigna una persona.
 */

const CSS = `
@keyframes fp-cal{0%,10%{opacity:0;transform:translateY(-4px)}14%,34%{opacity:1;transform:translateY(0)}38%,100%{opacity:0}}
@keyframes fp-day{0%,26%{background:transparent;color:${C.fg}}29%,100%{background:${primary()};color:${C.primaryFg}}}
@keyframes fp-old{0%,33%{opacity:1}36%,94%{opacity:0}98%,100%{opacity:1}}
@keyframes fp-new{0%,33%{opacity:0}36%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes fp-ppl{0%,46%{opacity:0;transform:translateY(-4px)}50%,66%{opacity:1;transform:translateY(0)}70%,100%{opacity:0}}
@keyframes fp-pick{0%,58%{background:transparent}61%,66%{background:${primary(0.14)}}}
@keyframes fp-empty{0%,66%{opacity:1}69%,94%{opacity:0}98%,100%{opacity:1}}
@keyframes fp-who{0%,66%{opacity:0;transform:scale(.5)}70%,94%{opacity:1;transform:scale(1)}98%,100%{opacity:0}}
@keyframes fp-cur{0%{transform:translate(300px,290px);opacity:0}5%{opacity:1}9%,12%{transform:translate(334px,84px)}24%,30%{transform:translate(397px,197px)}42%,48%{transform:translate(160px,130px)}58%,62%{transform:translate(186px,209px)}76%,88%{transform:translate(300px,270px);opacity:1}94%,100%{transform:translate(300px,270px);opacity:0}}
@keyframes fp-ring{0%,10%{opacity:0;transform:scale(.4)}12%{opacity:1;transform:scale(1)}16%{opacity:0;transform:scale(1.6)}27%{opacity:0;transform:scale(.4)}29%{opacity:1;transform:scale(1)}33%{opacity:0;transform:scale(1.6)}45%{opacity:0;transform:scale(.4)}47%{opacity:1;transform:scale(1)}51%{opacity:0;transform:scale(1.6)}59%{opacity:0;transform:scale(.4)}61%{opacity:1;transform:scale(1)}65%,100%{opacity:0;transform:scale(1.6)}}
`;

const COLS = [
    { label: 'Tarea', w: 128 },
    { label: 'Responsable', w: 84 },
    { label: 'Equipo', w: 72 },
    { label: 'Entrega', w: 76 },
    { label: 'Archivos', w: 70 },
];

function Cell({ w, children }: { w: number; children: JSX.Element }): JSX.Element {
    return <span style={{ width: w, display: 'flex', alignItems: 'center', position: 'relative', height: '100%' }}>{children}</span>;
}

function Team({ name, t }: { name: string; t: 'violet' | 'blue' }): JSX.Element {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 15, padding: '0 6px', borderRadius: 99, background: tone(t, 0.15), color: tone(t), fontSize: 7.5, fontWeight: 700 }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: tone(t) }} />
            {name}
        </span>
    );
}

function FileChip({ icon }: { icon: JSX.Element }): JSX.Element {
    return <span style={{ width: 18, height: 18, borderRadius: 4, border: `1px solid ${C.border}`, background: C.muted, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: C.mutedFg }}>{icon}</span>;
}

export default function LcFechasPersonas(): JSX.Element {
    const days = Array.from({ length: 31 }, (_, i) => i + 1);
    return (
        <Stage label="En la tabla de tareas, una fecha de entrega vencida aparece en rojo y se cambia con el calendario; a una tarea sin responsable se le asigna una persona desde la lista del equipo." tint="blue">
            <Keyframes css={CSS} />
            <At x={14} y={30} w={452} h={226} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 16px 36px -22px rgba(15,23,42,.5)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', height: 30, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                    {COLS.map((c) => (
                        <span key={c.label} style={{ width: c.w, display: 'flex' }}>
                            <T size={8.5} weight={600} color={C.mutedFg}>
                                {c.label}
                            </T>
                        </span>
                    ))}
                </div>
                {/* Fila 1 */}
                <div style={{ display: 'flex', alignItems: 'center', height: 48, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                    <Cell w={128}>
                        <T size={9} weight={600}>
                            Diseñar el menú nuevo
                        </T>
                    </Cell>
                    <Cell w={84}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Avatar initials="AG" t="violet" size={18} />
                            <T size={8}>Ana G.</T>
                        </span>
                    </Cell>
                    <Cell w={72}>
                        <Team name="Diseño" t="violet" />
                    </Cell>
                    <Cell w={76}>
                        <>
                            <span data-a="" style={{ position: 'absolute', left: 0, display: 'flex', animationName: 'fp-old', opacity: 0 }}>
                                <T size={8.5} weight={700} color={C.destructive}>
                                    20/10/2026
                                </T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', left: 0, display: 'flex', animationName: 'fp-new' }}>
                                <T size={8.5} weight={600}>
                                    30/10/2026
                                </T>
                            </span>
                        </>
                    </Cell>
                    <Cell w={70}>
                        <span style={{ display: 'flex', gap: 3 }}>
                            <FileChip icon={<Image size={10} />} />
                            <FileChip icon={<FileText size={10} />} />
                        </span>
                    </Cell>
                </div>
                {/* Fila 2 */}
                <div style={{ display: 'flex', alignItems: 'center', height: 48, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                    <Cell w={128}>
                        <T size={9} weight={600}>
                            Cotizar con proveedores
                        </T>
                    </Cell>
                    <Cell w={84}>
                        <>
                            <span data-a="" style={{ position: 'absolute', left: 0, display: 'flex', animationName: 'fp-empty', opacity: 0 }}>
                                <T size={9} color={C.mutedFg}>
                                    —
                                </T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', left: 0, display: 'flex', alignItems: 'center', gap: 4, animationName: 'fp-who' }}>
                                <Avatar initials="CR" t="blue" size={18} />
                                <T size={8}>Carlos R.</T>
                            </span>
                        </>
                    </Cell>
                    <Cell w={72}>
                        <Team name="Compras" t="blue" />
                    </Cell>
                    <Cell w={76}>
                        <T size={8.5} weight={600}>
                            04/11/2026
                        </T>
                    </Cell>
                    <Cell w={70}>
                        <FileChip icon={<FileText size={10} />} />
                    </Cell>
                </div>
                {/* Filas 3 y 4 */}
                {[
                    ['Capacitar al equipo', 'LM', 'Lucía M.', 'mint', 'Diseño', '12/11/2026'],
                    ['Renovar el dominio', 'JH', 'Jorge H.', 'amber', 'Compras', '28/11/2026'],
                ].map(([t, ini, nm, tn, tm, d]) => (
                    <div key={t} style={{ display: 'flex', alignItems: 'center', height: 48, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                        <Cell w={128}>
                            <T size={9} weight={600}>
                                {t}
                            </T>
                        </Cell>
                        <Cell w={84}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Avatar initials={ini!} t={tn as 'mint'} size={18} />
                                <T size={8}>{nm}</T>
                            </span>
                        </Cell>
                        <Cell w={72}>
                            <Team name={tm!} t={tm === 'Diseño' ? 'violet' : 'blue'} />
                        </Cell>
                        <Cell w={76}>
                            <T size={8.5} weight={600}>
                                {d}
                            </T>
                        </Cell>
                        <Cell w={70}>
                            <T size={9} color={C.mutedFg}>
                                —
                            </T>
                        </Cell>
                    </div>
                ))}
            </At>

            {/* Calendario */}
            <At x={296} y={92} w={160} a="fp-cal" style={{ opacity: 0, zIndex: 5, background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 18px 40px -14px rgba(15,23,42,.6)', padding: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <ChevronLeft size={10} color={C.mutedFg} />
                    <T size={8.5} weight={700}>
                        octubre 2026
                    </T>
                    <ChevronRight size={10} color={C.mutedFg} />
                </span>
                <span style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
                    {['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'].map((d) => (
                        <span key={d} style={{ fontSize: 6.5, color: C.mutedFg, textAlign: 'center' }}>
                            {d}
                        </span>
                    ))}
                    {[0, 0, 0].map((_, i) => (
                        <span key={`e${i}`} />
                    ))}
                    {days.map((d) => (
                        <span
                            key={d}
                            data-a={d === 30 ? '' : undefined}
                            style={{
                                fontSize: 7.5,
                                height: 15,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 4,
                                color: d === 20 ? C.destructive : C.fg,
                                fontWeight: d === 20 || d === 30 ? 700 : 500,
                                boxShadow: d === 27 ? `inset 0 0 0 1px ${primary(0.5)}` : 'none',
                                animationName: d === 30 ? 'fp-day' : undefined,
                            }}
                        >
                            {d}
                        </span>
                    ))}
                </span>
            </At>

            {/* Personas */}
            <At x={136} y={152} w={124} a="fp-ppl" style={{ opacity: 0, zIndex: 5, background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 18px 40px -14px rgba(15,23,42,.6)', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ height: 18, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 5px', marginBottom: 2 }}>
                    <T size={7} color={C.mutedFg}>
                        Buscar persona…
                    </T>
                </span>
                {[
                    ['AG', 'Ana Gómez', 'violet'],
                    ['CR', 'Carlos Ruiz', 'blue'],
                    ['LM', 'Lucía Martínez', 'mint'],
                ].map(([i, n, t]) => (
                    <span key={i} data-a={i === 'CR' ? '' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 5, height: 20, padding: '0 4px', borderRadius: 5, animationName: i === 'CR' ? 'fp-pick' : undefined }}>
                        <Avatar initials={i!} t={t as 'blue'} size={14} />
                        <T size={8}>{n}</T>
                    </span>
                ))}
            </At>
            <Cursor a="fp-cur" click="fp-ring" rest={[300, 270]} />
        </Stage>
    );
}
