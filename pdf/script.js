document.getElementById('year').textContent = new Date().getFullYear();

const PDFJS_VER = '3.11.174';
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VER + '/pdf.min.js';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VER + '/pdf.worker.min.js';
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

// ── Utilities ───────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function loadScript(src) {
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = function() { reject(new Error('Failed to load ' + src)); };
    document.head.appendChild(s);
  });
}

async function loadPDFJS() {
  if (window.pdfjsLib && pdfjsLib.GlobalWorkerOptions.workerSrc) return;
  await loadScript(PDFJS_URL);
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
}

async function loadJSZip() {
  if (window.JSZip) return;
  await loadScript(JSZIP_URL);
}

function triggerDownload(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
}

function escForScriptTag(code) {
  return code.replace(/<\/script>/gi, '<\\/script>');
}

// ── Tabs ────────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(function(btn) {
    var active = btn.dataset.tab === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.tab-panel').forEach(function(panel) {
    panel.classList.toggle('u-hidden', panel.id !== 'tab-' + name);
  });
}

// ── Merge ────────────────────────────────────────────────────────────────────

var files = [];
var dragSrcIdx = null;

var dropZone = document.getElementById('dropZone');
var fileInput = document.getElementById('fileInput');
var fileList = document.getElementById('fileList');
var mergeBtn = document.getElementById('mergeBtn');
var mergeStatus = document.getElementById('mergeStatus');
var progressBar = document.getElementById('progressBar');
var progressFill = document.getElementById('progressFill');
var emptyHint = document.getElementById('emptyHint');

dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('drag-over'); });
dropZone.addEventListener('drop', function(e) {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  addFiles([].slice.call(e.dataTransfer.files));
});
fileInput.addEventListener('change', function() { addFiles([].slice.call(fileInput.files)); });

