import type { PPLib } from '@src/types/common.types';
import type { DataLayerConfig, DataLayerItem, DataLayerItemInput } from '@src/types/datalayer.types';
import { toFloat } from '@src/common/coerce';

export function createItemBuilder(
  ppLib: PPLib,
  CONFIG: DataLayerConfig
) {
  function normalizeItem(input: DataLayerItemInput): DataLayerItem {
    const item: DataLayerItem = {
      item_id: input.item_id || '',
      item_name: input.item_name || '',
      item_brand: input.item_brand || CONFIG.defaults.itemBrand,
      // Monetary fields leave the SDK as floats (decimal); quantity as int.
      // `?? 1` preserves an explicit 0; only undefined falls back to 1.
      price: toFloat(input.price),
      quantity: input.quantity ?? 1,
      discount: toFloat(input.discount),
      coupon: input.coupon || ''
    };

    if (input.item_category) {
      item.item_category = input.item_category;
    }

    return item;
  }

  function calculateValue(items: DataLayerItem[]): number {
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      total += items[i].price * items[i].quantity - items[i].discount;
    }
    return Math.round(total * 100) / 100;
  }

  return { normalizeItem: normalizeItem, calculateValue: calculateValue };
}
