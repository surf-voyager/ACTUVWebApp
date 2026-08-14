export const EMPTY_GEOFENCE_ALERT = Object.freeze({
    active: false,
    missionActive: false,
    customPolygonBreached: false,
    px4StatusAvailable: false,
    source: 'PX4_STATUSTEXT',
    fenceKind: 'CUSTOM_POLYGON'
});

export const GEOFENCE_ALERT_DISPLAY_DURATION_MS = 10_000;

export function normalizeGeofenceAlert(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return {...EMPTY_GEOFENCE_ALERT};
    }

    const missionActive = payload.mission_active === true;
    const customPolygonBreached = payload.custom_polygon_breached === true;
    const px4StatusAvailable = payload.px4_status_available === true;

    return {
        active: payload.active === true
            && missionActive
            && customPolygonBreached
            && px4StatusAvailable,
        missionActive,
        customPolygonBreached,
        px4StatusAvailable,
        source: String(payload.source || 'PX4_STATUSTEXT'),
        fenceKind: String(payload.fence_kind || 'CUSTOM_POLYGON')
    };
}
