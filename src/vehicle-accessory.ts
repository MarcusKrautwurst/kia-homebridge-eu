import type {
  PlatformAccessory,
  Service,
  CharacteristicValue,
  WithUUID,
} from 'homebridge';
import type { KiaConnectPlatform } from './platform.js';
import type { KiaApiClient } from './kia/client.js';
import type { VehicleSummary, VehicleState } from './kia/types.js';
import type { AccessoryCategory } from './accessory-layout.js';
import { DEFAULT_CLIMATE_TEMP_C, LOW_BATTERY_THRESHOLD } from './settings.js';

type CommandKey = 'lock' | 'climate';
type ServiceKey = CommandKey | 'fuel-low' | 'engine' | 'tire' | 'battery' | 'mileage';

// HomeKit's ambient light level (used as a stand-in to display the odometer
// number, since HomeKit has no mileage characteristic) is bounded to this range.
const LIGHT_SENSOR_MIN = 0.0001;
const LIGHT_SENSOR_MAX = 100000;

// Subtypes from older versions that the EU API can't populate (no ambient temp,
// no fuel %). Removed on setup so stale, always-empty tiles disappear on upgrade.
const LEGACY_SUBTYPES: readonly { type: 'HumiditySensor' | 'TemperatureSensor'; subtype: string }[] = [
  { type: 'HumiditySensor', subtype: 'fuel' },
  { type: 'TemperatureSensor', subtype: 'temperature' },
];

export interface VehicleAccessoryInstance {
  updateState(state: VehicleState): void;
}

const CATEGORY_SERVICE_KEYS: Record<AccessoryCategory, readonly ServiceKey[]> = {
  lock: ['lock'],
  climate: ['climate'],
  status: ['fuel-low', 'engine', 'tire'],
  body: [], // Body sensors are individual accessories (see BODY_PARTS), not grouped services.
  battery: ['battery'],
  mileage: ['mileage'],
};

type BooleanStateKey = {
  [K in keyof VehicleState]: VehicleState[K] extends boolean ? K : never;
}[keyof VehicleState];

export interface BodyPart {
  subtype: string;
  name: string;
  stateKey: BooleanStateKey;
  kind: 'door' | 'window';
}

// Each body sensor is its own accessory so HomeKit can categorise it as a door or
// window (the HomeKit category is per-accessory, not per-service).
export const BODY_PARTS: readonly BodyPart[] = [
  { subtype: 'door-fl', name: 'Front Left Door', stateKey: 'frontLeftDoorOpen', kind: 'door' },
  { subtype: 'door-fr', name: 'Front Right Door', stateKey: 'frontRightDoorOpen', kind: 'door' },
  { subtype: 'door-rl', name: 'Rear Left Door', stateKey: 'rearLeftDoorOpen', kind: 'door' },
  { subtype: 'door-rr', name: 'Rear Right Door', stateKey: 'rearRightDoorOpen', kind: 'door' },
  { subtype: 'hood', name: 'Hood', stateKey: 'hoodOpen', kind: 'door' },
  { subtype: 'trunk', name: 'Trunk', stateKey: 'trunkOpen', kind: 'door' },
  { subtype: 'window-fl', name: 'Front Left Window', stateKey: 'frontLeftWindowOpen', kind: 'window' },
  { subtype: 'window-fr', name: 'Front Right Window', stateKey: 'frontRightWindowOpen', kind: 'window' },
  { subtype: 'window-rl', name: 'Rear Left Window', stateKey: 'rearLeftWindowOpen', kind: 'window' },
  { subtype: 'window-rr', name: 'Rear Right Window', stateKey: 'rearRightWindowOpen', kind: 'window' },
];

abstract class ConfiguredAccessory implements VehicleAccessoryInstance {
  private readonly services = new Map<ServiceKey, Service>();
  private currentState: VehicleState | null = null;
  private commandsInFlight = new Set<CommandKey>();
  private readonly categories: ReadonlySet<AccessoryCategory>;

  constructor(
    protected readonly platform: KiaConnectPlatform,
    protected readonly accessory: PlatformAccessory,
    protected readonly vehicle: VehicleSummary,
    private readonly options: {
      categories: readonly AccessoryCategory[];
      apiClient?: KiaApiClient;
      vehicleKey?: string;
      climateTemperature?: number;
    },
  ) {
    this.categories = new Set(options.categories);
    this.setupServices();
  }

