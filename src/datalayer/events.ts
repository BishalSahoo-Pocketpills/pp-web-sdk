import type { PPLib } from '../types/common.types';
import type { DataLayerConfig, DataLayerItem, DataLayerItemInput, DataLayerUser, DataLayerUserData, DataLayerPage } from '../types/datalayer.types';

export function createEventPusher(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  CONFIG: DataLayerConfig,
  userBuilder: { buildUser: () => DataLayerUser; setUser: (u: Partial<DataLayerUser>) => void },
  userDataManager: { getUserData: () => DataLayerUserData },
  pageBuilder: { buildPage: () => DataLayerPage },
  itemBuilder: { normalizeItem: (input: DataLayerItemInput) => DataLayerItem; calculateValue: (items: DataLayerItem[]) => string }
) {

  function ensureDataLayer(): any[] {
    win.dataLayer = win.dataLayer || [];
    return win.dataLayer;
  }

  function merge(target: Record<string, any>, source: Record<string, any>): void {
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++) {
      target[keys[i]] = source[keys[i]];
    }
  }

  function pushEvent(eventName: string, extra?: Record<string, any>): void {
    var dl = ensureDataLayer();
    var enriched: Record<string, any> = {
      event: eventName,
      user: userBuilder.buildUser(),
      user_data: userDataManager.getUserData(),
      page: pageBuilder.buildPage(),
      pp_timestamp: new Date().toISOString()
    };

    merge(enriched, extra || {});

    if (!ppLib.Security.validateData(enriched)) {
      ppLib.log('error', '[ppDataLayer] Invalid event data rejected for ' + eventName);
      return;
    }
    dl.push(enriched);
    ppLib.log('info', '[ppDataLayer] push → ' + eventName, enriched);
  }

  function pushEcommerceEvent(eventName: string, inputItems: DataLayerItemInput[], extra?: Record<string, any>): void {
    var dl = ensureDataLayer();

    // Clear previous ecommerce data
    dl.push({ ecommerce: null });

    var items: DataLayerItem[] = [];
    var seenIds: Record<string, boolean> = {};
    for (var i = 0; i < inputItems.length; i++) {
      var normalized = itemBuilder.normalizeItem(inputItems[i]);
      var dedupeKey = normalized.item_id || normalized.item_name || '';
      if (dedupeKey && seenIds[dedupeKey]) continue;
      if (dedupeKey) seenIds[dedupeKey] = true;
      items.push(normalized);
    }

    var value = itemBuilder.calculateValue(items);

    var ecommerceData: Record<string, any> = {
      items: items,
      value: value,
      currency: CONFIG.defaults.currency
    };

    var merged: Record<string, any> = { ecommerce: ecommerceData };
    merge(merged, extra || {});

    pushEvent(eventName, merged);
  }

  return { pushEvent: pushEvent, pushEcommerceEvent: pushEcommerceEvent };
}
