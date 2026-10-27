import { FilePlus2, Globe, Webhook } from 'lucide-react';

import { At, Avatar, Btn, C, Chip, Cursor, Flow, IconSquare, Keyframes, Stage, T, Win, primary } from '../kit';

/**
 * Recibir datos de otro sistema: el formulario de tu sitio web (o Zapier, o tu
 * tienda) manda los datos a la URL pública de una automatización con el
 * disparador «Webhook entrante»; la automatización crea el registro y aparece
 * en la lista.
 */

const CSS = `
@keyframes iw-cur{0%{transform:translate(160px,280px);opacity:0}6%{opacity:1}16%,20%{transform:translate(100px,226px)}28%,100%{transform:translate(100px,226px);opacity:0}}
@keyframes iw-ring{0%,17%{opacity:0;transform:scale(.4)}18%{opacity:1;transform:scale(1)}22%,100%{opacity:0;transform:scale(1.6)}}
@keyframes iw-pkt{0%,20%{opacity:0;transform:translate(0,0)}23%{opacity:1}36%{opacity:1;transform:translate(100px,-186px)}38%,100%{opacity:0;transform:translate(100px,-186px)}}
@keyframes iw-url{0%,34%{box-shadow:0 0 0 0 transparent}38%,44%{box-shadow:0 0 0 3px ${primary(0.35)}}50%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes iw-a1{0%,40%{box-shadow:0 0 0 0 transparent}44%,50%{box-shadow:0 0 0 3px ${primary(0.35)}}56%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes iw-a2{0%,52%{box-shadow:0 0 0 0 transparent}56%,62%{box-shadow:0 0 0 3px ${primary(0.35)}}68%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes iw-row{0%,64%{opacity:0;transform:translateY(-8px);background:transparent}70%{opacity:1;transform:translateY(0);background:${primary(0.12)}}84%,92%{opacity:1;background:transparent}97%,100%{opacity:0}}
`;

function Step({ y, kicker, title, icon, t, a }: { y: number; kicker: string; title: string; icon: JSX.Element; t: 'violet' | 'mint'; a: string }): JSX.Element {
    return (
        <At x={262} y={y} w={196} h={44} a={a} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', boxShadow: '0 8px 20px -14px rgba(15,23,42,.45)' }}>
            <IconSquare t={t} size={24}>
                {icon}
            </IconSquare>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <T size={7.5} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {kicker}
                </T>
                <T size={10} weight={600}>
                    {title}
                </T>
            </span>
        </At>
    );
}

export default function IntegWebhookIn(): JSX.Element {
    return (
        <Stage label="El formulario de tu sitio web manda los datos a la URL pública de una automatización con el disparador Webhook entrante; la automatización crea el registro y aparece en la lista." tint="violet">
            <Keyframes css={CSS} />

            {/* El sitio web */}
            <Win x={20} y={54} w={170} h={186} title={<span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Globe size={10} /> tusitio.com/contacto</span>}>
                <div style={{ padding: 11, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <T size={11} weight={700}>
                        Pide tu cotización
                    </T>
                    {[
                        ['Nombre', 'Ana Gómez'],
                        ['Correo', 'ana@hotelbrisas.co'],
                        ['Habitaciones', '12'],
                    ].map(([l, v]) => (
                        <span key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <T size={7.5} color={C.mutedFg}>
                                {l}
                            </T>
                            <span style={{ height: 17, borderRadius: 4, border: `1px solid ${C.border}`, padding: '0 6px', display: 'flex', alignItems: 'center', fontSize: 8.5 }}>{v}</span>
                        </span>
                    ))}
                    <Btn label="Enviar" style={{ justifyContent: 'center', height: 20 }} />
                </div>
            </Win>

            {/* El paquete de datos viajando */}
            <At x={186} y={220} a="iw-pkt" style={{ opacity: 0 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 7px', borderRadius: 6, background: primary(), color: C.primaryFg, fontSize: 8, fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                    nombre, correo…
                </span>
            </At>

            {/* La URL pública */}
            <At x={262} y={22} w={196} a="iw-url" style={{ borderRadius: 8, border: `1px dashed ${primary(0.6)}`, background: C.card, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <T size={7.5} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    URL pública del webhook
                </T>
                <T size={8.5} weight={600} color={primary()} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                    …/public/hooks/k7Fq2xP9…
                </T>
            </At>
            <Flow x1={360} y1={64} x2={360} y2={78} />
            <Step y={80} kicker="Cuando" title="Llega un webhook" icon={<Webhook size={13} />} t="violet" a="iw-a1" />
            <Flow x1={360} y1={124} x2={360} y2={138} />
            <Step y={138} kicker="Entonces" title="Crear un registro" icon={<FilePlus2 size={13} />} t="mint" a="iw-a2" />

            {/* La lista */}
            <At x={262} y={196} w={196} h={86} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ height: 22, display: 'flex', alignItems: 'center', padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={8.5} weight={700}>
                        Solicitudes
                    </T>
                </div>
                <div data-a="" style={{ animationName: 'iw-row', height: 30, display: 'flex', alignItems: 'center', gap: 6, padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                    <Avatar initials="AG" t="rose" size={16} />
                    <T size={9} weight={600}>
                        Ana Gómez
                    </T>
                    <span style={{ marginLeft: 'auto' }}>
                        <Chip label="Nueva" t="blue" />
                    </span>
                </div>
                <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 6, padding: '0 9px', opacity: 0.55 }}>
                    <Avatar initials="CR" t="amber" size={16} />
                    <T size={9} weight={600}>
                        Carlos Ruiz
                    </T>
                    <span style={{ marginLeft: 'auto' }}>
                        <Chip label="Cotizada" t="mint" />
                    </span>
                </div>
            </At>

            <Cursor a="iw-cur" click="iw-ring" />
        </Stage>
    );
}