  private setupServices(): void {
    const { Service, Characteristic } = this.platform;

    const infoService = this.accessory.getService(Service.AccessoryInformation) ??
      this.accessory.addService(Service.AccessoryInformation);
    infoService
      .setCharacteristic(Characteristic.Manufacturer, 'Kia')
      .setCharacteristic(Characteristic.Model, this.vehicle.model)
      .setCharacteristic(Characteristic.SerialNumber, this.vehicle.vin);

    // Drop services that older versions created but the EU API can never fill.
    for (const legacy of LEGACY_SUBTYPES) {
      this.removeServiceBySubtype(Service[legacy.type], legacy.subtype);
    }

    for (const category of Object.keys(CATEGORY_SERVICE_KEYS) as AccessoryCategory[]) {
      if (!this.categories.has(category)) {
        for (const subtype of CATEGORY_SERVICE_KEYS[category]) {
          this.removeServiceBySubtype(this.getServiceType(subtype), subtype);
          this.services.delete(subtype);
        }
      }
    }

    if (this.categories.has('lock')) {
      const lockService = this.getOrAddService(Service.LockMechanism, 'Door Lock', 'lock');
      lockService.getCharacteristic(Characteristic.LockTargetState)
        .onSet(this.handleLockSet.bind(this));
      this.services.set('lock', lockService);
    }

    if (this.categories.has('climate')) {
      const climateService = this.getOrAddService(Service.Switch, 'Climate', 'climate');
      climateService.getCharacteristic(Characteristic.On)
        .onSet(this.handleClimateSet.bind(this));
      this.services.set('climate', climateService);
    }

    if (this.categories.has('status')) {
      this.services.set('fuel-low', this.getOrAddService(Service.LeakSensor, 'Low Fuel Warning', 'fuel-low'));
      this.services.set('engine', this.getOrAddService(Service.OccupancySensor, 'Engine Running', 'engine'));
      this.services.set('tire', this.getOrAddService(Service.LeakSensor, 'Tire Pressure Warning', 'tire'));
    }

    if (this.categories.has('battery')) {
      this.services.set('battery', this.getOrAddService(Service.Battery, 'Battery', 'battery'));
    }

    if (this.categories.has('mileage')) {
      this.services.set('mileage', this.getOrAddService(Service.LightSensor, 'Odometer', 'mileage'));
    }
  }

  private removeServiceBySubtype(serviceType: WithUUID<typeof Service>, subtype: string): void {
    const existing = this.accessory.getServiceById(serviceType, subtype);
    if (existing) {
      this.platform.log.info(`Removing disabled service: ${subtype}`);
      this.accessory.removeService(existing);
    }
  }

  private getOrAddService(
    serviceType: WithUUID<typeof Service>,
    name: string,
    subtype: string,
  ): Service {
    const existing = this.accessory.getServiceById(serviceType, subtype);
    const service = existing ?? this.accessory.addService(serviceType, name, subtype);
    this.nameService(service, name);
    return service;
  }

  /**
   * Names a bundled service so the Apple Home app shows the per-service name
   * instead of the accessory name. Home honours ConfiguredName (not Name) for
   * tiles on a multi-service accessory; we set it once and then leave it so a
   * user's manual rename is preserved across restarts.
   */
  private nameService(service: Service, name: string): void {
    const { Characteristic } = this.platform;
    service.setCharacteristic(Characteristic.Name, name);
    if (!service.testCharacteristic(Characteristic.ConfiguredName)) {
      service.addOptionalCharacteristic(Characteristic.ConfiguredName);
      service.setCharacteristic(Characteristic.ConfiguredName, name);
    }
  }

