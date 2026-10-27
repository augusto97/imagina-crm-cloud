import { Building2, GitBranch, User } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/** Pregunta condicional: al elegir «Empresa» aparecen Razón social y NIT; al volver a «Persona», se esconden. */

const CSS = `
@keyframes fc-cursor{0%{transform:translate(300px,250px);opacity:0}6%{opacity:1}16%,20%{transform:translate(212px,123px)}62%,67%{transform:translate(98px,123px);opacity:1}80%,100%{transform:translate(98px,123px);opacity:0}}
@keyframes fc-ring{0%,17%{opacity:0;transform:scale(.4)}19%{opacity:1;transform:scale(1)}23%{opacity:0;transform:scale(1.6)}63%{opacity:0;transform:scale(.4)}65%{opacity:1;transform:scale(1)}69%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fc-emp{0%,18%{background:${C.card};box-shadow:0 0 0 1px ${C.border}}21%,64%{background:${primary(0.1)};box-shadow:0 0 0 1.5px ${primary()}}67%,100%{background:${C.card};box-shadow:0 0 0 1px ${C.border}}}
@keyframes fc-per{0%,64%{background:${C.card};box-shadow:0 0 0 1px ${C.border}}67%,92%{background:${primary(0.1)};box-shadow:0 0 0 1.5px ${primary()}}97%,100%{background:${C.card};box-shadow:0 0 0 1px ${C.border}}}
@keyframes fc-block{0%,19%{height:0;opacity:0}28%,63%{height:72px;opacity:1}72%,100%{height:0;opacity:0}}
@keyframes fc-rest{0%,19%{transform:translateY(-72px)}28%,63%{transform:translateY(0)}72%,100%{transform:translateY(-72px)}}
@keyframes fc-true{0%,20%{background:${C.muted};color:${C.mutedFg}}25%,63%{background:${tone('mint', 0.18)};color:${tone('mint')}}68%,100%{background:${C.muted};color:${C.mutedFg}}}
@keyframes fc-truetxt{0%,20%{opacity:0}25%,63%{opacity:1}68%,100%{opacity:0}}
@keyframes fc-falsetxt{0%,20%{opacity:1}25%,63%{opacity:0}68%,100%{opacity:1}}
`;

function Q({ label, cond }: { label: string; cond?: boolean }): JSX.Element {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <T size={8} weight={700}>
                    {label}
                </T>
                {cond && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 5px', borderRadius: 99, background: primary(0.12), color: primary() }}>
                        <GitBranch size={7} />
                        <T size={6.5} weight={700} color={primary()}>
                            si es empresa
                        </T>
                    </span>
                )}
            </span>
            <span style={{ height: 17, borderRadius: 5, border: `1px solid ${C.border}` }} />
        </div>
    );
}

function Opt({ label, icon, a, selected }: { label: string; icon: JSX.Element; a: string; selected?: boolean }): JSX.Element {
    return (
        <span
            data-a=""
            style={{
                flex: 1,
                height: 24,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                background: selected ? primary(0.1) : C.card,
                boxShadow: selected ? `0 0 0 1.5px ${primary()}` : `0 0 0 1px ${C.border}`,
                animationName: a,
            }}
        >
            <span style={{ color: C.mutedFg, display: 'flex' }}>{icon}</span>
            <T size={8.5} weight={600}>
                {label}
            </T>
        </span>
    );
}

export default function FormConditional(): JSX.Element {
    return (
        <Stage label="Un formulario con una pregunta condicional: al elegir Empresa aparecen las preguntas Razón social y NIT; al elegir Persona, se esconden." tint="violet">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* El formulario */}
                <At
                    x={30}
                    y={20}
                    w={250}
                    h={260}
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 12px 30px -14px rgba(15,23,42,.35)' }}
                >
                    <div style={{ height: 4, background: primary() }} />
                    <At x={14} y={14}>
                        <T size={12} weight={800}>
                            Inscripción de clientes
                        </T>
                    </At>
                    <At x={14} y={38} w={222}>
                        <Q label="Nombre completo" />
                    </At>
                    <At x={14} y={70}>
                        <T size={8} weight={700}>
                            ¿Eres persona o empresa?
                        </T>
                    </At>
                    <At x={14} y={86} w={222} style={{ display: 'flex', gap: 8 }}>
                        <Opt label="Persona" icon={<User size={10} />} a="fc-per" />
                        <Opt label="Empresa" icon={<Building2 size={10} />} a="fc-emp" selected />
                    </At>
                    {/* Las condicionales */}
                    <At x={14} y={118} w={222} a="fc-block" style={{ height: 72, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <Q label="Razón social" cond />
                        <Q label="NIT" cond />
                    </At>
                    {/* Lo que sigue */}
                    <At x={14} y={194} w={222} a="fc-rest" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                        <Q label="Correo" />
                        <span style={{ height: 22, borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <T size={8.5} weight={700} color={C.primaryFg}>
                                Enviar
                            </T>
                        </span>
                    </At>
                </At>

                {/* La condición, como en el constructor */}
                <At
                    x={300}
                    y={74}
                    w={160}
                    h={150}
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 11, display: 'flex', flexDirection: 'column', gap: 7, boxShadow: '0 12px 30px -14px rgba(15,23,42,.35)' }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ color: primary(), display: 'flex' }}>
                            <GitBranch size={11} />
                        </span>
                        <T size={9} weight={800}>
                            Mostrar sólo si…
                        </T>
                    </span>
                    {(
                        [
                            ['Pregunta que controla', '¿Persona o empresa?'],
                            ['Comparación', 'es'],
                            ['Valor', 'Empresa'],
                        ] as const
                    ).map(([l, v]) => (
                        <span key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <T size={6.5} weight={600} color={C.mutedFg}>
                                {l}
                            </T>
                            <span style={{ height: 15, borderRadius: 4, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 5px' }}>
                                <T size={7.5} weight={600}>
                                    {v}
                                </T>
                            </span>
                        </span>
                    ))}
                    <span
                        data-a=""
                        style={{
                            position: 'relative',
                            height: 18,
                            borderRadius: 99,
                            background: tone('mint', 0.18),
                            color: tone('mint'),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            animationName: 'fc-true',
                        }}
                    >
                        <span data-a="" style={{ position: 'absolute', animationName: 'fc-truetxt' }}>
                            <T size={7.5} weight={700} color="inherit">
                                Se cumple: se muestra
                            </T>
                        </span>
                        <span data-a="" style={{ position: 'absolute', opacity: 0, animationName: 'fc-falsetxt' }}>
                            <T size={7.5} weight={700} color="inherit">
                                No se cumple: se esconde
                            </T>
                        </span>
                    </span>
                </At>
                <Cursor a="fc-cursor" click="fc-ring" rest={[212, 123]} />
            </At>
        </Stage>
    );
}
