import type { PPLib } from '@src/types/common.types';
import type { DataLayerConfig, DataLayerItem, DataLayerItemInput } from '@src/types/datalayer.types';

export function createItemBuilder(
  ppLib: PPLib,
  CONFIG: DataLayerConfig
) {
  function normalizeItem(input: DataLayerItemInput): DataLayerItem {
    var item: DataLayerItem = {
      item_id: input.item_id || '',
      item_name: input.item_name || '',
      item_brand: input.item_brand || CONFIG.defaults.itemBrand,
      price: String(input.price != null ? input.price : ''),
      quantity: input.quantity || 1,
      discount: String(input.discount != null ? input.discount : ''),
      coupon: input.coupon || ''
    };

    if (input.item_category) {
      item.item_category = input.item_category;
    }

    return item;
  }

  function calculateValue(items: DataLayerItem[]): string {
    var total = 0;
    for (var i = 0; i < items.length; i++) {
      var price = parseFloat(items[i].price) || 0;
      var discount = parseFloat(items[i].discount) || 0;
      total += price * items[i].quantity - discount;
    }
    return String(Math.round(total * 100) / 100);
  }

  return { normalizeItem: normalizeItem, calculateValue: calculateValue };
}
