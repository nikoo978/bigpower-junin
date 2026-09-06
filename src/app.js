import {
  getSettings,
  saveSettings,
  getBudgets,
  getBudget,
  saveBudget,
  deleteBudget,
  getQuickTemplates,
  saveQuickTemplate,
  deleteQuickTemplate,
  replaceAllData,
  getCloudSettings,
  saveCloudSettings,
  getCloudBudgets,
  getCloudBudget,
  saveCloudBudget,
  deleteCloudBudgetCache,
  getCloudQuickTemplates,
  saveCloudQuickTemplate,
  deleteCloudQuickTemplateCache,
  clearCloudData,
  migrateLegacyCloudMatches
} from './db.js';
import {
  isCloudConfigured,
  initializeCloud,
  getCloudUser,
  getStoredCloudUserId,
  signInCloud,
  signUpCloud,
  signOutCloud,
  clearCloudClientState,
  fetchCloudSnapshot,
  upsertCloudSettings,
  upsertCloudBudget,
  upsertCloudQuickTemplate,
  deleteCloudBudget,
  deleteCloudQuickTemplate,
  flushCloudQueue,
  sanitizeForBackup
} from './cloud.js';

const DEFAULT_TERMS = `El presente presupuesto se basa en el relevamiento disponible y queda sujeto a verificación final en obra, acceso seguro y disponibilidad de materiales.
No se ejecutarán tareas adicionales ni modificaciones de alcance sin autorización previa del cliente.
La garantía cubre los materiales provistos y la mano de obra detallada. No comprende fallas ajenas al trabajo, sobretensiones externas, humedad, intervenciones de terceros ni uso inadecuado.
Los trabajos que requieran corte de suministro deberán coordinarse previamente. El cliente debe garantizar acceso al lugar y comunicar riesgos o condiciones especiales.
Las instalaciones se entregarán probadas dentro del alcance indicado. Adecuaciones no visibles o exigencias de la distribuidora/administración se cotizarán por separado.
El retiro, gestión o disposición de residuos y materiales existentes se incluye únicamente cuando figure expresamente en el detalle.`;

const BRAND_PROFILE_VERSION = 2;
const DEFAULT_MARK_URL = './bigpower-mark-transparent.png';
const THEME_STORAGE_KEY = 'big-power-theme';

const DEFAULT_SETTINGS = {
  id: 'main',
  businessName: 'BIG POWER',
  tagline: 'Soluciones eléctricas · Hogares · Comercios · Empresas',
  address: 'Junín, Buenos Aires, Argentina',
  phone: '2364 66-8078 · 2364 50-0133',
  email: 'bigpowersolucioneselectricas@gmail.com',
  cuit: '',
  technicians: ['Técnico 1', 'Técnico 2'],
  technician: 'Técnico 1',
  technician2: 'Técnico 2',
  serviceArea: 'Junín y zona',
  licenseNumber: '',
  nextNumber: 1,
  warrantyDays: 30,
  validityDays: 10,
  executionDays: 3,
  defaultTemplate: 'classic',
  palette: 'industrial-gold',
  brandPattern: 'circuits',
  patternDefaultVersion: 1,
  patternRepeat: 5,
  patternIntensity: 35,
  customPatternSvg: '',
  patternDocuments: true,
  terms: DEFAULT_TERMS,
  logo: null,
  brandProfileVersion: BRAND_PROFILE_VERSION
};

const STATUS_OPTIONS = [
  { value: 'Ingresado', tone: 'cyan' },
  { value: 'Visita programada', tone: 'blue' },
  { value: 'Relevado', tone: 'violet' },
  { value: 'Presupuestado', tone: 'blue' },
  { value: 'Aprobado', tone: 'green' },
  { value: 'En ejecución', tone: 'orange' },
  { value: 'Finalizado', tone: 'green' },
  { value: 'Cancelado', tone: 'red' }
];

const STATUS_COMPAT = {
  Borrador: 'Ingresado',
  Recibido: 'Ingresado',
  Diagnosticando: 'Relevado',
  Pendiente: 'Presupuestado',
  Aceptado: 'Aprobado',
  'En reparación': 'En ejecución',
  Listo: 'Finalizado',
  Entregado: 'Finalizado',
  Rechazado: 'Cancelado'
};

const ELECTRICAL_QUICK_SERVICES = [
  {
    id: 'no-power', label: 'Sin energía', icon: '⚡', serviceType: 'Urgencia', priority: 'Urgente',
    issue: 'El cliente informa falta total o parcial de suministro dentro del inmueble.',
    diagnosis: 'Se realizará verificación de tensión de entrada, protecciones, continuidad y circuitos afectados. La causa definitiva queda sujeta a mediciones en obra y a la disponibilidad de acceso seguro al tablero y la instalación.',
    result: 'Pendiente de relevamiento y mediciones en el lugar.',
    work: 'Localización de la falla, aislamiento del sector afectado, normalización segura dentro del alcance autorizado y pruebas funcionales.',
    items: [{ detail: 'Visita, diagnóstico y localización de falla', condition: 'Servicio', price: 0 }, { detail: 'Mano de obra de reparación eléctrica', condition: 'Mano de obra', price: 0 }]
  },
  {
    id: 'short-circuit', label: 'Cortocircuito', icon: '↯', serviceType: 'Reparación', priority: 'Alta',
    issue: 'Actuación reiterada de térmica o disyuntor / posible cortocircuito.',
    diagnosis: 'Se requiere sectorizar la instalación, medir aislación y continuidad, verificar protecciones, empalmes y consumos conectados. No se energizará un circuito que no presente condiciones seguras.',
    result: 'Falla pendiente de ubicación y evaluación en obra.',
    work: 'Detección y aislamiento de la falla, reparación del tramo o elemento afectado, verificación de protecciones y prueba controlada de funcionamiento.',
    items: [{ detail: 'Diagnóstico y sectorización de circuito', condition: 'Servicio', price: 0 }, { detail: 'Reparación y pruebas eléctricas', condition: 'Mano de obra', price: 0 }]
  },
  {
    id: 'panel', label: 'Tablero eléctrico', icon: '▦', serviceType: 'Instalación', priority: 'Normal',
    issue: 'Revisión, ordenamiento o renovación de tablero eléctrico.',
    diagnosis: 'El tablero deberá relevarse para verificar capacidad, estado de conexiones, calibre de conductores, identificación de circuitos y coordinación de protecciones.',
    result: 'Adecuación sujeta al relevamiento y cálculo de cargas.',
    work: 'Provisión y montaje de gabinete, protecciones termomagnéticas y diferenciales, distribución, rotulado, ajuste de conexiones y pruebas.',
    items: [{ detail: 'Tablero y protecciones según relevamiento', condition: 'Material', price: 0 }, { detail: 'Armado, instalación, rotulado y pruebas', condition: 'Mano de obra', price: 0 }]
  },
  {
    id: 'new-installation', label: 'Instalación nueva', icon: '＋', serviceType: 'Instalación', priority: 'Normal',
    issue: 'Nueva instalación o ampliación de bocas, tomas y circuitos.',
    diagnosis: 'Se relevarán recorrido, cargas previstas, canalizaciones, tablero, puesta a tierra y condiciones constructivas para definir materiales y secciones adecuadas.',
    result: 'Alcance pendiente de aprobación del presupuesto.',
    work: 'Tendido y conexionado de conductores, canalización, montaje de bocas y protecciones, identificación y pruebas finales del alcance contratado.',
    items: [{ detail: 'Materiales eléctricos según cómputo', condition: 'Material', price: 0 }, { detail: 'Instalación, conexionado y pruebas', condition: 'Mano de obra', price: 0 }]
  },
  {
    id: 'lighting', label: 'Iluminación', icon: '✦', serviceType: 'Instalación', priority: 'Normal',
    issue: 'Instalación, reemplazo o mejora de iluminación.',
    diagnosis: 'Se relevarán puntos, comando, potencia, altura de trabajo y estado del circuito existente.',
    result: 'Solución sujeta a selección de artefactos y condiciones de montaje.',
    work: 'Montaje y conexión de artefactos, adecuación de comandos, verificación de protecciones y prueba de funcionamiento.',
    items: [{ detail: 'Artefactos y materiales de iluminación', condition: 'Material', price: 0 }, { detail: 'Montaje, conexionado y pruebas', condition: 'Mano de obra', price: 0 }]
  },
  {
    id: 'grounding', label: 'Puesta a tierra', icon: '⏚', serviceType: 'Instalación', priority: 'Alta',
    issue: 'Verificación o ejecución de sistema de puesta a tierra.',
    diagnosis: 'Se deberá inspeccionar la instalación existente y realizar las mediciones que correspondan. La solución final depende del terreno, accesibilidad y normativa aplicable.',
    result: 'Sistema pendiente de medición y definición técnica.',
    work: 'Ejecución o adecuación de puesta a tierra, conexión equipotencial, identificación y medición final dentro del alcance contratado.',
    items: [{ detail: 'Jabalina, caja, conductor y accesorios', condition: 'Material', price: 0 }, { detail: 'Instalación y medición de puesta a tierra', condition: 'Mano de obra', price: 0 }]
  },
  {
    id: 'maintenance', label: 'Mantenimiento', icon: '✓', serviceType: 'Mantenimiento', priority: 'Normal',
    issue: 'Mantenimiento preventivo de instalación eléctrica.',
    diagnosis: 'Se inspeccionarán tableros, protecciones, aprietes, señales de temperatura, canalizaciones y puntos críticos accesibles.',
    result: 'Se emitirá detalle de hallazgos y recomendaciones según la inspección.',
    work: 'Revisión preventiva, ajuste de conexiones, limpieza técnica, identificación de circuitos y pruebas funcionales sin modificar el alcance autorizado.',
    items: [{ detail: 'Mantenimiento preventivo e informe de hallazgos', condition: 'Servicio', price: 0 }]
  },
  {
    id: 'surge', label: 'Sobretensión / rayo', icon: '⚠', serviceType: 'Relevamiento', priority: 'Alta',
    issue: 'El cliente informa fallas posteriores a una tormenta eléctrica o evento de sobretensión.',
    diagnosis: 'Se realizará inspección y medición de tableros, protecciones, circuitos y equipos accesibles. Cualquier daño se describirá como compatible con el evento informado cuando técnicamente corresponda, sin atribuir causalidad pericial sin mediciones y antecedentes suficientes.',
    result: 'Alcance de daños pendiente de relevamiento técnico.',
    work: 'Aislamiento de sectores inseguros, diagnóstico documentado, propuesta de reposición o adecuación y pruebas posteriores a la intervención autorizada.',
    notes: 'El informe técnico describe el estado observado y no constituye por sí solo una pericia sobre el origen externo del evento.',
    items: [{ detail: 'Relevamiento por sobretensión y diagnóstico documentado', condition: 'Servicio', price: 0 }, { detail: 'Materiales / protecciones a definir', condition: 'Material', price: 0 }]
  }
];

let settings = { ...DEFAULT_SETTINGS };
let deferredInstallPrompt = null;
let budgets = [];
let quickTemplates = [];
let editingId = null;
let workingBudgetNumber = DEFAULT_SETTINGS.nextNumber;
let workingItems = [];
let pendingLogo = undefined;
let pendingPatternSvg = undefined;
let logoUrlCache = null;
let logoSourceCache = null;
let dirty = false;
let activePreviewTemplate = 'classic';
let previewBaseScale = 1;
let previewZoomFactor = 1;
let previewPinchStartDistance = 0;
let previewPinchStartZoom = 1;
let previewPinchCenter = null;
let cloudUser = null;
let cloudSyncBusy = false;
let pdfDownloadBusy = false;
let activeDataScope = 'local';
let editingScope = 'local';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const currency = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const percentage = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function fmtMoney(value) {
  return currency.format(Number(value) || 0).replace('ARS', '$').replace(/\s+/g, ' ');
}

function financialDocumentLabel(label, mode, value) {
  return mode === 'percent' ? `${label} (${percentage.format(Number(value) || 0)} %)` : label;
}

function fmtDate(value) {
  if (!value) return '—';
  const parts = String(value).split('-');
  if (parts.length !== 3) return value;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function fmtDateTime(value) {
  if (!value) return '—';
  const [date, time] = String(value).split('T');
  return `${fmtDate(date)}${time ? ` · ${time.slice(0, 5)} h` : ''}`;
}

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

function padNumber(value) {
  return String(Number(value) || 0).padStart(6, '0');
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function applyTheme(theme, { persist = false } = {}) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  const isLight = nextTheme === 'light';
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;

  if (persist) {
    try { localStorage.setItem(THEME_STORAGE_KEY, nextTheme); } catch (_) {}
  }

  $$('[data-theme-toggle]').forEach((button) => {
    const action = isLight ? 'Apagar luz y activar tema oscuro' : 'Encender luz y activar tema claro';
    button.setAttribute('aria-pressed', String(isLight));
    button.setAttribute('aria-label', action);
    button.title = action;
  });
  $$('[data-theme-label]').forEach((label) => { label.textContent = isLight ? 'Apagar luz' : 'Encender luz'; });
  $$('[data-theme-icon]').forEach((icon) => { icon.textContent = isLight ? '☾' : '☀'; });

  const themeColor = $('meta[name="theme-color"]');
  if (themeColor) themeColor.content = isLight ? '#f4f1e9' : '#0b0b0b';
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', { persist: true });
}

const PALETTES = new Set(['industrial-gold', 'technical-copper', 'electric-blue', 'precision-cyan', 'safety-green', 'energy-red', 'engineering-violet', 'graphite', 'professional-sand', 'monochrome']);
const BRAND_PATTERNS = new Set(['circuits', 'custom', 'none', 'pinstripe', 'microgrid', 'dot-grid', 'isometric', 'hex-mesh', 'diagonal', 'contour']);
const SAFE_SVG_ELEMENTS = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'lineargradient', 'radialgradient', 'stop', 'pattern', 'clippath', 'mask', 'title', 'desc']);
const SAFE_SVG_ATTRIBUTES = new Set(['xmlns', 'viewbox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform', 'gradientunits', 'gradienttransform', 'offset', 'stop-color', 'stop-opacity', 'patternunits', 'patterntransform', 'id', 'clip-path', 'mask']);

