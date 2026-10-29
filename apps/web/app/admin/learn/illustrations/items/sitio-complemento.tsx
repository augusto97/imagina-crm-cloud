import { CheckCircle2, Download, Plug, Zap } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, Btn, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * El complemento para WordPress: se descarga desde la página del sitio, se
 * sube en «Plugins → Añadir nuevo» y, con él activo, el sitio suma columnas
 * (SEO, campos de ACF y Meta Box, texto alternativo) y avisa cada cambio al
 * instante.
 */

const CSS = `
@keyframes sc-cur{0%{transform:translate(260px,280px);opacity:0}6%{opacity:1}14%,20%{transform:translate(118px,150px)}44%,50%{transform:translate(352px,150px)}80%,100%{transform:translate(420px,270px);opacity:0}}
@keyframes sc-ring{0%,16%{opacity:0;transform:scale(.4)}17%{opacity:1;transform:scale(1)}21%{opacity:0;transform:scale(1.6)}46%{opacity:0;transform:scale(.4)}47%{opacity:1;transform:scale(1)}51%,100%{opacity:0;transform:scale(1.6)}}
@keyframes sc-zip{0%,20%{opacity:0;transform:translate(0,0) scale(.6)}24%{opacity:1;transform:translate(0,0) scale(1)}40%{opacity:1;transform:translate(214px,0) scale(1)}46%,100%{opacity:0;transform:translate(214px,0) scale(.6)}}
@keyframes sc-off{0%,50%{opacity:1}54%,100%{opacity:0}}
@keyframes sc-on{0%,50%{opacity:0}54%,100%{opacity:1}}
@keyframes sc-col{0%,58%{opacity:0;transform:translateY(6px)}64%,100%{opacity:1;transform:translateY(0)}}
@keyframes sc-col2{0%,64%{opacity:0;transform:translateY(6px)}70%,100%{opacity:1;transform:translateY(0)}}
@keyframes sc-col3{0%,70%{opacity:0;transform:translateY(6px)}76%,100%{opacity:1;transform:translateY(0)}}
@keyframes sc-zap{0%,76%{opacity:0}80%,100%{opacity:1}}
`;

function NewCol({ label, a, t }: { label: string; a: string; t: 'blue' | 'violet' | 'mint' }): JSX.Element {
    return (
        <span data-a="" style={{ animationName: a, display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 8px', borderRadius: 99, background: tone(t, 0.14), border: `1px solid ${tone(t, 0.4)}` }}>
            <T size={8.5} weight={700}>
                {label}
            </T>
        </span>
    );
}

export default function SitioComplemento(): JSX.Element {
    return (
        <Stage
            label="En la página del sitio se descarga el complemento para WordPress y se sube en Plugins. Con el complemento activo, la lista suma las columnas de SEO, los campos personalizados y el texto alternativo, y los cambios llegan al instante."
            tint="blue"
        >
            <Keyframes css={CSS} />

            <Win x={14} y={16} w={208} h={188} title="Página del sitio">
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 6, background: primary(0.12), color: primary(), display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Plug size={12} />
                        </span>
                        <T size={9.5} weight={700}>
                            Suma el complemento
                        </T>
                    </span>
                    {['El SEO de cada página', 'Todos los campos, con su tipo', 'Texto alternativo y dónde se usa', 'Cada cambio, en segundos'].map((l) => (
                        <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <CheckCircle2 size={9} color={C.success} />
                            <T size={8.5} color={C.mutedFg}>
                                {l}
                            </T>
                        </span>
                    ))}
                    <Btn label={<><Download size={10} /> Descargar el complemento</>} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
                </div>
            </Win>

            <At x={96} y={150} a="sc-zip" style={{ opacity: 0, zIndex: 5 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 8px', borderRadius: 6, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 8px 18px -10px rgba(15,23,42,.5)' }}>
                    <Download size={10} color={primary()} />
                    <T size={8.5} weight={600}>
                        complemento.zip
                    </T>
                </span>
            </At>

            <Win x={258} y={16} w={208} h={188} title="WordPress · Plugins">
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <IntegrationLogo integrationKey="wordpress" size={18} />
                        <T size={9.5} weight={700}>
                            Subir plugin
                        </T>
                    </span>
                    <span style={{ height: 46, borderRadius: 8, border: `1.5px dashed ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={8.5} color={C.mutedFg}>
                            Instalar ahora
                        </T>
                    </span>
                    <span style={{ position: 'relative', height: 22 }}>
                        <span data-a="" style={{ animationName: 'sc-off', position: 'absolute', inset: 0 }}>
                            <Btn label="Activar plugin" />
                        </span>
                        <span data-a="" style={{ animationName: 'sc-on', position: 'absolute', inset: 0, opacity: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle2 size={11} color={C.success} />
                            <T size={9} weight={700} color={C.success}>
                                Complemento activo
                            </T>
                        </span>
                    </span>
                </div>
            </Win>

            <At x={14} y={218} w={452} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
                <NewCol label="Título SEO" a="sc-col" t="blue" />
                <NewCol label="Descripción para Google" a="sc-col" t="blue" />
                <NewCol label="Asesor (ACF)" a="sc-col2" t="violet" />
                <NewCol label="Estrato (Meta Box)" a="sc-col2" t="violet" />
                <NewCol label="Texto alternativo" a="sc-col3" t="mint" />
            </At>
            <At x={14} y={258} w={452} a="sc-zap" style={{ opacity: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5 }}>
                <Zap size={11} color={primary()} />
                <T size={9} weight={600}>
                    Al instante: lo que cambias en WordPress llega en segundos
                </T>
            </At>

            <Cursor a="sc-cur" click="sc-ring" />
        </Stage>
    );
}
