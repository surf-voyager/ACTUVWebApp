import assert from 'node:assert/strict';
import test from 'node:test';

import {
    GEOFENCE_ALERT_DISPLAY_DURATION_MS,
    normalizeGeofenceAlert,
    shouldPresentGeofenceAlert
} from '../src/services/geofenceAlert.js';


test('geofence presentation lasts exactly ten seconds', () => {
    assert.equal(GEOFENCE_ALERT_DISPLAY_DURATION_MS, 10_000);
});


test('activates only for an available PX4 custom-polygon breach in a mission', () => {
    const alert = normalizeGeofenceAlert({
        active: true,
        mission_active: true,
        custom_polygon_breached: true,
        px4_status_available: true,
        breach_event_id: 'event-42',
        source: 'PX4_STATUSTEXT',
        fence_kind: 'CUSTOM_POLYGON'
    });

    assert.equal(alert.active, true);
    assert.equal(alert.fenceKind, 'CUSTOM_POLYGON');
    assert.equal(alert.breachEventId, 'event-42');
});

test('rejects stale or internally inconsistent active flags', () => {
    assert.equal(normalizeGeofenceAlert(null).active, false);
    assert.equal(normalizeGeofenceAlert({
        active: true,
        mission_active: true,
        custom_polygon_breached: true,
        px4_status_available: false
    }).active, false);
    assert.equal(normalizeGeofenceAlert({
        active: true,
        mission_active: false,
        custom_polygon_breached: true,
        px4_status_available: true
    }).active, false);
});

test('presents each breach event only once in a browser session', () => {
    const alert = {active: true, breachEventId: 'event-42'};
    assert.equal(shouldPresentGeofenceAlert(alert, null), true);
    assert.equal(shouldPresentGeofenceAlert(alert, 'event-42'), false);
    assert.equal(shouldPresentGeofenceAlert(alert, 'event-41'), true);
    assert.equal(shouldPresentGeofenceAlert({
        active: false,
        breachEventId: 'event-43'
    }, 'event-42'), false);
});
