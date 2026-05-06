import type { PPLib } from '@src/types/common.types';
import type { DataLayerConfig, DataLayerItem, DataLayerItemInput, DataLayerUser, DataLayerUserData, DataLayerPage } from '@src/types/datalayer.types';

export function createEventPusher(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  CONFIG: DataLayerConfig,
  userBuilder: { buildUser: () => DataLayerUser; setUser: (u: Partial<DataLayerUser>) => void },
  userDataManager: { getUserData: () => DataLayerUserData },
  pageBuilder: { buildPage: () => DataLayerPage },
  itemBuilder: { normalizeItem: (input: DataLayerItemInput) => DataLayerItem; calculateValue: (items: DataLayerItem[]) => string }
) {

  function ensureDataLayer(): unknown[] {
    win.dataLayer = win.dataLayer || [];
    return win.dataLayer;
  }

  function merge(target: Record<string, unknown>, source: Record<string, unknown>): void {
    const keys = Object.keys(source);
    for (let i = 0; i < keys.length; i++) {
      target[keys[i]] = source[keys[i]];
    }
  }

  function pushEvent(eventName: string, extra?: Record<string, unknown>): void {
    const dl = ensureDataLayer();
    const enriched: Record<string, unknown> = {
      event: eventName,
      user: userBuilder.buildUser(),
      userData: userDataManager.getUserData(),
      page: pageBuilder.buildPage(),
      pp_timestamp: Date.now(),
      platform: CONFIG.defaults.platform
    };

    merge(enriched, extra || {});

    // marketingAttribution is auto-injected by the global dataLayer.push patch
    // in the attribution service — no per-module enrichment needed.

    if (!ppLib.Security.validateData(enriched)) {
      ppLib.log('error', '[ppDataLayer] Invalid event data rejected for ' + eventName);
      return;
    }
    dl.push(enriched);
    ppLib.log('info', '[ppDataLayer] push → ' + eventName, enriched);
  }

  function pushEcommerceEvent(eventName: string, inputItems: DataLayerItemInput[], extra?: Record<string, unknown>): void {
    const dl = ensureDataLayer();

    // Clear previous ecommerce data
    dl.push({ ecommerce: null });

    const items: DataLayerItem[] = [];
    const seenIds: Record<string, boolean> = {};
    for (let i = 0; i < inputItems.length; i++) {
      const normalized = itemBuilder.normalizeItem(inputItems[i]);
      const dedupeKey = normalized.item_id || normalized.item_name || '';
      if (dedupeKey && seenIds[dedupeKey]) continue;
      if (dedupeKey) seenIds[dedupeKey] = true;
      items.push(normalized);
    }

    const value = itemBuilder.calculateValue(items);

    const ecommerceData: Record<string, unknown> = {
      items: items,
      value: value,
      currency: CONFIG.defaults.currency
    };

    const merged: Record<string, unknown> = { ecommerce: ecommerceData };
    merge(merged, extra || {});

    pushEvent(eventName, merged);
  }

  return { pushEvent: pushEvent, pushEcommerceEvent: pushEcommerceEvent };
}
