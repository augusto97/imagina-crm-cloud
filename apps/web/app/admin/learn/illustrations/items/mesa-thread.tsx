import { ArrowDownLeft, ArrowUpRight, MessageSquare, Reply } from 'lucide-react';

import { At, Avatar, C, Chip, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * El hilo de un ticket: el correo del cliente crea el ticket; la respuesta
 * del equipo sale con el número en el asunto; cuando el cliente contesta, ese
 * número la devuelve al MISMO ticket (y lo reabre). Todo queda en los
 * comentarios del registro.
 */

const MAILS = [
    { dir: 'in', who: 'Ana Gómez', subject: 'No puedo descargar mi factura', a: 'mt-m1' },
    { dir: 'out', who: 'Soporte · Jorge', subject: 'Re: No puedo descargar mi factura [TCK-0042]', a: 'mt-m2' },
    { dir: 'in', who: 'Ana Gómez', subject: 'Re: No puedo descargar mi factura [TCK-0042]', a: 'mt-m3' },
] as const;

const CSS = `
@keyframes mt-m1{0%,3%{opacity:0;transform:translateX(-10px)}8%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes mt-m2{0%,32%{opacity:0;transform:translateX(-10px)}38%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes mt-m3{0%,60%{opacity:0;transform:translateX(-10px)}66%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes mt-c1{0%,12%{opacity:0;transform:translateY(5px)}17%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes mt-c2{0%,40%{opacity:0;transform:translateY(5px)}45%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes mt-c3{0%,68%{opacity:0;transform:translateY(5px)}73%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes mt-tag{0%,62%{background:transparent}66%,72%{background:${primary(0.22)}}80%,100%{background:transparent}}
@keyframes mt-s1{0%,44%{opacity:1}48%,100%{opacity:0}}
@keyframes mt-s2{0%,44%{opacity:0}48%,70%{opacity:1}74%,100%{opacity:0}}
@keyframes mt-s3{0%,70%{opacity:0}74%,92%{opacity:1}97%,100%{opacity:0}}
`;

export default function MesaThread(): JSX.Element {
    return (
        <Stage label="El correo del cliente crea el ticket; la respuesta del equipo sale con el número del ticket en el asunto; cuando el cliente contesta, el número devuelve su respuesta al mismo ticket y lo reabre." tint="rose">
            <Keyframes css={CSS} />

            {/* Los correos */}
            {MAILS.map((m, i) => (
                <At
                    key={m.a}
                    x={16}
                    y={26 + i * 84}
                    w={214}
                    a={m.a}
                    style={{
                        background: C.card,
                        border: `1px solid ${m.dir === 'out' ? primary(0.45) : C.border}`,
                        borderRadius: 10,
                        padding: '8px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        boxShadow: '0 8px 20px -14px rgba(15,23,42,.45)',
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {m.dir === 'in' ? <ArrowDownLeft size={11} color={tone('blue')} /> : <ArrowUpRight size={11} color={primary()} />}
                        <T size={8} weight={700} color={m.dir === 'in' ? tone('blue') : primary()}>
                            {m.dir === 'in' ? 'Correo del cliente' : 'Respuesta del equipo'}
                        </T>
                        <T size={8} color={C.mutedFg} style={{ marginLeft: 'auto' }}>
                            {m.who}
                        </T>
                    </span>
                    <T size={8.5} weight={600} style={{ whiteSpace: 'normal', display: 'block' }}>
                        {m.subject.includes('[TCK-0042]') ? (
                            <>
                                {m.subject.replace(' [TCK-0042]', ' ')}
                                <span data-a={i === 2 ? '' : undefined} style={{ animationName: i === 2 ? 'mt-tag' : undefined, fontFamily: 'ui-monospace, Menlo, monospace', color: primary(), borderRadius: 3, padding: '0 2px', whiteSpace: 'nowrap' }}>
                                    [TCK-0042]
                                </span>
                            </>
                        ) : (
                            m.subject
                        )}
                    </T>
                </At>
            ))}

            {/* El ticket */}
            <At x={252} y={20} w={212} h={262} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, overflow: 'hidden', boxShadow: '0 16px 36px -18px rgba(15,23,42,.55)' }}>
                <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <T size={8} weight={700} color={primary()} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                        TCK-0042
                    </T>
                    <T size={10.5} weight={700}>
                        No puedo descargar mi factura
                    </T>
                    <span style={{ position: 'relative', display: 'block', height: 16 }}>
                        <span data-a="" style={{ animationName: 'mt-s1', position: 'absolute', left: 0, top: 0, display: 'flex', opacity: 0 }}>
                            <Chip label="Abierto" t="rose" />
                        </span>
                        <span data-a="" style={{ animationName: 'mt-s2', position: 'absolute', left: 0, top: 0, display: 'flex', opacity: 0 }}>
                            <Chip label="Esperando al cliente" t="slate" />
                        </span>
                        <span data-a="" style={{ animationName: 'mt-s3', position: 'absolute', left: 0, top: 0, display: 'flex' }}>
                            <Chip label="En proceso" t="amber" />
                        </span>
                    </span>
                </div>
                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <T size={8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        Comentarios
                    </T>
                    {[
                        { a: 'mt-c1', ini: 'AG', t: 'rose' as const, name: 'Ana Gómez', text: 'Desde ayer me sale un error…', icon: <MessageSquare size={9} />, tag: 'Ticket nuevo' },
                        { a: 'mt-c2', ini: 'JH', t: 'blue' as const, name: 'Jorge Herrera', text: '¿Me envías una captura?', icon: <Reply size={9} />, tag: 'Respuesta por correo' },
                        { a: 'mt-c3', ini: 'AG', t: 'rose' as const, name: 'Ana Gómez', text: 'Te adjunto la captura.', icon: <MessageSquare size={9} />, tag: 'Respuesta del cliente' },
                    ].map((c) => (
                        <span key={c.a} data-a="" style={{ animationName: c.a, display: 'flex', gap: 6 }}>
                            <Avatar initials={c.ini} t={c.t} size={18} />
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <T size={8.5} weight={700}>
                                        {c.name}
                                    </T>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 13, padding: '0 4px', borderRadius: 4, background: C.muted, color: C.mutedFg, fontSize: 7, fontWeight: 700 }}>
                                        {c.icon}
                                        {c.tag}
                                    </span>
                                </span>
                                <T size={8.5} color={C.mutedFg}>
                                    {c.text}
                                </T>
                            </span>
                        </span>
                    ))}
                </div>
            </At>
        </Stage>
    );
}
