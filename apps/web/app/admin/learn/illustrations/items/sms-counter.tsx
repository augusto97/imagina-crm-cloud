import { At, C, Keyframes, Stage, T, tone } from '../kit';

/**
 * El contador de SMS: el mensaje con tildes ocupa 2 SMS (cada uno de 70
 * caracteres); al marcar «Quitar tildes» entra en 1 (de 160).
 */

const CSS = `
@keyframes sc-a{0%,44%{opacity:1}48%,100%{opacity:0}}
@keyframes sc-b{0%,46%{opacity:0}50%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes sc-check{0%,40%{background:transparent;border-color:${C.border}}44%,92%{background:hsl(var(--imcrm-primary));border-color:hsl(var(--imcrm-primary))}97%,100%{background:transparent}}
@keyframes sc-tick{0%,42%{opacity:0}46%,92%{opacity:1}97%,100%{opacity:0}}
`;

const WITH = 'Hola Ana, tu cuota vence en 2 días. Si ya pagaste, ignora este mensaje. Más información aquí: acme.co/pago';
const WITHOUT = 'Hola Ana, tu cuota vence en 2 dias. Si ya pagaste, ignora este mensaje. Mas informacion aqui: acme.co/pago';

function Box({ text, a }: { text: string; a: string }): JSX.Element {
    return (
        <span data-a="" style={{ animationName: a, position: 'absolute', inset: 0, padding: 10, opacity: 0 }}>
            <T size={10} style={{ whiteSpace: 'normal', display: 'block', lineHeight: 1.45 }}>
                {text}
            </T>
        </span>
    );
}

export default function SmsCounter(): JSX.Element {
    return (
        <Stage label="El contador de SMS: con tildes el mensaje ocupa 2 SMS; al quitar las tildes entra en 1." tint="cyan">
            <Keyframes css={CSS} />
            <At
                x={60}
                y={40}
                w={360}
                h={220}
                style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, padding: 14, boxShadow: '0 16px 36px -18px rgba(15,23,42,.5)' }}
            >
                <T size={9} weight={700} color={C.mutedFg}>
                    Mensaje
                </T>
                <div style={{ position: 'relative', marginTop: 6, height: 84, border: `1px solid ${C.border}`, borderRadius: 8, background: C.canvas }}>
                    <Box text={WITH} a="sc-a" />
                    <Box text={WITHOUT} a="sc-b" />
                </div>
                <div style={{ position: 'relative', marginTop: 10, height: 16 }}>
                    <span data-a="" style={{ animationName: 'sc-a', position: 'absolute', left: 0, top: 0, opacity: 0, display: 'flex', gap: 8 }}>
                        <T size={10} weight={700} color={tone('amber')}>
                            2 SMS · 106 caracteres
                        </T>
                        <T size={9.5} color={C.mutedFg}>
                            con «í», «á» y «ó» cada SMS lleva 70
                        </T>
                    </span>
                    <span data-a="" style={{ animationName: 'sc-b', position: 'absolute', left: 0, top: 0, opacity: 0, display: 'flex', gap: 8 }}>
                        <T size={10} weight={700}>
                            1 SMS · 106 caracteres
                        </T>
                        <T size={9.5} color={tone('mint')}>
                            quedan 54 en este SMS
                        </T>
                    </span>
                </div>
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span
                        data-a=""
                        style={{ animationName: 'sc-check', width: 13, height: 13, borderRadius: 3, border: `1.5px solid ${C.border}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <span data-a="" style={{ animationName: 'sc-tick', color: C.primaryFg, fontSize: 9, fontWeight: 800, opacity: 0 }}>
                            ✓
                        </span>
                    </span>
                    <T size={10} weight={600}>
                        Quitar tildes para que entre en menos SMS
                    </T>
                </div>
            </At>
        </Stage>
    );
}
