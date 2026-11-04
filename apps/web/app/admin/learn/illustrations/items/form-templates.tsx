import { Check, ClipboardList, Mail, Receipt, Smile } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Plantillas de formularios (v0.1.359): se elige una plantilla, la app
 * propone qué campo de la lista guarda cada respuesta (o crea el que falta)
 * y el formulario nace completo.
 */

const CSS = `
@keyframes ftp-cur{
0%{transform:translate(260px,280px)}
12%,16%{transform:translate(120px,140px)}
48%,52%{transform:translate(396px,258px)}
70%{transform:translate(420px,286px)}
100%{transform:translate(260px,280px)}}
@keyframes ftp-ring{0%,13%{opacity:0;transform:scale(.4)}14%{opacity:1;transform:scale(1)}19%,49%{opacity:0;transform:scale(1.6)}50%{opacity:1;transform:scale(1)}55%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ftp-pick{0%,14%{box-shadow:0 0 0 1px ${C.border}}16%,94%{box-shadow:0 0 0 2px ${primary()}}98%,100%{box-shadow:0 0 0 1px ${C.border}}}
@keyframes ftp-side{0%,16%{opacity:0;transform:translateX(10px)}22%,94%{opacity:1;transform:none}98%,100%{opacity:0}}
@keyframes ftp-r1{0%,24%{opacity:0}28%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes ftp-r2{0%,30%{opacity:0}34%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes ftp-r3{0%,36%{opacity:0}40%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes ftp-done{0%,54%{opacity:0;transform:scale(.9)}60%,94%{opacity:1;transform:none}98%,100%{opacity:0}}
`;

const CARD = { background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 10px 26px -14px rgba(15,23,42,.35)' } as const;

const TEMPLATES = [
    { name: 'Contacto', cat: 'Contacto', icon: Mail, t: 'cyan' as const },
    { name: 'Pide tu cotización', cat: 'Ventas', icon: Receipt, t: 'blue' as const, picked: true },
    { name: 'Encuesta NPS', cat: 'Opiniones', icon: Smile, t: 'mint' as const },
    { name: 'Inscripción', cat: 'Eventos', icon: ClipboardList, t: 'violet' as const },
];

const ROLES = [
    { label: 'Nombre', value: 'Nombre', a: 'ftp-r1' },
    { label: 'Tipo de cliente', value: 'Tipo de cliente', a: 'ftp-r2' },
    { label: 'Servicio', value: '+ Crear el campo', a: 'ftp-r3', create: true },
];

export default function FormTemplates(): JSX.Element {
    return (
        <Stage
            label="Plantillas de formularios: se elige «Pide tu cotización», la app propone qué campo de la lista guarda cada respuesta y crea el que falta; el formulario queda listo."
            cycle={9}
            tint="violet"
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {TEMPLATES.map((tp, i) => {
                    const Icon = tp.icon;
                    return (
                        <At
                            key={tp.name}
                            x={18 + (i % 2) * 124}
                            y={30 + Math.floor(i / 2) * 92}
                            w={116}
                            h={80}
                            a={tp.picked ? 'ftp-pick' : undefined}
                            style={{ ...CARD, boxShadow: `0 0 0 1px ${C.border}` }}
                        >
                            <At x={10} y={10} w={22} h={22} style={{ borderRadius: 6, background: tone(tp.t, 0.16), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Icon size={12} color={tone(tp.t)} />
                            </At>
                            <At x={10} y={40}>
                                <T size={8} weight={700}>
                                    {tp.name}
                                </T>
                            </At>
                            <At x={10} y={54}>
                                <T size={6.8} color={C.mutedFg}>
                                    {tp.cat}
                                </T>
                            </At>
                        </At>
                    );
                })}

                {/* Dónde se guarda cada respuesta */}
                <At x={272} y={30} w={190} h={250} a="ftp-side" style={{ ...CARD, opacity: 0 }}>
                    <At x={12} y={12}>
                        <T size={8.5} weight={800}>
                            Pide tu cotización
                        </T>
                    </At>
                    <At x={12} y={28}>
                        <T size={6.3} weight={700} color={C.mutedFg} style={{ letterSpacing: '.05em' }}>
                            DÓNDE SE GUARDA CADA RESPUESTA
                        </T>
                    </At>
                    {ROLES.map((r, i) => (
                        <At key={r.label} x={12} y={44 + i * 40} a={r.a} style={{ opacity: 0 }}>
                            <T size={7} weight={600}>
                                {r.label}
                            </T>
                            <At
                                x={0}
                                y={12}
                                w={166}
                                h={20}
                                style={{
                                    borderRadius: 5,
                                    border: `1px solid ${r.create ? primary(0.5) : C.border}`,
                                    background: r.create ? primary(0.08) : C.card,
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '0 7px',
                                }}
                            >
                                <T size={7} color={r.create ? primary() : C.fg} weight={r.create ? 700 : 500}>
                                    {r.value}
                                </T>
                            </At>
                        </At>
                    ))}
                    <At x={12} y={214} w={166} h={24} style={{ borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={7.5} weight={700} color="#fff">
                            Usar esta plantilla
                        </T>
                    </At>
                </At>

                {/* El formulario, listo */}
                <At x={60} y={214} w={170} h={50} a="ftp-done" style={{ ...CARD, opacity: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px' }}>
                    <At x={10} y={13} w={24} h={24} style={{ borderRadius: 99, background: tone('mint', 0.9), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Check size={13} color="#fff" strokeWidth={3} />
                    </At>
                    <At x={42} y={12}>
                        <T size={8} weight={700}>
                            Formulario listo
                        </T>
                    </At>
                    <At x={42} y={26}>
                        <T size={6.5} color={C.mutedFg}>
                            2 pasos · diseño incluido
                        </T>
                    </At>
                </At>

                <Cursor a="ftp-cur" click="ftp-ring" rest={[260, 280]} />
            </At>
        </Stage>
    );
}
