import { ArrowRight, Check, Sparkles, Wallet } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary } from '../kit';

/**
 * Importar desde Mercado Pago: las suscripciones que ya cobraba la cuenta
 * pasan, una por una, a la lista «Suscriptores · Mercado Pago» con su estado,
 * y al final una nueva que se crea en Mercado Pago llega sola.
 */

const SUBS = [
    { who: 'ana@panaderiasol.co', plan: 'Mensual', status: 'Activa', ok: true },
    { who: 'pagos@gimnasionorte.co', plan: 'Mensual', status: 'Activa', ok: true },
    { who: 'luis@cafeaurora.co', plan: 'Trimestral', status: 'Pausada', ok: false },
];

// Cada fila sale de Mercado Pago y aparece en la lista.
const AT = [10, 26, 42];
const NEW_AT = 66;

const CSS = `
${AT.map((a, i) => `@keyframes ci-s${i}{0%,${a}%{opacity:1}${a + 6}%,100%{opacity:.35}}
@keyframes ci-r${i}{0%,${a + 4}%{opacity:0;transform:translateX(-14px)}${a + 10}%,94%{opacity:1;transform:translateX(0)}100%{opacity:0}}`).join('\n')}
@keyframes ci-arrow{0%,8%{opacity:0;transform:translateX(-6px)}14%,50%{opacity:1;transform:translateX(4px)}56%,100%{opacity:0}}
@keyframes ci-new{0%,${NEW_AT}%{opacity:0;transform:translateY(-10px) scale(.96)}${NEW_AT + 6}%,94%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0}}
@keyframes ci-badge{0%,${NEW_AT + 2}%{opacity:0;transform:scale(.7)}${NEW_AT + 8}%,94%{opacity:1;transform:scale(1)}100%{opacity:0}}
`;

function Row({ who, plan, status, ok }: (typeof SUBS)[number]): JSX.Element {
    return (
        <>
            <T size={7} weight={600} color={primary()}>
                {who}
            </T>
            <T size={7} color={C.mutedFg}>
                {plan}
            </T>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {ok && <Check size={8} color="#10B981" />}
                <T size={7} weight={700} color={ok ? '#059669' : C.mutedFg}>
                    {ok ? 'Al día' : status}
                </T>
            </span>
        </>
    );
}

const ROW_STYLE = {
    display: 'grid',
    gridTemplateColumns: '1.6fr .8fr .7fr',
    gap: 4,
    alignItems: 'center',
    padding: '5px 6px',
    borderRadius: 6,
    border: `1px solid ${C.border}`,
} as const;

export default function CobroImportar(): JSX.Element {
    return (
        <Stage
            label="A la izquierda, las suscripciones que ya cobraba la cuenta de Mercado Pago; una por una pasan a la lista «Suscriptores · Mercado Pago» con su estado, y al final una suscripción nueva llega sola."
            tint="blue"
        >
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.3 }}>
                <At
                    x={18}
                    y={40}
                    w={164}
                    h={210}
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, boxShadow: '0 14px 30px -16px rgba(15,23,42,.45)' }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Wallet size={13} color="#0EA5E9" />
                        <T size={10} weight={700}>
                            Mercado Pago
                        </T>
                    </span>
                    <span style={{ display: 'block', marginTop: 2 }}>
                        <T size={7} color={C.mutedFg}>
                            Suscripciones de tu cuenta
                        </T>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                        {SUBS.map((s, i) => (
                            <span
                                key={s.who}
                                data-a=""
                                style={{ display: 'block', padding: '6px 7px', borderRadius: 7, background: 'rgba(14,165,233,.08)', animationName: `ci-s${i}` }}
                            >
                                <T size={7} weight={600}>
                                    {s.who}
                                </T>
                                <span style={{ display: 'block' }}>
                                    <T size={6} color={C.mutedFg}>
                                        {s.plan} · {s.status}
                                    </T>
                                </span>
                            </span>
                        ))}
                    </span>
                </At>

                <At x={188} y={128} w={30} h={30} style={{ display: 'grid', placeItems: 'center' }}>
                    <span data-a="" style={{ display: 'inline-flex', animationName: 'ci-arrow' }}>
                        <ArrowRight size={20} color={primary()} />
                    </span>
                </At>

                <At
                    x={222}
                    y={40}
                    w={240}
                    h={210}
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, boxShadow: '0 14px 30px -16px rgba(15,23,42,.45)' }}
                >
                    <T size={10} weight={700}>
                        Suscriptores · Mercado Pago
                    </T>
                    <span style={{ display: 'grid', gridTemplateColumns: '1.6fr .8fr .7fr', gap: 4, marginTop: 10, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>
                        {['Suscriptor', 'Plan', 'Estado'].map((h) => (
                            <T key={h} size={6} weight={700} color={C.mutedFg}>
                                {h}
                            </T>
                        ))}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                        {SUBS.map((s, i) => (
                            <span key={s.who} data-a="" style={{ ...ROW_STYLE, animationName: `ci-r${i}` }}>
                                <Row {...s} />
                            </span>
                        ))}
                        <span data-a="" style={{ ...ROW_STYLE, background: primary(0.08), animationName: 'ci-new' }}>
                            <Row who="sofia@estudiolumen.co" plan="Mensual" status="Activa" ok />
                        </span>
                    </span>
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            right: 12,
                            bottom: 12,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '3px 8px',
                            borderRadius: 999,
                            background: primary(),
                            color: '#fff',
                            animationName: 'ci-badge',
                        }}
                    >
                        <Sparkles size={9} color="#fff" />
                        <T size={7} weight={700} color="#fff">
                            Llegó sola
                        </T>
                    </span>
                </At>
            </div>
        </Stage>
    );
}
