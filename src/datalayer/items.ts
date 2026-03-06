import type { PPLib } from '../types/common.types';
import type { DataLayerConfig, DataLayerItem, DataLayerItemInput } from '../types/datalayer.types';

export function createItemBuilder(
  ppLib: PPLib,
  CONFIG: DataLayerConfig
) {
  function normalizeItem(input: DataLayerItemInput): DataLayerItem {
    var price = typeof input.price === 'string' ? parseFloat(input.price) : (input.price || 0);
    var discount = typeof input.discount === 'string' ? parseFloat(input.discount) : (input.discount || 0);

    if (isNaN(price)) price = 0;
    if (isNaN(discount)) discount = 0;

    return {
      item_id: input.item_id || null,
      item_name: input.item_name || null,
      item_brand: input.item_brand || CONFIG.defaults.itemBrand,
      item_category: input.item_category || null,
      item_category2: input.item_category2 || null,
      item_category3: input.item_category3 || null,
      item_category4: input.item_category4 || null,
      price: price,
      quantity: input.quantity || 1,
      discount: discount,
      coupon: input.coupon || null,
      currency: input.currency || CONFIG.defaults.currency
    };
  }

  function calculateValue(items: DataLayerItem[]): number {
    var total = 0;
    for (var i = 0; i < items.length; i++) {
      total += items[i].price * items[i].quantity - items[i].discount;
    }
    return Math.round(total * 100) / 100;
  }

  return { normalizeItem: normalizeItem, calculateValue: calculateValue };
}
