import { Globe, Link2, Webhook } from 'lucide-react';

import { At, Avatar, C, Chip, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Webhook entrante: alguien llena el formulario de contacto de la página web,
 * los datos viajan a la URL pública de la automatización y el prospecto
 * aparece solo en la lista.
 */

const CSS = `
@keyframes awe-cur{0%{transform:translate(170px,280px);opacity:0}6%{opacity:1}16%,22%{transform:translate(90px,218px)}34%,90%{transform:translate(60px,280px);opacity:1}96%,100%{transform:translate(60px,280px);opacity:0}}
@keyframes awe-ring{0%,18%{opacity:0;transform:scale(.4)}20%{opacity:1;transform:scale(1)}25%,100%{opacity:0;transform:scale(1.6)}}
@keyframes awe-btn{0%,18%{filter:none}20%,24%{filter:brightness(1.15)}28%,100%{filter:none}}
@keyframes awe-pkt{0%,22%{opacity:0;transform:translate(0,0)}24%{opacity:1;transform:translate(0,0)}36%{opacity:1;transform:translate(84px,-132px)}38%,100%{opacity:0;transform:translate(84px,-132px)}}
@keyframes awe-url{0%,35%{box-shadow:0 0 0 0 transparent}38%,48%{box-shadow:0 0 0 3px ${primary(0.3)}}54%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes awe-pkt2{0%,40%{opacity:0;transform:translate(0,0)}42%{opacity:1}50%{opacity:1;transform:translate(0,46px)}52%,100%{opacity:0;transform:translate(0,46px)}}
@keyframes awe-step{0%,50%{box-shadow:0 0 0 0 transparent}53%,60%{box-shadow:0 0 0 3px ${primary(0.3)}}66%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes awe-pkt3{0%,58%{opacity:0;transform:translate(0,0)}60%{opacity:1}68%{opacity:1;transform:translate(24px,-62px)}70%,100%{opacity:0;transform:translate(24px,-62px)}}
@keyframes awe-row{0%,68%{opacity:0;transform:translateY(-10px);background:transparent}72%{opacity:1;transform:translateY(0);background:${tone('mint', 0.18)}}86%,92%{opacity:1;background:transparent}97%,100%{opacity:0}}
@keyframes awe-push{0%,68%{transform:translateY(-34px)}72%,100%{transform:translateY(0)}}
@keyframes awe-cap{0%,46%{opacity:0;transform:translateY(6px)}52%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
`;

function Input({ y, label, value }: { y: number; label: string; value: string }): JSX.Element {
    return (
        <At x={10} y={y} w={130} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <T size={7.4} weight={600} color={C.mutedFg}>
                {label}
            </T>
            <span style={{ height: 20, borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                <T size={8.4}>{value}</T>
            </span>
        </At>
    );
}

const ROWS = [
    { n: 'Óptica Visión', who: 'JP', t: 'amber' as const },
    { n: 'Clínica Norte', who: 'AM', t: 'violet' as const },
    { n: 'Hotel Brisas', who: 'LG', t: 'cyan' as const },
];

export default function AutoWebhookEntrante(): JSX.Element {
    return (
        <Stage label="Un webhook entrante: alguien llena el formulario de contacto de la página web, los datos llegan a la URL pública de la automatización y el prospecto aparece solo en la lista." tint="mint">
            <Keyframes css={CSS} />
            {/* La página web del negocio */}
            <Win x={14} y={30} w={150} h={214} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Globe size={10} /> cafeaurora.co</span>}>
                <At x={10} y={8}>
                    <T size={10.5} weight={700}>
                        Cotiza tu evento
                    </T>
                </At>
                <Input y={34} label="Nombre" value="Ana Torres" />
                <Input y={72} label="Correo" value="ana@eventos.co" />
                <Input y={110} label="¿Qué necesitas?" value="Café para 80 personas" />
                <At x={10} y={152} w={130} h={22} a="awe-btn" style={{ borderRadius: 6, background: tone('amber'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <T size={8.8} weight={700} color="#fff">
                        Enviar
                    </T>
                </At>
            </Win>

            {/* Lo que viaja */}
            <At x={96} y={204} a="awe-pkt" style={{ opacity: 0, zIndex: 6 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 16, padding: '0 6px', borderRadius: 5, background: primary(), color: C.primaryFg, fontSize: 7.5, fontWeight: 700, boxShadow: '0 6px 14px -6px rgba(0,0,0,.4)' }}>
                    {'{ nombre, correo… }'}
                </span>
            </At>

            {/* La URL pública + el disparador */}
            <At x={176} y={62} w={116} h={36} a="awe-url" style={{ borderRadius: 9, background: C.card, border: `1px dashed ${primary(0.6)}`, padding: '4px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Link2 size={10} color={primary()} />
                    <T size={7.4} weight={700} color={primary()}>
                        URL pública del webhook
                    </T>
                </span>
                <T size={7.6} color={C.mutedFg} style={{ fontFamily: 'ui-monospace, monospace' }}>
                    …/public/hooks/a8f3k…
                </T>
            </At>
            <At x={232} y={100} a="awe-pkt2" style={{ opacity: 0, zIndex: 6 }}>
                <span style={{ display: 'block', width: 8, height: 8, borderRadius: 99, background: primary(), boxShadow: `0 0 0 4px ${primary(0.2)}` }} />
            </At>
            <At x={176} y={146} w={116} h={40} a="awe-step" style={{ borderRadius: 9, background: C.card, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', boxShadow: '0 6px 16px -12px rgba(15,23,42,.45)' }}>
                <span style={{ width: 20, height: 20, borderRadius: 6, background: tone('mint'), color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Webhook size={11} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <T size={6.8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                        Cuando
                    </T>
                    <T size={8.2} weight={600}>
                        Llega un webhook
                    </T>
                </span>
            </At>
            <At x={284} y={162} a="awe-pkt3" style={{ opacity: 0, zIndex: 6 }}>
                <span style={{ display: 'block', width: 8, height: 8, borderRadius: 99, background: primary(), boxShadow: `0 0 0 4px ${primary(0.2)}` }} />
            </At>
            {/* «Probar el webhook»: qué llegó */}
            <At x={172} y={196} w={126} a="awe-cap" style={{ borderRadius: 9, background: C.card, border: `1px solid ${C.border}`, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <T size={7} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Último dato recibido
                </T>
                {[
                    ['nombre', '{{nombre}}'],
                    ['correo', '{{correo}}'],
                    ['mensaje', '{{payload.mensaje}}'],
                ].map(([k, tag]) => (
                    <span key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                        <T size={7.4} color={C.mutedFg}>
                            {k}
                        </T>
                        <T size={6.6} weight={600} color={primary()} style={{ fontFamily: 'ui-monospace, monospace' }}>
                            {tag}
                        </T>
                    </span>
                ))}
            </At>

            {/* La lista que recibe */}
            <Win x={304} y={46} w={162} h={176} title="Prospectos">
                <At x={0} y={6} w={162} h={34} a="awe-row" style={{ padding: '0 9px', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Avatar initials="AT" t="mint" size={18} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                        <T size={8.8} weight={700}>
                            Ana Torres
                        </T>
                        <T size={7.2} color={C.mutedFg}>
                            Café para 80 personas
                        </T>
                    </span>
                    <Chip label="Nuevo" t="mint" />
                </At>
                <At x={0} y={40} w={162} h={120} a="awe-push">
                    {ROWS.map((r, i) => (
                        <div key={r.n} style={{ height: 34, padding: '0 9px', display: 'flex', alignItems: 'center', gap: 7, borderTop: `1px solid ${C.border}` }}>
                            <Avatar initials={r.who} t={r.t} size={18} />
                            <T size={8.6} weight={600} style={{ flex: 1 }}>
                                {r.n}
                            </T>
                            <Chip label={i === 0 ? 'Contactado' : 'Cliente'} t={i === 0 ? 'blue' : 'slate'} />
                        </div>
                    ))}
                </At>
            </Win>
            <Cursor a="awe-cur" click="awe-ring" rest={[60, 280]} />
        </Stage>
    );
}
