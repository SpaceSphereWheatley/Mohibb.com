document.getElementById('year').textContent = new Date().getFullYear();

let files = [];
let dragSrcIdx = null;

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const mergeBtn = document.getElementById('mergeBtn');
const status = document.getElementById('status');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const emptyHint = document.getElementById('emptyHint');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  addFiles([...e.dataTransfer.files]);
});
fileInput.addEventListener('change', () => addFiles([...fileInput.files]));

function addFiles(incoming) {
  const pdfs = incoming.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  if (pdfs.length < incoming.length) showStatus('Some files were skipped — only PDFs accepted.', 'info');
  files = [...files, ...pdfs];
  renderList();
  fileInput.value = '';
}

function renderList() {
  fileList.innerHTML = '';
  mergeBtn.disabled = files.length < 2;
  emptyHint.style.display = files.length === 0 ? 'block' : 'none';
  files.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.draggable = true;
    item.dataset.idx = i;
    item.innerHTML = `
      <div class="drag-handle" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="order-num">${i + 1}</div>
      <div class="file-icon">PDF</div>
      <div class="file-info">
        <div class="file-name" title="${f.name}">${f.name}</div>
        <div class="file-size">${formatSize(f.size)}</div>
      </div>
      <button class="remove-btn" onclick="removeFile(${i})" title="Remove">&#10005;</button>
    `;
    item.addEventListener('dragstart', () => { dragSrcIdx = i; setTimeout(() => item.classList.add('dragging'), 0); });
    item.addEventListener('dragend', () => { item.classList.remove('dragging'); clearDragTargets(); });
    item.addEventListener('dragover', e => { e.preventDefault(); clearDragTargets(); item.classList.add('drag-target'); });
    item.addEventListener('drop', e => { e.preventDefault(); if (dragSrcIdx !== null && dragSrcIdx !== i) reorder(dragSrcIdx, i); });
    fileList.appendChild(item);
  });
}

function clearDragTargets() {
  document.querySelectorAll('.drag-target').forEach(el => el.classList.remove('drag-target'));
}

function reorder(from, to) {
  const item = files.splice(from, 1)[0];
  files.splice(to, 0, item);
  dragSrcIdx = null;
  renderList();
}

function removeFile(i) {
  files.splice(i, 1);
  renderList();
  hideStatus();
}

function clearAll() {
  files = [];
  renderList();
  hideStatus();
  progressBar.classList.remove('visible');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function showStatus(msg, type) { status.textContent = msg; status.className = 'status ' + type; }
function hideStatus() { status.className = 'status'; }
function setProgress(pct) { progressBar.classList.add('visible'); progressFill.style.width = pct + '%'; }

async function mergePDFs() {
  if (files.length < 2) return;
  mergeBtn.disabled = true;
  showStatus('Merging…', 'info');
  setProgress(10);

  try {
    const { PDFDocument } = PDFLib;
    const merged = await PDFDocument.create();

    for (let i = 0; i < files.length; i++) {
      const arrayBuffer = await files[i].arrayBuffer();
      setProgress(10 + Math.round((i / files.length) * 70));
      const doc = await PDFDocument.load(arrayBuffer);
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }

    setProgress(90);
    const bytes = await merged.save();
    setProgress(100);

    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'merged.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    const totalPages = (await PDFDocument.load(bytes)).getPageCount();
    showStatus(`Done — ${totalPages} pages, saved as merged.pdf`, 'success');
  } catch (err) {
    showStatus('Error: ' + (err.message || 'Could not merge. Make sure the PDFs are not password-protected.'), 'error');
  }

  mergeBtn.disabled = files.length < 2;
}