function sanitizePatternSvg(source = '') {
  const raw = String(source || '').trim();
  if (!raw || raw.length > 512 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(raw)) return '';
  const parsed = new DOMParser().parseFromString(raw, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName.toLowerCase() !== 'svg') return '';
  [...parsed.querySelectorAll('*')].forEach((element) => {
    if (!SAFE_SVG_ELEMENTS.has(element.localName.toLowerCase())) {
      element.remove();
      return;
    }
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (!SAFE_SVG_ATTRIBUTES.has(name) || name.startsWith('on') || /url\s*\(/i.test(attribute.value)) element.removeAttribute(attribute.name);
    });
  });
  const root = parsed.documentElement;
  if (!root.getAttribute('viewBox')) {
    const width = Math.max(1, Number.parseFloat(root.getAttribute('width')) || 100);
    const height = Math.max(1, Number.parseFloat(root.getAttribute('height')) || 100);
    root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(root);
}

function currentPatternSvg(value = settings) {
  return pendingPatternSvg !== undefined ? pendingPatternSvg : String(value.customPatternSvg || '');
}

function svgPatternDataUrl(svg = '') {
  const clean = sanitizePatternSvg(svg);
  return clean ? `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(clean)}` : '';
}

function applyVisualIdentity(value = settings) {
  const palette = PALETTES.has(value.palette) ? value.palette : DEFAULT_SETTINGS.palette;
  const customSvg = currentPatternSvg(value);
  const selectedPattern = BRAND_PATTERNS.has(value.brandPattern) ? value.brandPattern : DEFAULT_SETTINGS.brandPattern;
  const pattern = selectedPattern === 'custom' && !customSvg ? DEFAULT_SETTINGS.brandPattern : selectedPattern;
  const repeat = Math.max(1, Math.min(24, Number(value.patternRepeat ?? DEFAULT_SETTINGS.patternRepeat)));
  const intensity = Math.max(0, Math.min(100, Number(value.patternIntensity ?? DEFAULT_SETTINGS.patternIntensity)));
  document.documentElement.dataset.palette = palette;
  document.documentElement.dataset.brandPattern = pattern;
  document.documentElement.style.setProperty('--pattern-repeat', String(repeat));
  document.documentElement.style.setProperty('--pattern-opacity', String(intensity / 100));
  const customUrl = svgPatternDataUrl(customSvg);
  if (customUrl) document.documentElement.style.setProperty('--custom-pattern', `url("${customUrl}")`);
  else document.documentElement.style.removeProperty('--custom-pattern');
  const repeatOutput = $('#patternRepeatValue');
  if (repeatOutput) repeatOutput.value = `${repeat}×`;
  const output = $('#patternIntensityValue');
  if (output) output.value = `${intensity}%`;
  const status = $('#customPatternStatus');
  if (status) status.textContent = customSvg ? 'SVG personalizado cargado' : 'Sin SVG personalizado';
  $('#removePatternSvgBtn')?.classList.toggle('hidden', !customSvg);
}

function documentPatternClass() {
  const enabled = Boolean(settings.patternDocuments);
  return `pattern-${enabled && BRAND_PATTERNS.has(settings.brandPattern) ? settings.brandPattern : 'none'}`;
}

function documentPatternOpacity() {
  return Math.max(0, Math.min(.42, Number(settings.patternIntensity ?? 35) / 260));
}

function documentPatternSize() {
  const repeat = Math.max(1, Math.min(24, Number(settings.patternRepeat ?? DEFAULT_SETTINGS.patternRepeat)));
  return `${185 / repeat}mm`;
}

function documentPatternStyle() {
  const customUrl = svgPatternDataUrl(currentPatternSvg(settings));
  return `--document-pattern-opacity:${documentPatternOpacity()};--document-pattern-size:${documentPatternSize()};${customUrl ? `--custom-pattern:url(&quot;${escapeHtml(customUrl)}&quot;);` : ''}`;
}

function documentPaletteClass() {
  return `document-palette-${PALETTES.has(settings.palette) ? settings.palette : DEFAULT_SETTINGS.palette}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function multiline(value = '') {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function normalizeStatus(value) {
  return STATUS_COMPAT[value] || value || 'Ingresado';
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2400);
}

function cloudMessage(error) {
  const raw = String(error?.message || '').toLowerCase();
  if (raw.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (raw.includes('email not confirmed')) return 'Confirmá primero el correo que envió Supabase.';
  if (raw.includes('user already registered')) return 'Ya existe una cuenta con ese correo.';
  if (raw.includes('rate limit')) return 'Supabase limitó temporalmente los registros. Esperá unos minutos e intentá nuevamente.';
  if (raw.includes('email address') && raw.includes('invalid')) return 'Ingresá una dirección de correo válida.';
  if (raw.includes('password')) return 'La contraseña debe tener al menos 8 caracteres.';
  if (raw.includes('failed to fetch') || !navigator.onLine) return 'Sin conexión. Los cambios quedaron guardados en este dispositivo.';
  return error?.message || 'No se pudo completar la operación en la nube.';
}

function setCloudAuthMessage(message = '', isError = false) {
  const box = $('#cloudAuthMessage');
  if (!box) return;
  box.textContent = message;
  box.classList.toggle('error', isError);
}

function renderCloudState(mode = 'idle') {
  const configured = isCloudConfigured();
  const online = navigator.onLine;
  const user = cloudUser || getCloudUser();
  const connected = Boolean(user);
  const title = $('#cloudStateTitle');
  const summary = $('#cloudStateSummary');
  const detail = $('#cloudStatusDetail');
  const shortcut = $('#cloudAccountShortcut');
  const dots = [$('#connectionDot'), $('#cloudStateDot')].filter(Boolean);

  dots.forEach((dot) => {
    dot.classList.remove('cloud-offline', 'cloud-error', 'cloud-syncing');
    if (mode === 'syncing') dot.classList.add('cloud-syncing');
    else if (!online) dot.classList.add('cloud-offline');
    else if (mode === 'error') dot.classList.add('cloud-error');
    else if (!connected) dot.classList.add('cloud-offline');
  });

  if (!configured) {
    $('#offlineStatus').textContent = online ? 'Guardado en este equipo' : 'Trabajando sin conexión';
    if (title) title.textContent = 'Nube no configurada';
    if (summary) summary.textContent = 'La aplicación continúa funcionando localmente.';
    if (detail) detail.textContent = 'Datos protegidos en este dispositivo';
  } else if (connected) {
    $('#offlineStatus').textContent = mode === 'syncing' ? 'Actualizando Nube…' : (activeDataScope === 'cloud' ? (online ? 'Espacio Nube' : 'Nube sin conexión') : 'Espacio Dispositivo');
    if (title) title.textContent = user.email || 'Cuenta conectada';
    if (summary) summary.textContent = online ? 'Nube está separada de los trabajos del dispositivo.' : 'Los cambios creados en Nube se enviarán al recuperar internet.';
    if (detail) detail.textContent = user.email || 'Cuenta conectada';
  } else {
    $('#offlineStatus').textContent = online ? 'Guardado en este equipo' : 'Trabajando sin conexión';
    if (title) title.textContent = 'Sólo en este dispositivo';
    if (summary) summary.textContent = 'Conectá una cuenta para consultar los presupuestos desde cualquier equipo.';
    if (detail) detail.textContent = 'Conectá una cuenta para abrir Nube';
  }

  if (shortcut) shortcut.textContent = connected ? 'Gestionar cuenta' : 'Conectar nube';
  $('#cloudAuthBtn')?.classList.toggle('hidden', connected || !configured);
  $('#cloudSyncBtn')?.classList.toggle('hidden', !connected);
  $('#cloudSignOutBtn')?.classList.toggle('hidden', !connected);
  if ($('#cloudSyncBtn')) $('#cloudSyncBtn').disabled = cloudSyncBusy || !online;
  renderDataScope();
}

function openCloudAuthDialog() {
  if (cloudUser) {
    showView('settings');
    $('#cloudSyncBtn')?.focus();
    return;
  }
  const dialog = $('#cloudAuthDialog');
  const form = $('#cloudAuthForm');
  form.reset();
  setCloudAuthMessage();
  dialog.showModal();
  requestAnimationFrame(() => form.elements.email.focus());
}

function closeCloudAuthDialog() {
  const dialog = $('#cloudAuthDialog');
  if (dialog?.open) dialog.close();
}

function recordTime(record) {
  return String(record?.updatedAt || record?.createdAt || '');
}

function mergeCloudRecords(cachedRecords = [], remoteRecords = []) {
  const localMap = new Map(cachedRecords.map((record) => [record.id, record]));
  const merged = [];
  const upload = [];
  remoteRecords.forEach((remote) => {
    const cached = localMap.get(remote.id);
    localMap.delete(remote.id);
    if (cached?._cloudPending && recordTime(cached) > recordTime(remote)) {
      merged.push(cached);
      upload.push(cached);
      return;
    }
    merged.push({ ...remote, _cloudPending: false });
  });
  localMap.forEach((cached) => {
    if (!cached?._cloudPending) return;
    merged.push(cached);
    upload.push(cached);
  });
  return { merged, upload };
}

async function settingsToCloud(value) {
  const logoDataUrl = await blobToDataURL(value.logo);
  const clean = { ...value, logo: undefined, logoDataUrl };
  delete clean.logo;
  return clean;
}

function settingsFromCloud(value) {
  if (!value) return null;
  const restored = { ...value, logo: value.logoDataUrl ? dataURLToBlob(value.logoDataUrl) : null };
  delete restored.logoDataUrl;
  return restored;
}

function cloudOwnerId() {
  return cloudUser?.id || getCloudUser()?.id || null;
}

async function readScopeData(scope = activeDataScope) {
  if (scope === 'cloud') {
    const ownerId = cloudOwnerId();
    if (!ownerId) throw new Error('Ingresá a la nube para abrir ese espacio.');
    const [cloudSettings, cloudBudgets, cloudTemplates] = await Promise.all([
      getCloudSettings(ownerId), getCloudBudgets(ownerId), getCloudQuickTemplates(ownerId)
    ]);
    const localSeed = cloudSettings ? null : await getSettings();
    return {
      settings: applyBigPowerProfile(cloudSettings || { ...(localSeed || DEFAULT_SETTINGS), id: 'main', updatedAt: '' }),
      budgets: cloudBudgets,
      quickTemplates: cloudTemplates
    };
  }
  const [localSettings, localBudgets, localTemplates] = await Promise.all([getSettings(), getBudgets(), getQuickTemplates()]);
  return {
    settings: applyBigPowerProfile(localSettings || {}),
    budgets: localBudgets,
    quickTemplates: localTemplates
  };
}

function renderDataScope() {
  $$('[data-storage-scope]').forEach((button) => {
    const isCloud = button.dataset.storageScope === 'cloud';
    button.classList.toggle('active', button.dataset.storageScope === activeDataScope);
    button.classList.toggle('locked', isCloud && !cloudUser);
    button.setAttribute('aria-disabled', String(isCloud && !cloudUser));
    button.title = isCloud && !cloudUser ? 'Ingresá a una cuenta para usar Nube' : '';
  });
  const label = activeDataScope === 'cloud' ? 'NUBE' : 'LOCAL';
  if ($('#ordersScopeLabel')) $('#ordersScopeLabel').textContent = label;
  if ($('#settingsScopeLabel')) $('#settingsScopeLabel').textContent = label;
}

async function reloadActiveScope({ reset = false } = {}) {
  const data = await readScopeData(activeDataScope);
  settings = data.settings;
  budgets = data.budgets;
  quickTemplates = data.quickTemplates;
  pendingLogo = undefined;
  pendingPatternSvg = undefined;
  applyVisualIdentity(settings);
  fillSettingsForm();
  renderQuickServices();
  renderCustomTemplatesList();
  refreshDatalists();
  renderBudgetsTable();
  renderDataScope();
  if (reset) resetEditor();
}

async function setDataScope(scope, { notify = true } = {}) {
  const next = scope === 'cloud' ? 'cloud' : 'local';
  if (next === 'cloud' && !cloudUser) {
    openCloudAuthDialog();
    setCloudAuthMessage('Ingresá para abrir el espacio Nube. Los trabajos del dispositivo no se subirán automáticamente.');
    return false;
  }
  if (next === activeDataScope) return true;
  if (dirty && !confirm('Hay cambios sin guardar. ¿Cambiar de espacio igualmente?')) return false;
  activeDataScope = next;
  editingScope = next;
  await reloadActiveScope({ reset: true });
  if (notify) toast(next === 'cloud' ? 'Espacio Nube abierto' : 'Espacio Dispositivo abierto');
  return true;
}

async function synchronizeCloudData({ notify = true } = {}) {
  if (!cloudUser || !navigator.onLine || cloudSyncBusy) return;
  cloudSyncBusy = true;
  renderCloudState('syncing');
  try {
    await flushCloudQueue();
    const ownerId = cloudOwnerId();
    const remote = await fetchCloudSnapshot();
    const promoted = await migrateLegacyCloudMatches(ownerId, remote.budgets, remote.quickTemplates);
    const remoteBudgetMap = new Map(remote.budgets.map((record) => [record.id, record]));
    const remoteTemplateMap = new Map(remote.quickTemplates.map((record) => [record.id, record]));
    for (const budget of promoted.budgets) {
      if (recordTime(budget) > recordTime(remoteBudgetMap.get(budget.id))) await saveCloudBudget(ownerId, { ...budget, _cloudPending: true });
    }
    for (const template of promoted.quickTemplates) {
      if (recordTime(template) > recordTime(remoteTemplateMap.get(template.id))) await saveCloudQuickTemplate(ownerId, { ...template, _cloudPending: true });
    }

    const [cachedSettings, cachedBudgets, cachedTemplates] = await Promise.all([
      getCloudSettings(ownerId), getCloudBudgets(ownerId), getCloudQuickTemplates(ownerId)
    ]);
    const budgetMerge = mergeCloudRecords(cachedBudgets, remote.budgets);
    const templateMerge = mergeCloudRecords(cachedTemplates, remote.quickTemplates);
    for (const budget of budgetMerge.upload) await upsertCloudBudget(budget);
    for (const template of templateMerge.upload) await upsertCloudQuickTemplate(template);

    let mergedSettings = remote.settings ? settingsFromCloud(remote.settings) : null;
    if (cachedSettings?._cloudPending && (!remote.settings || recordTime(cachedSettings) > recordTime(remote.settings))) {
      await upsertCloudSettings(await settingsToCloud(cachedSettings));
      mergedSettings = { ...cachedSettings, _cloudPending: false };
    }
    await clearCloudData(ownerId);
    if (mergedSettings) await saveCloudSettings(ownerId, applyBigPowerProfile({ ...mergedSettings, _cloudPending: false }));
    for (const budget of budgetMerge.merged) await saveCloudBudget(ownerId, { ...budget, _cloudPending: false });
    for (const template of templateMerge.merged) await saveCloudQuickTemplate(ownerId, { ...template, _cloudPending: false });
    if (activeDataScope === 'cloud') await reloadActiveScope();
    else {
      const localData = await readScopeData('local');
      budgets = localData.budgets;
      quickTemplates = localData.quickTemplates;
      refreshDatalists();
      renderBudgetsTable();
    }
    if (notify) toast(promoted.budgets.length || promoted.quickTemplates.length ? 'Nube actualizada y datos antiguos reclasificados' : 'Espacio Nube actualizado');
    renderCloudState();
    if (!dirty && $('#saveState')) {
      $('#saveState').textContent = activeDataScope === 'cloud' ? 'Nube actualizada' : 'Guardado local';
      $('#saveState').classList.add('saved');
    }
  } catch (error) {
    console.error('Sincronización:', error);
    renderCloudState('error');
    if (notify) toast(cloudMessage(error));
  } finally {
    cloudSyncBusy = false;
    renderCloudState();
  }
}

async function handleCloudSignIn(event) {
  event.preventDefault();
  const form = $('#cloudAuthForm');
  if (!form.reportValidity()) return;
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  setCloudAuthMessage('Ingresando…');
  try {
    const previousOwnerId = getStoredCloudUserId();
    cloudUser = await signInCloud(email, password);
    if (previousOwnerId && previousOwnerId !== cloudUser?.id) {
      await clearCloudData(previousOwnerId);
      clearCloudClientState(previousOwnerId, { preserveSession: true });
      await purgeExternalHttpCaches();
    }
    renderCloudState('syncing');
    await synchronizeCloudData({ notify: false });
    closeCloudAuthDialog();
    form.reset();
    renderDataScope();
    toast('Cuenta conectada. Elegí Nube para ver sus trabajos.');
  } catch (error) {
    setCloudAuthMessage(cloudMessage(error), true);
  }
}

async function handleCloudSignUp() {
  const form = $('#cloudAuthForm');
  if (!form.reportValidity()) return;
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  setCloudAuthMessage('Creando cuenta…');
  try {
    const result = await signUpCloud(email, password);
    if (!result.signedIn) {
      setCloudAuthMessage('Cuenta creada. Revisá tu correo y confirmalo antes de ingresar.');
      return;
    }
    cloudUser = result.user;
    renderCloudState('syncing');
    await synchronizeCloudData({ notify: false });
    closeCloudAuthDialog();
    form.reset();
    renderDataScope();
    toast('Cuenta creada. El espacio local permanece separado.');
  } catch (error) {
    setCloudAuthMessage(cloudMessage(error), true);
  }
}

async function handleCloudSignOut() {
  if (!confirm('¿Cerrar esta sesión? Se eliminarán del dispositivo todos los datos descargados de esta cuenta. Los trabajos locales permanecerán intactos.')) return;
  const ownerId = cloudOwnerId() || getStoredCloudUserId();
  await signOutCloud();
  if (ownerId) await clearCloudData(ownerId);
  await purgeExternalHttpCaches();
  cloudUser = null;
  activeDataScope = 'local';
  editingScope = 'local';
  $('#cloudAuthForm')?.reset();
  await reloadActiveScope({ reset: true });
  renderCloudState();
  toast('Sesión y datos cloud eliminados de este dispositivo');
}

async function purgeExternalHttpCaches() {
  if (!('caches' in window)) return;
  try {
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        if (new URL(request.url).origin !== location.origin) await cache.delete(request);
      }
    }
  } catch (error) {
    console.warn('Limpieza de caché externa:', error);
  }
}

async function syncCloudAction(action, pendingMessage = 'Cambio cloud pendiente de envío') {
  if (!cloudUser) return false;
  try {
    await action();
    renderCloudState();
    return true;
  } catch (error) {
    console.error('Nube:', error);
    renderCloudState('error');
    toast(pendingMessage);
    return false;
  }
}

function setDirty(value = true) {
  dirty = value;
  const state = $('#saveState');
  if (!state) return;
  state.textContent = value ? 'Cambios sin guardar' : 'Guardado';
  state.classList.toggle('saved', !value);
}

function initials(name) {
  const words = String(name || 'ST').replace(/[-·|]/g, ' ').split(/\s+/).filter(Boolean);
  const skip = new Set(['SERVICIO', 'TÉCNICO', 'TECNICO', 'DE', 'DEL']);
  const chosen = words.filter((word) => !skip.has(word.toUpperCase())).slice(0, 2);
  return (chosen.length ? chosen : words.slice(0, 2)).map((word) => word[0]).join('').toUpperCase() || 'ST';
}

function normalizeTechnicians(value = {}) {
  const configured = Array.isArray(value.technicians) ? value.technicians : [];
  const legacy = [value.technician, value.technician2];
  return [...new Set([...configured, ...legacy]
    .map((name) => String(name || '').trim())
    .filter(Boolean))];
}

function settingsWithTechnicians(value = {}) {
  const technicians = normalizeTechnicians(value);
  return {
    ...value,
    technicians,
    technician: technicians[0] || '',
    technician2: technicians[1] || ''
  };
}

function primaryTechnician(fallback = 'Electricista responsable') {
  return normalizeTechnicians(settings)[0] || fallback;
}

function applyBigPowerProfile(savedSettings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...savedSettings };
  if ((Number(savedSettings.patternDefaultVersion) || 0) < 1) {
    if (!savedSettings.brandPattern || savedSettings.brandPattern === 'pinstripe') merged.brandPattern = 'circuits';
    merged.patternDefaultVersion = 1;
  }
  merged.palette = PALETTES.has(merged.palette) ? merged.palette : DEFAULT_SETTINGS.palette;
  merged.brandPattern = BRAND_PATTERNS.has(merged.brandPattern) ? merged.brandPattern : DEFAULT_SETTINGS.brandPattern;
  merged.patternRepeat = Math.max(1, Math.min(24, Number(merged.patternRepeat ?? DEFAULT_SETTINGS.patternRepeat)));
  merged.patternIntensity = Math.max(0, Math.min(100, Number(merged.patternIntensity ?? DEFAULT_SETTINGS.patternIntensity)));
  merged.customPatternSvg = sanitizePatternSvg(merged.customPatternSvg || '');
  if (merged.brandPattern === 'custom' && !merged.customPatternSvg) merged.brandPattern = DEFAULT_SETTINGS.brandPattern;
  merged.patternDocuments = typeof merged.patternDocuments === 'boolean' ? merged.patternDocuments : String(merged.patternDocuments ?? 'true') !== 'false';
  if (!Array.isArray(savedSettings.technicians)) {
    const legacyTechnicians = [savedSettings.technician, savedSettings.technician2].map((name) => String(name || '').trim()).filter(Boolean);
    merged.technicians = legacyTechnicians.length ? legacyTechnicians : [...DEFAULT_SETTINGS.technicians];
  }
  if ((Number(savedSettings.brandProfileVersion) || 0) >= BRAND_PROFILE_VERSION) return settingsWithTechnicians(merged);

  const previousName = String(savedSettings.businessName || '').trim().toUpperCase();
  if (!previousName || previousName === 'SERVICIOS ELÉCTRICOS') merged.businessName = DEFAULT_SETTINGS.businessName;
  if (!savedSettings.tagline || savedSettings.tagline === 'Instalaciones · Mantenimiento · Urgencias') merged.tagline = DEFAULT_SETTINGS.tagline;
  ['address', 'phone', 'email', 'serviceArea', 'technician', 'technician2'].forEach((field) => {
    if (!String(savedSettings[field] || '').trim()) merged[field] = DEFAULT_SETTINGS[field];
  });
  merged.logo = null;
  merged.brandProfileVersion = BRAND_PROFILE_VERSION;
  return settingsWithTechnicians(merged);
}

function updateBrandUI() {
  $('#sidebarBusiness').textContent = settings.businessName || 'BIG POWER';
  $('#sidebarTagline').textContent = settings.tagline || 'Soluciones eléctricas';
  $('#mobileBusiness').textContent = settings.businessName || 'BIG POWER';
  document.title = `${settings.businessName || 'BIG POWER'} · Gestión eléctrica`;
}

function ensureLogoUrl(blob) {
  if (!blob) return null;
  if (blob === logoSourceCache && logoUrlCache) return logoUrlCache;
  if (logoUrlCache) URL.revokeObjectURL(logoUrlCache);
  logoSourceCache = blob;
  logoUrlCache = URL.createObjectURL(blob);
  return logoUrlCache;
}

function currentLogoBlob() {
  return pendingLogo !== undefined ? pendingLogo : settings.logo;
}

function defaultBrandLockupHtml(className = '') {
  return `<span class="brand-lockup ${className}" role="img" aria-label="BIG POWER">
    <img class="brand-lockup-mark" src="${DEFAULT_MARK_URL}" alt="" />
    <span class="brand-lockup-word"><span class="brand-lockup-thin">IG</span> POWER</span>
  </span>`;
}

function refreshLogoUI() {
  const blob = currentLogoBlob();
  const box = $('#logoPreview');
  box.innerHTML = '';
  if (blob) {
    const img = new Image();
    img.src = ensureLogoUrl(blob);
    img.alt = `Logo de ${settings.businessName || 'BIG POWER'}`;
    box.appendChild(img);
  } else {
    box.innerHTML = defaultBrandLockupHtml('settings-brand-lockup');
  }
  $('#removeLogoBtn').classList.toggle('hidden', !blob);
}

function updateViewHistory(view, mode = 'auto') {
  if (mode === 'none') return;
  const state = { bigPowerView: view };
  const fragment = view === 'new' ? '#inicio' : `#${view}`;
  if (mode === 'replace') {
    history.replaceState(state, '', fragment);
    return;
  }
  const currentView = history.state?.bigPowerView;
  if (currentView === view) return;
  if (view === 'new') {
    history.replaceState(state, '', fragment);
    return;
  }
  if (currentView && currentView !== 'new') history.replaceState({ bigPowerView: 'new' }, '', '#inicio');
  history.pushState(state, '', fragment);
}

