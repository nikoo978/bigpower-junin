import { PDFDocument } from './vendor/pdf-lib.esm.min.js';

const MM_TO_CSS_PX = 96 / 25.4;
const MM_TO_PT = 72 / 25.4;
const A4 = Object.freeze({
  widthPx: Math.round(210 * MM_TO_CSS_PX),
  heightPx: Math.round(297 * MM_TO_CSS_PX),
  widthPt: 210 * MM_TO_PT,
  heightPt: 297 * MM_TO_PT
});
const PDF_SCALE = 3;
const PDF_FALLBACK_SCALE = 2;
const IOS_PDF_SCALE = 1.5;
const IOS_PDF_FALLBACK_SCALE = 1;

let stylesheetPromise = null;

function isAppleMobileWebKit() {
  const agent = navigator.userAgent || '';
  return /iPad|iPhone|iPod/i.test(agent)
    || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints) > 1);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer un recurso del documento.'));
    reader.readAsDataURL(blob);
  });
}

async function resourceToDataUrl(source, baseUrl = document.baseURI) {
  if (!source || source.startsWith('data:')) return source;
  const url = source.startsWith('blob:') ? source : new URL(source, baseUrl).href;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo incorporar el recurso ${source}.`);
  return blobToDataUrl(await response.blob());
}

async function getEmbeddedStylesheet() {
  if (stylesheetPromise) return stylesheetPromise;
  stylesheetPromise = (async () => {
    const stylesheetUrl = new URL('./styles.css', import.meta.url);
    const response = await fetch(stylesheetUrl);
    if (!response.ok) throw new Error('No se pudieron cargar los estilos del PDF.');
    let css = await response.text();
    const sources = [...new Set([...css.matchAll(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g)].map((match) => match[2].trim()))];
    for (const source of sources) {
      if (!source || source.startsWith('data:') || source.startsWith('#')) continue;
      const dataUrl = await resourceToDataUrl(source, stylesheetUrl);
      css = css.split(source).join(dataUrl);
    }
    return css;
  })();
  return stylesheetPromise;
}

async function inlineDocumentImages(root) {
  const images = [...root.querySelectorAll('img')];
  await Promise.all(images.map(async (image) => {
    const source = image.getAttribute('src') || image.currentSrc;
    if (!source || source.startsWith('data:')) return;
    image.removeAttribute('srcset');
    image.setAttribute('src', await resourceToDataUrl(source));
  }));
  await Promise.all(images.map((image) => image.decode?.().catch(() => undefined)));
}

function iosSafeStylesheet(css) {
  return css
    .replace(/[^{}]+\{[^{}]*color-mix\([^{}]*\)[^{}]*\}/gi, '')
    .replace(/(?:-webkit-)?backdrop-filter\s*:[^;{}]+;?/gi, '')
    .replace(/scrollbar-gutter\s*:[^;{}]+;?/gi, '');
}

async function createIsolatedRenderPage(html) {
  const css = iosSafeStylesheet(await getEmbeddedStylesheet());
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${A4.widthPx}px;height:${A4.heightPx}px;border:0;opacity:.01;pointer-events:none;`;
  document.body.append(frame);

  const frameDocument = frame.contentDocument;
  if (!frameDocument) {
    frame.remove();
    throw new Error('iOS no pudo crear el entorno aislado del PDF.');
  }
  frameDocument.open();
  frameDocument.write(`<!doctype html><html><head><base href="${document.baseURI}"><meta charset="utf-8"><style>${css}\n
    html, body { width: ${A4.widthPx}px !important; height: ${A4.heightPx}px !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: #fff !important; color-scheme: light !important; }
    .pdf-export-page { width: 210mm !important; height: 297mm !important; min-height: 297mm !important; max-height: 297mm !important; margin: 0 !important; overflow: hidden !important; box-shadow: none !important; transform: none !important; zoom: 1 !important; }
    .pdf-export-page .classic-brand, .pdf-export-page .workshop-business { width: fit-content !important; max-width: 100% !important; justify-self: start !important; }
  </style></head><body>${html}</body></html>`);
  frameDocument.close();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const page = frameDocument.querySelector('.a4-page');
  if (!page) {
    frame.remove();
    throw new Error('No se encontró la hoja A4 para descargar.');
  }
  page.classList.add('pdf-export-page');
  await inlineDocumentImages(page);
  return { page, cleanup: () => frame.remove() };
}

