import { Inbox, Mail, Paperclip, Timer } from 'lucide-react';

import { At, Avatar, C, Chip, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Portada de «Mesa de ayuda»: un correo llega al buzón de soporte y se
 * convierte en un ticket numerado en la lista, con prioridad, responsable y el
 * reloj del SLA corriendo.
 */

const CSS = `
@keyframes mh-mail{0%,4%{opacity:0;transform:translate(0,0) scale(.9)}10%{opacity:1;transform:translate(0,0) scale(1)}26%{opacity:1;transform:translate(0,0) scale(1)}36%{opacity:.9;transform:translate(133px,-25px) scale(.3)}38%,100%{opacity:0;transform:translate(133px,-25px) scale(.2)}}
@keyframes mh-row{0%,38%{opacity:0;transform:translateY(-8px);background:transparent}44%{opacity:1;transform:translateY(0);background:${primary(0.14)}}60%,92%{opacity:1;background:transparent}97%,100%{opacity:0}}
@keyframes mh-sla{0%,52%{opacity:0;transform:scale(.6)}58%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes mh-who{0%,64%{opacity:0;transform:scale(.6)}70%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes mh-toast{0%,40%{opacity:0;transform:translateY(6px)}46%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes mh-bar{0%,58%{width:4%}92%,100%{width:46%}}
`;

const ROWS = [
    { n: 'TCK-0041', s: 'Cobro duplicado en la tarjeta', st: 'En proceso', st2: 'amber' as const, p: 'Normal', p2: 'blue' as const, who: 'CR', wt: 'amber' as const },
    { n: 'TCK-0040', s: 'Cambio de dirección de envío', st: 'Esperando al cliente', st2: 'slate' as const, p: 'Baja', p2: 'slate' as const, who: 'LM', wt: 'violet' as const },
];

function Row({ n, s, st, st2, p, p2, who, wt }: (typeof ROWS)[number]): JSX.Element {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr 108px 40px 20px', gap: 5, alignItems: 'center', height: 32, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
            <T size={8} weight={700} color={C.mutedFg} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                {n}
            </T>
            <T size={9} weight={600} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s}
            </T>
            <span>
                <Chip label={st} t={st2} />
            </span>
            <span>
                <Chip label={p} t={p2} />
            </span>
            <Avatar initials={who} t={wt} size={17} />
        </div>
    );
}

export default function MesaHero(): JSX.Element {
    return (
        <Stage label="Un correo de un cliente llega al buzón de soporte y se convierte en un ticket numerado en la lista, con prioridad, responsable y el reloj del SLA corriendo." tint="rose">
            <Keyframes css={CSS} />

            {/* El correo que llega */}
            <At x={20} y={22} w={200} a="mh-mail" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: '9px 11px', boxShadow: '0 14px 30px -14px rgba(15,23,42,.5)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 6, background: tone('blue', 0.15), color: tone('blue'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Mail size={11} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={8.5} weight={700}>
                            Ana Gómez
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            para soporte@cafeaurora.co
                        </T>
                    </span>
                </span>
                <T size={9.5} weight={700}>
                    No puedo descargar mi factura
                </T>
                <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block' }}>
                    Hola, desde ayer me sale un error al bajar la factura de octubre…
                </T>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Paperclip size={9} color={C.mutedFg} />
                    <T size={7.5} color={C.mutedFg}>
                        captura.png
                    </T>
                </span>
            </At>

            {/* Aviso: el correo ya es un ticket */}
            <At x={20} y={44} w={200} a="mh-toast" style={{ opacity: 0, background: C.card, border: `1px solid ${tone('mint', 0.5)}`, borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2, boxShadow: '0 10px 24px -14px rgba(15,23,42,.5)' }}>
                <T size={9} weight={700} color={C.success}>
                    ✓ El correo ya es un ticket
                </T>
                <T size={8} color={C.mutedFg}>
                    TCK-0042 · asignado a Jorge Herrera
                </T>
            </At>

            {/* El buzón */}
            <At x={240} y={34} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, background: primary(0.14), color: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Inbox size={14} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <T size={9.5} weight={700}>
                        Buzón de soporte
                    </T>
                    <T size={8} color={C.mutedFg}>
                        Se revisa cada minuto
                    </T>
                </span>
            </At>

            {/* La lista de tickets */}
            <At x={20} y={128} w={440} h={152} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 36px -18px rgba(15,23,42,.55)' }}>
                <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={10} weight={700}>
                        Tickets
                    </T>
                    <T size={8.5} color={C.mutedFg}>
                        · Mesa de ayuda
                    </T>
                </div>
                <div data-a="" style={{ animationName: 'mh-row', display: 'grid', gridTemplateColumns: '54px 1fr 108px 40px 20px', gap: 5, alignItems: 'center', minHeight: 50, padding: '4px 10px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={8} weight={700} color={primary()} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                        TCK-0042
                    </T>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                        <T size={9} weight={700} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            No puedo descargar mi factura
                        </T>
                        <span data-a="" style={{ animationName: 'mh-sla', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Timer size={9} color={tone('mint')} />
                            <span style={{ width: 70, height: 4, borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                                <span data-a="" style={{ animationName: 'mh-bar', display: 'block', height: '100%', width: '46%', background: tone('mint'), borderRadius: 99 }} />
                            </span>
                            <T size={7.5} weight={600} color={tone('mint')}>
                                A tiempo · responde antes de las 12:00
                            </T>
                        </span>
                    </span>
                    <span>
                        <Chip label="Abierto" t="rose" />
                    </span>
                    <span>
                        <Chip label="Alta" t="amber" />
                    </span>
                    <span data-a="" style={{ animationName: 'mh-who' }}>
                        <Avatar initials="JH" t="blue" size={17} />
                    </span>
                </div>
                {ROWS.map((r) => (
                    <Row key={r.n} {...r} />
                ))}
            </At>
        </Stage>
    );
}
