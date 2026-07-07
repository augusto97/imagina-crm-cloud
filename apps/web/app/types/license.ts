export type LicenseStatus =
    | 'inactive'
    | 'valid'
    | 'expired'
    | 'invalid'
    | 'site_limit_reached';

export interface LicenseState {
    /** Clave enmascarada (`abcd••••wxyz`) — la real solo vive en el servidor. */
    key: string;
    status: LicenseStatus;
    activated_at: string | null;
    expires_at: string | null;
    last_check_at: string | null;
    grace_until: string | null;
    site_limit: number | null;
    activations_count: number | null;
    message: string | null;
    is_valid: boolean;
    in_grace: boolean;
}
