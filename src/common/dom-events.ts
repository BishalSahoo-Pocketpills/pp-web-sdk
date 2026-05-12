/**
 * Shared DOM event-listener helpers.
 *
 * Several modules bind `click` + `touchend` to the document for tap
 * detection on touch devices (without this pair, mobile Safari can drop
 * the click on fast taps). The pattern was duplicated across braze,
 * ecommerce, event-source, vwo, datalayer, login — same pair of
 * addEventListener calls with `{ capture: false, passive: ? }`.
 *
 * `addInteractionListener` codifies the pattern in one place. Callers
 * choose `passive` based on whether they need to call `preventDefault`
 * inside the handler (e.g. datalayer redirect interception → false;
 * everything else → true).
 *
 * Returns a `remove()` for caller-controlled teardown. Most modules
 * just bind once at init and never tear down, but tests sometimes
 * re-bind across reloads and need the cleanup path.
 */

export interface InteractionListenerHandle {
  /** Removes both the click and touchend listeners. */
  remove: () => void;
}

export interface InteractionListenerOptions {
  /**
   * `passive: true` lets the browser scroll without waiting for the
   * handler. Required by mobile Safari for `touchend` to be cheap.
   * Set to `false` only if the handler calls `event.preventDefault()`.
   * Default: `true`.
   */
  passive?: boolean;
  /**
   * Whether to register in capture phase. Almost always `false`.
   * Default: `false`.
   */
  capture?: boolean;
}

/**
 * Binds `click` + `touchend` to `target` with one handler so taps on
 * touch devices are reliably caught without double-firing.
 */
export function addInteractionListener(
  target: EventTarget,
  handler: (e: Event) => void,
  opts?: InteractionListenerOptions
): InteractionListenerHandle {
  const options: AddEventListenerOptions = {
    capture: opts?.capture ?? false,
    passive: opts?.passive ?? true
  };

  target.addEventListener('click', handler, options);
  target.addEventListener('touchend', handler, options);

  return {
    remove: () => {
      target.removeEventListener('click', handler, options);
      target.removeEventListener('touchend', handler, options);
    }
  };
}
