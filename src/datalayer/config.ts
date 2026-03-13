import type { DataLayerConfig } from '../types/datalayer.types';

export function createDataLayerConfig(): DataLayerConfig {
  return {
    cookieNames: {
      userId: 'userId',
      patientId: 'patientId',
      firstName: 'firstName',
      lastName: 'lastName',
      appAuth: 'app_is_authenticated',
      email: 'email',
      phone: 'phone',
      street: 'street',
      city: 'city',
      region: 'region',
      postalCode: 'postalCode',
      country: 'country',
      previousUser: 'previousUser'
    },
    defaults: {
      itemBrand: 'Pocketpills',
      currency: 'CAD',
      platform: 'web'
    },
    attributes: {
      event: 'data-dl-event',
      method: 'data-dl-method',
      pageType: 'data-dl-page-type',
      signupFlow: 'data-dl-signup-flow',
      searchTerm: 'data-dl-search-term',
      resultsCount: 'data-dl-results-count',
      searchType: 'data-dl-search-type',
      itemId: 'data-dl-item-id',
      itemName: 'data-dl-item-name',
      itemBrand: 'data-dl-item-brand',
      itemCategory: 'data-dl-item-category',
      price: 'data-dl-item-price',
      quantity: 'data-dl-quantity',
      discount: 'data-dl-discount',
      coupon: 'data-dl-coupon',
      currency: 'data-dl-currency',
      transactionId: 'data-dl-transaction-id',
      viewItem: 'data-dl-view-item'
    },
    debounceMs: 300,
    navigationDelay: 200,
    autoViewItem: true
  };
}
