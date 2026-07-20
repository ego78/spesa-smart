import {
  getProducts,
  saveProducts,
  getSettings,
  saveSettings,
  exportData
} from "./storage.js";

import {
  syncProductToGoogle,
  deleteProductFromGoogle,
  loadOffers
} from "./api.js";

import {
  renderProducts,
  renderOffers
} from "./ui.js";

let products = getProducts();
let settings = getSettings();
let offers = [];

const $ = id => document.getElementById(id);
const productDialog = $("productDialog");
const settingsDialog = $("settingsDialog");

function uid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openProductDialog(product = null) {
  $("productDialogTitle").textContent =
    product ? "Modifica prodotto" : "Aggiungi prodotto";

  $("editingProductId").value = product?.id || "";
  $("productName").value = product?.name || "";
  $("productBrand").value = product?.brand || "";
  $("productFormat").value = product?.format || "";
  $("productCategory").value = product?.category || "Alimentari";
  $("maximumPrice").value = product?.maximumPrice || "";
  $("productFavorite").checked = Boolean(product?.favorite);
  $("formMessage").textContent = "";

  productDialog.showModal();

  setTimeout(() => $("productName").focus(), 50);
}

function closeProductDialog() {
  productDialog.close();
}

async function saveProduct() {
  const name = $("productName").value.trim();

  if (!name) {
    $("formMessage").textContent = "Inserisci il nome del prodotto.";
    return;
  }

  const editingId = $("editingProductId").value;

  const duplicate = products.find(product =>
    product.name.toLowerCase() === name.toLowerCase() &&
    product.id !== editingId
  );

  if (duplicate) {
    $("formMessage").textContent = "Questo prodotto è già presente.";
    return;
  }

  const product = {
    id: editingId || uid(),
    name,
    brand: $("productBrand").value.trim(),
    format: $("productFormat").value.trim(),
    category: $("productCategory").value,
    maximumPrice: $("maximumPrice").value
      ? Number($("maximumPrice").value)
      : null,
    favorite: $("productFavorite").checked,
    updatedAt: new Date().toISOString()
  };

  if (editingId) {
    products = products.map(existing =>
      existing.id === editingId ? product : existing
    );
  } else {
    products.unshift(product);
  }

  saveProducts(products);
  refreshUI();
  closeProductDialog();

  try {
    await syncProductToGoogle(product, settings);
  } catch (error) {
    console.warn(error);
  }
}

function editProduct(id) {
  openProductDialog(products.find(product => product.id === id));
}

function duplicateProduct(id) {
  const source = products.find(product => product.id === id);
  if (!source) return;

  products.unshift({
    ...source,
    id: uid(),
    name: `${source.name} copia`,
    updatedAt: new Date().toISOString()
  });

  saveProducts(products);
  refreshUI();
}

async function deleteProduct(id) {
  const product = products.find(item => item.id === id);

  if (!product || !confirm(`Eliminare "${product.name}"?`)) return;

  products = products.filter(item => item.id !== id);
  saveProducts(products);
  refreshUI();

  try {
    await deleteProductFromGoogle(id, settings);
  } catch (error) {
    console.warn(error);
  }
}

function filteredProducts() {
  const query = $("productSearch").value.trim().toLowerCase();
  const category = $("categoryFilter").value;

  return products
    .filter(product =>
      !query ||
      [product.name, product.brand, product.format, product.category]
        .join(" ")
        .toLowerCase()
        .includes(query)
    )
    .filter(product => !category || product.category === category)
    .sort((a, b) =>
      Number(b.favorite) - Number(a.favorite) ||
      a.name.localeCompare(b.name, "it")
    );
}

function updateCategoryFilter() {
  const current = $("categoryFilter").value;

  const categories = [
    ...new Set(products.map(product => product.category).filter(Boolean))
  ].sort();

  $("categoryFilter").innerHTML =
    `<option value="">Tutte le categorie</option>` +
    categories.map(category =>
      `<option value="${category}">${category}</option>`
    ).join("");

  $("categoryFilter").value =
    categories.includes(current) ? current : "";
}

function refreshUI() {
  updateCategoryFilter();

  renderProducts(
    $("productsList"),
    filteredProducts(),
    {
      onAdd: () => openProductDialog(),
      edit: editProduct,
      duplicate: duplicateProduct,
      delete: deleteProduct
    }
  );

  const relevantOffers = renderOffers(
    $("offersList"),
    offers,
    products
  );

  $("productsCount").textContent = products.length;
  $("offersCount").textContent = relevantOffers.length;
}

async function refreshOffers() {
  $("refreshButton").disabled = true;
  $("refreshButton").textContent = "Aggiornamento…";

  try {
    offers = await loadOffers();
  } catch {
    offers = [];
  } finally {
    refreshUI();
    $("refreshButton").disabled = false;
    $("refreshButton").textContent = "Aggiorna offerte";
  }
}

function openSettings() {
  $("familyCode").value = settings.familyCode || "";
  $("city").value = settings.city || "";
  $("appsScriptUrl").value = settings.appsScriptUrl || "";
  $("settingsMessage").textContent = "";
  settingsDialog.showModal();
}

function saveSettingsNow() {
  settings = {
    familyCode: $("familyCode").value.trim(),
    city: $("city").value.trim(),
    appsScriptUrl: $("appsScriptUrl").value.trim()
  };

  saveSettings(settings);

  $("settingsMessage").style.color = "var(--primary)";
  $("settingsMessage").textContent = "Impostazioni salvate.";

  setTimeout(() => settingsDialog.close(), 500);
}

function downloadExport() {
  const blob = new Blob([exportData()], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download =
    `spesa-smart-backup-${new Date().toISOString().slice(0, 10)}.json`;

  link.click();
  URL.revokeObjectURL(url);
}

$("addProductButton").addEventListener(
  "click",
  () => openProductDialog()
);

$("navAddButton").addEventListener(
  "click",
  () => openProductDialog()
);

$("closeProductDialog").addEventListener(
  "click",
  closeProductDialog
);

$("cancelProductButton").addEventListener(
  "click",
  closeProductDialog
);

$("saveProductButton").addEventListener(
  "click",
  saveProduct
);

$("productName").addEventListener("keydown", event => {
  if (event.key === "Enter") saveProduct();
});

$("productSearch").addEventListener(
  "input",
  refreshUI
);

$("categoryFilter").addEventListener(
  "change",
  refreshUI
);

$("refreshButton").addEventListener(
  "click",
  refreshOffers
);

$("settingsButton").addEventListener(
  "click",
  openSettings
);

$("closeSettingsDialog").addEventListener(
  "click",
  () => settingsDialog.close()
);

$("saveSettingsButton").addEventListener(
  "click",
  saveSettingsNow
);

$("exportButton").addEventListener(
  "click",
  downloadExport
);

document.querySelectorAll("[data-target]").forEach(button => {
  button.addEventListener("click", () => {
    document
      .getElementById(button.dataset.target)
      ?.scrollIntoView({ behavior: "smooth" });
  });
});

productDialog.addEventListener("click", event => {
  if (event.target === productDialog) closeProductDialog();
});

settingsDialog.addEventListener("click", event => {
  if (event.target === settingsDialog) settingsDialog.close();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch(console.warn);
  });
}

refreshUI();
refreshOffers();