function initializeAppHistory() {
  if (history.state?.bigPowerEntry) {
    history.replaceState({ bigPowerView: 'new', bigPowerEntry: true }, '', '#inicio');
    return;
  }
  history.replaceState({ bigPowerView: 'new', bigPowerRoot: true }, '', '#inicio');
  history.pushState({ bigPowerView: 'new', bigPowerEntry: true }, '', '#inicio');
}

function setMobileMenu(open) {
  const isOpen = Boolean(open);
  document.body.classList.toggle('menu-open', isOpen);
  const button = $('#mobileMenuBtn');
  if (!button) return;
  button.setAttribute('aria-expanded', String(isOpen));
  button.setAttribute('aria-label', isOpen ? 'Cerrar menú' : 'Abrir menú');
}

function showView(view, { historyMode = 'auto' } = {}) {
  $$('.view').forEach((section) => section.classList.toggle('active-view', section.id === `view-${view}`));
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  setMobileMenu(false);
  if (view === 'orders') renderBudgetsTable();
  updateViewHistory(view, historyMode);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function currentViewName() {
  return $('.view.active-view')?.id.replace('view-', '') || 'new';
}

function allQuickServices() {
  return [...ELECTRICAL_QUICK_SERVICES, ...quickTemplates];
}

function renderQuickServices() {
  $('#quickServices').innerHTML = allQuickServices().map((service) => `
    <button class="quick-service ${service.custom ? 'custom' : ''}" type="button" data-service="${escapeHtml(service.id)}" title="Aplicar ${escapeHtml(service.label)}">
      <span>${escapeHtml(service.icon || '⚡')}</span>${escapeHtml(service.label)}${service.custom ? '<i>PROPIA</i>' : ''}
    </button>
  `).join('');
}

function renderCustomTemplatesList() {
  const list = $('#customTemplatesList');
  if (!list) return;
  if (!quickTemplates.length) {
    list.innerHTML = '<div class="custom-templates-empty"><strong>Todavía no creaste plantillas propias</strong><span>Guardá una desde una orden o creala manualmente.</span></div>';
    return;
  }
  list.innerHTML = quickTemplates.map((template) => `
    <article class="custom-template-card" data-template-id="${escapeHtml(template.id)}">
      <div class="custom-template-icon">${escapeHtml(template.icon || '⚡')}</div>
      <div><strong>${escapeHtml(template.label)}</strong><span>${escapeHtml([template.serviceType, template.priority].filter(Boolean).join(' · '))}</span></div>
      <div class="custom-template-actions"><button class="mini-link" type="button" data-edit-quick-template="${escapeHtml(template.id)}">Editar</button><button class="mini-link danger" type="button" data-delete-quick-template="${escapeHtml(template.id)}">Eliminar</button></div>
    </article>
  `).join('');
}

function renderStatusPicker(selected = 'Ingresado') {
  selected = normalizeStatus(selected);
  const options = STATUS_OPTIONS.some((x) => x.value === selected)
    ? STATUS_OPTIONS
    : [{ value: selected, tone: 'cyan' }, ...STATUS_OPTIONS];
  $('#statusPicker').innerHTML = options.map((status) => `
    <button class="status-button tone-${status.tone} ${status.value === selected ? 'active' : ''}" type="button" data-status="${escapeHtml(status.value)}">
      <span class="state-light"></span>${escapeHtml(status.value)}
    </button>
  `).join('');
  $('#budgetForm').elements.status.value = selected;
}

function setDeviceType(value) {
  const known = ['Vivienda', 'Comercio', 'Empresa', 'Consorcio'];
  const safe = known.includes(value) ? value : 'Vivienda';
  $('#budgetForm').elements.equipmentType.value = safe;
  $$('.device-btn').forEach((button) => button.classList.toggle('active', button.dataset.device === safe));
}

function setTemplate(value, { markDirty = true } = {}) {
  const template = value === 'workshop' ? 'workshop' : 'classic';
  $('#budgetForm').elements.template.value = template;
  $$('.template-option').forEach((button) => button.classList.toggle('active', button.dataset.template === template));
  activePreviewTemplate = template;
  $$('.preview-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.previewTemplate === template));
  if (markDirty) setDirty();
  renderPreview(template);
}

function setDefaultTemplate(value) {
  const template = value === 'workshop' ? 'workshop' : 'classic';
  $('#settingsForm').elements.defaultTemplate.value = template;
  $$('#defaultTemplatePicker button').forEach((button) => button.classList.toggle('active', button.dataset.template === template));
}

function normalizeWarrantyMode(source = null) {
  const value = source?.warrantyMode ?? source;
  if (value === 'days' || value === 'none') return value;
  return source && Number(source.warrantyDays) > 0 ? 'days' : 'none';
}

function setWarrantyMode(value, { markDirty = false, rerender = true } = {}) {
  const form = $('#budgetForm');
  if (!form) return;
  const mode = normalizeWarrantyMode(value);
  form.elements.warrantyMode.value = mode;
  $('#budgetWarrantyDaysField')?.classList.toggle('hidden', mode !== 'days');
  if (rerender) renderItems();
  if (markDirty) setDirty();
}

function defaultItem(detail = '', condition = 'Material') {
  return { id: uid(), qty: 1, detail, condition, warranty: settings.warrantyDays, price: 0 };
}

function setWorkingBudgetNumber(value, { markDirty = false } = {}) {
  const next = Math.max(1, Math.trunc(Number(value) || 1));
  workingBudgetNumber = next;
  const input = $('#budgetNumberInput');
  if (input && Number(input.value) !== next) input.value = String(next);
  $('#editorTitle').textContent = `Orden #${padNumber(next)}`;
  if (markDirty) setDirty();
  return next;
}

function resetEditor() {
  editingId = null;
  editingScope = activeDataScope;
  workingBudgetNumber = settings.nextNumber;
  workingItems = [];
  const form = $('#budgetForm');
  form.reset();
  form.elements.date.value = todayISO();
  form.elements.status.value = 'Ingresado';
  form.elements.equipmentType.value = 'Vivienda';
  form.elements.validityDays.value = settings.validityDays;
  form.elements.warrantyDays.value = settings.warrantyDays;
  form.elements.warrantyMode.value = 'none';
  form.elements.executionDays.value = settings.executionDays;
  form.elements.surcharge.value = 0;
  form.elements.discount.value = 0;
  form.elements.deposit.value = 0;
  form.elements.surchargeMode.value = 'amount';
  form.elements.discountMode.value = 'amount';
  form.elements.depositMode.value = 'amount';
  form.elements.paymentMethod.value = 'Efectivo';
  form.elements.template.value = settings.defaultTemplate || 'classic';
  setWorkingBudgetNumber(workingBudgetNumber);
  $('.order-identity .eyebrow').textContent = activeDataScope === 'cloud' ? 'ORDEN / PRESUPUESTO · NUBE' : 'ORDEN / PRESUPUESTO · DISPOSITIVO';
  $$('.collapsible').forEach((el) => el.classList.add('hidden'));
  $$('[data-toggle]').forEach((button) => button.classList.remove('active'));
  setDeviceType('Vivienda');
  renderStatusPicker('Ingresado');
  refreshTechnicianOptions();
  setWarrantyMode('none', { markDirty: false, rerender: false });
  renderItems();
  updateFinancialModeControls();
  setTemplate(settings.defaultTemplate || 'classic', { markDirty: false });
  setDirty(false);
  updateFinancials();
  renderDocumentWarnings();
}

function renderItems() {
  const container = $('#itemsContainer');
  const warrantyEnabled = normalizeWarrantyMode($('#budgetForm')?.elements.warrantyMode?.value) === 'days';
  if (!workingItems.length) {
    container.innerHTML = '<div class="items-empty">Sin ítems todavía. Aplicá una plantilla o agregá materiales y mano de obra.</div>';
    updateFinancials();
    return;
  }
  container.innerHTML = workingItems.map((item, index) => `
    <div class="item-row" data-id="${item.id}">
      <div class="item-index">${index + 1}</div>
      <label class="mini-field item-detail"><span>Descripción</span><input class="input" data-item-field="detail" value="${escapeHtml(item.detail || '')}" placeholder="Material, servicio o mano de obra" /></label>
      <label class="mini-field item-qty"><span>Cant.</span><input class="input" data-item-field="qty" type="number" min="1" step="1" value="${Number(item.qty) || 1}" /></label>
      <label class="mini-field item-price"><span>Precio unit.</span><input class="input" data-item-field="price" type="number" min="0" step="1" value="${Number(item.price) || 0}" /></label>
      <strong class="item-line-total">${fmtMoney((Number(item.qty) || 0) * (Number(item.price) || 0))}</strong>
      <button class="icon-danger" type="button" data-remove-item="${item.id}" aria-label="Eliminar ítem">×</button>
      <details class="item-advanced">
        <summary>${warrantyEnabled ? 'Rubro y garantía' : 'Rubro'}</summary>
        <div class="item-advanced-grid">
          <label class="mini-field"><span>Rubro</span><input class="input" data-item-field="condition" value="${escapeHtml(item.condition || '')}" placeholder="Material / Mano de obra / Servicio" /></label>
          ${warrantyEnabled ? `<label class="mini-field"><span>Garantía</span><div class="suffix-input"><input class="input" data-item-field="warranty" type="number" min="0" value="${Number(item.warranty) || 0}" /><span>días</span></div></label>` : ''}
        </div>
      </details>
    </div>
  `).join('');
  updateFinancials();
}

function normalizeFinancialMode(value) {
  return value === 'percent' ? 'percent' : 'amount';
}

function financialInputValue(form, name, mode) {
  const raw = Math.max(0, Number(form.elements[name]?.value) || 0);
  return mode === 'percent' ? Math.min(100, raw) : raw;
}

function updateFinancialModeControls() {
  const form = $('#budgetForm');
  if (!form) return;
  ['surcharge', 'discount', 'deposit'].forEach((name) => {
    const mode = normalizeFinancialMode(form.elements[`${name}Mode`]?.value);
    const input = form.elements[name];
    const toggle = $(`[data-financial-toggle="${name}"]`);
    if (!input || !toggle) return;
    toggle.textContent = mode === 'percent' ? '%' : '$';
    toggle.classList.toggle('is-percent', mode === 'percent');
    toggle.setAttribute('aria-pressed', String(mode === 'percent'));
    toggle.title = mode === 'percent' ? 'Expresado como porcentaje. Presioná para usar pesos.' : 'Expresado en pesos. Presioná para usar porcentaje.';
    input.step = mode === 'percent' ? '0.1' : '1';
    input.inputMode = 'decimal';
    if (mode === 'percent') input.max = '100';
    else input.removeAttribute('max');
  });
}

function toggleFinancialMode(name) {
  const form = $('#budgetForm');
  const modeInput = form?.elements[`${name}Mode`];
  if (!modeInput) return;
  modeInput.value = normalizeFinancialMode(modeInput.value) === 'percent' ? 'amount' : 'percent';
  updateFinancialModeControls();
  updateFinancials();
  setDirty();
}

function getFinancials() {
  const form = $('#budgetForm');
  const subtotal = workingItems.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.price) || 0), 0);
  const surchargeMode = normalizeFinancialMode(form.elements.surchargeMode?.value);
  const discountMode = normalizeFinancialMode(form.elements.discountMode?.value);
  const depositMode = normalizeFinancialMode(form.elements.depositMode?.value);
  const surchargeValue = financialInputValue(form, 'surcharge', surchargeMode);
  const discountValue = financialInputValue(form, 'discount', discountMode);
  const depositValue = financialInputValue(form, 'deposit', depositMode);
  const surcharge = surchargeMode === 'percent' ? subtotal * surchargeValue / 100 : surchargeValue;
  const discount = discountMode === 'percent' ? subtotal * discountValue / 100 : discountValue;
  const total = Math.max(0, subtotal + surcharge - discount);
  const deposit = depositMode === 'percent' ? total * depositValue / 100 : depositValue;
  const balance = Math.max(0, total - deposit);
  return {
    subtotal,
    surcharge,
    discount,
    deposit,
    total,
    balance,
    surchargeMode,
    discountMode,
    depositMode,
    surchargeValue,
    discountValue,
    depositValue
  };
}

