import { BarChart3, Megaphone, MousePointerClick } from 'lucide-react';

import { At, Bar, C, Cursor, Keyframes, Pill, Stage, T, Win, anim, primary, tone } from '../kit';

/**
 * v0.1.374 — Medir conversiones: alguien llega por un anuncio, envía el
 * formulario insertado en el sitio y el sitio dispara la conversión en Tag
 * Manager, Google Ads y Meta; el registro guarda la campaña y la persona
 * termina en la página de gracias.
 */

const CSS = `
@keyframes fcv-cur{0%,10%{transform:translate(60px,280px)}26%,34%{transform:translate(128px,201px)}52%,100%{transform:translate(60px,280px)}}
@keyframes fcv-ring{0%,27%{opacity:0;transform:scale(.4)}29%{opacity:1;transform:scale(1)}35%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fcv-ev1{0%,34%{opacity:0;transform:translateX(-14px)}40%,90%{opacity:1;transform:none}96%,100%{opacity:0}}
@keyframes fcv-ev2{0%,40%{opacity:0;transform:translateX(-14px)}46%,90%{opacity:1;transform:none}96%,100%{opacity:0}}
@keyframes fcv-ev3{0%,46%{opacity:0;transform:translateX(-14px)}52%,90%{opacity:1;transform:none}96%,100%{opacity:0}}
@keyframes fcv-row{0%,54%{opacity:0;transform:translateY(8px)}60%,90%{opacity:1;transform:none}96%,100%{opacity:0}}
@keyframes fcv-form{0%,62%{opacity:1}66%,94%{opacity:0}100%{opacity:1}}
@keyframes fcv-thanks{0%,62%{opacity:0}66%,94%{opacity:1}100%{opacity:0}}
@keyframes fcv-url1{0%,62%{opacity:1}66%,94%{opacity:0}100%{opacity:1}}
@keyframes fcv-url2{0%,62%{opacity:0}66%,94%{opacity:1}100%{opacity:0}}
`;

function Field({ label }: { label: string }): JSX.Element {
    return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <T size={6.8} weight={600}>
                {label}
            </T>
            <span style={{ width: 128, height: 14, borderRadius: 4, border: `1px solid ${C.border}`, background: C.card }} />
        </span>
    );
}

export default function FormConversions(): JSX.Element {
    return (
        <Stage
            label="Una persona llega por un anuncio de Google, envía el formulario insertado en el sitio y el sitio registra la conversión en Tag Manager, Google Ads y Meta; el registro guarda la campaña y la persona llega a la página de gracias."
            tint="blue"
            cycle={9}
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                <Win
                    x={20}
                    y={18}
                    w={210}
                    h={232}
                    title={
                        <span style={{ position: 'relative', display: 'inline-block', width: 170, height: 12 }}>
                            <span {...anim('fcv-url1', { position: 'absolute', left: 0, top: 0 })}>
                                <T size={7} color={C.mutedFg}>
                                    tusitio.com/cotizar?gclid=Cj0K…
                                </T>
                            </span>
                            <span {...anim('fcv-url2', { position: 'absolute', left: 0, top: 0, opacity: 0 })}>
                                <T size={7} color={C.mutedFg}>
                                    tusitio.com/gracias
                                </T>
                            </span>
                        </span>
                    }
                >
                    <At x={12} y={12} w={186} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 14, height: 14, borderRadius: 4, background: tone('amber'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Megaphone size={9} />
                        </span>
                        <T size={8.5} weight={800}>
                            Tu empresa
                        </T>
                    </At>
                    <At x={12} y={36} w={186} h={180} a="fcv-form">
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card }}>
                            <T size={10} weight={800}>
                                Pide tu cotización
                            </T>
                            <Field label="Nombre" />
                            <Field label="Correo" />
                            <span style={{ alignSelf: 'flex-start', padding: '4px 10px', borderRadius: 5, background: primary(), color: C.primaryFg }}>
                                <T size={7.5} weight={700} color={C.primaryFg}>
                                    Enviar
                                </T>
                            </span>
                        </span>
                    </At>
                    <At x={12} y={60} w={186} a="fcv-thanks" style={{ opacity: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 30, height: 30, borderRadius: 99, background: tone('mint', 0.18), color: tone('mint'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800 }}>
                            ✓
                        </span>
                        <T size={11} weight={800}>
                            ¡Gracias, Ana!
                        </T>
                        <Bar w={120} h={5} />
                        <Bar w={90} h={5} />
                    </At>
                </Win>

                {/* Lo que el sitio registra */}
                <At x={250} y={26} w={210} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <T size={8} weight={700} color={C.mutedFg}>
                        Tu sitio registra la conversión
                    </T>
                    <At x={0} y={18} a="fcv-ev1" style={{ opacity: 0 }}>
                        <Pill t="blue" icon={<BarChart3 size={9} />} label="Tag Manager · imagina_form_submit" />
                    </At>
                    <At x={0} y={42} a="fcv-ev2" style={{ opacity: 0 }}>
                        <Pill t="mint" icon={<MousePointerClick size={9} />} label="Google Ads · Conversión · $50.000" />
                    </At>
                    <At x={0} y={66} a="fcv-ev3" style={{ opacity: 0 }}>
                        <Pill t="violet" icon={<Megaphone size={9} />} label="Meta · Lead" />
                    </At>
                </At>

                {/* El registro guarda de dónde vino */}
                <At x={250} y={136} w={210} h={92} a="fcv-row" style={{ opacity: 0, padding: 9, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <T size={8} weight={800}>
                        Ana · Nuevo registro
                    </T>
                    <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <T size={7} color={C.mutedFg}>
                            Campaña
                        </T>
                        <T size={7} weight={700}>
                            Navidad
                        </T>
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <T size={7} color={C.mutedFg}>
                            Origen
                        </T>
                        <T size={7} weight={700}>
                            google · cpc
                        </T>
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <T size={7} color={C.mutedFg}>
                            ID de clic de Google
                        </T>
                        <T size={7} weight={700}>
                            Cj0K…
                        </T>
                    </span>
                </At>

                <Cursor a="fcv-cur" click="fcv-ring" rest={[60, 280]} />
            </At>
        </Stage>
    );
}