function addFiles(incoming) {
  var pdfs = incoming.filter(function(f) { return f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'); });
  if (pdfs.length < incoming.length) showMergeStatus('Some files were skipped — only PDFs accepted.', 'info');
  files = files.concat(pdfs);
  renderList();
  fileInput.value = '';
}

function renderList() {
  fileList.innerHTML = '';
  mergeBtn.disabled = files.length < 2;
  emptyHint.style.display = files.length === 0 ? 'block' : 'none';
  files.forEach(function(f, i) {
    var item = document.createElement('div');
    item.className = 'file-item';
    item.draggable = true;
    item.dataset.idx = i;
    item.innerHTML =
      '<div class="drag-handle" aria-hidden="true"><span></span><span></span><span></span></div>' +
      '<div class="order-num">' + (i + 1) + '</div>' +
      '<div class="file-icon">PDF</div>' +
      '<div class="file-info">' +
        '<div class="file-name" title="' + f.name + '">' + f.name + '</div>' +
        '<div class="file-size">' + formatSize(f.size) + '</div>' +
      '</div>' +
      '<button class="remove-btn" onclick="removeFile(' + i + ')" title="Remove">&#10005;</button>';
    item.addEventListener('dragstart', function() { dragSrcIdx = i; setTimeout(function() { item.classList.add('dragging'); }, 0); });
    item.addEventListener('dragend', function() { item.classList.remove('dragging'); clearDragTargets(); });
    item.addEventListener('dragover', function(e) { e.preventDefault(); clearDragTargets(); item.classList.add('drag-target'); });
    item.addEventListener('drop', function(e) { e.preventDefault(); if (dragSrcIdx !== null && dragSrcIdx !== i) reorder(dragSrcIdx, i); });
    fileList.appendChild(item);
  });
}

function clearDragTargets() {
  document.querySelectorAll('.drag-target').forEach(function(el) { el.classList.remove('drag-target'); });
}

function reorder(from, to) {
  var item = files.splice(from, 1)[0];
  files.splice(to, 0, item);
  dragSrcIdx = null;
  renderList();
}

function removeFile(i) {
  files.splice(i, 1);
  renderList();
  hideMergeStatus();
}

function clearAll() {
  files = [];
  renderList();
  hideMergeStatus();
  progressBar.classList.remove('visible');
}

function showMergeStatus(msg, type) { mergeStatus.textContent = msg; mergeStatus.className = 'status ' + type; }
function hideMergeStatus() { mergeStatus.className = 'status'; }
function setMergeProgress(pct) { progressBar.classList.add('visible'); progressFill.style.width = pct + '%'; }

async function mergePDFs() {
  if (files.length < 2) return;
  mergeBtn.disabled = true;
  showMergeStatus('Merging…', 'info');
  setMergeProgress(10);

  try {
    var PDFDocument = PDFLib.PDFDocument;
    var merged = await PDFDocument.create();
    for (var i = 0; i < files.length; i++) {
      var arrayBuffer = await files[i].arrayBuffer();
      setMergeProgress(10 + Math.round((i / files.length) * 70));
      var doc = await PDFDocument.load(arrayBuffer);
      var pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach(function(p) { merged.addPage(p); });
    }
    setMergeProgress(90);
    var bytes = await merged.save();
    setMergeProgress(100);
    triggerDownload(new Blob([bytes], { type: 'application/pdf' }), 'merged.pdf');
    var totalPages = (await PDFDocument.load(bytes)).getPageCount();
    showMergeStatus('Done — ' + totalPages + ' pages, saved as merged.pdf', 'success');
  } catch (err) {
    showMergeStatus('Error: ' + (err.message || 'Could not merge. Make sure the PDFs are not password-protected.'), 'error');
  }
  mergeBtn.disabled = files.length < 2;
}

// ── Split ────────────────────────────────────────────────────────────────────

var splitFile = null;

var splitDropZone = document.getElementById('splitDropZone');
var splitFileInput = document.getElementById('splitFileInput');
var splitFileInfo = document.getElementById('splitFileInfo');
var rangeWrap = document.getElementById('rangeWrap');
var splitProgressBar = document.getElementById('splitProgressBar');
var splitProgressFill = document.getElementById('splitProgressFill');
var splitStatus = document.getElementById('splitStatus');

document.querySelectorAll('input[name="splitMode"]').forEach(function(radio) {
  radio.addEventListener('change', function() {
    rangeWrap.classList.toggle('u-hidden', radio.value !== 'ranges');
  });
});

splitDropZone.addEventListener('dragover', function(e) { e.preventDefault(); splitDropZone.classList.add('drag-over'); });
splitDropZone.addEventListener('dragleave', function() { splitDropZone.classList.remove('drag-over'); });
splitDropZone.addEventListener('drop', function(e) {
  e.preventDefault();
  splitDropZone.classList.remove('drag-over');
  var f = e.dataTransfer.files[0];
  if (f) setSplitFile(f);
});
splitFileInput.addEventListener('change', function() {
  if (splitFileInput.files[0]) setSplitFile(splitFileInput.files[0]);
  splitFileInput.value = '';
});

async function setSplitFile(f) {
  if (!f.name.toLowerCase().endsWith('.pdf') && f.type !== 'application/pdf') {
    showSplitStatus('Only PDF files are accepted.', 'error');
    return;
  }
  splitFile = f;
  document.getElementById('splitFileName').textContent = f.name;
  document.getElementById('splitFileSize').textContent = formatSize(f.size);
  splitDropZone.style.display = 'none';
  splitFileInfo.classList.remove('u-hidden');
  hideSplitStatus();
  splitProgressBar.classList.remove('visible');

  // Read page count and update hint
  try {
    var buf = await f.arrayBuffer();
    var doc = await PDFLib.PDFDocument.load(buf);
    var n = doc.getPageCount();
    document.getElementById('splitFileSize').textContent = formatSize(f.size) + ' · ' + n + ' page' + (n !== 1 ? 's' : '');
    document.getElementById('rangeInput').placeholder = n <= 4 ? '1-2, 3-' + n : 'e.g. 1-3, 5, 8-' + n;
    document.getElementById('rangeHint').textContent = 'Pages 1–' + n + '. Each comma-separated entry becomes a separate PDF.';
  } catch (_) { /* non-critical, leave defaults */ }
}

function clearSplit() {
  splitFile = null;
  splitDropZone.style.display = '';
  splitFileInfo.classList.add('u-hidden');
  document.getElementById('rangeInput').value = '';
  document.querySelector('input[name="splitMode"][value="all"]').checked = true;
  rangeWrap.classList.add('u-hidden');
  hideSplitStatus();
  splitProgressBar.classList.remove('visible');
}

function showSplitStatus(msg, type) { splitStatus.textContent = msg; splitStatus.className = 'status ' + type; }
function hideSplitStatus() { splitStatus.className = 'status'; }
function setSplitProgress(pct) { splitProgressBar.classList.add('visible'); splitProgressFill.style.width = pct + '%'; }

function parsePageRanges(input, totalPages) {
  if (!input.trim()) return null;
  var ranges = [];
  var parts = input.split(',');
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (!part) continue;
    var match = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) return null;
    var from = parseInt(match[1], 10);
    var to = match[2] ? parseInt(match[2], 10) : from;
    if (from < 1 || to > totalPages || from > to) return null;
    var pages = [];
    for (var p = from; p <= to; p++) pages.push(p - 1); // 0-indexed
    ranges.push({ label: part.replace(/-/g, '_'), pages: pages });
  }
  return ranges.length ? ranges : null;
}