function updateFinancials() {
  if (!$('#budgetForm')) return;
  const f = getFinancials();
  $('#itemsSubtotal').textContent = fmtMoney(f.subtotal);
  $('#quoteTotal').textContent = fmtMoney(f.subtotal);
  $('#serviceTotal').textContent = fmtMoney(f.total);
  $('#balanceTotal').textContent = fmtMoney(f.balance);
  $('#mobileBalance').textContent = fmtMoney(f.balance);
  $$('.item-row').forEach((row) => {
    const item = workingItems.find((x) => x.id === row.dataset.id);
    if (item) $('.item-line-total', row).textContent = fmtMoney((Number(item.qty) || 0) * (Number(item.price) || 0));
  });
}

function readFormBudget() {
  const form = $('#budgetForm');
  const data = Object.fromEntries(new FormData(form).entries());
  const f = getFinancials();
  const existing = editingId ? budgets.find((b) => b.id === editingId) : null;
  const budgetNumber = Math.max(1, Math.trunc(Number(data.budgetNumber) || Number(workingBudgetNumber) || 1));
  workingBudgetNumber = budgetNumber;
  return {
    ...data,
    id: editingId || uid(),
    budgetNumber,
    status: normalizeStatus(data.status),
    validityDays: Number(data.validityDays) || settings.validityDays,
    warrantyMode: normalizeWarrantyMode(data.warrantyMode),
    warrantyDays: Math.max(1, Number(data.warrantyDays) || Number(settings.warrantyDays) || 1),
    executionDays: Number(data.executionDays) || settings.executionDays,
    surcharge: f.surchargeValue,
    discount: f.discountValue,
    deposit: f.depositValue,
    surchargeMode: f.surchargeMode,
    discountMode: f.discountMode,
    depositMode: f.depositMode,
    subtotal: f.subtotal,
    total: f.total,
    balance: f.balance,
    items: workingItems.map((item) => ({
      ...item,
      qty: Number(item.qty) || 0,
      price: Number(item.price) || 0,
      warranty: Number(item.warranty) || 0
    })),
    template: data.template === 'workshop' ? 'workshop' : 'classic',
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function documentCompletenessWarnings(budget = readFormBudget()) {
  const warnings = [];
  if (!String(settings.businessName || '').trim()) warnings.push('Falta razón social o nombre comercial.');
  if (!String(settings.cuit || '').trim()) warnings.push('Falta CUIT de la empresa.');
  if (!String(settings.address || '').trim()) warnings.push('Falta domicilio comercial.');
  if (!String(budget.clientName || '').trim()) warnings.push('Falta nombre del cliente.');
  if (!String(budget.clientPhone || '').trim()) warnings.push('Falta teléfono del cliente.');
  if (!String(budget.workAddress || '').trim()) warnings.push('Falta dirección de la obra.');
  if (!String(budget.requiredWork || '').trim()) warnings.push('Falta definir el alcance del trabajo.');
  return warnings;
}

function renderDocumentWarnings() {
  const box = $('#documentWarnings');
  if (!box || !$('#budgetForm')) return;
  box.innerHTML = documentCompletenessWarnings().map((warning) => `<div class="document-warning">${escapeHtml(warning)}</div>`).join('');
}

async function handleSaveBudget() {
  const budget = readFormBudget();
  if (!String(budget.clientName || '').trim()) {
    toast('Ingresá el nombre del cliente');
    $('#budgetForm').elements.clientName.focus();
    return;
  }
  const numberInUse = budgets.find((saved) => saved.id !== budget.id && Number(saved.budgetNumber) === Number(budget.budgetNumber));
  if (numberInUse) {
    toast(`El número ${padNumber(budget.budgetNumber)} ya pertenece a otro trabajo`);
    $('#budgetNumberInput')?.focus();
    return;
  }
  const targetScope = editingScope === 'cloud' ? 'cloud' : 'local';
  if (targetScope === 'cloud' && !cloudUser) {
    toast('Ingresá a la nube antes de guardar este trabajo');
    openCloudAuthDialog();
    return;
  }
  const ownerId = cloudOwnerId();
  const storedBudget = { ...budget, storageScope: targetScope, ...(targetScope === 'cloud' ? { _cloudPending: true } : {}) };
  if (targetScope === 'cloud') await saveCloudBudget(ownerId, storedBudget);
  else await saveBudget(storedBudget);
  editingId = budget.id;
  const nextNumber = Math.max(Number(settings.nextNumber) || 1, Number(budget.budgetNumber) + 1);
  const settingsChanged = nextNumber !== Number(settings.nextNumber);
  if (settingsChanged) {
    settings.nextNumber = nextNumber;
    settings.updatedAt = new Date().toISOString();
    if (targetScope === 'cloud') await saveCloudSettings(ownerId, { ...settings, _cloudPending: true });
    else await saveSettings(settings);
  }
  budgets = targetScope === 'cloud' ? await getCloudBudgets(ownerId) : await getBudgets();
  setWorkingBudgetNumber(budget.budgetNumber);
  setDirty(false);
  refreshDatalists();
  renderBudgetsTable();
  if (targetScope === 'local') {
    $('#saveState').textContent = 'Guardado local';
    $('#saveState').classList.add('saved');
    toast('Orden guardada sólo en este dispositivo');
    return;
  }
  const budgetSynced = await syncCloudAction(() => upsertCloudBudget(storedBudget), 'Trabajo guardado en Nube; envío pendiente');
  const settingsSynced = !settingsChanged || await syncCloudAction(async () => upsertCloudSettings(await settingsToCloud(settings)), 'Ajustes cloud pendientes de envío');
  if (budgetSynced) await saveCloudBudget(ownerId, { ...storedBudget, _cloudPending: false });
  if (settingsChanged && settingsSynced) await saveCloudSettings(ownerId, { ...settings, _cloudPending: false });
  budgets = await getCloudBudgets(ownerId);
  if (budgetSynced && settingsSynced) {
    $('#saveState').textContent = 'Guardado en Nube';
    $('#saveState').classList.add('saved');
    toast('Orden guardada en Nube');
  } else {
    $('#saveState').textContent = 'Nube · envío pendiente';
    $('#saveState').classList.remove('saved');
  }
}

function fillEditorFromBudget(budget, { duplicate = false } = {}) {
  const form = $('#budgetForm');
  editingId = duplicate ? null : budget.id;
  editingScope = activeDataScope;
  workingBudgetNumber = duplicate ? settings.nextNumber : budget.budgetNumber;
  workingItems = (budget.items || []).map((item) => ({ ...item, id: duplicate ? uid() : (item.id || uid()) }));
  form.reset();
  form.elements.budgetNumber.value = String(workingBudgetNumber);
  const skip = new Set(['id', 'items', 'createdAt', 'updatedAt', 'budgetNumber', 'total', 'subtotal', 'balance']);
  Object.entries(budget).forEach(([key, value]) => {
    if (skip.has(key)) return;
    const field = form.elements.namedItem(key);
    if (field) field.value = value ?? '';
  });
  if (duplicate) {
    form.elements.date.value = todayISO();
    form.elements.status.value = 'Ingresado';
    form.elements.deposit.value = 0;
    form.elements.depositMode.value = 'amount';
  }
  form.elements.validityDays.value ||= settings.validityDays;
  form.elements.warrantyDays.value ||= settings.warrantyDays;
  form.elements.executionDays.value ||= settings.executionDays;
  form.elements.template.value = budget.template || settings.defaultTemplate || 'classic';
  setDeviceType(budget.equipmentType || 'Vivienda');
  refreshTechnicianOptions(budget.assignedTechnician || '');
  renderStatusPicker(duplicate ? 'Ingresado' : normalizeStatus(budget.status));
  setWarrantyMode(normalizeWarrantyMode(budget), { markDirty: false, rerender: false });
  renderItems();
  updateFinancialModeControls();
  setTemplate(form.elements.template.value, { markDirty: false });
  setWorkingBudgetNumber(workingBudgetNumber);
  setDirty(duplicate);
  updateFinancials();
  renderDocumentWarnings();
}

async function openBudget(id) {
  if (dirty && !confirm('Hay cambios sin guardar. ¿Abrir otra orden igualmente?')) return;
  const budget = activeDataScope === 'cloud' ? await getCloudBudget(cloudOwnerId(), id) : await getBudget(id);
  if (!budget) return;
  editingScope = activeDataScope;
  fillEditorFromBudget(budget);
  showView('new');
}

async function duplicateBudget(id) {
  if (dirty && !confirm('Hay cambios sin guardar. ¿Crear una copia igualmente?')) return;
  const budget = activeDataScope === 'cloud' ? await getCloudBudget(cloudOwnerId(), id) : await getBudget(id);
  if (!budget) return;
  editingScope = activeDataScope;
  fillEditorFromBudget(budget, { duplicate: true });
  showView('new');
  toast('Copia lista para editar');
}

async function removeBudget(id) {
  const budget = budgets.find((b) => b.id === id);
  if (!budget) return;
  if (!confirm(`¿Eliminar la orden #${padNumber(budget.budgetNumber)} de ${budget.clientName || 'este cliente'}?`)) return;
  if (activeDataScope === 'cloud') {
    const ownerId = cloudOwnerId();
    await deleteCloudBudgetCache(ownerId, id);
    await syncCloudAction(() => deleteCloudBudget(id), 'Orden eliminada de este equipo; borrado cloud pendiente');
    budgets = await getCloudBudgets(ownerId);
  } else {
    await deleteBudget(id);
    budgets = await getBudgets();
  }
  renderBudgetsTable();
  refreshDatalists();
  toast(activeDataScope === 'cloud' ? 'Orden eliminada del espacio Nube' : 'Orden eliminada sólo del dispositivo');
}

function templateItemsToText(items = []) {
  return items.map((item) => [item.condition || 'Servicio', item.detail || '', Number(item.price) || 0].join(' | ')).join('\n');
}

function parseTemplateItems(value = '') {
  return String(value).split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [condition = 'Servicio', detail = '', rawPrice = '0'] = line.split('|').map((part) => part.trim());
    const normalizedPrice = String(rawPrice).replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
    return { detail: detail || condition, condition: detail ? condition : 'Servicio', price: Math.max(0, Number(normalizedPrice) || 0) };
  });
}