function createSvg(page, css, scale) {
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const htmlNamespace = 'http://www.w3.org/1999/xhtml';
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('xmlns', svgNamespace);
  svg.setAttribute('width', String(A4.widthPx * scale));
  svg.setAttribute('height', String(A4.heightPx * scale));
  svg.setAttribute('viewBox', `0 0 ${A4.widthPx} ${A4.heightPx}`);

  const foreignObject = document.createElementNS(svgNamespace, 'foreignObject');
  foreignObject.setAttribute('x', '0');
  foreignObject.setAttribute('y', '0');
  foreignObject.setAttribute('width', String(A4.widthPx));
  foreignObject.setAttribute('height', String(A4.heightPx));

  const wrapper = document.createElementNS(htmlNamespace, 'div');
  wrapper.setAttribute('class', 'pdf-export-root');
  const style = document.createElementNS(htmlNamespace, 'style');
  style.textContent = `${css}\n
    .pdf-export-root { width: ${A4.widthPx}px; height: ${A4.heightPx}px; margin: 0; overflow: hidden; background: #fff; }
    .pdf-export-page { width: 210mm !important; height: 297mm !important; min-height: 297mm !important; max-height: 297mm !important; margin: 0 !important; overflow: hidden !important; box-shadow: none !important; }
    .pdf-export-page .classic-brand,
    .pdf-export-page .workshop-business { width: fit-content !important; max-width: 100% !important; justify-self: start !important; }
  `;
  wrapper.append(style, page);
  foreignObject.append(wrapper);
  svg.append(foreignObject);
  return new XMLSerializer().serializeToString(svg);
}

function loadImageSource(source, cleanup = () => {}) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('El navegador tardó demasiado en preparar la hoja A4.'));
    }, 20000);
    image.onload = () => {
      clearTimeout(timeout);
      resolve({ image, cleanup });
    };
    image.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error('El navegador no pudo preparar la hoja A4.'));
    };
    image.decoding = 'sync';
    image.src = source;
  });
}

async function loadSvgImage(svg) {
  const encodedSource = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const blobSource = { source: blobUrl, cleanup: () => URL.revokeObjectURL(blobUrl) };
  const dataSource = { source: encodedSource, cleanup: () => {} };
  // El data URL conserva el SVG como recurso autocontenido y evita que ciertos
  // navegadores consideren contaminado el canvas al dibujar un blob con HTML.
  const sources = [dataSource, blobSource];
  let lastError;
  for (const candidate of sources) {
    try {
      const loaded = await loadImageSource(candidate.source, candidate.cleanup);
      if (candidate === dataSource) URL.revokeObjectURL(blobUrl);
      return loaded;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('El navegador no pudo preparar la hoja A4.');
}

function dataUrlToBlob(dataUrl) {
  const [header, payload] = dataUrl.split(',');
  const mimeType = /data:([^;]+)/.exec(header)?.[1] || 'application/octet-stream';
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishWithDataUrl = () => {
      if (settled) return;
      try {
        settled = true;
        resolve(dataUrlToBlob(canvas.toDataURL('image/png')));
      } catch (error) {
        reject(error);
      }
    };
    const timeout = setTimeout(finishWithDataUrl, 15000);
    try {
      canvas.toBlob((blob) => {
        if (settled) return;
        clearTimeout(timeout);
        if (blob) {
          settled = true;
          resolve(blob);
        } else {
          finishWithDataUrl();
        }
      }, 'image/png');
    } catch (_) {
      clearTimeout(timeout);
      finishWithDataUrl();
    }
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function renderPageWithHtml2Canvas(page, scale) {
  const { default: html2canvas } = await import('./vendor/html2canvas.esm.js');
  const canvas = await html2canvas(page, {
    backgroundColor: '#ffffff',
    scale,
    logging: false,
    useCORS: false,
    allowTaint: false,
    foreignObjectRendering: false,
    imageTimeout: 20000,
    width: A4.widthPx,
    height: A4.heightPx,
    windowWidth: A4.widthPx,
    windowHeight: A4.heightPx,
    scrollX: 0,
    scrollY: 0,
    removeContainer: true,
    onclone: (clonedDocument) => {
      clonedDocument.documentElement.style.background = '#fff';
      clonedDocument.body.style.background = '#fff';
      clonedDocument.querySelectorAll('style').forEach((style) => {
        style.textContent = iosSafeStylesheet(style.textContent || '');
      });
    }
  });
  try {
    return await canvasToPng(canvas);
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

async function renderPageForApple(html) {
  const isolated = await createIsolatedRenderPage(html);
  let lastError;
  try {
    for (const scale of [IOS_PDF_SCALE, IOS_PDF_FALLBACK_SCALE]) {
      try {
        return await renderPageWithHtml2Canvas(isolated.page, scale);
      } catch (error) {
        lastError = error;
        console.warn(`PDF iOS: reintento de renderizado a escala ${scale}`, error);
      }
    }
  } finally {
    isolated.cleanup();
  }
  throw lastError || new Error('iOS no pudo convertir la hoja A4 en imagen.');
}

async function renderPageWithRasterFallback(html) {
  const isolated = await createIsolatedRenderPage(html);
  let lastError;
  try {
    for (const scale of [PDF_FALLBACK_SCALE, IOS_PDF_SCALE, IOS_PDF_FALLBACK_SCALE]) {
      try {
        return await renderPageWithHtml2Canvas(isolated.page, scale);
      } catch (error) {
        lastError = error;
        console.warn(`PDF: reintento de renderizado a escala ${scale}`, error);
      }
    }
  } finally {
    isolated.cleanup();
  }
  throw lastError || new Error('El navegador no pudo convertir la hoja A4 en imagen.');
}

function shareFileAfterTap(file, filename) {
  return new Promise((resolve, reject) => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Guardar PDF en iPhone');
    dialog.style.cssText = 'width:min(420px,calc(100vw - 28px));padding:0;border:1px solid #7b5a20;border-radius:14px;background:#111;color:#fff;box-shadow:0 22px 70px rgba(0,0,0,.55);';
    dialog.innerHTML = `<div style="padding:20px;display:grid;gap:14px;font-family:system-ui,sans-serif"><strong style="font-size:18px">PDF listo</strong><span style="font-size:14px;line-height:1.45;color:#ddd">iOS necesita una confirmación final para guardar el archivo.</span><button type="button" data-save-ios style="min-height:48px;border:1px solid #d69b26;border-radius:9px;background:#e9ad32;color:#241600;font-weight:800;font-size:16px">Guardar PDF</button><button type="button" data-cancel-ios style="min-height:42px;border:0;background:transparent;color:#ccc;font-size:14px">Cancelar</button><small style="color:#aaa;overflow-wrap:anywhere">${filename}</small></div>`;
    document.body.append(dialog);
    const close = () => {
      if (dialog.open) dialog.close();
      dialog.remove();
    };
    dialog.querySelector('[data-save-ios]').addEventListener('click', () => {
      const sharing = navigator.share({ files: [file], title: filename });
      close();
      sharing.then(() => resolve('share')).catch((error) => error?.name === 'AbortError' ? resolve('cancelled') : reject(error));
    });
    dialog.querySelector('[data-cancel-ios]').addEventListener('click', () => {
      close();
      resolve('cancelled');
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
      resolve('cancelled');
    });
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.setAttribute('open', '');
      dialog.style.position = 'fixed';
      dialog.style.zIndex = '9999';
      dialog.style.inset = '50% auto auto 50%';
      dialog.style.transform = 'translate(-50%,-50%)';
    }
  });
}

async function deliverPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  if (!isAppleMobileWebKit()) {
    triggerDownload(blob, filename);
    return 'download';
  }

  const file = new File([blob], filename, { type: 'application/pdf', lastModified: Date.now() });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'share';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      if (error?.name === 'NotAllowedError') return shareFileAfterTap(file, filename);
    }
  }

  const dataUrl = await blobToDataUrl(blob);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  return 'download';
}

