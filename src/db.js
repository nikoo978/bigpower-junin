const DB_NAME = 'presupuestos-tecnicos';
const DB_VERSION = 3;

const SETTINGS_STORE = 'settings';
const BUDGETS_STORE = 'budgets';
const QUICK_TEMPLATES_STORE = 'quickTemplates';
const CLOUD_SETTINGS_STORE = 'cloudSettings';
const CLOUD_BUDGETS_STORE = 'cloudBudgets';
const CLOUD_QUICK_TEMPLATES_STORE = 'cloudQuickTemplates';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(BUDGETS_STORE)) {
        const store = db.createObjectStore(BUDGETS_STORE, { keyPath: 'id' });
        store.createIndex('budgetNumber', 'budgetNumber', { unique: true });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(QUICK_TEMPLATES_STORE)) {
        const store = db.createObjectStore(QUICK_TEMPLATES_STORE, { keyPath: 'id' });
        store.createIndex('label', 'label', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(CLOUD_SETTINGS_STORE)) db.createObjectStore(CLOUD_SETTINGS_STORE, { keyPath: 'ownerId' });
      if (!db.objectStoreNames.contains(CLOUD_BUDGETS_STORE)) {
        const store = db.createObjectStore(CLOUD_BUDGETS_STORE, { keyPath: ['ownerId', 'id'] });
        store.createIndex('ownerId', 'ownerId', { unique: false });
        store.createIndex('ownerNumber', ['ownerId', 'budgetNumber'], { unique: true });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(CLOUD_QUICK_TEMPLATES_STORE)) {
        const store = db.createObjectStore(CLOUD_QUICK_TEMPLATES_STORE, { keyPath: ['ownerId', 'id'] });
        store.createIndex('ownerId', 'ownerId', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, callback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try { result = callback(store); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function sortBudgets(rows = []) {
  return [...rows].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}

function sortTemplates(rows = []) {
  return [...rows].sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'es'));
}

function withoutOwner(record) {
  if (!record) return null;
  const { ownerId, ...clean } = record;
  return clean;
}

export async function getSettings() {
  const db = await openDB();
  return requestResult(db.transaction(SETTINGS_STORE, 'readonly').objectStore(SETTINGS_STORE).get('main')).then((value) => value || null);
}

export function saveSettings(settings) {
  return withStore(SETTINGS_STORE, 'readwrite', (store) => store.put({ ...settings, id: 'main' }));
}

export async function getBudgets() {
  const db = await openDB();
  return requestResult(db.transaction(BUDGETS_STORE, 'readonly').objectStore(BUDGETS_STORE).getAll()).then(sortBudgets);
}

export async function getBudget(id) {
  const db = await openDB();
  return requestResult(db.transaction(BUDGETS_STORE, 'readonly').objectStore(BUDGETS_STORE).get(id)).then((value) => value || null);
}

export function saveBudget(budget) {
  return withStore(BUDGETS_STORE, 'readwrite', (store) => store.put(budget));
}

export function deleteBudget(id) {
  return withStore(BUDGETS_STORE, 'readwrite', (store) => store.delete(id));
}

export async function getQuickTemplates() {
  const db = await openDB();
  return requestResult(db.transaction(QUICK_TEMPLATES_STORE, 'readonly').objectStore(QUICK_TEMPLATES_STORE).getAll()).then(sortTemplates);
}

export function saveQuickTemplate(template) {
  return withStore(QUICK_TEMPLATES_STORE, 'readwrite', (store) => store.put(template));
}

export function deleteQuickTemplate(id) {
  return withStore(QUICK_TEMPLATES_STORE, 'readwrite', (store) => store.delete(id));
}

export async function getCloudSettings(ownerId) {
  if (!ownerId) return null;
  const db = await openDB();
  const value = await requestResult(db.transaction(CLOUD_SETTINGS_STORE, 'readonly').objectStore(CLOUD_SETTINGS_STORE).get(ownerId));
  return withoutOwner(value);
}

export function saveCloudSettings(ownerId, settings) {
  if (!ownerId) throw new Error('Falta el usuario de la nube.');
  return withStore(CLOUD_SETTINGS_STORE, 'readwrite', (store) => store.put({ ...settings, id: 'main', ownerId }));
}

export async function getCloudBudgets(ownerId) {
  if (!ownerId) return [];
  const db = await openDB();
  const store = db.transaction(CLOUD_BUDGETS_STORE, 'readonly').objectStore(CLOUD_BUDGETS_STORE);
  const rows = await requestResult(store.index('ownerId').getAll(IDBKeyRange.only(ownerId)));
  return sortBudgets(rows.map(withoutOwner));
}

export async function getCloudBudget(ownerId, id) {
  if (!ownerId || !id) return null;
  const db = await openDB();
  const value = await requestResult(db.transaction(CLOUD_BUDGETS_STORE, 'readonly').objectStore(CLOUD_BUDGETS_STORE).get([ownerId, id]));
  return withoutOwner(value);
}

export function saveCloudBudget(ownerId, budget) {
  if (!ownerId) throw new Error('Falta el usuario de la nube.');
  return withStore(CLOUD_BUDGETS_STORE, 'readwrite', (store) => store.put({ ...budget, ownerId }));
}

export function deleteCloudBudgetCache(ownerId, id) {
  return withStore(CLOUD_BUDGETS_STORE, 'readwrite', (store) => store.delete([ownerId, id]));
}

export async function getCloudQuickTemplates(ownerId) {
  if (!ownerId) return [];
  const db = await openDB();
  const store = db.transaction(CLOUD_QUICK_TEMPLATES_STORE, 'readonly').objectStore(CLOUD_QUICK_TEMPLATES_STORE);
  const rows = await requestResult(store.index('ownerId').getAll(IDBKeyRange.only(ownerId)));
  return sortTemplates(rows.map(withoutOwner));
}

export function saveCloudQuickTemplate(ownerId, template) {
  if (!ownerId) throw new Error('Falta el usuario de la nube.');
  return withStore(CLOUD_QUICK_TEMPLATES_STORE, 'readwrite', (store) => store.put({ ...template, ownerId }));
}

export function deleteCloudQuickTemplateCache(ownerId, id) {
  return withStore(CLOUD_QUICK_TEMPLATES_STORE, 'readwrite', (store) => store.delete([ownerId, id]));
}

function clearOwnedStore(store, ownerId) {
  const request = store.index('ownerId').openKeyCursor(IDBKeyRange.only(ownerId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    store.delete(cursor.primaryKey);
    cursor.continue();
  };
}

export async function replaceCloudSnapshot(ownerId, settings, budgets = [], quickTemplates = []) {
  if (!ownerId) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([CLOUD_SETTINGS_STORE, CLOUD_BUDGETS_STORE, CLOUD_QUICK_TEMPLATES_STORE], 'readwrite');
    const settingsStore = tx.objectStore(CLOUD_SETTINGS_STORE);
    const budgetsStore = tx.objectStore(CLOUD_BUDGETS_STORE);
    const templatesStore = tx.objectStore(CLOUD_QUICK_TEMPLATES_STORE);
    settingsStore.delete(ownerId);
    clearOwnedStore(budgetsStore, ownerId);
    clearOwnedStore(templatesStore, ownerId);
    if (settings) settingsStore.put({ ...settings, id: 'main', ownerId });
    budgets.forEach((budget) => budgetsStore.put({ ...budget, ownerId }));
    quickTemplates.forEach((template) => templatesStore.put({ ...template, ownerId }));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function clearCloudData(ownerId = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([CLOUD_SETTINGS_STORE, CLOUD_BUDGETS_STORE, CLOUD_QUICK_TEMPLATES_STORE], 'readwrite');
    const settingsStore = tx.objectStore(CLOUD_SETTINGS_STORE);
    const budgetsStore = tx.objectStore(CLOUD_BUDGETS_STORE);
    const templatesStore = tx.objectStore(CLOUD_QUICK_TEMPLATES_STORE);
    if (!ownerId) {
      settingsStore.clear();
      budgetsStore.clear();
      templatesStore.clear();
    } else {
      settingsStore.delete(ownerId);
      clearOwnedStore(budgetsStore, ownerId);
      clearOwnedStore(templatesStore, ownerId);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function migrateLegacyCloudMatches(ownerId, remoteBudgets = [], remoteTemplates = []) {
  if (!ownerId) return { budgets: [], quickTemplates: [] };
  const remoteBudgetMap = new Map(remoteBudgets.map((record) => [record.id, record]));
  const remoteTemplateMap = new Map(remoteTemplates.map((record) => [record.id, record]));
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const promoted = { budgets: [], quickTemplates: [] };
    const tx = db.transaction([BUDGETS_STORE, QUICK_TEMPLATES_STORE, CLOUD_BUDGETS_STORE, CLOUD_QUICK_TEMPLATES_STORE], 'readwrite');
    const localBudgets = tx.objectStore(BUDGETS_STORE);
    const localTemplates = tx.objectStore(QUICK_TEMPLATES_STORE);
    const cloudBudgets = tx.objectStore(CLOUD_BUDGETS_STORE);
    const cloudTemplates = tx.objectStore(CLOUD_QUICK_TEMPLATES_STORE);
    const budgetRequest = localBudgets.getAll();
    budgetRequest.onsuccess = () => {
      (budgetRequest.result || []).forEach((local) => {
        const remote = remoteBudgetMap.get(local.id);
        if (!remote) return;
        const chosen = String(local.updatedAt || local.createdAt || '') > String(remote.updatedAt || remote.createdAt || '') ? local : remote;
        cloudBudgets.put({ ...chosen, ownerId });
        localBudgets.delete(local.id);
        promoted.budgets.push(chosen);
      });
    };
    const templateRequest = localTemplates.getAll();
    templateRequest.onsuccess = () => {
      (templateRequest.result || []).forEach((local) => {
        const remote = remoteTemplateMap.get(local.id);
        if (!remote) return;
        const chosen = String(local.updatedAt || local.createdAt || '') > String(remote.updatedAt || remote.createdAt || '') ? local : remote;
        cloudTemplates.put({ ...chosen, ownerId });
        localTemplates.delete(local.id);
        promoted.quickTemplates.push(chosen);
      });
    };
    tx.oncomplete = () => resolve(promoted);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function replaceAllData(settings, budgets, quickTemplates = []) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([SETTINGS_STORE, BUDGETS_STORE, QUICK_TEMPLATES_STORE], 'readwrite');
    const settingsStore = tx.objectStore(SETTINGS_STORE);
    const budgetsStore = tx.objectStore(BUDGETS_STORE);
    const quickTemplatesStore = tx.objectStore(QUICK_TEMPLATES_STORE);
    settingsStore.clear();
    budgetsStore.clear();
    quickTemplatesStore.clear();
    settingsStore.put({ ...settings, id: 'main' });
    (budgets || []).forEach((budget) => budgetsStore.put(budget));
    (quickTemplates || []).forEach((template) => quickTemplatesStore.put(template));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