function quickTemplateDraftFromCurrent() {
  const form = $('#budgetForm');
  return {
    label: '',
    icon: '⚡',
    serviceType: form.elements.serviceType.value || 'Reparación',
    priority: form.elements.priority.value || 'Normal',
    deviceType: form.elements.equipmentType.value || '',
    issue: form.elements.issue.value || '',
    diagnosis: form.elements.diagnosis.value || '',
    result: form.elements.result.value || '',
    work: form.elements.requiredWork.value || '',
    notes: form.elements.notes.value || '',
    items: workingItems.map(({ detail, condition, price }) => ({ detail, condition, price: Number(price) || 0 }))
  };
}

function openQuickTemplateDialog(template = null, { seedFromCurrent = false } = {}) {
  const dialog = $('#quickTemplateDialog');
  const form = $('#quickTemplateForm');
  const source = template || (seedFromCurrent ? quickTemplateDraftFromCurrent() : {});
  form.reset();
  form.elements.id.value = source.id || '';
  form.elements.label.value = source.label || '';
  form.elements.icon.value = source.icon || '⚡';
  form.elements.serviceType.value = source.serviceType || 'Reparación';
  form.elements.priority.value = source.priority || 'Normal';
  form.elements.deviceType.value = source.deviceType || '';
  form.elements.issue.value = source.issue || '';
  form.elements.diagnosis.value = source.diagnosis || '';
  form.elements.work.value = source.work || '';
  form.elements.result.value = source.result || '';
  form.elements.notes.value = source.notes || '';
  form.elements.itemsText.value = templateItemsToText(source.items || []);
  $('#quickTemplateDialogTitle').textContent = source.id ? 'Editar plantilla' : 'Nueva plantilla';
  dialog.showModal();
  requestAnimationFrame(() => form.elements.label.focus());
}

function closeQuickTemplateDialog() {
  const dialog = $('#quickTemplateDialog');
  if (dialog.open) dialog.close();
}

async function handleSaveQuickTemplate(event) {
  event.preventDefault();
  const form = $('#quickTemplateForm');
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const previous = quickTemplates.find((template) => template.id === data.id);
  const now = new Date().toISOString();
  const template = {
    id: data.id || uid(),
    custom: true,
    label: String(data.label || '').trim(),
    icon: String(data.icon || '⚡').trim() || '⚡',
    serviceType: data.serviceType || 'Reparación',
    priority: data.priority || 'Normal',
    deviceType: data.deviceType || '',
    issue: String(data.issue || '').trim(),
    diagnosis: String(data.diagnosis || '').trim(),
    result: String(data.result || '').trim(),
    work: String(data.work || '').trim(),
    notes: String(data.notes || '').trim(),
    items: parseTemplateItems(data.itemsText),
    createdAt: previous?.createdAt || now,
    updatedAt: now
  };
  let cloudSynced = false;
  if (activeDataScope === 'cloud') {
    const ownerId = cloudOwnerId();
    const pendingTemplate = { ...template, storageScope: 'cloud', _cloudPending: true };
    await saveCloudQuickTemplate(ownerId, pendingTemplate);
    cloudSynced = await syncCloudAction(() => upsertCloudQuickTemplate(pendingTemplate), 'Plantilla guardada en Nube; envío pendiente');
    if (cloudSynced) await saveCloudQuickTemplate(ownerId, { ...pendingTemplate, _cloudPending: false });
    quickTemplates = await getCloudQuickTemplates(ownerId);
  } else {
    await saveQuickTemplate({ ...template, storageScope: 'local' });
    quickTemplates = await getQuickTemplates();
  }
  renderQuickServices();
  renderCustomTemplatesList();
  closeQuickTemplateDialog();
  toast(`${previous ? 'Plantilla actualizada' : 'Plantilla creada'} en ${activeDataScope === 'cloud' ? (cloudSynced ? 'Nube' : 'Nube, pendiente de envío') : 'Dispositivo'}`);
}

async function removeQuickTemplate(id) {
  const template = quickTemplates.find((item) => item.id === id);
  if (!template || !confirm(`¿Eliminar la plantilla “${template.label}”?`)) return;
  if (activeDataScope === 'cloud') {
    const ownerId = cloudOwnerId();
    await deleteCloudQuickTemplateCache(ownerId, id);
    await syncCloudAction(() => deleteCloudQuickTemplate(id), 'Plantilla eliminada del equipo; borrado cloud pendiente');
    quickTemplates = await getCloudQuickTemplates(ownerId);
  } else {
    await deleteQuickTemplate(id);
    quickTemplates = await getQuickTemplates();
  }
  renderQuickServices();
  renderCustomTemplatesList();
  toast(activeDataScope === 'cloud' ? 'Plantilla eliminada de Nube' : 'Plantilla eliminada del dispositivo');
}

function applyQuickService(id) {
  const service = allQuickServices().find((x) => x.id === id);
  if (!service) return;
  const form = $('#budgetForm');
  const hasText = form.elements.diagnosis.value.trim() || form.elements.requiredWork.value.trim();
  if (hasText && !confirm('¿Reemplazar el diagnóstico y trabajo actuales por esta plantilla?')) return;
  if (service.deviceType) setDeviceType(service.deviceType);
  form.elements.issue.value = service.issue;
  form.elements.diagnosis.value = service.diagnosis;
  form.elements.result.value = service.result;
  form.elements.requiredWork.value = service.work;
  if (service.serviceType) form.elements.serviceType.value = service.serviceType;
  if (service.priority) form.elements.priority.value = service.priority;
  if (service.notes && !form.elements.notes.value.trim()) form.elements.notes.value = service.notes;
  const hasUsefulItems = workingItems.some((item) => String(item.detail || '').trim() || Number(item.price));
  if (!hasUsefulItems) {
    workingItems = (service.items || []).map((item) => ({
      id: uid(), qty: 1, detail: item.detail, condition: item.condition,
      warranty: settings.warrantyDays, price: item.price
    }));
    renderItems();
  }
  setDirty();
  updateFinancials();
  toast(`Plantilla “${service.label}” aplicada`);
}

function statusTone(status) {
  return STATUS_OPTIONS.find((x) => x.value === normalizeStatus(status))?.tone || 'cyan';
}

function renderBudgetsTable() {
  const body = $('#budgetsTableBody');
  if (!body) return;
  const q = ($('#budgetSearch')?.value || '').trim().toLowerCase();
  const status = $('#statusFilter')?.value || '';
  const rows = budgets.filter((budget) => {
    const haystack = `${padNumber(budget.budgetNumber)} ${budget.clientName || ''} ${budget.clientPhone || ''} ${budget.workAddress || ''} ${budget.locality || ''} ${budget.assignedTechnician || ''} ${budget.equipmentType || ''}`.toLowerCase();
    return (!q || haystack.includes(q)) && (!status || normalizeStatus(budget.status) === status);
  });

  body.innerHTML = rows.map((budget) => {
    const total = Number(budget.total ?? budget.subtotal ?? 0);
    const tone = statusTone(budget.status);
    return `
      <tr>
        <td class="order-number"><strong>#${padNumber(budget.budgetNumber)}</strong><small>${fmtDate(budget.date)}</small></td>
        <td class="order-client"><strong>${escapeHtml(budget.clientName || '—')}</strong><small>${escapeHtml(budget.clientPhone || '')}</small></td>
        <td class="order-device"><strong>${escapeHtml(budget.workAddress || budget.equipmentType || '—')}</strong><small>${escapeHtml([budget.locality, budget.serviceType].filter(Boolean).join(' · '))}</small></td>
        <td><span class="status-chip tone-${tone}"><span></span>${escapeHtml(normalizeStatus(budget.status))}</span></td>
        <td><span class="doc-chip">${escapeHtml(budget.assignedTechnician || 'Sin asignar')}</span></td>
        <td class="num"><strong>${fmtMoney(total)}</strong>${Number(budget.balance) > 0 ? `<small>Saldo ${fmtMoney(budget.balance)}</small>` : ''}</td>
        <td class="row-actions">
          <details class="row-menu">
            <summary aria-label="Acciones">···</summary>
            <div class="row-menu-popover">
              <button type="button" data-edit="${budget.id}">Editar</button>
              <button type="button" data-duplicate="${budget.id}">Duplicar</button>
              <button type="button" data-print-order="${budget.id}">Vista / PDF</button>
              <button class="danger" type="button" data-delete="${budget.id}">Eliminar</button>
            </div>
          </details>
        </td>
      </tr>`;
  }).join('');

  const noRows = !rows.length;
  $('.table-wrap', $('#view-orders')).classList.toggle('hidden', noRows);
  $('#emptyBudgets').classList.toggle('hidden', !noRows);

  $('#statOrders').textContent = budgets.length;
  const pendingBalance = budgets.reduce((sum, b) => sum + Math.max(0, Number(b.balance) || 0), 0);
  $('#statBalance').textContent = fmtMoney(pendingBalance);
  $('#statRepair').textContent = budgets.filter((b) => normalizeStatus(b.status) === 'En ejecución').length;
}

function refreshDatalists() {
  const clients = new Map();
  budgets.forEach((b) => {
    const key = String(b.clientName || '').trim().toLowerCase();
    if (key && !clients.has(key)) clients.set(key, b);
  });
  $('#clientNames').innerHTML = [...clients.values()].map((b) => `<option value="${escapeHtml(b.clientName)}">${escapeHtml(b.clientPhone || '')}</option>`).join('');

  const addresses = new Set();
  const localities = new Set();
  budgets.forEach((b) => {
    if (b.workAddress) addresses.add(b.workAddress);
    if (b.locality) localities.add(b.locality);
  });
  $('#workAddressList').innerHTML = [...addresses].sort((a, b) => a.localeCompare(b)).map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
  $('#localityList').innerHTML = [...localities].sort((a, b) => a.localeCompare(b)).map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
}

function refreshTechnicianOptions(selected = null) {
  const select = $('#assignedTechnician');
  if (!select) return;
  const current = selected ?? select.value;
  const technicians = normalizeTechnicians(settings);
  select.innerHTML = '<option value="">Sin asignar</option>' + technicians.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (current && !technicians.includes(current)) select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(current)}">${escapeHtml(current)}</option>`);
  select.value = current || '';
}

function renderTechnicianSettings(focusIndex = null, values = null) {
  const list = $('#techniciansList');
  if (!list) return;
  const technicians = Array.isArray(values) ? values : normalizeTechnicians(settings);
  list.innerHTML = technicians.length ? technicians.map((name, index) => `
    <div class="technician-row" data-technician-index="${index}">
      <label class="field"><span>Técnico ${index + 1}</span><input class="input" name="technicianName" value="${escapeHtml(name)}" placeholder="Nombre completo" /></label>
      <button class="icon-danger" type="button" data-remove-technician="${index}" aria-label="Quitar a ${escapeHtml(name || `Técnico ${index + 1}`)}">×</button>
    </div>
  `).join('') : '<div class="technicians-empty">No hay técnicos cargados. Agregá el primero para poder asignarlo a los trabajos.</div>';
  if (focusIndex !== null) requestAnimationFrame(() => list.querySelector(`[data-technician-index="${focusIndex}"] input`)?.focus());
}

function readTechniciansFromSettingsForm() {
  return [...new Set($$('[name="technicianName"]', $('#settingsForm'))
    .map((input) => input.value.trim())
    .filter(Boolean))];
}

function autofillKnownClient() {
  const form = $('#budgetForm');
  const name = form.elements.clientName.value.trim().toLowerCase();
  if (!name) return;
  const match = budgets.find((b) => String(b.clientName || '').trim().toLowerCase() === name);
  if (!match) return;
  ['clientPhone', 'clientEmail', 'clientTaxId'].forEach((field) => {
    if (!form.elements[field].value && match[field]) form.elements[field].value = match[field];
  });
}

