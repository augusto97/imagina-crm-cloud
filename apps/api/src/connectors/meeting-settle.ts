import { safeWebhookFetch } from '../common/safe-fetch';
import { googleEventReadRequest, meetingResult, type MeetingResult } from './integration-calls';

/**
 * v0.1.384 — Google crea la sala de Meet un instante DESPUÉS del evento: si
 * volvió «pendiente», se vuelve a leer el evento hasta tener el enlace. Lo
 * usan el motor y «Probar ahora», así la prueba dice lo mismo que la corrida
 * de verdad (antes la prueba decía «sin enlace» aunque Meet sí se creara).
 */
export async function settleGoogleMeet(
    meet: MeetingResult | null,
    p: { integration: string; calendar: string; accessToken: string; tries?: number; delayMs?: number },
): Promise<MeetingResult | null> {
    if (p.integration !== 'google_calendar') return meet;
    let current = meet;
    const tries = p.tries ?? 2;
    for (let i = 0; i < tries && current && current.pending; i++) {
        await new Promise((r) => setTimeout(r, p.delayMs ?? 1500));
        const read = googleEventReadRequest(p.calendar, current.id, p.accessToken);
        const again = await safeWebhookFetch(read.url, {
            method: 'GET',
            headers: read.headers,
            captureBody: true,
            maxCaptureBytes: 64 * 1024,
            timeoutMs: 8000,
        }).catch(() => null);
        const next = again && again.status < 300 ? meetingResult('google_calendar', again.body ?? '') : null;
        if (next) current = next;
    }
    return current;
}
