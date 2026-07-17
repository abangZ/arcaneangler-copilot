export const SITE_MAINTENANCE_CODE = 'SITE_MAINTENANCE';

export class SiteMaintenanceError extends Error {
    constructor(message = 'Arcane Angler 正在维护。') {
        super(message);
        this.name = 'SiteMaintenanceError';
        this.code = SITE_MAINTENANCE_CODE;
    }
}
