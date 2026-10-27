import { AlarmClock, ClipboardCheck, Eye, ListChecks, UsersRound } from 'lucide-react';

import { At, Avatar, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * «Mi trabajo»: lo asignado en todas las listas, agrupado por vencimiento.
 * Llega una asignación nueva a «Hoy» y después se marca como hecho un ítem
 * de checklist, que sale de la lista.
 */

const CSS = `
@keyframes mt-new{0%,10%{opacity:0;transform:translateX(60px)}18%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes mt-newglow{0%,18%{box-shadow:0 0 0 2px ${primary(0.6)}}40%,100%{box-shadow:0 0 0 1px ${C.border}}}
@keyframes mt-chk{0%,10%{opacity:1;transform:translate(0,0)}18%,49%{opacity:1;transform:translate(0,30px)}52%,56%{opacity:.6;transform:translate(0,30px)}64%,100%{opacity:0;transform:translate(-30px,30px)}}
@keyframes mt-prop{0%,10%{transform:translateY(0)}18%,58%{transform:translateY(30px)}66%,92%{transform:translateY(0)}97%,100%{transform:translateY(0)}}
@keyframes mt-hoy1{0%,14%{opacity:1}17%,96%{opacity:0}100%{opacity:1}}
@keyframes mt-hoy2{0%,14%{opacity:0}17%,52%{opacity:1}55%,96%{opacity:0}100%{opacity:0}}
@keyframes mt-hoy3{0%,52%{opacity:0}55%,96%{opacity:1}100%{opacity:0}}
@keyframes mt-check{0%,46%{background:${C.card};border-color:${C.mutedFg}}49%,100%{background:${C.success};border-color:${C.success}}}
@keyframes mt-tick{0%,46%{opacity:0}49%,100%{opacity:1}}
@keyframes mt-strike{0%,49%{width:0}53%,100%{width:100%}}
@keyframes mt-cur{0%{transform:translate(300px,280px);opacity:0}24%{opacity:0;transform:translate(300px,280px)}30%{opacity:1}42%,48%{transform:translate(48px,188px)}62%,86%{transform:translate(250px,262px);opacity:1}92%,100%{transform:translate(250px,262px);opacity:0}}
@keyframes mt-ring{0%,45%{opacity:0;transform:scale(.4)}47%{opacity:1;transform:scale(1)}51%,100%{opacity:0;transform:scale(1.6)}}
@keyframes mt-toast{0%,52%{opacity:0;transform:translateY(8px)}56%,80%{opacity:1;transform:translateY(0)}85%,100%{opacity:0}}
`;

const TABS: Array<[string, typeof ListChecks, string]> = [
    ['Asignado a mí', ListChecks, '6'],
    ['De mis equipos', UsersRound, ''],
    ['Aprobaciones', ClipboardCheck, '1'],
    ['Recordatorios', AlarmClock, '2'],
    ['Siguiendo', Eye, ''],
];

function Row({ title, list, who, t, due, kind = 'record' }: { title: string; list: string; who: string; t: 'violet' | 'amber' | 'cyan' | 'rose' | 'blue'; due: string; kind?: 'record' | 'check' }): JSX.Element {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 26, padding: '0 9px', borderRadius: 7, background: C.card, boxShadow: `0 0 0 1px ${C.border}` }}>
            {kind === 'check' ? (
                <span data-a="" style={{ position: 'relative', width: 11, height: 11, borderRadius: 3, border: `1.5px solid ${C.success}`, background: C.success, animationName: 'mt-check', flexShrink: 0 }}>
                    <span data-a="" style={{ position: 'absolute', inset: 0, color: '#fff', fontSize: 8, fontWeight: 800, lineHeight: '9px', textAlign: 'center', animationName: 'mt-tick' }}>
                        ✓
                    </span>
                </span>
            ) : (
                <span style={{ width: 8, height: 8, borderRadius: 3, background: tone(t), flexShrink: 0 }} />
            )}
            <span style={{ position: 'relative', display: 'flex', flex: 1, minWidth: 0 }}>
                <T size={9} weight={600}>
                    {title}
                </T>
                {kind === 'check' && <span data-a="" style={{ position: 'absolute', left: 0, top: '50%', height: 1.5, width: '100%', background: C.mutedFg, animationName: 'mt-strike' }} />}
            </span>
            <T size={7.5} color={C.mutedFg}>
                {list}
            </T>
            <span style={{ fontSize: 7.5, fontWeight: 700, color: tone(t === 'rose' ? 'rose' : t === 'blue' ? 'blue' : 'amber'), background: tone(t === 'rose' ? 'rose' : t === 'blue' ? 'blue' : 'amber', 0.14), borderRadius: 99, padding: '1px 6px' }}>{due}</span>
            <Avatar initials={who} t="violet" size={15} />
        </div>
    );
}