function fillSettingsForm() {
  const form = $('#settingsForm');
  Object.entries(settings).forEach(([key, value]) => {
    if (['logo', 'customPatternSvg', 'technicians', 'technician', 'technician2'].includes(key)) return;
    const field = form.elements.namedItem(key);
    if (field?.type === 'checkbox') field.checked = Boolean(value);
    else if (field) field.value = value ?? '';
  });
  renderTechnicianSettings();
  setDefaultTemplate(settings.defaultTemplate || 'classic');
  refreshLogoUI();
  updateBrandUI();
  refreshTechnicianOptions();
  renderCustomTemplatesList();
  applyVisualIdentity(settings);
}

async function handleSaveSettings() {
  const form = $('#settingsForm');
  const data = Object.fromEntries(new FormData(form).entries());
  data.technicians = readTechniciansFromSettingsForm();
  delete data.technicianName;
  data.technician = data.technicians[0] || '';
  data.technician2 = data.technicians[1] || '';
  data.nextNumber = Math.max(1, Number(data.nextNumber) || DEFAULT_SETTINGS.nextNumber);
  data.warrantyDays = Math.max(0, Number(data.warrantyDays) || 0);
  data.validityDays = Math.max(1, Number(data.validityDays) || DEFAULT_SETTINGS.validityDays);
  data.executionDays = Math.max(1, Number(data.executionDays) || DEFAULT_SETTINGS.executionDays);
  data.defaultTemplate = data.defaultTemplate === 'workshop' ? 'workshop' : 'classic';
  data.palette = PALETTES.has(data.palette) ? data.palette : DEFAULT_SETTINGS.palette;
  data.brandPattern = BRAND_PATTERNS.has(data.brandPattern) ? data.brandPattern : DEFAULT_SETTINGS.brandPattern;
  data.patternRepeat = Math.max(1, Math.min(24, Number(data.patternRepeat ?? DEFAULT_SETTINGS.patternRepeat)));
  data.patternIntensity = Math.max(0, Math.min(100, Number(data.patternIntensity ?? DEFAULT_SETTINGS.patternIntensity)));
  data.patternDocuments = form.elements.patternDocuments.checked;
  settings = settingsWithTechnicians({
    ...settings,
    ...data,
    logo: pendingLogo !== undefined ? pendingLogo : settings.logo,
    customPatternSvg: sanitizePatternSvg(pendingPatternSvg !== undefined ? pendingPatternSvg : settings.customPatternSvg),
    updatedAt: new Date().toISOString()
  });
  pendingLogo = undefined;
  pendingPatternSvg = undefined;
  let cloudSynced = false;
  if (activeDataScope === 'cloud') {
    const ownerId = cloudOwnerId();
    await saveCloudSettings(ownerId, { ...settings, _cloudPending: true });
    cloudSynced = await syncCloudAction(async () => upsertCloudSettings(await settingsToCloud(settings)), 'Ajustes guardados en Nube; envío pendiente');
    if (cloudSynced) await saveCloudSettings(ownerId, { ...settings, _cloudPending: false });
  } else {
    await saveSettings(settings);
  }
  if (!editingId) setWorkingBudgetNumber(settings.nextNumber);
  applyVisualIdentity(settings);
  updateBrandUI();
  refreshLogoUI();
  refreshTechnicianOptions();
  toast(activeDataScope === 'cloud' ? (cloudSynced ? 'Ajustes guardados en Nube' : 'Ajustes cloud pendientes de envío') : 'Ajustes guardados sólo en este dispositivo');
}

function termsAsList() {
  return String(sanitizeForBackup(settings.terms || DEFAULT_TERMS)).split(/\n+/).map((x) => x.trim()).filter(Boolean);
}

function termsForBudget(budget) {
  const terms = termsAsList();
  return normalizeWarrantyMode(budget) === 'days' ? terms : terms.filter((term) => !/\bgarant/i.test(term));
}

function previewLogoHtml(className = 'doc-logo') {
  const blob = currentLogoBlob();
  if (blob) return `<img class="${className}" src="${ensureLogoUrl(blob)}" alt="Logo de ${escapeHtml(settings.businessName || 'BIG POWER')}" />`;
  return `<img class="${className} default-brand-mark" src="${DEFAULT_MARK_URL}" alt="Isotipo de BIG POWER" />`;
}

function previewDocumentBrandHtml(className = 'document-brand-lockup') {
  if (currentLogoBlob()) return previewLogoHtml('doc-logo uploaded-doc-logo');
  return defaultBrandLockupHtml(className);
}

function renderElectricalClassicTemplate(budget) {
  budget = sanitizeForBackup(budget);
  const docSettings = sanitizeForBackup(settings);
  const f = getFinancials();
  const terms = termsForBudget(budget);
  const warrantyEnabled = normalizeWarrantyMode(budget) === 'days';
  const items = budget.items.length ? budget.items : [defaultItem('Sin ítems cargados', '—')];
  const technician = budget.assignedTechnician || primaryTechnician('Electricista responsable');
  return `
    <article class="a4-page classic-document electrical-document ${documentPatternClass()} ${documentPaletteClass()}" style="${documentPatternStyle()}">
      <header class="classic-header">
        <div class="classic-brand">
          <div class="classic-brand-line">${previewDocumentBrandHtml('document-brand-lockup classic-document-brand')}</div>
          <div class="classic-brand-details">
            <p>${escapeHtml(docSettings.tagline || 'Instalaciones · Mantenimiento · Urgencias')}</p>
            <p>${escapeHtml([docSettings.phone, docSettings.address].filter(Boolean).join(' · '))}</p>
            ${docSettings.cuit || docSettings.licenseNumber ? `<p>${escapeHtml([docSettings.cuit ? `CUIT ${docSettings.cuit}` : '', docSettings.licenseNumber ? `Matrícula ${docSettings.licenseNumber}` : ''].filter(Boolean).join(' · '))}</p>` : ''}
            ${docSettings.email ? `<p class="classic-brand-email">${escapeHtml(docSettings.email)}</p>` : ''}
          </div>
        </div>
        <div class="classic-docbox"><small>DOCUMENTO</small><strong>PRESUPUESTO</strong><span>N.º ${padNumber(budget.budgetNumber)}</span></div>
      </header>

      <div class="classic-titlebar"><strong>PRESUPUESTO / ORDEN DE TRABAJO</strong><span>Fecha: ${fmtDate(budget.date)}</span><span>Validez: ${budget.validityDays} días</span><span>Plazo: ${budget.executionDays} días</span></div>

      <table class="classic-info"><tbody>
        <tr><th>CLIENTE</th><td>${escapeHtml(budget.clientName || '—')}</td><th>TELÉFONO</th><td>${escapeHtml(budget.clientPhone || '—')}</td></tr>
        <tr><th>DNI / CUIT</th><td>${escapeHtml(budget.clientTaxId || '—')}</td><th>TIPO</th><td>${escapeHtml(budget.clientType || 'Particular')}</td></tr>
        <tr><th>OBRA</th><td>${escapeHtml(budget.workAddress || '—')}</td><th>LOCALIDAD</th><td>${escapeHtml(budget.locality || '—')}</td></tr>
        <tr><th>INMUEBLE</th><td>${escapeHtml(budget.equipmentType || '—')}</td><th>SERVICIO</th><td>${escapeHtml(budget.serviceType || '—')}</td></tr>
        <tr><th>TÉCNICO</th><td>${escapeHtml(technician)}</td><th>VISITA</th><td>${escapeHtml(fmtDateTime(budget.scheduledDate))}</td></tr>
      </tbody></table>

      <section class="classic-section"><h2>SOLICITUD / FALLA INFORMADA</h2><p>${multiline(budget.issue || 'Sin detalle cargado.')}</p></section>
      <section class="classic-section"><h2>RELEVAMIENTO Y DIAGNÓSTICO ELÉCTRICO</h2><p>${multiline(budget.diagnosis || 'Pendiente de relevamiento.')}</p></section>
      <table class="classic-result"><tbody>
        <tr><th>DATOS TÉCNICOS</th><td>${escapeHtml([budget.voltage, budget.circuit ? `Circuito: ${budget.circuit}` : '', budget.powerCut ? `Corte: ${budget.powerCut}` : ''].filter(Boolean).join(' · ') || 'No relevados')}</td></tr>
        <tr><th>TRABAJO / ALCANCE</th><td>${multiline(budget.requiredWork || 'Sin trabajo detallado.')}</td></tr>
        <tr><th>RESULTADO</th><td>${escapeHtml(budget.result || '—')}</td></tr>
      </tbody></table>

      <section class="classic-section"><h2>MATERIALES Y MANO DE OBRA</h2>
        <table class="classic-items ${warrantyEnabled ? '' : 'no-warranty'}"><thead><tr><th>CANT.</th><th>DETALLE</th><th>RUBRO</th>${warrantyEnabled ? '<th>GAR.</th>' : ''}<th>IMPORTE</th></tr></thead><tbody>
          ${items.map((item) => `<tr><td>${Number(item.qty) || 0}</td><td>${escapeHtml(item.detail || '—')}</td><td>${escapeHtml(item.condition || '—')}</td>${warrantyEnabled ? `<td>${Number(item.warranty ?? budget.warrantyDays) || 0} días</td>` : ''}<td class="num">${fmtMoney((Number(item.qty) || 0) * (Number(item.price) || 0))}</td></tr>`).join('')}
        </tbody><tfoot>
          ${f.surcharge ? `<tr><td colspan="${warrantyEnabled ? 4 : 3}">${financialDocumentLabel('Recargo', f.surchargeMode, f.surchargeValue)}</td><td class="num">${fmtMoney(f.surcharge)}</td></tr>` : ''}
          ${f.discount ? `<tr><td colspan="${warrantyEnabled ? 4 : 3}">${financialDocumentLabel('Descuento', f.discountMode, f.discountValue)}</td><td class="num">- ${fmtMoney(f.discount)}</td></tr>` : ''}
          <tr><td colspan="${warrantyEnabled ? 4 : 3}">TOTAL</td><td class="num">${fmtMoney(f.total)}</td></tr>
        </tfoot></table>
      </section>

      <section class="classic-section conditions"><h2>CONDICIONES / OBSERVACIONES</h2><ul>${terms.map((term) => `<li>${escapeHtml(term)}</li>`).join('')}</ul>${budget.notes ? `<p class="doc-note"><strong>Observaciones:</strong> ${escapeHtml(budget.notes)}</p>` : ''}</section>
      <div class="classic-finance-line"><span>Forma de pago: <strong>${escapeHtml(budget.paymentMethod || '—')}</strong></span><span>${financialDocumentLabel('Cobro/anticipo', f.depositMode, f.depositValue)}: <strong>${fmtMoney(f.deposit)}</strong></span><span>Saldo: <strong>${fmtMoney(f.balance)}</strong></span></div>
      <div class="accept-row"><span><i></i> ACEPTO EL PRESUPUESTO</span><span><i></i> SOLICITO REVISIÓN</span></div>
      <div class="signature-row"><div><span></span>Firma / aclaración del cliente</div><div><span></span>${escapeHtml(technician)} · Firma</div></div>
    </article>`;
}

function renderElectricalWorkshopTemplate(budget) {
  budget = sanitizeForBackup(budget);
  const docSettings = sanitizeForBackup(settings);
  const f = getFinancials();
  const status = normalizeStatus(budget.status);
  const technician = budget.assignedTechnician || primaryTechnician('Sin asignar');
  const items = budget.items.length ? budget.items : [defaultItem('Sin ítems cargados', '—')];
  const warrantyEnabled = normalizeWarrantyMode(budget) === 'days';
  return `
    <article class="a4-page workshop-document electrical-document ${documentPatternClass()} ${documentPaletteClass()}" style="${documentPatternStyle()}">
      <header class="workshop-doc-header">
        <div class="workshop-business"><div class="workshop-brand-line">${previewDocumentBrandHtml('document-brand-lockup workshop-document-brand')}</div><p>${escapeHtml(docSettings.tagline || '')}</p><p>${escapeHtml([docSettings.phone, docSettings.address, docSettings.licenseNumber ? `Matrícula ${docSettings.licenseNumber}` : ''].filter(Boolean).join(' · '))}</p></div>
        <div class="workshop-number"><small>ORDEN DE CAMPO</small><strong>#${padNumber(budget.budgetNumber)}</strong><span>${fmtDate(budget.date)}</span></div>
      </header>

      <div class="workshop-strip"><span>ESTADO</span><strong>${escapeHtml(status)}</strong><span>PRIORIDAD</span><strong>${escapeHtml(budget.priority || 'Normal')}</strong><span>TÉCNICO</span><strong>${escapeHtml(technician)}</strong></div>

      <section class="workshop-box"><h2>CLIENTE Y UBICACIÓN</h2><div class="box-grid four">
        <div><small>CLIENTE</small><strong>${escapeHtml(budget.clientName || '—')}</strong></div>
        <div><small>TELÉFONO</small><strong>${escapeHtml(budget.clientPhone || '—')}</strong></div>
        <div><small>DNI / CUIT</small><strong>${escapeHtml(budget.clientTaxId || '—')}</strong></div>
        <div><small>TIPO DE INMUEBLE</small><strong>${escapeHtml(budget.equipmentType || '—')}</strong></div>
        <div><small>DIRECCIÓN DE OBRA</small><strong>${escapeHtml(budget.workAddress || '—')}</strong></div>
        <div><small>LOCALIDAD</small><strong>${escapeHtml(budget.locality || '—')}</strong></div>
        <div><small>CONTACTO EN EL LUGAR</small><strong>${escapeHtml(budget.contactOnSite || '—')}</strong></div>
        <div><small>VISITA PROGRAMADA</small><strong>${escapeHtml(fmtDateTime(budget.scheduledDate))}</strong></div>
      </div></section>

      <section class="workshop-box"><h2>DATOS DEL SERVICIO</h2><div class="box-grid four">
        <div><small>TIPO DE SERVICIO</small><strong>${escapeHtml(budget.serviceType || '—')}</strong></div>
        <div><small>TENSIÓN</small><strong>${escapeHtml(budget.voltage || 'No relevada')}</strong></div>
        <div><small>SECTOR / CIRCUITO</small><strong>${escapeHtml(budget.circuit || '—')}</strong></div>
        <div><small>CORTE REQUERIDO</small><strong>${escapeHtml(budget.powerCut || 'Por definir')}</strong></div>
      </div><div class="workshop-text"><small>SOLICITUD / FALLA INFORMADA</small><p>${multiline(budget.issue || '—')}</p></div></section>

      <section class="workshop-box work-diagnosis"><h2>RELEVAMIENTO Y EJECUCIÓN</h2><div class="box-grid two">
        <div><small>DIAGNÓSTICO / MEDICIONES</small><p>${multiline(budget.diagnosis || 'Pendiente de relevamiento.')}</p></div>
        <div><small>TRABAJO / ALCANCE</small><p>${multiline(budget.requiredWork || 'Sin trabajo cargado.')}</p></div>
      </div><div class="workshop-result"><small>RESULTADO / ESTADO FINAL</small><strong>${escapeHtml(budget.result || '—')}</strong></div></section>

      <section class="workshop-box"><h2>MATERIALES Y MANO DE OBRA</h2><table class="workshop-items ${warrantyEnabled ? '' : 'no-warranty'}"><thead><tr><th>CANT.</th><th>DETALLE</th><th>RUBRO</th>${warrantyEnabled ? '<th>GARANTÍA</th>' : ''}<th>IMPORTE</th></tr></thead><tbody>
        ${items.map((item) => `<tr><td>${Number(item.qty) || 0}</td><td>${escapeHtml(item.detail || '—')}</td><td>${escapeHtml(item.condition || '—')}</td>${warrantyEnabled ? `<td>${Number(item.warranty ?? budget.warrantyDays) || 0} días</td>` : ''}<td>${fmtMoney((Number(item.qty) || 0) * (Number(item.price) || 0))}</td></tr>`).join('')}
      </tbody></table></section>

      <section class="workshop-finance"><div><small>FORMA DE PAGO</small><strong>${escapeHtml(budget.paymentMethod || '—')}</strong></div><div><small>SUBTOTAL</small><strong>${fmtMoney(f.subtotal)}</strong></div><div><small>${financialDocumentLabel('RECARGO', f.surchargeMode, f.surchargeValue)}</small><strong>${fmtMoney(f.surcharge)}</strong></div><div><small>${financialDocumentLabel('DESCUENTO', f.discountMode, f.discountValue)}</small><strong>${fmtMoney(f.discount)}</strong></div><div><small>TOTAL</small><strong>${fmtMoney(f.total)}</strong></div><div><small>${financialDocumentLabel('COBRO / ANTICIPO', f.depositMode, f.depositValue)}</small><strong>${fmtMoney(f.deposit)}</strong></div><div class="workshop-balance"><small>SALDO A COBRAR</small><strong>${fmtMoney(f.balance)}</strong></div></section>
      <section class="workshop-notes"><h2>OBSERVACIONES / ANOTACIONES</h2><p>${budget.notes ? multiline(budget.notes) : '&nbsp;'}</p></section>
    </article>`;
}

