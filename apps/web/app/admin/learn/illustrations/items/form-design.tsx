import { Palette, Type } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Diseño de un formulario: a la izquierda la galería de plantillas; al tocar
 * cada una, el mismo formulario cambia de cara a la derecha (Clásico →
 * Oscuro → Píldoras), con sus colores, esquinas y botón.
 */

const CSS = `
@keyframes fds-p1{0%,30%{opacity:1}34%,96%{opacity:0}100%{opacity:1}}
@keyframes fds-p2{0%,30%{opacity:0}34%,63%{opacity:1}67%,100%{opacity:0}}
@keyframes fds-p3{0%,63%{opacity:0}67%,96%{opacity:1}100%{opacity:0}}
@keyframes fds-s1{0%,30%{box-shadow:0 0 0 2px ${primary()}}34%,96%{box-shadow:0 0 0 1px ${C.border}}100%{box-shadow:0 0 0 2px ${primary()}}}
@keyframes fds-s2{0%,30%{box-shadow:0 0 0 1px ${C.border}}34%,63%{box-shadow:0 0 0 2px ${primary()}}67%,100%{box-shadow:0 0 0 1px ${C.border}}}
@keyframes fds-s3{0%,63%{box-shadow:0 0 0 1px ${C.border}}67%,96%{box-shadow:0 0 0 2px ${primary()}}100%{box-shadow:0 0 0 1px ${C.border}}}
@keyframes fds-cur{0%,30%{transform:translate(122px,66px)}34%,63%{transform:translate(122px,120px)}67%,100%{transform:translate(122px,174px)}}
@keyframes fds-ring{0%,1%{opacity:0;transform:scale(.4)}3%{opacity:1;transform:scale(1)}8%,33%{opacity:0;transform:scale(1.6)}35%{opacity:1;transform:scale(1)}40%,66%{opacity:0;transform:scale(1.6)}68%{opacity:1;transform:scale(1)}73%,100%{opacity:0;transform:scale(1.6)}}
`;

interface Look {
    page: string;
    card: string;
    text: string;
    muted: string;
    inputBg: string;
    inputBorder: string;
    inputRadius: number;
    btn: string;
    btnText: string;
    btnRadius: number;
    btnFull: boolean;
    band: boolean;
    font: string;
}

const CLASSIC: Look = {
    page: '#f4f5f7',
    card: '#ffffff',
    text: '#1f2933',
    muted: '#6b7280',
    inputBg: '#ffffff',
    inputBorder: '#d6dae0',
    inputRadius: 5,
    btn: primary(),
    btnText: '#ffffff',
    btnRadius: 5,
    btnFull: false,
    band: true,
    font: 'inherit',
};
const DARK: Look = {
    page: '#0f1115',
    card: '#181b21',
    text: '#f3f4f6',
    muted: '#9aa3af',
    inputBg: '#20242c',
    inputBorder: '#323844',
    inputRadius: 6,
    btn: tone('violet'),
    btnText: '#ffffff',
    btnRadius: 6,
    btnFull: false,
    band: false,
    font: 'Georgia, serif',
};
const PILLS: Look = {
    page: tone('mint', 0.18),
    card: '#ffffff',
    text: '#1f2933',
    muted: '#6b7280',
    inputBg: '#ffffff',
    inputBorder: '#d6dae0',
    inputRadius: 99,
    btn: tone('mint'),
    btnText: '#ffffff',
    btnRadius: 99,
    btnFull: true,
    band: false,
    font: 'inherit',
};

function Preview({ look, a }: { look: Look; a: string }): JSX.Element {
    return (
        <At x={0} y={0} w={262} h={252} a={a} style={{ opacity: 0, background: look.page, borderRadius: 12, padding: 16 }}>
            <div style={{ position: 'relative', background: look.card, borderRadius: look.inputRadius > 20 ? 18 : 10, overflow: 'hidden', boxShadow: '0 12px 28px -14px rgba(15,23,42,.45)', height: 220 }}>
                {look.band ? <div style={{ height: 4, background: primary() }} /> : null}
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <T size={12} weight={800} color={look.text} style={{ fontFamily: look.font }}>
                        Pide tu cotización
                    </T>
                    <T size={7.5} color={look.muted} style={{ whiteSpace: 'normal' }}>
                        Te respondemos en menos de 24 horas.
                    </T>
                    {['Nombre', 'Correo', 'Qué necesitas'].map((l) => (
                        <span key={l} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <T size={7.5} weight={700} color={look.text}>
                                {l}
                            </T>
                            <span style={{ height: 17, borderRadius: look.inputRadius, border: `1px solid ${look.inputBorder}`, background: look.inputBg }} />
                        </span>
                    ))}
                    <span
                        style={{
                            marginTop: 2,
                            alignSelf: look.btnFull ? 'stretch' : 'flex-start',
                            height: 21,
                            padding: '0 16px',
                            borderRadius: look.btnRadius,
                            background: look.btn,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <T size={8} weight={700} color={look.btnText}>
                            Enviar
                        </T>
                    </span>
                </div>
            </div>
        </At>
    );
}

function Swatch({ y, a, name, look }: { y: number; a: string; name: string; look: Look }): JSX.Element {
    return (
        <At
            x={14}
            y={y}
            w={150}
            h={46}
            a={a}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', borderRadius: 8, background: C.card, boxShadow: `0 0 0 1px ${C.border}` }}
        >
            <span style={{ width: 38, height: 30, borderRadius: 5, background: look.page, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${C.border}` }}>
                <span style={{ width: 24, height: 18, borderRadius: look.inputRadius > 20 ? 8 : 3, background: look.card, display: 'flex', alignItems: 'flex-end', padding: 2 }}>
                    <span style={{ width: look.btnFull ? '100%' : 9, height: 4, borderRadius: look.btnRadius > 20 ? 9 : 1, background: look.btn }} />
                </span>
            </span>
            <T size={8.5} weight={700}>
                {name}
            </T>
        </At>
    );
}

export default function FormDesign(): JSX.Element {
    return (
        <Stage label="La galería de plantillas del formulario: al elegir Clásico, Oscuro o Píldoras, el mismo formulario cambia sus colores, sus esquinas y su botón en la vista previa." cycle={9} tint="mint">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Panel de diseño */}
                <At x={20} y={24} w={178} h={252} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.35)' }}>
                    <At x={14} y={14} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Palette size={10} color={primary()} />
                        <T size={7} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                            PLANTILLAS DE DISEÑO
                        </T>
                    </At>
                    <Swatch y={40} a="fds-s1" name="Clásico" look={CLASSIC} />
                    <Swatch y={94} a="fds-s2" name="Oscuro" look={DARK} />
                    <Swatch y={148} a="fds-s3" name="Píldoras" look={PILLS} />
                    <At x={14} y={210} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Type size={9} color={C.mutedFg} />
                        <T size={7.5} color={C.mutedFg}>
                            Colores · Tipografía · Botón…
                        </T>
                    </At>
                    <Cursor a="fds-cur" click="fds-ring" rest={[122, 174]} />
                </At>

                {/* Vista previa */}
                <At x={204} y={24} w={262} h={252}>
                    <Preview look={CLASSIC} a="fds-p1" />
                    <Preview look={DARK} a="fds-p2" />
                    <Preview look={PILLS} a="fds-p3" />
                </At>
            </At>
        </Stage>
    );
}
