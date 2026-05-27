/**
 * Lightweight bridge for modules that need to dispatch to Mixpanel
 * without depending on the full mixpanel module. Routes through
 * ppLib.mixpanel (the SDK facade — handles dual-instance fan-out and
 * pre-init buffering) when loaded, falls back to win.mixpanel (the
 * raw Mixpanel SDK) for minimal deployments where the facade module
 * isn't present.
 */
import type { PPLib } from '@src/types/common.types';

interface MixpanelGlobalStub {
  track?: (event: string, props?: Record<string, unknown>) => void;
  register?: (props: Record<string, unknown>) => void;
}

export function trackViaMixpanel(
  ppLib: PPLib,
  win: Window & typeof globalThis,
  eventName: string,
  properties: Record<string, unknown>,
): boolean {
  if (ppLib.mixpanel && typeof ppLib.mixpanel.track === 'function') {
    ppLib.mixpanel.track(eventName, properties);
    return true;
  }
  const mp = (win as unknown as { mixpanel?: MixpanelGlobalStub }).mixpanel;
  if (mp && typeof mp.track === 'function') {
    mp.track(eventName, properties);
    return true;
  }
  return false;
}

export function registerViaMixpanel(
  ppLib: PPLib,
  win: Window & typeof globalThis,
  properties: Record<string, unknown>,
): boolean {
  if (ppLib.mixpanel && typeof ppLib.mixpanel.register === 'function') {
    ppLib.mixpanel.register(properties);
    return true;
  }
  const mp = (win as unknown as { mixpanel?: MixpanelGlobalStub }).mixpanel;
  if (mp && typeof mp.register === 'function') {
    mp.register(properties);
    return true;
  }
  return false;
}