function GroupTitle({ label, t, counts }: { label: string; t: 'rose' | 'amber' | 'blue'; counts: Array<[string, string]> }): JSX.Element {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 18 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: tone(t) }} />
            <T size={9} weight={700} color={tone(t)}>
                {label}
            </T>
            <span style={{ position: 'relative', width: 14, height: 12 }}>
                {counts.map(([n, a]) => (
                    <span key={a} data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', animationName: a, opacity: 0 }}>
                        <T size={8} weight={700} color={C.mutedFg}>
                            {n}
                        </T>
                    </span>
                ))}
            </span>
        </div>
    );
}

export default function DiaMiTrabajo(): JSX.Element {
    return (
        <Stage label="La pantalla Mi trabajo agrupa lo asignado en Vencido, Hoy y Próximos 7 días; llega una asignación nueva a Hoy y después se marca como hecho un ítem de checklist." tint="amber">
            <Keyframes css={CSS} />
            <At x={16} y={14} w={448} h={272} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 14px 34px -20px rgba(15,23,42,.5)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '9px 14px 5px' }}>
                    <T size={12} weight={700}>
                        Mi trabajo
                    </T>
                    <T size={8} color={C.mutedFg}>
                        Lo que tienes asignado en todas las listas.
                    </T>
                </div>
                <div style={{ display: 'flex', gap: 2, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    {TABS.map(([l, Icon, n], i) => (
                        <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 3, height: 24, padding: '0 6px', borderBottom: i === 0 ? `2px solid ${primary()}` : '2px solid transparent', color: i === 0 ? primary() : C.mutedFg }}>
                            <Icon size={9} />
                            <T size={7.5} weight={i === 0 ? 700 : 500} color={i === 0 ? primary() : C.mutedFg}>
                                {l}
                            </T>
                            {n && (
                                <span style={{ fontSize: 7, fontWeight: 700, color: C.mutedFg, background: C.muted, borderRadius: 99, padding: '0 4px' }}>{n}</span>
                            )}
                        </span>
                    ))}
                </div>
            </At>
            {/* Grupos */}
            <At x={30} y={80} w={420}>
                <GroupTitle label="Vencido" t="rose" counts={[['1', 'mt-hoy1'], ['1', 'mt-hoy2'], ['1', 'mt-hoy3']]} />
            </At>
            <At x={30} y={98} w={420}>
                <Row title="Llamar a Clínica Norte" list="Oportunidades" who="LG" t="rose" due="Ayer" />
            </At>
            <At x={30} y={130} w={420}>
                <GroupTitle label="Hoy" t="amber" counts={[['2', 'mt-hoy1'], ['3', 'mt-hoy2'], ['2', 'mt-hoy3']]} />
            </At>
            {/* ítem de checklist que se marca y sale */}
            <At x={30} y={148} w={420} a="mt-chk" style={{ opacity: 0 }}>
                <Row title="Revisar contrato del proveedor" list="Checklist · Compras" who="LG" t="amber" due="Hoy" kind="check" />
            </At>
            {/* el que sube cuando se va el ítem */}
            <At x={30} y={178} w={420} a="mt-prop">
                <Row title="Preparar propuesta comercial" list="Tareas" who="LG" t="amber" due="Hoy" />
            </At>
            {/* nueva asignación */}
            <At x={30} y={148} w={420} a="mt-new">
                <div data-a="" style={{ borderRadius: 7, animationName: 'mt-newglow' }}>
                    <Row title="Enviar cotización a Hotel Brisas" list="Oportunidades" who="AM" t="amber" due="Hoy" />
                </div>
            </At>
            <At x={30} y={238} w={420}>
                <GroupTitle label="Próximos 7 días" t="blue" counts={[['3', 'mt-hoy1'], ['3', 'mt-hoy2'], ['3', 'mt-hoy3']]} />
            </At>
            <At x={30} y={256} w={420}>
                <Row title="Visita a Ferretería El Sol" list="Citas" who="LG" t="blue" due="Jue" />
            </At>
            <At x={250} y={212} a="mt-toast" style={{ opacity: 0, zIndex: 8 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 10px', borderRadius: 8, background: C.fg, color: C.card, fontSize: 8.5, fontWeight: 600, boxShadow: '0 10px 22px -10px rgba(15,23,42,.6)' }}>
                    ✓ «Revisar contrato» quedó hecho
                </span>
            </At>
            <Cursor a="mt-cur" click="mt-ring" rest={[250, 262]} />
        </Stage>
    );
}
