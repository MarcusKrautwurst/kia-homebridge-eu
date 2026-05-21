import type { PlatformConfig } from 'homebridge';

export interface KiaConnectConfig extends PlatformConfig {
  username: string;
  password: string;
  /** Kia Connect PIN. Required by the EU API to mint a control token for commands. */
  pin: string;
  /** bluelinky region. Defaults to 'EU'. */
  region?: string;
  /** EU UI/notification language (ISO 639-1), e.g. 'en', 'de'. Defaults to 'en'. */
  language?: string;
  pollIntervalMinutes?: number;
  showLock?: boolean;
  showClimate?: boolean;
  showStatus?: boolean;
  showBody?: boolean;
  showBattery?: boolean;
  showMileage?: boolean;
  /** Remote climate target temperature in Celsius. */
  climateTemperature?: number;
  vehicleIndex?: number;
}

export interface VehicleSummary {
  id: string;
  name: string;
  model: string;
  /** Stable identifier used to look the vehicle up again (VIN, falling back to vehicle id). */
  key: string;
  vin: string;
}

export interface VehicleState {
  // Doors
  frontLeftDoorOpen: boolean;
  frontRightDoorOpen: boolean;
  rearLeftDoorOpen: boolean;
  rearRightDoorOpen: boolean;
  hoodOpen: boolean;
  trunkOpen: boolean;

  // Lock
  locked: boolean;

  // Engine / climate
  engineRunning: boolean;
  airControlOn: boolean;
  defrostOn: boolean;

  // Temperature (ambient; not exposed by the EU API, kept for shape compatibility)
  outsideTemperature: number | null;

  // 12V battery
  batteryPercentage: number | null;

  // EV high-voltage battery
  evBatteryPercentage: number | null;
  evCharging: boolean;
  evPluggedIn: boolean;
  evRange: number | null;

  // Fuel (combustion vehicles)
  fuelLevel: number | null;
  fuelLevelLow: boolean;
  fuelDrivingRange: number | null;

  // Windows
  frontLeftWindowOpen: boolean;
  frontRightWindowOpen: boolean;
  rearLeftWindowOpen: boolean;
  rearRightWindowOpen: boolean;

  // Tire
  tirePressureWarning: boolean;

  // Odometer
  odometer: number | null;

  // Location
  latitude: number | null;
  longitude: number | null;

  // Meta
  lastUpdated: string | null;
}

export type LoginResult =
  | { success: true }
  | { success: false; error?: string };

export interface ClimateOptions {
  /** Target temperature in Celsius. */
  temperature?: number;
  defrost?: boolean;
}

export class KiaApiError extends Error {
  constructor(
    message: string,
    public statusCode = 0,
    public errorCode = 0,
  ) {
    super(message);
    this.name = 'KiaApiError';
  }
}

export class AuthenticationError extends KiaApiError {
  constructor(message: string, statusCode = 0, errorCode = 0) {
    super(message, statusCode, errorCode);
    this.name = 'AuthenticationError';
  }
}
