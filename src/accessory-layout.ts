import type { KiaConnectConfig } from './kia/types.js';

export type AccessoryCategory = 'lock' | 'climate' | 'status' | 'body' | 'battery' | 'mileage';

export const ACCESSORY_CATEGORIES: readonly AccessoryCategory[] = [
  'lock',
  'climate',
  'status',
  'body',
  'battery',
  'mileage',
];

export interface AccessoryPresentation {
  enabledCategories: AccessoryCategory[];
  showLock: boolean;
  showClimate: boolean;
  showStatus: boolean;
  showBody: boolean;
  showBattery: boolean;
  showMileage: boolean;
}

export function resolveAccessoryPresentation(config: KiaConnectConfig): AccessoryPresentation {
  const showLock = config.showLock ?? true;
  const showClimate = config.showClimate ?? true;
  const showStatus = config.showStatus ?? true;
  const showBody = config.showBody ?? true;
  const showBattery = config.showBattery ?? true;
  const showMileage = config.showMileage ?? true;

  return {
    enabledCategories: ACCESSORY_CATEGORIES.filter((category) => {
      switch (category) {
      case 'lock':
        return showLock;
      case 'climate':
        return showClimate;
      case 'status':
        return showStatus;
      case 'body':
        return showBody;
      case 'battery':
        return showBattery;
      case 'mileage':
        return showMileage;
      }
    }),
    showLock,
    showClimate,
    showStatus,
    showBody,
    showBattery,
    showMileage,
  };
}
