export const EMPTY_GEOFENCE_ALERT = Object.freeze({
    active: false,
    missionActive: false,
    customPolygonBreached: false,
    px4StatusAvailable: false,
    breachEventId: null,
    source: 'PX4_STATUSTEXT',
    fenceKind: 'CUSTOM_POLYGON'
});

export const GEOFENCE_ALERT_DISPLAY_DURATION_MS = 10_000;

export function shouldPresentGeofenceAlert(alert, lastShownEventId) {
    if (!alert?.active) return false;
    if (!alert.breachEventId) return true;
    return alert.breachEventId !== String(lastShownEventId || '');
}

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
        breachEventId: payload.breach_event_id === null
            || payload.breach_event_id === undefined
            ? null
            : String(payload.breach_event_id),
        source: String(payload.source || 'PX4_STATUSTEXT'),
        fenceKind: String(payload.fence_kind || 'CUSTOM_POLYGON')
    };
}
