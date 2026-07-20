const PRODUCT_KEY = "spesaSmart.products.v1";
const SETTINGS_KEY = "spesaSmart.settings.v1";

export function getProducts() {
  try {
    return JSON.parse(localStorage.getItem(PRODUCT_KEY)) || [];
  } catch {
    return [];
  }
}

export function saveProducts(products) {
  localStorage.setItem(PRODUCT_KEY, JSON.stringify(products));
}

export function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function exportData() {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    products: getProducts(),
    settings: getSettings()
  }, null, 2);
}