  updateState(state: VehicleState): void {
    this.currentState = state;
    const { Characteristic } = this.platform;

    const lockService = this.services.get('lock');
    if (lockService) {
      const lockState = state.locked
        ? Characteristic.LockCurrentState.SECURED
        : Characteristic.LockCurrentState.UNSECURED;
      lockService.updateCharacteristic(Characteristic.LockCurrentState, lockState);
      if (!this.commandsInFlight.has('lock')) {
        const targetState = state.locked
          ? Characteristic.LockTargetState.SECURED
          : Characteristic.LockTargetState.UNSECURED;
        lockService.updateCharacteristic(Characteristic.LockTargetState, targetState);
      }
    }

    const climateService = this.services.get('climate');
    if (climateService) {
      climateService.updateCharacteristic(Characteristic.On, state.airControlOn);
    }

    const lowFuelService = this.services.get('fuel-low');
    if (lowFuelService) {
      lowFuelService.updateCharacteristic(
        Characteristic.LeakDetected,
        state.fuelLevelLow
          ? Characteristic.LeakDetected.LEAK_DETECTED
          : Characteristic.LeakDetected.LEAK_NOT_DETECTED,
      );
    }

    const engineService = this.services.get('engine');
    if (engineService) {
      engineService.updateCharacteristic(
        Characteristic.OccupancyDetected,
        state.engineRunning
          ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
          : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      );
    }

    const tireService = this.services.get('tire');
    if (tireService) {
      tireService.updateCharacteristic(
        Characteristic.LeakDetected,
        state.tirePressureWarning
          ? Characteristic.LeakDetected.LEAK_DETECTED
          : Characteristic.LeakDetected.LEAK_NOT_DETECTED,
      );
    }

    const batteryService = this.services.get('battery');
    if (batteryService) {
      // Prefer the EV high-voltage battery when present, otherwise the 12V battery.
      const level = state.evBatteryPercentage ?? state.batteryPercentage;
      if (level !== null) {
        batteryService.updateCharacteristic(Characteristic.BatteryLevel, level);
        batteryService.updateCharacteristic(
          Characteristic.StatusLowBattery,
          level < LOW_BATTERY_THRESHOLD
            ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
        );
      }

      batteryService.updateCharacteristic(
        Characteristic.ChargingState,
        state.evCharging
          ? Characteristic.ChargingState.CHARGING
          : Characteristic.ChargingState.NOT_CHARGING,
      );
    }

    // HomeKit has no odometer field, so the mileage (km) is surfaced through a
    // light sensor's lux reading. Clamp to the characteristic's allowed range.
    const mileageService = this.services.get('mileage');
    if (mileageService && state.odometer !== null) {
      const value = Math.min(Math.max(state.odometer, LIGHT_SENSOR_MIN), LIGHT_SENSOR_MAX);
      mileageService.updateCharacteristic(Characteristic.CurrentAmbientLightLevel, value);
    }
  }

  private getServiceType(subtype: ServiceKey): WithUUID<typeof Service> {
    const { Service } = this.platform;

    switch (subtype) {
    case 'lock':
      return Service.LockMechanism;
    case 'climate':
      return Service.Switch;
    case 'fuel-low':
    case 'tire':
      return Service.LeakSensor;
    case 'engine':
      return Service.OccupancySensor;
    case 'battery':
      return Service.Battery;
    case 'mileage':
      return Service.LightSensor;
    default:
      return Service.ContactSensor;
    }
  }

  private async handleLockSet(value: CharacteristicValue): Promise<void> {
    const { Characteristic } = this.platform;
    if (!this.options.apiClient || !this.options.vehicleKey) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    if (this.commandsInFlight.has('lock')) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.RESOURCE_BUSY);
    }

    const shouldLock = value === Characteristic.LockTargetState.SECURED;

    this.platform.log.info(`${shouldLock ? 'Locking' : 'Unlocking'} doors...`);
    this.commandsInFlight.add('lock');

    try {
      if (shouldLock) {
        await this.options.apiClient.lockDoors(this.options.vehicleKey);
      } else {
        await this.options.apiClient.unlockDoors(this.options.vehicleKey);
      }

      // Command accepted. Optimistically reflect the new lock state in HomeKit; the
      // next poll confirms it. We deliberately don't force a live status read here —
      // the EU API rejects a status poll right after a command as a duplicate request.
      const lockService = this.services.get('lock');
      if (lockService) {
        lockService.updateCharacteristic(
          Characteristic.LockCurrentState,
          shouldLock
            ? Characteristic.LockCurrentState.SECURED
            : Characteristic.LockCurrentState.UNSECURED,
        );
      }
    } catch (e) {
      this.platform.log.error('Door lock/unlock failed:', e);

      const lockService = this.services.get('lock');
      if (lockService && this.currentState) {
        lockService.updateCharacteristic(
          Characteristic.LockTargetState,
          this.currentState.locked
            ? Characteristic.LockTargetState.SECURED
            : Characteristic.LockTargetState.UNSECURED,
        );
      }

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    } finally {
      this.commandsInFlight.delete('lock');
    }
  }

  private async handleClimateSet(value: CharacteristicValue): Promise<void> {
    if (!this.options.apiClient || !this.options.vehicleKey) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    if (this.commandsInFlight.has('climate')) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.RESOURCE_BUSY);
    }

    const shouldStart = value === true;

    this.platform.log.info(`${shouldStart ? 'Starting' : 'Stopping'} climate control...`);
    this.commandsInFlight.add('climate');

    try {
      if (shouldStart) {
        await this.options.apiClient.startClimate(this.options.vehicleKey, {
          temperature: this.options.climateTemperature ?? DEFAULT_CLIMATE_TEMP_C,
        });
      } else {
        await this.options.apiClient.stopClimate(this.options.vehicleKey);
      }

      // Command accepted. Optimistically reflect the new climate state; the next
      // poll confirms it. No immediate live status read (EU rejects it as duplicate).
      const climateService = this.services.get('climate');
      if (climateService) {
        climateService.updateCharacteristic(this.platform.Characteristic.On, shouldStart);
      }
    } catch (e) {
      this.platform.log.error('Climate control failed:', e);

      const climateService = this.services.get('climate');
      if (climateService && this.currentState) {
        climateService.updateCharacteristic(this.platform.Characteristic.On, this.currentState.airControlOn);
      }

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    } finally {
      this.commandsInFlight.delete('climate');
    }
  }
}

