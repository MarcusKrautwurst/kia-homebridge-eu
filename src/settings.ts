export const PLATFORM_NAME = 'KiaConnectEU';
export const PLUGIN_NAME = 'homebridge-kia-eu';

export const DEFAULT_POLL_INTERVAL_MINUTES = 15;
export const MIN_POLL_INTERVAL_MINUTES = 5;

// bluelinky EU defaults
export const DEFAULT_REGION = 'EU';
export const DEFAULT_BRAND = 'kia';
export const DEFAULT_LANGUAGE = 'en';

// Remote climate is configured in Celsius for the EU API.
export const DEFAULT_CLIMATE_TEMP_C = 21;
export const MIN_CLIMATE_TEMP_C = 14;
export const MAX_CLIMATE_TEMP_C = 30;
export const CLIMATE_DURATION_MINUTES = 10;

// HomeKit StatusLowBattery threshold (percent).
export const LOW_BATTERY_THRESHOLD = 20;

// Give bluelinky's login/handshake a bounded window before we treat it as failed.
export const LOGIN_TIMEOUT_MS = 60_000;