function applyPreviewZoom() {
  const area = $('#printArea');
  if (!area) return;
  const effectiveZoom = Math.max(0.2, Math.min(3, previewBaseScale * previewZoomFactor));
  area.style.zoom = String(effectiveZoom);
  const output = $('#previewZoomValue');
  if (output) output.value = `${Math.round(previewZoomFactor * 100)}%`;
  const range = $('#previewZoomRange');
  if (range) range.value = String(Math.round(previewZoomFactor * 100));
}

function setPreviewZoom(factor, { clientX = null, clientY = null, preservePoint = true } = {}) {
  const stage = $('#previewStage');
  const area = $('#printArea');
  const oldEffectiveZoom = Math.max(0.2, Math.min(3, previewBaseScale * previewZoomFactor));
  let anchor = null;
  if (preservePoint && stage && area) {
    const stageRect = stage.getBoundingClientRect();
    const areaRect = area.getBoundingClientRect();
    const anchorX = Number.isFinite(clientX) ? clientX : stageRect.left + stage.clientWidth / 2;
    const anchorY = Number.isFinite(clientY) ? clientY : stageRect.top + stage.clientHeight / 2;
    anchor = {
      clientX: anchorX,
      clientY: anchorY,
      contentX: (anchorX - areaRect.left) / oldEffectiveZoom,
      contentY: (anchorY - areaRect.top) / oldEffectiveZoom
    };
  }
  previewZoomFactor = Math.max(0.5, Math.min(3, Number(factor) || 1));
  applyPreviewZoom();
  if (!anchor || !stage || !area) return;
  const newEffectiveZoom = Math.max(0.2, Math.min(3, previewBaseScale * previewZoomFactor));
  // Leer la geometría fuerza el recálculo inmediatamente. Esto evita acumular
  // varios requestAnimationFrame mientras se arrastra el deslizador y mantiene
  // estable el punto bajo el cursor, el centro del pellizco o el centro visible.
  const areaRect = area.getBoundingClientRect();
  const targetX = areaRect.left + anchor.contentX * newEffectiveZoom;
  const targetY = areaRect.top + anchor.contentY * newEffectiveZoom;
  stage.scrollLeft += targetX - anchor.clientX;
  stage.scrollTop += targetY - anchor.clientY;
}

function changePreviewZoom(command) {
  if (command === 'fit') {
    setPreviewZoom(1, { preservePoint: false });
    requestAnimationFrame(() => $('#previewStage')?.scrollTo({ top: 0, left: 0, behavior: 'smooth' }));
    return;
  }
}

function fitPreview({ reset = false } = {}) {
  const stage = $('#previewStage');
  const area = $('#printArea');
  if (!stage || !area || $('#previewModal')?.classList.contains('hidden')) return;
  const a4WidthPx = 210 * 96 / 25.4;
  const available = Math.max(260, stage.clientWidth - (window.innerWidth <= 920 ? 20 : 40));
  previewBaseScale = Math.max(0.32, Math.min(1, available / a4WidthPx));
  if (reset) previewZoomFactor = 1;
  applyPreviewZoom();
  if (reset) requestAnimationFrame(() => stage.scrollTo({ top: 0, left: 0 }));
}

function renderPreview(template = activePreviewTemplate) {
  const area = $('#printArea');
  if (!area) return;
  const budget = readFormBudget();
  activePreviewTemplate = template === 'workshop' ? 'workshop' : 'classic';
  $$('.preview-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.previewTemplate === activePreviewTemplate));
  area.innerHTML = activePreviewTemplate === 'workshop' ? renderElectricalWorkshopTemplate(budget) : renderElectricalClassicTemplate(budget);
  requestAnimationFrame(fitPreview);
}

function openPreview(template = null, { historyMode = 'auto' } = {}) {
  if (template) setTemplate(template, { markDirty: false });
  renderPreview($('#budgetForm').elements.template.value);
  const modal = $('#previewModal');
  const wasClosed = modal.classList.contains('hidden');
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => fitPreview({ reset: wasClosed }));
  if (wasClosed && historyMode !== 'none') {
    history.pushState({ bigPowerView: currentViewName(), bigPowerLayer: 'preview' }, '', '#vista-previa');
  }
}

function closePreview({ historyMode = 'auto' } = {}) {
  const modal = $('#previewModal');
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  previewPinchStartDistance = 0;
  previewPinchCenter = null;
  if (historyMode !== 'none' && history.state?.bigPowerLayer === 'preview') history.back();
}

function printBudget() {
  renderPreview(activePreviewTemplate);
  setTimeout(() => window.print(), 30);
}

function pdfFilenamePart(value, fallback) {
  const clean = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return clean || fallback;
}

function pdfCodeDate(value) {
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(String(value || ''))?.[0] || todayISO();
  const [year, month, day] = iso.split('-');
  return `${day}${month}${year.slice(-2)}`;
}

function pdfUniqueCode(budget) {
  const documentNumber = String(Math.max(0, Number(budget.budgetNumber) || 0)).padStart(5, '0');
  const creationDate = pdfCodeDate(budget.createdAt || budget.date);
  return `${documentNumber}${creationDate}`;
}

function setPdfDownloadBusy(busy) {
  pdfDownloadBusy = busy;
  ['downloadPdfBtn', 'railDownloadPdfBtn', 'mobileDownloadPdfBtn', 'downloadPreviewPdfBtn'].forEach((id) => {
    const button = $(`#${id}`);
    if (!button) return;
    button.dataset.idleLabel ||= button.textContent;
    button.disabled = busy;
    button.textContent = busy ? 'Preparando PDF…' : button.dataset.idleLabel;
  });
}

async function downloadCurrentPdf() {
  if (pdfDownloadBusy) return;
  const budget = readFormBudget();
  if (!String(budget.clientName || '').trim()) {
    toast('Ingresá el nombre del cliente para nombrar el PDF');
    $('#budgetForm').elements.clientName.focus();
    return;
  }

  const template = budget.template === 'workshop' ? 'workshop' : 'classic';
  const documentName = template === 'workshop' ? 'Orden de campo' : 'Presupuesto';
  const number = padNumber(budget.budgetNumber);
  const client = pdfFilenamePart(budget.clientName, 'Cliente');
  const uniqueCode = pdfUniqueCode(budget);
  const filename = `${client}-${uniqueCode}.pdf`;
  const html = template === 'workshop' ? renderElectricalWorkshopTemplate(budget) : renderElectricalClassicTemplate(budget);

  setPdfDownloadBusy(true);
  try {
    const { downloadA4Pdf } = await import('./pdf-export.js');
    const result = await downloadA4Pdf({
      html,
      filename,
      title: `${documentName} Nro ${number} - ${client}`,
      subject: `${documentName} A4 de BIG POWER para ${client}`
    });
    if (result.delivery === 'cancelled') toast('Guardado del PDF cancelado');
    else if (result.delivery === 'share') toast(`PDF listo en iOS: ${filename}`);
    else toast(`PDF A4 descargado: ${filename}`);
  } catch (error) {
    console.error('Descarga PDF:', error);
    const detail = String(error?.message || 'Error desconocido').replace(/\s+/g, ' ').slice(0, 92);
    toast(`No se pudo generar el PDF: ${detail}`);
  } finally {
    setPdfDownloadBusy(false);
  }
}

async function previewStoredBudget(id) {
  if (dirty && !confirm('Hay cambios sin guardar. ¿Abrir otra orden igualmente?')) return;
  const budget = activeDataScope === 'cloud' ? await getCloudBudget(cloudOwnerId(), id) : await getBudget(id);
  if (!budget) return;
  editingScope = activeDataScope;
  fillEditorFromBudget(budget);
  showView('new');
  openPreview(budget.template || 'classic');
}

async function blobToDataURL(blob) {
  if (!blob) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const [meta, data] = dataUrl.split(',');
  if (!meta || !data) return null;
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'application/octet-stream';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportBackup() {
  const [localSettings, localBudgets, localTemplates] = await Promise.all([getSettings(), getBudgets(), getQuickTemplates()]);
  const cleanSettings = { ...(localSettings || DEFAULT_SETTINGS), logo: undefined, logoDataUrl: await blobToDataURL(localSettings?.logo) };
  const payload = sanitizeForBackup({ app: 'presupuestos-tecnicos', product: 'gestion-electrica', version: 6, scope: 'local', exportedAt: new Date().toISOString(), settings: cleanSettings, budgets: localBudgets, quickTemplates: localTemplates });
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `backup-local-gestion-electrica-${todayISO()}.json`);
  toast('Backup local exportado sin credenciales');
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data?.app !== 'presupuestos-tecnicos' || !data.settings || !Array.isArray(data.budgets)) throw new Error('Formato inválido');
    if (!confirm(`Se reemplazarán los datos locales por ${data.budgets.length} órdenes del backup. ¿Continuar?`)) return;
    const restoredSettings = applyBigPowerProfile({ ...data.settings, logo: data.settings.logoDataUrl ? dataURLToBlob(data.settings.logoDataUrl) : null });
    delete restoredSettings.logoDataUrl;
    await replaceAllData(restoredSettings, data.budgets, Array.isArray(data.quickTemplates) ? data.quickTemplates : []);
    location.reload();
  } catch (error) {
    console.error(error);
    toast('No se pudo importar el backup');
  }
}