async function renderPageToPng(html, scale = PDF_SCALE) {
  if (isAppleMobileWebKit()) return renderPageForApple(html);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:210mm;height:297mm;overflow:hidden;pointer-events:none;';
  host.innerHTML = html;
  document.body.append(host);
  try {
    const page = host.querySelector('.a4-page');
    if (!page) throw new Error('No se encontró la hoja A4 para descargar.');
    page.classList.add('pdf-export-page');
    page.style.width = '210mm';
    page.style.height = '297mm';
    page.style.minHeight = '297mm';
    page.style.maxHeight = '297mm';
    page.style.margin = '0';
    page.style.overflow = 'hidden';
    page.style.boxShadow = 'none';
    await inlineDocumentImages(page);
    const css = await getEmbeddedStylesheet();
    const clone = page.cloneNode(true);
    const svg = createSvg(clone, css, scale);
    const loadedImage = await loadSvgImage(svg);
    const canvas = document.createElement('canvas');
    canvas.width = A4.widthPx * scale;
    canvas.height = A4.heightPx * scale;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('El navegador no pudo crear el PDF.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    try {
      context.drawImage(loadedImage.image, 0, 0, canvas.width, canvas.height);
      return await canvasToPng(canvas);
    } catch (error) {
      console.warn('PDF: el método vectorial no estuvo disponible; se usa el renderizado compatible.', error);
      return await renderPageWithRasterFallback(html);
    } finally {
      loadedImage.cleanup();
      canvas.width = 1;
      canvas.height = 1;
    }
  } finally {
    host.remove();
  }
}

export async function downloadA4Pdf({ html, filename, title, subject }) {
  const pngBlob = await renderPageToPng(html);
  const documentPdf = await PDFDocument.create();
  documentPdf.setTitle(title || filename.replace(/\.pdf$/i, ''));
  documentPdf.setSubject(subject || 'Documento A4 de BIG POWER');
  documentPdf.setAuthor('BIG POWER');
  documentPdf.setCreator('BIG POWER - Gestión eléctrica');
  documentPdf.setProducer('BIG POWER - PDF A4 directo');
  documentPdf.setCreationDate(new Date());
  documentPdf.setModificationDate(new Date());

  const image = await documentPdf.embedPng(await pngBlob.arrayBuffer());
  const page = documentPdf.addPage([A4.widthPt, A4.heightPt]);
  page.drawImage(image, { x: 0, y: 0, width: A4.widthPt, height: A4.heightPt });
  const bytes = await documentPdf.save({ useObjectStreams: !isAppleMobileWebKit() });
  const delivery = await deliverPdf(bytes, filename);
  return { filename, bytes: bytes.length, delivery };
}
