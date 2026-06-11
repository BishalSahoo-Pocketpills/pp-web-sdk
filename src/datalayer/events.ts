import type { PPLib } from '@src/types/common.types';
import type { DataLayerConfig, DataLayerItem, DataLayerItemInput, DataLayerUser, DataLayerUserData, DataLayerPage } from '@src/types/datalayer.types';
import { pushToDataLayer } from '@src/common/datalayer-guard';
import { isConsentGranted } from '@src/common/consent-check';

export function createEventPusher(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  CONFIG: DataLayerConfig,
  userBuilder: { buildUser: () => DataLayerUser; setUser: (u: Partial<DataLayerUser>) => void },
  userDataManager: { getUserData: () => DataLayerUserData },
  pageBuilder: { buildPage: () => DataLayerPage },
  itemBuilder: { normalizeItem: (input: DataLayerItemInput) => DataLayerItem; calculateValue: (items: DataLayerItem[]) => number }
) {

  function merge(target: Record<string, unknown>, source: Record<string, unknown>): void {
    const keys = Object.keys(source);
    for (let i = 0; i < keys.length; i++) {
      target[keys[i]] = source[keys[i]];
    }
  }

  function pushEvent(eventName: string, extra?: Record<string, unknown>): void {
    // Consent gate (C1): denied consent drops the dataLayer push silently.
    if (!isConsentGranted(ppLib)) {
      ppLib.log('verbose', '[ppDataLayer] consent not granted — suppressed ' + eventName);
      return;
    }
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
    // Isolate the host page from a throwing dataLayer.push (e.g. a third-party
    // script or enricher that patched push) — tracking must never break the
    // caller. The public ppLib.datalayer.* API reaches here un-try/catch'd.
    try {
      pushToDataLayer(win, enriched);
    } catch (e) {
      ppLib.log('error', '[ppDataLayer] push error for ' + eventName, ppLib.safeLogError(e));
      return;
    }
    ppLib.log('info', '[ppDataLayer] push → ' + eventName, enriched);
  }

  function pushEcommerceEvent(eventName: string, inputItems: DataLayerItemInput[], extra?: Record<string, unknown>): void {
    // Consent gate (C1): denied consent drops the ecommerce push (incl. the
    // ecommerce-null clear) silently.
    if (!isConsentGranted(ppLib)) {
      ppLib.log('verbose', '[ppDataLayer] consent not granted — suppressed ' + eventName);
      return;
    }
    // Clear previous ecommerce data
    try {
      pushToDataLayer(win, { ecommerce: null });
    } catch (e) {
      ppLib.log('error', '[ppDataLayer] ecommerce clear push error for ' + eventName, ppLib.safeLogError(e));
      return;
    }

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
