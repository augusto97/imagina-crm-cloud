import { CalendarDays, DollarSign, History, ListChecks, RotateCcw, User } from 'lucide-react';

import { At, Avatar, C, Chip, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** El historial de un campo: quién cambió «Monto», de qué a qué, y «Restaurar» vuelve a poner el valor de ayer. */

const CSS = `
@keyframes fhi-icon{0%,6%{opacity:0}10%,100%{opacity:1}}
@keyframes fhi-pop{0%,16%{opacity:0;transform:translateX(-8px)}21%,93%{opacity:1;transform:translateX(0)}98%,100%{opacity:0}}
@keyframes fhi-old{0%,62%{opacity:1}65%,100%{opacity:0}}
@keyframes fhi-new{0%,62%{opacity:0}65%,94%{opacity:1}99%,100%{opacity:0}}
@keyframes fhi-flash{0%,62%{background:transparent}66%{background:${tone('mint', 0.28)}}80%,100%{background:transparent}}
@keyframes fhi-toast{0%,66%{opacity:0;transform:translateY(8px)}70%,93%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes fhi-cur{0%{transform:translate(120px,290px);opacity:0}4%{opacity:1}10%,15%{transform:translate(200px,137px)}30%{transform:translate(330px,200px)}52%,60%{transform:translate(418px,162px);opacity:1}76%,92%{transform:translate(440px,250px);opacity:1}97%,100%{opacity:0}}
@keyframes fhi-ring{0%,13%{opacity:0;transform:scale(.4)}14%{opacity:1;transform:scale(1)}17%,58%{opacity:0;transform:scale(1.6)}59%{opacity:1;transform:scale(1)}62%,100%{opacity:0;transform:scale(1.6)}}
`;

type Entry = { who: string; ini: string; t: 'violet' | 'amber' | 'cyan'; verb: string; when: string; from?: string; to: string; current?: boolean };
const ENTRIES: Entry[] = [
    { who: 'Juan Pérez', ini: 'JP', t: 'amber', verb: 'cambió', when: 'hace 10 min', from: '$ 4.200.000', to: '$ 4.500.000', current: true },
    { who: 'Ana Martínez', ini: 'AM', t: 'violet', verb: 'cambió', when: 'ayer', from: '$ 3.900.000', to: '$ 4.200.000' },
    { who: 'Laura Gómez', ini: 'LG', t: 'cyan', verb: 'lo estableció al crear el registro', when: '12/10', to: '$ 3.900.000' },
];

function Row({ icon, label, children, y }: { icon: JSX.Element; label: string; children: JSX.Element; y: number }): JSX.Element {
    return (
        <At x={10} y={y} w={180} h={28} style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ width: 74, display: 'flex', alignItems: 'center', gap: 4, color: C.mutedFg }}>
                {icon}
                <T size={8.5} color={C.mutedFg}>
                    {label}
                </T>
            </span>
            {children}
        </At>
    );
}

export default function FichaHistorial(): JSX.Element {
    return (
        <Stage label="En la ficha de una oportunidad, el botón de historial junto a «Monto» abre la lista de cambios: quién lo cambió, cuándo y de qué valor a cuál; al tocar «Restaurar» en el cambio de ayer, el monto vuelve a ese valor." tint="amber">
            <Keyframes css={CSS} />
            <Win x={14} y={30} w={204} h={232} title="Oportunidades / Hotel Brisas">
                <At x={10} y={10} style={{ display: 'flex' }}>
                    <T size={13} weight={800}>
                        Renovación 2027
                    </T>
                </At>
                <Row icon={<User size={9} />} label="Cliente" y={36}>
                    <T size={9} weight={600} color={primary()}>
                        Hotel Brisas
                    </T>
                </Row>
                <At x={6} y={64} w={188} h={28} a="fhi-flash" style={{ borderRadius: 6 }} />
                <Row icon={<DollarSign size={9} />} label="Monto" y={64}>
                    <span style={{ position: 'relative', flex: 1, height: 14 }}>
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', animationName: 'fhi-old', opacity: 0 }}>
                            <T size={9.5} weight={600}>
                                $ 4.500.000
                            </T>
                        </span>
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', animationName: 'fhi-new' }}>
                            <T size={9.5} weight={600}>
                                $ 4.200.000
                            </T>
                        </span>
                        <span data-a="" style={{ position: 'absolute', right: 2, top: -2, width: 18, height: 18, borderRadius: 5, border: `1px solid ${primary(0.5)}`, color: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.card, animationName: 'fhi-icon' }}>
                            <History size={10} />
                        </span>
                    </span>
                </Row>
                <Row icon={<CalendarDays size={9} />} label="Cierre" y={92}>
                    <T size={9}>30/11/2026</T>
                </Row>
                <Row icon={<ListChecks size={9} />} label="Etapa" y={120}>
                    <Chip label="Propuesta" t="violet" />
                </Row>
                <At x={10} y={162} w={180} a="fhi-toast" style={{ opacity: 0, borderRadius: 8, background: tone('mint', 0.16), padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <RotateCcw size={10} color={tone('mint')} />
                    <T size={8.5} weight={600} style={{ whiteSpace: 'normal' }}>
                        Monto volvió a $ 4.200.000
                    </T>
                </At>
            </Win>

            {/* El historial del campo */}
            <At x={228} y={30} w={238} a="fhi-pop" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 18px 40px -16px rgba(15,23,42,.5)', padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <History size={11} color={primary()} />
                    <T size={10.5} weight={700}>
                        Historial de «Monto»
                    </T>
                </span>
                <T size={8} color={C.mutedFg}>
                    Valor actual: <b style={{ color: C.fg }}>$ 4.500.000</b>
                </T>
                {ENTRIES.map((e) => (
                    <div key={e.who} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Avatar initials={e.ini} t={e.t} size={15} />
                            <T size={8.5} weight={700}>
                                {e.who}
                            </T>
                            <T size={8} color={C.mutedFg} style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 92 }}>
                                {e.verb}
                            </T>
                            <span style={{ flex: 1 }} />
                            <T size={7.5} color={C.mutedFg}>
                                {e.when}
                            </T>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            {e.from && (
                                <>
                                    <T size={8.5} color={C.mutedFg} style={{ textDecoration: 'line-through' }}>
                                        {e.from}
                                    </T>
                                    <T size={8.5} color={C.mutedFg}>
                                        →
                                    </T>
                                </>
                            )}
                            <T size={8.5} weight={700}>
                                {e.to}
                            </T>
                            <span style={{ flex: 1 }} />
                            {e.current ? (
                                <T size={7.5} weight={600} color={primary()}>
                                    Es el valor actual
                                </T>
                            ) : (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 5, border: `1px solid ${C.border}`, color: C.fg }}>
                                    <RotateCcw size={8} />
                                    <T size={7.5} weight={600}>
                                        Restaurar
                                    </T>
                                </span>
                            )}
                        </span>
                    </div>
                ))}
            </At>
            <Cursor a="fhi-cur" click="fhi-ring" rest={[440, 250]} />
        </Stage>
    );
}
