import { BlueLinky } from 'bluelinky';
import type { Logger } from 'homebridge';
import {
  AuthenticationError,
  KiaApiError,
  type ClimateOptions,
  type LoginResult,
  type VehicleState,
  type VehicleSummary,
} from './types.js';
import {
  CLIMATE_DURATION_MINUTES,
  DEFAULT_CLIMATE_TEMP_C,
  DEFAULT_LANGUAGE,
  LOGIN_TIMEOUT_MS,
  MAX_CLIMATE_TEMP_C,
  MIN_CLIMATE_TEMP_C,
} from '../settings.js';

export interface KiaClientOptions {
  username: string;
  password: string;
  pin: string;
  language?: string;
}

/**
 * Structural view of the bluelinky Vehicle methods we use. Declared locally so
 * we don't depend on bluelinky's internal type paths.
 */
interface BlVehicle {
  vin(): string;
  id(): string;
  name(): string;
  nickname(): string;
  status(input: { refresh: boolean; parsed: boolean }): Promise<unknown>;
  lock(): Promise<string>;
  unlock(): Promise<string>;
  start(config: {
    hvac: boolean;
    duration: number;
    temperature: number;
    defrost: boolean;
    heatedFeatures: number | boolean;
    unit?: 'C' | 'F';
  }): Promise<string>;
  stop(): Promise<string>;
}

type BlueLinkyCtorConfig = ConstructorParameters<typeof BlueLinky>[0];

/**
 * Subset of bluelinky's RawVehicleStatus (region EU) that we actually read.
 * Declared locally so we don't couple to bluelinky's internal type paths and so
 * the mapper degrades gracefully when fields are missing.
 */
interface EuRawStatus {
  doorLock?: boolean;
  doorOpen?: Record<string, number | undefined>;
  windowOpen?: Record<string, number | undefined>;
  trunkOpen?: boolean;
  hoodOpen?: boolean;
  engine?: boolean;
  airCtrlOn?: boolean;
  defrost?: boolean;
  lowFuelLight?: boolean;
  battery?: { batSoc?: number };
  dte?: { value?: number; unit?: number };
  tirePressureLamp?: Record<string, number | undefined>;
  evStatus?: {
    batteryCharge?: boolean;
    batteryStatus?: number;
    batteryPlugin?: number;
    drvDistance?: Array<{
      rangeByFuel?: {
        evModeRange?: { value?: number };
        totalAvailableRange?: { value?: number };
      };
    }>;
  };
  lastStatusDate?: string;
  dateTime?: string;
}

function parseNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function isOpen(value: number | undefined): boolean {
  return (value ?? 0) !== 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

const AUTH_HINTS = ['token', 'auth', 'login', 'session', 'credential', 'pin', '401', '403'];

function looksLikeAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return AUTH_HINTS.some((hint) => lower.includes(hint));
}

/**
 * Maps a bluelinky EU raw status payload into the region-agnostic VehicleState
 * the HomeKit accessory layer consumes.
 *
 * Note: the EU API does not expose ambient outside temperature or a fuel
 * percentage, so those remain null. EV charge, charging state and range are
 * available and are surfaced through the battery accessory.
 */
