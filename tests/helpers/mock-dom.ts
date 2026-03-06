/**
 * Build ecommerce DOM fixtures.
 */
export function createEcommerceDOM({ items = [] } = {}) {
  items.forEach(item => {
    const el = document.createElement('section');
    el.setAttribute('data-ecommerce-item', item.id);
    el.setAttribute('data-ecommerce-name', item.name);
    el.setAttribute('data-ecommerce-price', item.price);
    if (item.category) el.setAttribute('data-ecommerce-category', item.category);
    if (item.brand) el.setAttribute('data-ecommerce-brand', item.brand);
    if (item.variant) el.setAttribute('data-ecommerce-variant', item.variant);
    if (item.discount) el.setAttribute('data-ecommerce-discount', item.discount);
    if (item.coupon) el.setAttribute('data-ecommerce-coupon', item.coupon);
    if (item.ctaText) {
      const btn = document.createElement('button');
      btn.setAttribute('data-event-source', 'add_to_cart');
      btn.textContent = item.ctaText;
      el.appendChild(btn);
    }
    document.body.appendChild(el);
  });
}

/**
 * Build event-source DOM fixtures.
 */
export function createEventSourceDOM(elements) {
  elements.forEach(cfg => {
    const el = document.createElement(cfg.tag || 'button');
    el.setAttribute('data-event-source', cfg.source);
    if (cfg.category) el.setAttribute('data-event-category', cfg.category);
    if (cfg.label) el.setAttribute('data-event-label', cfg.label);
    if (cfg.value) el.setAttribute('data-event-value', cfg.value);
    if (cfg.href) el.href = cfg.href;
    el.textContent = cfg.text || '';
    document.body.appendChild(el);
  });
}

/**
 * Build datalayer DOM fixtures.
 */
export function createDataLayerDOM(elements) {
  elements.forEach(cfg => {
    const el = document.createElement(cfg.tag || 'button');
    el.setAttribute('data-dl-event', cfg.event);
    if (cfg.id) el.id = cfg.id;
    if (cfg.attrs) {
      Object.keys(cfg.attrs).forEach(key => {
        el.setAttribute(key, cfg.attrs[key]);
      });
    }
    el.textContent = cfg.text || '';
    document.body.appendChild(el);
  });
}

/**
 * Build login module DOM fixtures.
 */
export function createLoginDOM({ logoutButtons = 0, forgetButtons = 0, nameElements = 0 } = {}) {
  for (let i = 0; i < logoutButtons; i++) {
    const btn = document.createElement('button');
    btn.setAttribute('data-action', 'logout');
    document.body.appendChild(btn);
  }
  for (let i = 0; i < forgetButtons; i++) {
    const btn = document.createElement('button');
    btn.setAttribute('data-action', 'forget-me');
    document.body.appendChild(btn);
  }
  for (let i = 0; i < nameElements; i++) {
    const span = document.createElement('span');
    span.setAttribute('data-login-identifier-key', 'user-first-name');
    document.body.appendChild(span);
  }
}
