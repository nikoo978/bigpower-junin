import { CLOUD_CONFIG } from './cloud-config.js';

const SESSION_KEY = 'big-power-cloud-session';
const QUEUE_KEY = 'big-power-cloud-queue';
let session = null;

const SENSITIVE_KEY = /(?:password|passcode|contrasena|clave|pin|secret|token|apikey|credential|credencial|otp|temporarycode|codigotemporal|accesscode|codigoacceso)/i;
const SENSITIVE_TEXT = /\b(password|contrase(?:n|ñ)a|clave(?: temporal)?|pin|token|credencial|api[ -]?key|otp|código(?: temporal| de acceso)|codigo(?: temporal| de acceso))\s*[:=]\s*([^\s,;]+)/gi;

function isSensitiveKey(key) {
  return SENSITIVE_KEY.test(String(key).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, ''));
}

function sanitizeValue(value, { redactKeys = false } = {}) {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, { redactKeys }));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      if (key.startsWith('_')) return [];
      if (isSensitiveKey(key)) return redactKeys ? [[key, '[EXCLUIDO]']] : [];
      return [[key, sanitizeValue(item, { redactKeys })]];
    }));
  }
  if (typeof value === 'string') return value.replace(SENSITIVE_TEXT, '$1: [PROTEGIDO]');
  return value;
}

export function sanitizeForCloud(value) {
  return sanitizeValue(value, { redactKeys: false });
}

export function sanitizeForBackup(value) {
  return sanitizeValue(value, { redactKeys: true });
}

export function isCloudConfigured() {
  return /^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(CLOUD_CONFIG.url || '')
    && String(CLOUD_CONFIG.publishableKey || '').startsWith('sb_publishable_');
}

function readJsonStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
}

function writeJsonStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

function normalizeSession(value) {
  if (!value?.access_token || !value?.refresh_token) return null;
  const expiresAt = Number(value.expires_at)
    || Math.floor(Date.now() / 1000) + Number(value.expires_in || 3600);
  return { ...value, expires_at: expiresAt };
}

function setSession(value) {
  session = normalizeSession(value);
  if (session) writeJsonStorage(SESSION_KEY, session);
  else {
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
  }
  return session;
}

function cloudError(message, status = 0, details = null) {
  const error = new Error(message || 'No se pudo completar la operación en la nube.');
  error.status = status;
  error.details = details;
  return error;
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return text; }
}

async function authRequest(path, { method = 'POST', body = null, token = null } = {}) {
  const response = await fetch(`${CLOUD_CONFIG.url}/auth/v1/${path}`, {
    method,
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      apikey: CLOUD_CONFIG.publishableKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : null
  });
  const data = await readResponse(response);
  if (!response.ok) throw cloudError(data?.msg || data?.message || data?.error_description || 'Error de autenticación.', response.status, data);
  return data;
}