export function mapRawStatus(raw: EuRawStatus | null | undefined): VehicleState {
  const doors = raw?.doorOpen ?? {};
  const windows = raw?.windowOpen ?? {};
  const tire = raw?.tirePressureLamp ?? {};
  const ev = raw?.evStatus;
  const evRange = ev?.drvDistance?.[0]?.rangeByFuel?.evModeRange?.value;

  return {
    // Doors (1 = open)
    frontLeftDoorOpen: isOpen(doors.frontLeft),
    frontRightDoorOpen: isOpen(doors.frontRight),
    rearLeftDoorOpen: isOpen(doors.backLeft),
    rearRightDoorOpen: isOpen(doors.backRight),
    hoodOpen: raw?.hoodOpen === true,
    trunkOpen: raw?.trunkOpen === true,

    // Lock
    locked: raw?.doorLock === true,

    // Engine / climate
    engineRunning: raw?.engine === true,
    airControlOn: raw?.airCtrlOn === true,
    defrostOn: raw?.defrost === true,

    // Ambient temperature is not provided by the EU API.
    outsideTemperature: null,

    // 12V battery
    batteryPercentage: parseNumber(raw?.battery?.batSoc),

    // EV high-voltage battery
    evBatteryPercentage: parseNumber(ev?.batteryStatus),
    evCharging: ev?.batteryCharge === true,
    evPluggedIn: isOpen(ev?.batteryPlugin),
    evRange: parseNumber(evRange),

    // Fuel — percentage is not exposed; distance-to-empty is.
    fuelLevel: null,
    fuelLevelLow: raw?.lowFuelLight === true,
    fuelDrivingRange: parseNumber(raw?.dte?.value),

    // Windows (1 = open)
    frontLeftWindowOpen: isOpen(windows.frontLeft),
    frontRightWindowOpen: isOpen(windows.frontRight),
    rearLeftWindowOpen: isOpen(windows.backLeft),
    rearRightWindowOpen: isOpen(windows.backRight),

    // Tire pressure warning (any lamp lit)
    tirePressureWarning: Object.values(tire).some((v) => (v ?? 0) !== 0),

    // Odometer / location are fetched on demand elsewhere; not part of status.
    odometer: null,
    latitude: null,
    longitude: null,

    // Meta
    lastUpdated: raw?.lastStatusDate ?? raw?.dateTime ?? null,
  };
}

export class KiaApiClient {
  private client?: BlueLinky;
  private readonly vehicles = new Map<string, BlVehicle>();
  private summaries: VehicleSummary[] = [];

  constructor(
    private readonly log: Logger,
    private readonly options: KiaClientOptions,
  ) {}

