import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraOff, Flashlight, Keyboard, Loader2, RefreshCw, SwitchCamera } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { __ } from '@/lib/i18n';
import { browserName, deviceInfo } from '@/lib/pwa/platform';
import { createFrameDecoder, type FrameDecoder } from '@/lib/scan/decoder';
import { cn } from '@/lib/utils';

/** Cada cuánto se lee un cuadro (≈ 5 por segundo: rápido y sin calentar el teléfono). */
const FRAME_MS = 200;
/** En el escaneo continuo, el MISMO código se ignora este tiempo (está delante de la cámara). */
const SAME_CODE_MS = 2500;

type CameraState =
    | { kind: 'starting' }
    | { kind: 'scanning' }
    | { kind: 'paused' }
    | { kind: 'denied' }
    | { kind: 'no-camera' }
    | { kind: 'busy' }
    | { kind: 'unsupported' }
    | { kind: 'error'; message: string };

/**
 * H3 — La cámara y la lectura de códigos (QR y de barras).
 *
 * `continuous`: sigue leyendo después de cada código (inventario, entradas a
 * un evento); si no, se detiene en el primero. Siempre ofrece escribir el
 * código a mano (cámara bloqueada, sin cámara o un código dañado).
 */
export function CodeScanner({
    onCode,
    continuous = false,
    paused = false,
    className,
}: {
    /** Un código leído (o escrito). En modo único la cámara ya se detuvo. */
    onCode: (code: string) => void;
    continuous?: boolean;
    /** Detener la lectura (p. ej. mientras se muestra un resultado). */
    paused?: boolean;
    className?: string;
}): JSX.Element {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const decoderRef = useRef<FrameDecoder | null>(null);
    const lastRef = useRef<{ code: string; at: number } | null>(null);
    const onCodeRef = useRef(onCode);
    onCodeRef.current = onCode;
    const [state, setState] = useState<CameraState>({ kind: 'starting' });
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    const [cameraIndex, setCameraIndex] = useState<number | null>(null);
    const [torch, setTorch] = useState<boolean | null>(null);
    const [manual, setManual] = useState(false);
    const [typed, setTyped] = useState('');
    const [attempt, setAttempt] = useState(0);
    const stoppedRef = useRef(false);

    const stop = useCallback((): void => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
    }, []);

    // Encender la cámara (y apagarla al salir).
    useEffect(() => {
        let cancelled = false;
        stoppedRef.current = false;
        const start = async (): Promise<void> => {
            setState({ kind: 'starting' });
            if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
                setState({ kind: 'unsupported' });
                return;
            }
            try {
                const deviceId = cameraIndex !== null ? cameras[cameraIndex]?.deviceId : undefined;
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: deviceId
                        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
                        : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
                });
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                streamRef.current = stream;
                const video = videoRef.current;
                if (video) {
                    video.srcObject = stream;
                    await video.play().catch(() => undefined);
                }
                const track = stream.getVideoTracks()[0];
                const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
                setTorch(caps.torch ? false : null);
                // Con el permiso ya dado, la lista trae los nombres de las cámaras.
                const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
                if (!cancelled) setCameras(devices.filter((d) => d.kind === 'videoinput'));
                decoderRef.current ??= await createFrameDecoder();
                if (!cancelled) setState({ kind: 'scanning' });
            } catch (err) {
                if (cancelled) return;
                const name = err instanceof DOMException ? err.name : '';
                if (name === 'NotAllowedError' || name === 'SecurityError') setState({ kind: 'denied' });
                else if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') setState({ kind: 'no-camera' });
                else if (name === 'NotReadableError' || name === 'TrackStartError') setState({ kind: 'busy' });
                else setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
            }
        };
        void start();
        return () => {
            cancelled = true;
            stoppedRef.current = true;
            stop();
        };
        // `cameras` cambia DESPUÉS de encender: no tiene que volver a encender.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cameraIndex, attempt, stop]);

    // El ciclo de lectura.
    useEffect(() => {
        if (state.kind !== 'scanning' || paused) return;
        let timer = 0;
        let busy = false;
        const tick = async (): Promise<void> => {
            const video = videoRef.current;
            const decoder = decoderRef.current;
            if (!busy && video && decoder && video.readyState >= 2 && !stoppedRef.current) {
                busy = true;
                try {
                    const codes = await decoder.decode(video);
                    const code = codes[0];
                    if (code) {
                        const last = lastRef.current;
                        const now = Date.now();
                        const repeated = last !== null && last.code === code && now - last.at < SAME_CODE_MS;
                        lastRef.current = { code, at: now };
                        if (!repeated) {
                            if (!continuous) {
                                stoppedRef.current = true;
                                stop();
                                setState({ kind: 'paused' });
                            }
                            onCodeRef.current(code);
                            if (!continuous) return;
                        }
                    }
                } catch {
                    /* un cuadro que no se pudo leer: se sigue con el próximo */
                } finally {
                    busy = false;
                }
            }
            timer = window.setTimeout(() => void tick(), FRAME_MS);
        };
        timer = window.setTimeout(() => void tick(), FRAME_MS);
        return () => window.clearTimeout(timer);
    }, [state.kind, paused, continuous, stop]);

    const toggleTorch = async (): Promise<void> => {
        const track = streamRef.current?.getVideoTracks()[0];
        if (!track || torch === null) return;
        try {
            await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
            setTorch(!torch);
        } catch {
            setTorch(null);
        }
    };

    const submitTyped = (e: React.FormEvent): void => {
        e.preventDefault();
        const code = typed.trim();
        if (code === '') return;
        setTyped('');
        onCodeRef.current(code);
    };

    const problem = cameraProblem(state);

    return (
        <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-3', className)} data-testid="code-scanner" data-scan-state={state.kind}>
            <div className="imcrm-relative imcrm-aspect-[4/3] imcrm-w-full imcrm-overflow-hidden imcrm-rounded-lg imcrm-bg-black">
                <video
                    ref={videoRef}
                    muted
                    playsInline
                    className={cn('imcrm-h-full imcrm-w-full imcrm-object-cover', problem && 'imcrm-hidden')}
                    aria-label={__('Imagen de la cámara')}
                />
                {state.kind === 'starting' && (
                    <div className="imcrm-absolute imcrm-inset-0 imcrm-flex imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-text-sm imcrm-text-white/80">
                        <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin" />
                        {__('Encendiendo la cámara…')}
                    </div>
                )}
                {(state.kind === 'scanning' || state.kind === 'paused') && !problem && (
                    // El recuadro donde poner el código.
                    <div className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-0 imcrm-flex imcrm-items-center imcrm-justify-center">
                        <div className="imcrm-h-[55%] imcrm-w-[70%] imcrm-rounded-xl imcrm-border-2 imcrm-border-white/80 imcrm-shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                        {paused || state.kind === 'paused' ? null : (
                            <div className="imcrm-absolute imcrm-left-[15%] imcrm-right-[15%] imcrm-top-1/2 imcrm-h-0.5 imcrm-animate-pulse imcrm-bg-primary" />
                        )}
                    </div>
                )}
                {problem && (
                    <div
                        className="imcrm-absolute imcrm-inset-0 imcrm-flex imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-bg-muted imcrm-p-4 imcrm-text-center imcrm-text-sm imcrm-text-foreground"
                        data-testid="scan-problem"
                    >
                        <CameraOff className="imcrm-h-6 imcrm-w-6 imcrm-text-muted-foreground" aria-hidden />
                        <p className="imcrm-font-medium">{problem.title}</p>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">{problem.hint}</p>
                        {problem.retry && (
                            <Button type="button" variant="outline" size="sm" className="imcrm-mt-1" onClick={() => setAttempt((a) => a + 1)}>
                                <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Reintentar')}
                            </Button>
                        )}
                    </div>
                )}
                {(state.kind === 'scanning' || state.kind === 'paused') && (
                    <div className="imcrm-absolute imcrm-bottom-2 imcrm-right-2 imcrm-flex imcrm-gap-1.5">
                        {torch !== null && (
                            <button
                                type="button"
                                onClick={() => void toggleTorch()}
                                aria-pressed={torch}
                                aria-label={__('Linterna')}
                                className={cn('imcrm-rounded-full imcrm-p-2 imcrm-text-white', torch ? 'imcrm-bg-primary' : 'imcrm-bg-black/50 hover:imcrm-bg-black/70')}
                            >
                                <Flashlight className="imcrm-h-4 imcrm-w-4" />
                            </button>
                        )}
                        {cameras.length > 1 && (
                            <button
                                type="button"
                                onClick={() => setCameraIndex((i) => ((i ?? 0) + 1) % cameras.length)}
                                aria-label={__('Cambiar de cámara')}
                                className="imcrm-rounded-full imcrm-bg-black/50 imcrm-p-2 imcrm-text-white hover:imcrm-bg-black/70"
                            >
                                <SwitchCamera className="imcrm-h-4 imcrm-w-4" />
                            </button>
                        )}
                    </div>
                )}
            </div>

            {state.kind === 'paused' && !continuous ? null : (
                <p className="imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                    {state.kind === 'scanning'
                        ? continuous
                            ? __('Apunta a cada código: se busca solo y puedes seguir con el siguiente.')
                            : __('Apunta al código QR o de barras dentro del recuadro.')
                        : null}
                </p>
            )}

            {manual || problem ? (
                <form onSubmit={submitTyped} className="imcrm-flex imcrm-gap-2">
                    <Input
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        placeholder={__('Escribe el código')}
                        aria-label={__('Código')}
                        className="imcrm-h-9"
                        autoFocus={manual}
                        data-testid="scan-manual-input"
                    />
                    <Button type="submit" size="sm" className="imcrm-h-9" disabled={typed.trim() === ''}>
                        {__('Buscar')}
                    </Button>
                </form>
            ) : (
                <button
                    type="button"
                    onClick={() => setManual(true)}
                    className="imcrm-inline-flex imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground"
                >
                    <Keyboard className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Escribir el código a mano')}
                </button>
            )}
        </div>
    );
}

