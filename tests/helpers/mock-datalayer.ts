/**
 * Initialize and return a mock dataLayer.
 */
export function createMockDataLayer() {
  const dataLayer = [];
  window.dataLayer = dataLayer;
  return dataLayer;
}
