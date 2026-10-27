import { useCallback } from 'react';

import { useIsSuperadmin } from '@/hooks/usePlatform';

import type { LearnArticleMeta, LearnModuleMeta } from './content/types';

/** Qué módulos y artículos ve esta persona (lo del operador, sólo el superadmin). */
export function useLearnVisibility(): (m: LearnModuleMeta, a?: LearnArticleMeta) => boolean {
    const isSuperadmin = useIsSuperadmin();
    return useCallback(
        (m: LearnModuleMeta, a?: LearnArticleMeta) => {
            if (m.operatorOnly && !isSuperadmin) return false;
            if (a?.operatorOnly && !isSuperadmin) return false;
            return true;
        },
        [isSuperadmin],
    );
}