export class LockAccessory extends ConfiguredAccessory {
  constructor(
    platform: KiaConnectPlatform,
    accessory: PlatformAccessory,
    apiClient: KiaApiClient,
    vehicleKey: string,
    vehicle: VehicleSummary,
  ) {
    super(platform, accessory, vehicle, {
      categories: ['lock'],
      apiClient,
      vehicleKey,
    });
  }
}

export class ClimateAccessory extends ConfiguredAccessory {
  constructor(
    platform: KiaConnectPlatform,
    accessory: PlatformAccessory,
    apiClient: KiaApiClient,
    vehicleKey: string,
    vehicle: VehicleSummary,
    climateTemperature?: number,
  ) {
    super(platform, accessory, vehicle, {
      categories: ['climate'],
      apiClient,
      vehicleKey,
      climateTemperature,
    });
  }
}

export class StatusAccessory extends ConfiguredAccessory {
  constructor(
    platform: KiaConnectPlatform,
    accessory: PlatformAccessory,
    vehicle: VehicleSummary,
  ) {
    super(platform, accessory, vehicle, {
      categories: ['status'],
    });
  }
}

/**
 * A single door/window/hood/trunk contact sensor as its own accessory, so it can
 * carry a HomeKit Door or Window category (which is per-accessory, not per-service).
 */
export class DoorWindowAccessory implements VehicleAccessoryInstance {
  private readonly service: Service;

  constructor(
    private readonly platform: KiaConnectPlatform,
    accessory: PlatformAccessory,
    vehicle: VehicleSummary,
    private readonly part: BodyPart,
  ) {
    const { Service, Characteristic, api } = this.platform;

    accessory.category = part.kind === 'window'
      ? api.hap.Categories.WINDOW
      : api.hap.Categories.DOOR;

    const infoService = accessory.getService(Service.AccessoryInformation) ??
      accessory.addService(Service.AccessoryInformation);
    infoService
      .setCharacteristic(Characteristic.Manufacturer, 'Kia')
      .setCharacteristic(Characteristic.Model, vehicle.model)
      .setCharacteristic(Characteristic.SerialNumber, `${vehicle.vin}-${part.subtype}`);

    this.service = accessory.getService(Service.ContactSensor) ??
      accessory.addService(Service.ContactSensor, part.name);
    this.service.setCharacteristic(Characteristic.Name, part.name);
  }

  updateState(state: VehicleState): void {
    const { Characteristic } = this.platform;
    const isOpen = state[this.part.stateKey];
    this.service.updateCharacteristic(
      Characteristic.ContactSensorState,
      isOpen
        ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
        : Characteristic.ContactSensorState.CONTACT_DETECTED,
    );
  }
}

export class BatteryAccessory extends ConfiguredAccessory {
  constructor(
    platform: KiaConnectPlatform,
    accessory: PlatformAccessory,
    vehicle: VehicleSummary,
  ) {
    super(platform, accessory, vehicle, {
      categories: ['battery'],
    });
  }
}

export class MileageAccessory extends ConfiguredAccessory {
  constructor(
    platform: KiaConnectPlatform,
    accessory: PlatformAccessory,
    vehicle: VehicleSummary,
  ) {
    super(platform, accessory, vehicle, {
      categories: ['mileage'],
    });
  }
}