async function refreshSession() {
  if (!session?.refresh_token) return null;
  try {
    const data = await authRequest('token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } });
    return setSession(data);
  } catch (error) {
    if ([400, 401, 403].includes(error.status)) setSession(null);
    throw error;
  }
}

async function validSession() {
  if (!session) return null;
  const now = Math.floor(Date.now() / 1000);
  if (Number(session.expires_at || 0) <= now + 60) await refreshSession();
  return session;
}

async function restRequest(path, { method = 'GET', body = null, prefer = null } = {}) {
  const active = await validSession();
  if (!active?.access_token) throw cloudError('Iniciá sesión para sincronizar.', 401);
  const response = await fetch(`${CLOUD_CONFIG.url}/rest/v1/${path}`, {
    method,
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      apikey: CLOUD_CONFIG.publishableKey,
      Authorization: `Bearer ${active.access_token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body ? JSON.stringify(body) : null
  });
  const data = await readResponse(response);
  if (!response.ok) throw cloudError(data?.message || data?.hint || 'No se pudo sincronizar con la nube.', response.status, data);
  return data;
}

export async function initializeCloud() {
  if (!isCloudConfigured()) return null;
  session = normalizeSession(readJsonStorage(SESSION_KEY, null));
  if (!session) return null;
  const ownerId = session?.user?.id || null;
  try {
    await validSession();
    const user = await authRequest('user', { method: 'GET', token: session.access_token });
    session.user = user;
    setSession(session);
    return user;
  } catch (_) {
    clearCloudClientState(ownerId);
    return null;
  }
}

export function getCloudUser() {
  return session?.user || null;
}

export function getStoredCloudUserId() {
  return session?.user?.id || readJsonStorage(SESSION_KEY, null)?.user?.id || null;
}

export async function signInCloud(email, password) {
  const data = await authRequest('token?grant_type=password', { body: { email, password } });
  setSession(data);
  return session?.user || null;
}

export async function signUpCloud(email, password) {
  const data = await authRequest('signup', { body: { email, password } });
  if (data?.access_token) setSession(data);
  return { user: data?.user || null, signedIn: Boolean(data?.access_token) };
}

export async function signOutCloud() {
  const ownerId = getStoredCloudUserId();
  try {
    if (session?.access_token) await authRequest('logout?scope=local', { token: session.access_token });
  } catch (error) {
    console.warn('No se pudo revocar la sesión remota; se limpiará igualmente este dispositivo.', error);
  } finally {
    setSession(null);
    clearCloudClientState(ownerId);
  }
}

export function clearCloudClientState(ownerId = null, { preserveSession = false } = {}) {
  if (!preserveSession) setSession(null);
  const queue = readQueue();
  if (ownerId) {
    const remaining = queue.filter((item) => item.userId !== ownerId);
    if (remaining.length) writeJsonStorage(QUEUE_KEY, remaining);
    else {
      try { localStorage.removeItem(QUEUE_KEY); } catch (_) {}
    }
  }
  else {
    try { localStorage.removeItem(QUEUE_KEY); } catch (_) {}
  }
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith('big-power-cloud-') && key !== SESSION_KEY && key !== QUEUE_KEY)
      .forEach((key) => localStorage.removeItem(key));
    Object.keys(sessionStorage).filter((key) => key.startsWith('big-power-cloud-')).forEach((key) => sessionStorage.removeItem(key));
  } catch (_) {}
}

export async function fetchCloudSnapshot() {
  const [settingsRows, budgetRows, templateRows] = await Promise.all([
    restRequest('bp_user_settings?select=data,updated_at&limit=1'),
    restRequest('bp_budgets?select=id,budget_number,data,updated_at&order=updated_at.desc'),
    restRequest('bp_quick_templates?select=id,data,updated_at&order=updated_at.desc')
  ]);
  return {
    settings: settingsRows?.[0]?.data || null,
    budgets: (budgetRows || []).map((row) => ({ ...row.data, id: row.id, budgetNumber: Number(row.budget_number), updatedAt: row.data?.updatedAt || row.updated_at })),
    quickTemplates: (templateRows || []).map((row) => ({ ...row.data, id: row.id, updatedAt: row.data?.updatedAt || row.updated_at }))
  };
}

export async function upsertCloudSettings(data) {
  const user = getCloudUser();
  if (!user) return false;
  const updatedAt = data.updatedAt || new Date().toISOString();
  await restRequest('bp_user_settings?on_conflict=user_id', {
    method: 'POST',
    body: [{ user_id: user.id, data: sanitizeForCloud({ ...data, updatedAt }), updated_at: updatedAt }],
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
  return true;
}

export async function upsertCloudBudget(budget) {
  const user = getCloudUser();
  if (!user) return false;
  const updatedAt = budget.updatedAt || new Date().toISOString();
  await restRequest('bp_budgets?on_conflict=user_id,id', {
    method: 'POST',
    body: [{ user_id: user.id, id: budget.id, budget_number: Number(budget.budgetNumber), data: sanitizeForCloud({ ...budget, updatedAt }), updated_at: updatedAt }],
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
  return true;
}

export async function upsertCloudQuickTemplate(template) {
  const user = getCloudUser();
  if (!user) return false;
  const updatedAt = template.updatedAt || new Date().toISOString();
  await restRequest('bp_quick_templates?on_conflict=user_id,id', {
    method: 'POST',
    body: [{ user_id: user.id, id: template.id, data: sanitizeForCloud({ ...template, updatedAt }), updated_at: updatedAt }],
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
  return true;
}

function readQueue() {
  return readJsonStorage(QUEUE_KEY, []);
}

function queueDelete(type, id) {
  const user = getCloudUser();
  if (!user) return;
  const queue = readQueue().filter((item) => !(item.userId === user.id && item.type === type && item.id === id));
  queue.push({ userId: user.id, type, id, queuedAt: new Date().toISOString() });
  writeJsonStorage(QUEUE_KEY, queue);
}

async function deleteCloudRow(table, type, id, { queueOnFailure = true } = {}) {
  if (!getCloudUser()) return false;
  try {
    await restRequest(`${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    return true;
  } catch (error) {
    if (queueOnFailure) queueDelete(type, id);
    throw error;
  }
}

export function deleteCloudBudget(id) {
  return deleteCloudRow('bp_budgets', 'budget', id);
}

export function deleteCloudQuickTemplate(id) {
  return deleteCloudRow('bp_quick_templates', 'template', id);
}

export async function flushCloudQueue() {
  const user = getCloudUser();
  if (!user) return;
  const queue = readQueue();
  const remaining = queue.filter((item) => item.userId !== user.id);
  let failed = 0;
  for (const item of queue.filter((entry) => entry.userId === user.id)) {
    try {
      const table = item.type === 'template' ? 'bp_quick_templates' : 'bp_budgets';
      await deleteCloudRow(table, item.type, item.id, { queueOnFailure: false });
    } catch (_) {
      remaining.push(item);
      failed += 1;
    }
  }
  writeJsonStorage(QUEUE_KEY, remaining);
  if (failed) throw cloudError('Hay eliminaciones pendientes de sincronizar.');
}