function cameraProblem(state: CameraState): { title: string; hint: string; retry: boolean } | null {
    switch (state.kind) {
        case 'denied':
            return { title: __('No hay permiso para usar la cámara'), hint: cameraUnblockHint(), retry: true };
        case 'no-camera':
            return { title: __('No encontramos una cámara'), hint: __('Conecta una cámara o escribe el código a mano.'), retry: true };
        case 'busy':
            return { title: __('La cámara está en uso'), hint: __('Cierra la otra app o pestaña que la está usando y vuelve a intentarlo.'), retry: true };
        case 'unsupported':
            return {
                title: __('Este navegador no permite usar la cámara aquí'),
                hint: __('La cámara sólo funciona con una conexión segura (https). Puedes escribir el código a mano.'),
                retry: false,
            };
        case 'error':
            return { title: __('No se pudo encender la cámara'), hint: state.message, retry: true };
        default:
            return null;
    }
}

/** Cómo dar el permiso de la cámara si se negó, según el navegador. */
export function cameraUnblockHint(): string {
    const info = deviceInfo();
    if (info.ios) {
        return info.standalone
            ? __('Abre los Ajustes del iPhone → busca la app → Cámara → actívala. Después toca Reintentar.')
            : __('Toca «aA» en la barra de Safari → Configuración del sitio web → Cámara → Permitir. Después toca Reintentar.');
    }
    const b = browserName();
    if (info.android) return __('Toca el candado junto a la dirección → Permisos → Cámara → Permitir. Después toca Reintentar.');
    if (b === 'firefox') return __('Haz clic en el icono de la cámara tachada junto a la dirección, quita el bloqueo y toca Reintentar.');
    if (b === 'safari') return __('En Safari → Ajustes → Sitios web → Cámara, elige «Permitir» para este sitio y toca Reintentar.');
    return __('Haz clic en el icono de la cámara (o el candado) junto a la dirección → Permitir, y toca Reintentar.');
}