function attachEvents() {
  $$('[data-theme-toggle]').forEach((button) => button.addEventListener('click', toggleTheme));
  $$('[data-storage-scope]').forEach((button) => button.addEventListener('click', () => setDataScope(button.dataset.storageScope)));

  $$('.nav-item').forEach((button) => button.addEventListener('click', () => {
    const view = button.dataset.view;
    if (view === 'new' && !button.classList.contains('active')) {
      if (dirty && !confirm('Hay cambios sin guardar. ¿Crear una orden nueva igualmente?')) return;
      resetEditor();
    }
    showView(view);
  }));

  const createNew = () => {
    if (dirty && !confirm('Hay cambios sin guardar. ¿Crear una orden nueva igualmente?')) return;
    resetEditor();
    showView('new');
  };

  $('#newBudgetBtn').addEventListener('click', createNew);
  $('#mobileNewBtn').addEventListener('click', createNew);
  $('#ordersNewBtn').addEventListener('click', createNew);
  $('#emptyNewBtn').addEventListener('click', createNew);
  $('#saveBudgetBtn').addEventListener('click', handleSaveBudget);
  $('#mobileSaveBtn').addEventListener('click', handleSaveBudget);
  $('#previewBudgetBtn').addEventListener('click', () => openPreview());
  $('#railPreviewBtn').addEventListener('click', () => openPreview());
  $('#mobilePreviewBtn').addEventListener('click', () => openPreview());
  $('#printBudgetBtn').addEventListener('click', printBudget);
  ['downloadPdfBtn', 'railDownloadPdfBtn', 'mobileDownloadPdfBtn', 'downloadPreviewPdfBtn'].forEach((id) => {
    $(`#${id}`)?.addEventListener('click', downloadCurrentPdf);
  });

  $('#mobileMenuBtn').addEventListener('click', () => setMobileMenu(!document.body.classList.contains('menu-open')));
  $('#openManualBtn').addEventListener('click', () => showView('manual'));
  $('#openVersionsBtn').addEventListener('click', () => showView('versions'));
  $('#manualHomeBtn').addEventListener('click', () => showView('new'));
  $('#versionsHomeBtn').addEventListener('click', () => showView('new'));
  $$('[data-manual-link]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    document.querySelector(link.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  $$('[data-toggle]').forEach((button) => button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.toggle);
    target?.classList.toggle('hidden');
    button.classList.toggle('active', !target?.classList.contains('hidden'));
  }));

  $$('.device-btn').forEach((button) => button.addEventListener('click', () => {
    setDeviceType(button.dataset.device);
    setDirty();
  }));

  $('#statusPicker').addEventListener('click', (event) => {
    const button = event.target.closest('[data-status]');
    if (!button) return;
    renderStatusPicker(button.dataset.status);
    setDirty();
  });

  $('#quickServices').addEventListener('click', (event) => {
    const button = event.target.closest('[data-service]');
    if (button) applyQuickService(button.dataset.service);
  });
  $('#saveAsQuickTemplateBtn').addEventListener('click', () => openQuickTemplateDialog(null, { seedFromCurrent: true }));

  $('#addItemBtn').addEventListener('click', () => {
    workingItems.push(defaultItem());
    renderItems();
    setDirty();
    setTimeout(() => $('#itemsContainer .item-row:last-child [data-item-field="detail"]')?.focus(), 0);
  });

  $('#itemsContainer').addEventListener('input', (event) => {
    const row = event.target.closest('.item-row');
    const field = event.target.dataset.itemField;
    if (!row || !field) return;
    const item = workingItems.find((x) => x.id === row.dataset.id);
    if (!item) return;
    item[field] = ['qty', 'price', 'warranty'].includes(field) ? Number(event.target.value) : event.target.value;
    updateFinancials();
    setDirty();
  });

  $('#itemsContainer').addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-item]');
    if (!button) return;
    workingItems = workingItems.filter((item) => item.id !== button.dataset.removeItem);
    renderItems();
    setDirty();
  });

  $('#budgetForm').addEventListener('input', (event) => {
    if (event.target.closest('#itemsContainer')) return;
    if (event.target.name === 'budgetNumber' && event.target.value) {
      workingBudgetNumber = Math.max(1, Math.trunc(Number(event.target.value) || 1));
      $('#editorTitle').textContent = `Orden #${padNumber(workingBudgetNumber)}`;
    }
    if (['surcharge', 'discount', 'deposit'].includes(event.target.name)) updateFinancials();
    setDirty();
    renderDocumentWarnings();
  });
  $('#budgetForm').addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-financial-toggle]');
    if (toggle) toggleFinancialMode(toggle.dataset.financialToggle);
  });
  $('#budgetForm').addEventListener('change', (event) => {
    if (event.target.name === 'clientName') autofillKnownClient();
    if (event.target.name === 'budgetNumber') setWorkingBudgetNumber(event.target.value, { markDirty: true });
    if (event.target.name === 'warrantyMode') setWarrantyMode(event.target.value, { markDirty: false });
    if (['surcharge', 'discount', 'deposit'].includes(event.target.name)) updateFinancials();
    setDirty();
    renderDocumentWarnings();
  });
  $('#budgetForm').elements.clientName.addEventListener('blur', autofillKnownClient);

  $('#templatePicker').addEventListener('click', (event) => {
    const button = event.target.closest('[data-template]');
    if (button) setTemplate(button.dataset.template);
  });

  $('#previewModal').addEventListener('click', (event) => {
    if (event.target.closest('[data-close-preview]')) closePreview();
    const tab = event.target.closest('[data-preview-template]');
    if (tab) setTemplate(tab.dataset.previewTemplate);
    const zoom = event.target.closest('[data-preview-zoom]');
    if (zoom) changePreviewZoom(zoom.dataset.previewZoom);
  });

  $('#previewZoomRange').addEventListener('input', (event) => {
    setPreviewZoom(Number(event.target.value) / 100);
  });

  const previewStage = $('#previewStage');
  previewStage.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 2) return;
    previewPinchStartDistance = Math.hypot(
      event.touches[0].clientX - event.touches[1].clientX,
      event.touches[0].clientY - event.touches[1].clientY
    );
    previewPinchStartZoom = previewZoomFactor;
    previewPinchCenter = {
      clientX: (event.touches[0].clientX + event.touches[1].clientX) / 2,
      clientY: (event.touches[0].clientY + event.touches[1].clientY) / 2
    };
  }, { passive: true });
  previewStage.addEventListener('touchmove', (event) => {
    if (event.touches.length !== 2 || !previewPinchStartDistance) return;
    event.preventDefault();
    const distance = Math.hypot(
      event.touches[0].clientX - event.touches[1].clientX,
      event.touches[0].clientY - event.touches[1].clientY
    );
    previewPinchCenter = {
      clientX: (event.touches[0].clientX + event.touches[1].clientX) / 2,
      clientY: (event.touches[0].clientY + event.touches[1].clientY) / 2
    };
    setPreviewZoom(previewPinchStartZoom * (distance / previewPinchStartDistance), previewPinchCenter);
  }, { passive: false });
  previewStage.addEventListener('touchend', (event) => {
    if (event.touches.length < 2) {
      previewPinchStartDistance = 0;
      previewPinchCenter = null;
    }
  }, { passive: true });
  previewStage.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setPreviewZoom(previewZoomFactor * (event.deltaY < 0 ? 1.08 : 1 / 1.08), { clientX: event.clientX, clientY: event.clientY });
  }, { passive: false });
  previewStage.addEventListener('dblclick', (event) => {
    const targetZoom = previewZoomFactor > 1.05 ? 1 : 1.75;
    setPreviewZoom(targetZoom, { clientX: event.clientX, clientY: event.clientY });
  });

  $('#budgetSearch').addEventListener('input', renderBudgetsTable);
  $('#statusFilter').addEventListener('change', renderBudgetsTable);

  $('#budgetsTableBody').addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit]');
    const duplicate = event.target.closest('[data-duplicate]');
    const remove = event.target.closest('[data-delete]');
    const print = event.target.closest('[data-print-order]');
    if (edit) openBudget(edit.dataset.edit);
    if (duplicate) duplicateBudget(duplicate.dataset.duplicate);
    if (remove) removeBudget(remove.dataset.delete);
    if (print) previewStoredBudget(print.dataset.printOrder);
    if (event.target.tagName === 'BUTTON') event.target.closest('.row-menu')?.removeAttribute('open');
  });

  $('#saveSettingsBtn').addEventListener('click', handleSaveSettings);
  $('#settingsForm').addEventListener('input', (event) => {
    if (!['palette', 'brandPattern', 'patternRepeat', 'patternIntensity', 'patternDocuments'].includes(event.target.name)) return;
    const form = $('#settingsForm');
    applyVisualIdentity({
      ...settings,
      palette: form.elements.palette.value,
      brandPattern: form.elements.brandPattern.value,
      patternRepeat: Number(form.elements.patternRepeat.value),
      patternIntensity: Number(form.elements.patternIntensity.value)
    });
  });
  $('#addTechnicianBtn').addEventListener('click', () => {
    const values = $$('[name="technicianName"]', $('#settingsForm')).map((input) => input.value);
    values.push('');
    renderTechnicianSettings(values.length - 1, values);
  });
  $('#techniciansList').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-technician]');
    if (!remove) return;
    const index = Number(remove.dataset.removeTechnician);
    const values = $$('[name="technicianName"]', $('#settingsForm')).map((input) => input.value).filter((_, itemIndex) => itemIndex !== index);
    renderTechnicianSettings(null, values);
  });
  $('#cloudAccountShortcut').addEventListener('click', openCloudAuthDialog);
  $('#cloudAuthBtn').addEventListener('click', openCloudAuthDialog);
  $('#cloudSyncBtn').addEventListener('click', () => synchronizeCloudData());
  $('#cloudSignOutBtn').addEventListener('click', handleCloudSignOut);
  $('#cloudAuthForm').addEventListener('submit', handleCloudSignIn);
  $('#cloudSignUpBtn').addEventListener('click', handleCloudSignUp);
  $$('[data-close-cloud]').forEach((button) => button.addEventListener('click', closeCloudAuthDialog));
  $('#cloudAuthDialog').addEventListener('click', (event) => {
    if (event.target === $('#cloudAuthDialog')) closeCloudAuthDialog();
  });
  $('#newQuickTemplateBtn').addEventListener('click', () => openQuickTemplateDialog());
  $('#quickTemplateForm').addEventListener('submit', handleSaveQuickTemplate);
  $$('[data-close-template]').forEach((button) => button.addEventListener('click', closeQuickTemplateDialog));
  $('#quickTemplateDialog').addEventListener('click', (event) => {
    if (event.target === $('#quickTemplateDialog')) closeQuickTemplateDialog();
  });
  $('#customTemplatesList').addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit-quick-template]');
    const remove = event.target.closest('[data-delete-quick-template]');
    if (edit) openQuickTemplateDialog(quickTemplates.find((template) => template.id === edit.dataset.editQuickTemplate));
    if (remove) removeQuickTemplate(remove.dataset.deleteQuickTemplate);
  });
  $('#defaultTemplatePicker').addEventListener('click', (event) => {
    const button = event.target.closest('[data-template]');
    if (button) setDefaultTemplate(button.dataset.template);
  });
  $('#logoInput').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      toast('El logo debe pesar menos de 3 MB');
      event.target.value = '';
      return;
    }
    pendingLogo = file;
    logoSourceCache = null;
    refreshLogoUI();
  });
  $('#removeLogoBtn').addEventListener('click', () => {
    pendingLogo = null;
    $('#logoInput').value = '';
    logoSourceCache = null;
    refreshLogoUI();
  });
  $('#patternSvgInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024 || (!file.name.toLowerCase().endsWith('.svg') && file.type !== 'image/svg+xml')) {
      toast('Usá un archivo SVG de hasta 512 KB');
      event.target.value = '';
      return;
    }
    const cleanSvg = sanitizePatternSvg(await file.text());
    if (!cleanSvg) {
      toast('El SVG no es válido o contiene elementos no permitidos');
      event.target.value = '';
      return;
    }
    pendingPatternSvg = cleanSvg;
    const form = $('#settingsForm');
    form.elements.brandPattern.value = 'custom';
    applyVisualIdentity({
      ...settings,
      customPatternSvg: cleanSvg,
      brandPattern: 'custom',
      patternRepeat: Number(form.elements.patternRepeat.value),
      patternIntensity: Number(form.elements.patternIntensity.value)
    });
    toast('Patrón SVG cargado. Guardá los cambios para conservarlo.');
  });
  $('#removePatternSvgBtn').addEventListener('click', () => {
    pendingPatternSvg = '';
    $('#patternSvgInput').value = '';
    const form = $('#settingsForm');
    if (form.elements.brandPattern.value === 'custom') form.elements.brandPattern.value = 'circuits';
    applyVisualIdentity({
      ...settings,
      customPatternSvg: '',
      brandPattern: form.elements.brandPattern.value,
      patternRepeat: Number(form.elements.patternRepeat.value),
      patternIntensity: Number(form.elements.patternIntensity.value)
    });
    toast('Patrón SVG quitado');
  });
  $('#exportBackupBtn').addEventListener('click', exportBackup);
  $('#importBackupInput').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) importBackup(file);
    event.target.value = '';
  });

  document.addEventListener('click', (event) => {
    $$('.row-menu[open]').forEach((menu) => { if (!menu.contains(event.target)) menu.open = false; });
    if (document.body.classList.contains('menu-open') && !event.target.closest('.sidebar') && !event.target.closest('#mobileMenuBtn')) setMobileMenu(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePreview();
      closeQuickTemplateDialog();
      closeCloudAuthDialog();
      setMobileMenu(false);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if ($('#view-new').classList.contains('active-view')) handleSaveBudget();
      if ($('#view-settings').classList.contains('active-view')) handleSaveSettings();
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'n' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) createNew();
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $('#installAppBtn')?.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    $('#installAppBtn')?.classList.add('hidden');
    toast('Aplicación instalada');
  });
  $('#installAppBtn')?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('#installAppBtn')?.classList.add('hidden');
  });
  window.addEventListener('resize', () => requestAnimationFrame(fitPreview));
  window.addEventListener('popstate', (event) => {
    const state = event.state || {};
    const view = ['new', 'orders', 'settings', 'manual', 'versions'].includes(state.bigPowerView) ? state.bigPowerView : 'new';
    if (state.bigPowerLayer !== 'preview') closePreview({ historyMode: 'none' });
    closeCloudAuthDialog();
    closeQuickTemplateDialog();
    showView(view, { historyMode: 'none' });
    if (state.bigPowerLayer === 'preview') openPreview(null, { historyMode: 'none' });
  });

  ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
    document.addEventListener(type, (event) => {
      if (!$('#previewModal')?.classList.contains('hidden') && event.target.closest?.('#previewStage')) event.preventDefault();
    }, { passive: false });
  });

  window.addEventListener('online', () => {
    updateConnectionStatus();
    synchronizeCloudData({ notify: false });
  });
  window.addEventListener('offline', updateConnectionStatus);
  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

function updateConnectionStatus() {
  renderCloudState();
}

async function requestPersistentStorage() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch (_) {}
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try { const registration = await navigator.serviceWorker.register('./service-worker.js'); await registration.update(); } catch (error) { console.warn('Service Worker:', error); }
}

async function init() {
  applyTheme(document.documentElement.dataset.theme || 'dark');
  initializeAppHistory();
  renderQuickServices();
  attachEvents();
  const [savedSettings, savedBudgets, savedQuickTemplates] = await Promise.all([getSettings(), getBudgets(), getQuickTemplates()]);
  const needsBrandMigration = (Number(savedSettings?.brandProfileVersion) || 0) < BRAND_PROFILE_VERSION;
  const needsTechnicianMigration = Boolean(savedSettings) && !Array.isArray(savedSettings.technicians);
  const needsPatternMigration = (Number(savedSettings?.patternDefaultVersion) || 0) < 1;
  settings = applyBigPowerProfile(savedSettings || {});
  settings.terms ||= DEFAULT_TERMS;
  settings.defaultTemplate ||= 'classic';
  settings.updatedAt ||= new Date().toISOString();
  if (needsTechnicianMigration) settings.updatedAt = new Date().toISOString();
  if (!savedSettings || needsBrandMigration || needsTechnicianMigration || needsPatternMigration || !savedSettings.updatedAt) await saveSettings(settings);
  budgets = savedBudgets;
  quickTemplates = savedQuickTemplates;
  activeDataScope = 'local';
  editingScope = 'local';
  applyVisualIdentity(settings);
  renderQuickServices();
  fillSettingsForm();
  refreshDatalists();
  const filter = $('#statusFilter');
  filter.innerHTML = '<option value="">Todos los estados</option>' + STATUS_OPTIONS.map((s) => `<option>${escapeHtml(s.value)}</option>`).join('');
  resetEditor();
  renderBudgetsTable();
  const previousOwnerId = getStoredCloudUserId();
  cloudUser = await initializeCloud();
  if (!cloudUser && previousOwnerId) await clearCloudData(previousOwnerId);
  updateConnectionStatus();
  if (cloudUser) await synchronizeCloudData({ notify: false });
  await requestPersistentStorage();
  await registerServiceWorker();
  await purgeExternalHttpCaches();

  showView('new', { historyMode: 'none' });
  if (!savedSettings) toast('BIG POWER listo para crear la primera orden');
}

init().catch((error) => {
  console.error(error);
  toast('No se pudo iniciar la aplicación');
});
