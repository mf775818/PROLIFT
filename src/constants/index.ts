export const RESIZE_DEFAULTS = {
    RIGHT_WIDTH: 760,
    MOBILE_VIDEO_HEIGHT_PCT: 45,
    CHART_HEIGHT_PCT: 55,
    MIN_RIGHT_WIDTH: 50,
    MIN_PCT: 20,
    MAX_PCT: 80,
};

export const PHYSICS_DEFAULTS = {
    BARBELL_MASS: 60,
    GRAVITY: 9.81, // m/s^2
};

export const TIME_CONSTANTS = {
    METRICS_THROTTLE_MS: 100, // Limit React state updates for 60fps telemetry to avoid dropping paints
    INIT_CHECK_INTERVAL_MS: 100,
    INIT_MAX_CHECKS: 300, // 30 seconds
};

export const UI_MESSAGES = {
    INIT_LOADING: 'INITIALIZING PROLIFT AI',
    INIT_SUBTEXT: 'Loading core computer vision and analysis engines to ensure industrial-grade accuracy.',
    INIT_RELOAD_CRITICAL: 'Critical Reload (F5)',
    INIT_RESTART: 'Force Restart Engines',
    INIT_WAITING: 'Please wait, analyzing environment...',
    STATUS_PROCESSING: 'PROCESSING...',
    STATUS_READY: 'READY',
};
