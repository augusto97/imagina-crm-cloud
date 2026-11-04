import { X } from 'lucide-react';

import { At, Bar, C, Cursor, Keyframes, Stage, T, primary } from '../kit';

/**
 * Panel lateral (v0.1.359): el botón del sitio abre el formulario en un panel
 * que entra desde el costado; la página se sigue viendo detrás.
 */

const CSS = `
@keyframes fes-cur{
0%{transform:translate(300px,280px)}
14%,18%{transform:translate(120px,150px)}
60%{transform:translate(120px,150px)}
70%{transform:translate(300px,280px)}
100%{transform:translate(300px,280px)}}
@keyframes fes-ring{0%,15%{opacity:0;transform:scale(.4)}16%{opacity:1;transform:scale(1)}22%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fes-dim{0%,17%{opacity:0}24%,90%{opacity:1}96%,100%{opacity:0}}
@keyframes fes-panel{0%,17%{transform:translateX(200px)}27%,90%{transform:none}97%,100%{transform:translateX(200px)}}
`;

export default function FormEmbedSide(): JSX.Element {
    return (
        <Stage
            label="Panel lateral: en el sitio de la empresa, el botón «Pide tu cotización» abre el formulario en un panel que entra desde la derecha mientras la página se sigue viendo detrás."
            cycle={8}
            tint="blue"
        >
            <Keyframes css={CSS} />
            <At x={20} y={18} w={440} h={264} style={{ borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, overflow: 'hidden' }}>
                {/* El sitio de la empresa */}
                <At x={0} y={0} w={440} h={26} style={{ borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 12px' }}>
                    <T size={8} weight={800}>
                        Constructora Andina
                    </T>
                </At>
                <At x={18} y={44}>
                    <T size={13} weight={800}>
                        Remodelamos tu casa
                    </T>
                </At>
                <At x={18} y={66} w={220}>
                    <Bar w={210} />
                    <Bar w={180} style={{ marginTop: 6 }} />
                    <Bar w={196} style={{ marginTop: 6 }} />
                </At>
                <At x={18} y={118} w={130} h={28} style={{ borderRadius: 99, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <T size={8} weight={700} color="#fff">
                        Pide tu cotización
                    </T>
                </At>
                <At x={18} y={170} w={190} h={70} style={{ borderRadius: 8, background: C.muted }} />

                {/* Velo y panel */}
                <At x={0} y={0} w={440} h={264} a="fes-dim" style={{ opacity: 0, background: 'rgba(15,23,42,.42)' }} />
                <At x={250} y={0} w={190} h={264} a="fes-panel" style={{ background: C.card, boxShadow: '-10px 0 30px -12px rgba(15,23,42,.45)', transform: 'translateX(200px)' }}>
                    <At x={162} y={8} w={20} h={20} style={{ borderRadius: 99, background: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={11} color={C.fg} />
                    </At>
                    <At x={14} y={14} w={140} h={4} style={{ borderRadius: 99, background: primary() }} />
                    <At x={14} y={30}>
                        <T size={9} weight={800}>
                            Pide tu cotización
                        </T>
                    </At>
                    <At x={14} y={48}>
                        <T size={6.5} color={C.mutedFg}>
                            Paso 1 de 2
                        </T>
                    </At>
                    {['¿Qué servicio te interesa?', 'Cuéntanos un poco más', 'Tu nombre'].map((q, i) => (
                        <At key={q} x={14} y={66 + i * 52}>
                            <T size={7} weight={600}>
                                {q}
                            </T>
                            <At x={0} y={12} w={162} h={22} style={{ borderRadius: 5, border: `1px solid ${C.border}` }} />
                        </At>
                    ))}
                    <At x={14} y={228} w={162} h={24} style={{ borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={7.5} weight={700} color="#fff">
                            Siguiente
                        </T>
                    </At>
                </At>
            </At>
            <Cursor a="fes-cur" click="fes-ring" rest={[300, 280]} />
        </Stage>
    );
}