async function splitPDF() {
  if (!splitFile) return;
  var btn = document.getElementById('splitBtn');
  btn.disabled = true;
  showSplitStatus('Loading PDF…', 'info');
  setSplitProgress(5);

  try {
    var PDFDocument = PDFLib.PDFDocument;
    var arrayBuffer = await splitFile.arrayBuffer();
    var srcDoc = await PDFDocument.load(arrayBuffer);
    var total = srcDoc.getPageCount();
    var baseName = splitFile.name.replace(/\.pdf$/i, '');
    var mode = document.querySelector('input[name="splitMode"]:checked').value;

    var segments;
    if (mode === 'ranges') {
      var rangeInput = document.getElementById('rangeInput').value;
      segments = parsePageRanges(rangeInput, total);
      if (!segments) {
        showSplitStatus('Invalid range. Use format: 1-3, 5, 8-10 (pages 1 to ' + total + ')', 'error');
        btn.disabled = false;
        return;
      }
    } else {
      segments = [];
      for (var i = 0; i < total; i++) {
        segments.push({ label: String(i + 1), pages: [i] });
      }
    }

    showSplitStatus('Splitting…', 'info');

    if (segments.length === 1) {
      var newDoc = await PDFDocument.create();
      var copied = await newDoc.copyPages(srcDoc, segments[0].pages);
      copied.forEach(function(p) { newDoc.addPage(p); });
      setSplitProgress(90);
      var bytes = await newDoc.save();
      setSplitProgress(100);
      triggerDownload(new Blob([bytes], { type: 'application/pdf' }), baseName + '_pages_' + segments[0].label + '.pdf');
      showSplitStatus('Done — saved 1 PDF.', 'success');
    } else {
      await loadJSZip();
      var zip = new JSZip();
      for (var j = 0; j < segments.length; j++) {
        var seg = segments[j];
        var d = await PDFDocument.create();
        var cp = await d.copyPages(srcDoc, seg.pages);
        cp.forEach(function(p) { d.addPage(p); });
        var b = await d.save();
        var fname = mode === 'all'
          ? baseName + '_page_' + seg.label + '.pdf'
          : baseName + '_pages_' + seg.label + '.pdf';
        zip.file(fname, b);
        setSplitProgress(10 + Math.round(((j + 1) / segments.length) * 80));
      }
      setSplitProgress(95);
      var zipBlob = await zip.generateAsync({ type: 'blob' });
      setSplitProgress(100);
      triggerDownload(zipBlob, baseName + '_split.zip');
      showSplitStatus('Done — saved ' + segments.length + ' PDFs in a ZIP.', 'success');
    }
  } catch (err) {
    showSplitStatus('Error: ' + (err.message || 'Could not split. Make sure the PDF is not password-protected.'), 'error');
  }
  btn.disabled = false;
}

// ── To Markdown ──────────────────────────────────────────────────────────────

var mdFile = null;
var mdResultText = '';

var mdDropZone = document.getElementById('mdDropZone');
var mdFileInput = document.getElementById('mdFileInput');
var mdFileInfo = document.getElementById('mdFileInfo');
var mdProgressBar = document.getElementById('mdProgressBar');
var mdProgressFill = document.getElementById('mdProgressFill');
var mdStatusEl = document.getElementById('mdStatus');
var mdResultEl = document.getElementById('mdResult');
var mdPreview = document.getElementById('mdPreview');

mdDropZone.addEventListener('dragover', function(e) { e.preventDefault(); mdDropZone.classList.add('drag-over'); });
mdDropZone.addEventListener('dragleave', function() { mdDropZone.classList.remove('drag-over'); });
mdDropZone.addEventListener('drop', function(e) {
  e.preventDefault();
  mdDropZone.classList.remove('drag-over');
  var f = e.dataTransfer.files[0];
  if (f) setMdFile(f);
});
mdFileInput.addEventListener('change', function() {
  if (mdFileInput.files[0]) setMdFile(mdFileInput.files[0]);
  mdFileInput.value = '';
});

