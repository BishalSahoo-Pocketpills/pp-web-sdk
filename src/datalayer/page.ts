import type { DataLayerPage } from '@src/types/datalayer.types';

export function createPageBuilder(
  win: Window & typeof globalThis,
  doc: Document
) {
  function buildPage(): DataLayerPage {
    return {
      url: win.location.href,
      title: doc.title,
      referrer: doc.referrer
    };
  }

  return { buildPage: buildPage };
}
