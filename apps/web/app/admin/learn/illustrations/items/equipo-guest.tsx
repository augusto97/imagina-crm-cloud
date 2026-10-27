import { ChevronDown, FileText, Inbox, Lock, MailPlus, Share2 } from 'lucide-react';

import { At, Btn, C, Cursor, Flow, Keyframes, Pill, Stage, T, Win, primary, tone } from '../kit';

/**
 * Compartir UN registro con alguien de afuera (el contador): se invita por
 * correo con «Puede comentar» y esa persona sólo ve ese registro.
 */

const CSS = `
@keyframes egu-dlg{0%,14%{opacity:0;transform:translateY(8px) scale(.97)}22%,92%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0}}
@keyframes egu-cursor{0%{transform:translate(120px,270px);opacity:0}5%{opacity:1}12%,16%{transform:translate(216px,72px)}32%,38%{transform:translate(218px,186px)}50%,88%{transform:translate(196px,250px);opacity:1}95%,100%{opacity:0;transform:translate(196px,250px)}}
@keyframes egu-ring{0%,13%{opacity:0;transform:scale(.4)}15%{opacity:1;transform:scale(1)}19%{opacity:0;transform:scale(1.6)}33%{opacity:0;transform:scale(.4)}35%{opacity:1;transform:scale(1)}40%,100%{opacity:0;transform:scale(1.6)}}
@keyframes egu-row{0%,38%{opacity:0;transform:translateY(-6px)}46%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes egu-flow{0%,44%{opacity:0}50%,92%{opacity:1}100%{opacity:0}}
@keyframes egu-guest{0%,48%{opacity:0;transform:translateX(16px)}58%,92%{opacity:1;transform:translateX(0)}100%{opacity:0}}
`;

export default function EquipoGuest(): JSX.Element {
    return (
        <Stage
            label="Desde la ficha de un contrato se toca Compartir y se invita al contador por correo con el nivel «Puede comentar». Él entra a «Compartido conmigo» y ve sólo ese registro; nada más de la empresa."
            tint="mint"
        >
            <Keyframes css={CSS} />
            <Win x={14} y={22} w={250} h={256} title="Contratos">
                <At
                    x={12}
                    y={12}
                    w={226}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <T size={11} weight={700}>
                        Contrato · Café del Sur
                    </T>
                    <Btn
                        kind="outline"
                        label={
                            <>
                                <Share2 size={10} /> Compartir
                            </>
                        }
                    />
                </At>
                {[
                    ['Valor', '$ 18.400.000'],
                    ['Vence', '30/11/2026'],
                    ['Estado', 'En revisión'],
                ].map(([k, v], i) => (
                    <At
                        key={k}
                        x={12}
                        y={42 + i * 24}
                        w={226}
                        style={{
                            display: 'flex',
                            borderBottom: `1px solid ${C.border}`,
                            height: 22,
                            alignItems: 'center',
                        }}
                    >
                        <T size={9} color={C.mutedFg} style={{ width: 70 }}>
                            {k}
                        </T>
                        <T size={9.5} weight={600}>
                            {v}
                        </T>
                    </At>
                ))}
            </Win>

            {/* Diálogo de compartir */}
            <At x={34} y={92} w={226} a="egu-dlg">
                <div
                    style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 11,
                        padding: 11,
                        boxShadow: '0 18px 36px -16px rgba(15,23,42,.55)',
                    }}
                >
                    <T size={10} weight={700} style={{ display: 'block' }}>
                        Compartir «Contrato · Café del Sur»
                    </T>
                    <T size={8} color={C.mutedFg} style={{ display: 'block', whiteSpace: 'normal', marginTop: 3 }}>
                        Ve SÓLO este registro y no ocupa un usuario de tu plan.
                    </T>
                    <div
                        style={{
                            display: 'flex',
                            gap: 5,
                            marginTop: 8,
                            alignItems: 'center',
                        }}
                    >
                        <span
                            style={{
                                flex: 1,
                                height: 22,
                                border: `1px solid ${C.border}`,
                                borderRadius: 5,
                                display: 'flex',
                                alignItems: 'center',
                                padding: '0 6px',
                            }}
                        >
                            <T size={8.5}>contador@estudio.co</T>
                        </span>
                        <span
                            style={{
                                height: 22,
                                border: `1px solid ${C.border}`,
                                borderRadius: 5,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                                padding: '0 5px',
                                fontSize: 8,
                                fontWeight: 600,
                            }}
                        >
                            Puede comentar <ChevronDown size={8} />
                        </span>
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'flex-end',
                            marginTop: 6,
                        }}
                    >
                        <Btn
                            label={
                                <>
                                    <MailPlus size={10} /> Invitar
                                </>
                            }
                        />
                    </div>
                    <div
                        data-a=""
                        style={{
                            animationName: 'egu-row',
                            marginTop: 7,
                            paddingTop: 7,
                            borderTop: `1px solid ${C.border}`,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                        }}
                    >
                        <span
                            style={{
                                width: 18,
                                height: 18,
                                borderRadius: 99,
                                background: tone('mint', 0.2),
                                color: tone('mint'),
                                fontSize: 8,
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            CO
                        </span>
                        <T size={8.5} weight={600} style={{ flex: 1 }}>
                            contador@estudio.co
                        </T>
                        <Pill t="amber" label="Invitación pendiente" style={{ height: 15, fontSize: 7.5, padding: '0 5px' }} />
                    </div>
                </div>
            </At>

            <At x={264} y={150} a="egu-flow">
                <Flow x1={0} y1={0} x2={30} y2={0} />
            </At>

            {/* Lo que ve el invitado */}
            <At x={298} y={40} w={168} h={226} a="egu-guest">
                <div
                    style={{
                        height: 226,
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        overflow: 'hidden',
                        boxShadow: '0 14px 30px -16px rgba(15,23,42,.5)',
                    }}
                >
                    <div
                        style={{
                            padding: '8px 10px',
                            background: tone('amber', 0.12),
                            borderBottom: `1px solid ${C.border}`,
                        }}
                    >
                        <T size={7.5} weight={600} color={tone('amber')} style={{ whiteSpace: 'normal', display: 'block' }}>
                            Eres invitado de «Café Aurora»: sólo ves lo que te compartieron.
                        </T>
                    </div>
                    <div
                        style={{
                            padding: 10,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 7,
                        }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Inbox size={12} color={primary()} />
                            <T size={10} weight={700}>
                                Compartido conmigo
                            </T>
                        </span>
                        <T size={8} weight={700} color={C.mutedFg}>
                            Registros
                        </T>
                        <span
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '6px 7px',
                                border: `1px solid ${primary(0.5)}`,
                                borderRadius: 7,
                                background: primary(0.06),
                            }}
                        >
                            <FileText size={11} color={primary()} />
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <T size={8.5} weight={600}>
                                    Contrato · Café del Sur
                                </T>
                                <T size={7.5} color={C.mutedFg}>
                                    Puede comentar
                                </T>
                            </span>
                        </span>
                        {['Clientes', 'Facturas'].map((l) => (
                            <span
                                key={l}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '5px 7px',
                                    borderRadius: 7,
                                    border: `1px dashed ${C.border}`,
                                    opacity: 0.55,
                                }}
                            >
                                <Lock size={10} color={C.mutedFg} />
                                <T size={8.5} color={C.mutedFg}>
                                    {l}
                                </T>
                            </span>
                        ))}
                    </div>
                </div>
            </At>
            <Cursor a="egu-cursor" click="egu-ring" rest={[196, 250]} />
        </Stage>
    );
}