function setMdFile(f) {
  if (!f.name.toLowerCase().endsWith('.pdf') && f.type !== 'application/pdf') {
    showMdStatus('Only PDF files are accepted.', 'error');
    return;
  }
  mdFile = f;
  document.getElementById('mdFileName').textContent = f.name;
  document.getElementById('mdFileSize').textContent = formatSize(f.size);
  mdDropZone.style.display = 'none';
  mdFileInfo.classList.remove('u-hidden');
  hideMdStatus();
  mdProgressBar.classList.remove('visible');
  mdResultEl.classList.add('u-hidden');
  mdResultText = '';
}

function clearMarkdown() {
  mdFile = null;
  mdResultText = '';
  mdDropZone.style.display = '';
  mdFileInfo.classList.add('u-hidden');
  mdResultEl.classList.add('u-hidden');
  mdPreview.value = '';
  hideMdStatus();
  mdProgressBar.classList.remove('visible');
}

function showMdStatus(msg, type) { mdStatusEl.textContent = msg; mdStatusEl.className = 'status ' + type; }
function hideMdStatus() { mdStatusEl.className = 'status'; }
function setMdProgress(pct) { mdProgressBar.classList.add('visible'); mdProgressFill.style.width = pct + '%'; }

function median(arr) {
  if (!arr.length) return 0;
  var s = arr.slice().sort(function(a, b) { return a - b; });
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pageItemsToMarkdown(items, pageNum, pageHeight) {
  if (!items.length) return '';

  // Build rows: each item has x, y (from top), h, str
  var rows = items.map(function(item) {
    return {
      x: item.transform[4],
      y: pageHeight - item.transform[5],
      h: Math.abs(item.transform[3]) || item.height || 12,
      str: item.str
    };
  }).filter(function(r) { return r.str.trim(); });

  if (!rows.length) return '';

  // Cluster into lines by Y proximity
  rows.sort(function(a, b) { return a.y - b.y || a.x - b.x; });
  var lines = [];
  var cur = [rows[0]];
  for (var i = 1; i < rows.length; i++) {
    var prev = cur[cur.length - 1];
    var threshold = Math.max(prev.h, rows[i].h) * 0.6;
    if (Math.abs(rows[i].y - prev.y) <= threshold) {
      cur.push(rows[i]);
    } else {
      lines.push(cur);
      cur = [rows[i]];
    }
  }
  lines.push(cur);

  // Sort items within each line by X
  lines.forEach(function(line) { line.sort(function(a, b) { return a.x - b.x; }); });

  // Compute median font height to detect headings
  var heights = rows.map(function(r) { return r.h; });
  var medH = median(heights);

  var output = [];
  var prevLineY = null;
  var prevLineH = medH;

  lines.forEach(function(line) {
    var lineText = '';
    var lineH = median(line.map(function(r) { return r.h; }));
    var lineY = line[0].y;

    // Join items, adding a space if there's a gap between them
    for (var i = 0; i < line.length; i++) {
      if (i === 0) {
        lineText = line[i].str;
      } else {
        var gap = line[i].x - (line[i - 1].x + line[i - 1].str.length * lineH * 0.5);
        lineText += (gap > lineH * 0.3 ? ' ' : '') + line[i].str;
      }
    }
    lineText = lineText.trim();
    if (!lineText) return;

    // Paragraph gap detection
    if (prevLineY !== null) {
      var gap = lineY - prevLineY;
      if (gap > prevLineH * 2.2) output.push('');
    }

    // Heading detection by relative font size
    var ratio = lineH / medH;
    if (ratio >= 1.8 && lineText.length < 120) {
      output.push('## ' + lineText);
    } else if (ratio >= 1.3 && lineText.length < 120) {
      output.push('### ' + lineText);
    } else {
      output.push(lineText);
    }

    prevLineY = lineY;
    prevLineH = lineH;
  });

  return output.join('\n');
}

async function convertToMarkdown() {
  if (!mdFile) return;
  var btn = document.getElementById('mdConvertBtn');
  btn.disabled = true;
  showMdStatus('Loading PDF.js…', 'info');
  setMdProgress(5);

  try {
    await loadPDFJS();
    showMdStatus('Extracting text…', 'info');
    setMdProgress(15);

    var arrayBuffer = await mdFile.arrayBuffer();
    var pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    var numPages = pdfDoc.numPages;
    var sections = [];

    for (var i = 1; i <= numPages; i++) {
      var page = await pdfDoc.getPage(i);
      var viewport = page.getViewport({ scale: 1 });
      var content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      var pageText = pageItemsToMarkdown(content.items, i, viewport.height);
      if (pageText.trim()) {
        if (numPages > 1) sections.push('---\n\n*Page ' + i + ' of ' + numPages + '*\n\n' + pageText);
        else sections.push(pageText);
      }
      setMdProgress(15 + Math.round((i / numPages) * 80));
    }

    setMdProgress(100);

    if (!sections.length) {
      showMdStatus('No text found. This PDF may contain only scanned images.', 'error');
      btn.disabled = false;
      return;
    }

    mdResultText = sections.join('\n\n');
    mdPreview.value = mdResultText;
    mdResultEl.classList.remove('u-hidden');
    showMdStatus('Extraction complete — ' + numPages + ' page' + (numPages !== 1 ? 's' : '') + ' processed.', 'success');
  } catch (err) {
    showMdStatus('Error: ' + (err.message || 'Could not extract text.'), 'error');
  }
  btn.disabled = false;
}

function downloadMarkdown() {
  if (!mdResultText) return;
  var baseName = mdFile ? mdFile.name.replace(/\.pdf$/i, '') : 'document';
  triggerDownload(new Blob([mdResultText], { type: 'text/markdown;charset=utf-8' }), baseName + '.md');
}

// ── Download tool (offline bundle) ──────────────────────────────────────────

async function downloadTool() {
  var btn = document.getElementById('downloadToolBtn');
  var origText = btn.textContent;
  btn.textContent = 'Bundling…';
  btn.disabled = true;

  try {
    // Fetch all local assets + CDN libraries in parallel
    var results = await Promise.all([
      fetch('./style.css').then(function(r) { return r.text(); }),
      fetch('./script.js').then(function(r) { return r.text(); }),
      fetch('./pdf-lib.min.js').then(function(r) { return r.text(); }),
      fetch(JSZIP_URL).then(function(r) { return r.text(); }),
      fetch(PDFJS_URL).then(function(r) { return r.text(); }),
      fetch(PDFJS_WORKER_URL).then(function(r) { return r.text(); }),
      fetch('./index.html').then(function(r) { return r.text(); })
    ]);

    var css = results[0];
    var js = results[1];
    var pdflib = results[2];
    var jszip = results[3];
    var pdfjs = results[4];
    var pdfjsWorker = results[5];
    var html = results[6];

    // Inline CSS
    html = html.replace(
      '<link rel="stylesheet" href="./style.css">',
      '<style>' + css + '</style>'
    );

    // Inline pdf-lib (replace the external script tag)
    html = html.replace(
      '<script src="pdf-lib.min.js"></script>',
      '<script>' + escForScriptTag(pdflib) + '</script>'
    );

    // Replace script.js with the full offline bundle (all libs + main script)
    var workerBlob = '(function(){var w=' + JSON.stringify(pdfjsWorker) +
      ';window._pdfjsWorkerBlob=URL.createObjectURL(new Blob([w],{type:"application/javascript"}));})();';

    var pdfjsSetup = escForScriptTag(pdfjs) + '\n' +
      'if(window.pdfjsLib&&window._pdfjsWorkerBlob)pdfjsLib.GlobalWorkerOptions.workerSrc=window._pdfjsWorkerBlob;';

    var inlinedScripts = [
      '<script>' + escForScriptTag(jszip) + '</script>',
      '<script>' + workerBlob + '</script>',
      '<script>' + pdfjsSetup + '</script>',
      '<script>window.OFFLINE_BUNDLE=true;\n' + escForScriptTag(js) + '</script>'
    ].join('\n');

    html = html.replace('<script src="./script.js"></script>', inlinedScripts);

    // Remove the offline download card (not needed in the bundle)
    html = html.replace(/[ \t]*<!-- offline-card-start -->[\s\S]*?<!-- offline-card-end -->\n?/g, '');

    // Remove the Google Fonts preconnect/link (fails silently offline; use system fonts)
    html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n?/g, '');
    html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com[^"]*" rel="stylesheet">\n?/g, '');

    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    triggerDownload(blob, 'pdf-tools.html');
  } catch (err) {
    alert('Could not create bundle: ' + (err.message || 'network error. Check your connection and try again.'));
  }

  btn.textContent = origText;
  btn.disabled = false;
}