  /**
   * Logs in via bluelinky. The constructor auto-logs-in and emits 'ready' with
   * the account's vehicles, or 'error' on failure.
   */
  login(): Promise<LoginResult> {
    return new Promise<LoginResult>((resolve) => {
      let settled = false;
      const finish = (result: LoginResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({ success: false, error: 'Timed out waiting for Kia Connect login' });
      }, LOGIN_TIMEOUT_MS);

      try {
        const config = {
          username: this.options.username,
          password: this.options.password,
          pin: this.options.pin,
          brand: 'kia',
          region: 'EU',
          language: this.options.language ?? DEFAULT_LANGUAGE,
          autoLogin: true,
        };

        const client = new BlueLinky(config as unknown as BlueLinkyCtorConfig);

        client.on('ready', (vehicles: BlVehicle[]) => {
          this.client = client;
          this.indexVehicles(vehicles);
          this.log.info(`Logged in to Kia Connect (EU); found ${this.summaries.length} vehicle(s)`);
          finish({ success: true });
        });

        client.on('error', (error: unknown) => {
          finish({ success: false, error: errorMessage(error) });
        });
      } catch (error) {
        finish({ success: false, error: errorMessage(error) });
      }
    });
  }

  async getVehicles(): Promise<VehicleSummary[]> {
    if (this.summaries.length > 0) {
      return this.summaries;
    }
    if (!this.client) {
      throw new AuthenticationError('Not logged in to Kia Connect');
    }
    const vehicles = await this.client.getVehicles();
    this.indexVehicles(vehicles as unknown as BlVehicle[]);
    return this.summaries;
  }

  async getVehicleStatus(vehicleKey: string, refresh = false): Promise<VehicleState> {
    return this.withRelogin(async () => {
      const vehicle = this.requireVehicle(vehicleKey);
      const raw = await vehicle.status({ refresh, parsed: false });
      return mapRawStatus(raw as EuRawStatus | null);
    }, 'fetch vehicle status');
  }

  async lockDoors(vehicleKey: string): Promise<string> {
    return this.withRelogin(async () => (await this.requireVehicle(vehicleKey).lock()) ?? '', 'lock doors');
  }

  async unlockDoors(vehicleKey: string): Promise<string> {
    return this.withRelogin(async () => (await this.requireVehicle(vehicleKey).unlock()) ?? '', 'unlock doors');
  }

  async startClimate(vehicleKey: string, options?: ClimateOptions): Promise<string> {
    const temperature = clamp(
      options?.temperature ?? DEFAULT_CLIMATE_TEMP_C,
      MIN_CLIMATE_TEMP_C,
      MAX_CLIMATE_TEMP_C,
    );
    return this.withRelogin(async () => {
      const result = await this.requireVehicle(vehicleKey).start({
        hvac: true,
        duration: CLIMATE_DURATION_MINUTES,
        temperature,
        defrost: options?.defrost ?? false,
        heatedFeatures: false,
        unit: 'C',
      });
      return result ?? '';
    }, 'start climate');
  }

  async stopClimate(vehicleKey: string): Promise<string> {
    return this.withRelogin(async () => (await this.requireVehicle(vehicleKey).stop()) ?? '', 'stop climate');
  }

  /**
   * bluelinky resolves command calls once the server accepts them, so there is
   * no separate transaction to poll. Retained for accessory-layer compatibility.
   */
  async waitForAction(_vehicleKey: string, _actionId: string): Promise<boolean> {
    return true;
  }

  /**
   * Runs an operation, transparently re-authenticating once if it fails with a
   * session/device error (e.g. the EU "Invalid deviceId" after a token expires).
   * The operation must re-resolve its vehicle on each call, since re-login
   * rebuilds the vehicle objects. PIN failures are never retried — that would
   * waste limited PIN attempts.
   */
  private async withRelogin<T>(operation: () => Promise<T>, action: string): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const message = errorMessage(error);
      if (!this.isRecoverableSessionError(message)) {
        throw this.wrapError(error, action);
      }

      this.log.warn(`Kia session expired while trying to ${action}; re-authenticating...`);
      const result = await this.login();
      if (!result.success) {
        throw new AuthenticationError(`Re-authentication failed: ${result.error ?? 'unknown error'}`);
      }

      try {
        return await operation();
      } catch (retryError) {
        throw this.wrapError(retryError, action);
      }
    }
  }

  private isRecoverableSessionError(message: string): boolean {
    const lower = message.toLowerCase();
    // Never re-login for PIN problems — re-login won't fix them and each retry
    // burns a limited PIN attempt.
    if (lower.includes('4003') || (lower.includes('pin') && lower.includes('invalid'))) {
      return false;
    }
    return ['deviceid', '4002', 'token', 'session', 'unauthorized', '401', 'expired']
      .some((hint) => lower.includes(hint));
  }

  private indexVehicles(vehicles: BlVehicle[]): void {
    this.vehicles.clear();
    this.summaries = vehicles.map((vehicle) => {
      const vin = this.safeCall(() => vehicle.vin());
      const id = this.safeCall(() => vehicle.id());
      const nickname = this.safeCall(() => vehicle.nickname());
      const model = this.safeCall(() => vehicle.name());
      const key = vin || id;
      if (key) {
        this.vehicles.set(key, vehicle);
      }
      return {
        id,
        vin,
        key,
        name: nickname || model || 'Kia Vehicle',
        model: model || 'Kia',
      };
    });
  }

  private safeCall(fn: () => string | undefined): string {
    try {
      return fn() ?? '';
    } catch {
      return '';
    }
  }

  private requireVehicle(vehicleKey: string): BlVehicle {
    const vehicle = this.vehicles.get(vehicleKey);
    if (!vehicle) {
      throw new KiaApiError(`Vehicle ${vehicleKey} is not available`);
    }
    return vehicle;
  }

  private wrapError(error: unknown, action: string): KiaApiError {
    if (error instanceof KiaApiError) {
      return error;
    }
    const message = `Failed to ${action}: ${errorMessage(error)}`;
    return looksLikeAuthError(message)
      ? new AuthenticationError(message)
      : new KiaApiError(message);
  }
}
