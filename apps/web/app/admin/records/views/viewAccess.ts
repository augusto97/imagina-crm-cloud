import { getBootData } from '@/lib/boot';
import type { SavedViewEntity } from '@/types/view';

/**
 * v0.1.260 — las mismas reglas que el backend (views.service): una vista
 * PROTEGIDA sólo la cambia quien la creó o un admin; hacerla privada o
 * compartirla, sólo su autor (o un admin si la vista no tiene autor).
 */
type Who = { userId: number; isAdmin: boolean };

function me(): Who {
    const boot = getBootData();
    return { userId: boot.user.id, isAdmin: boot.user.capabilities.workspace_admin === true };
}

export function canWriteView(view: Pick<SavedViewEntity, 'is_locked' | 'created_by'>, who: Who = me()): boolean {
    return !view.is_locked || view.created_by === who.userId || who.isAdmin;
}

export function isViewOwner(view: Pick<SavedViewEntity, 'created_by'>, who: Who = me()): boolean {
    return view.created_by === who.userId || ((view.created_by ?? null) === null && who.isAdmin);
}
