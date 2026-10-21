import { useEffect, useState } from 'react';

/** Reloj que avanza cada segundo mientras `ticking` (p. ej. un cronómetro a la vista). */
export function useNow(ticking: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!ticking) return undefined;
        setNow(Date.now());
        const t = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(t);
    }, [ticking]);
    return now;
}
