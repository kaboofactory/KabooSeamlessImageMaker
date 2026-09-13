(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const fileInput = $('#fileInput');
  const loadButton = $('#loadButton');
  const dropZone = $('#dropZone');
  const fileInfo = $('#fileInfo');
  const algorithmSelect = $('#algorithmSelect');
  const algorithmHelp = $('#algorithmHelp');
  const curveSelect = $('#curveSelect');
  const curveRow = $('#curveRow');
  const borderSection = $('#borderSection');
  const borderNumber = $('#borderNumber');
  const borderUnit = $('#borderUnit');
  const borderRange = $('#borderRange');
  const borderHint = $('#borderHint');
  const downloadButton = $('#downloadButton');
  const status = $('#status');
  const resultInfo = $('#resultInfo');
  const emptyPreview = $('#emptyPreview');
  const sourceCanvas = $('#sourceCanvas');
  const resultCanvas = $('#resultCanvas');
  const beforePreview = $('#beforePreview');
  const afterPreview = $('#afterPreview');
  const splitCanvas = $('#splitCanvas');
  const splitRange = $('#splitRange');
  const splitLine = $('#splitLine');
  const tileCanvas = $('#tileCanvas');
  const processingOverlay = $('#processingOverlay');

  let sourceName = 'clipboard.png';
  let hasImage = false;
  let hasResult = false;
  let processing = false;
  let currentView = 'side';
  let autoTimer = null;

  const algorithmText = {
    offset: '<strong>写真向け。</strong>画像を選択方向へ50%ラップ移動し、元の端が中央へ来たところだけをフェザー修復します。出力サイズは維持されます。',
    edge: '<strong>中心を完全保持。</strong>指定した幅の左右端／上下端だけを、反対側の画素と対称にブレンドします。',
    tone: '<strong>照明ムラ向け。</strong>反対側同士の平均色差を全体へ緩やかに分散してから、端をフェザーブレンドします。',
    mirror: '<strong>境界一致を保証。</strong>反転コピーを連結します。選択した方向の出力サイズは2倍。対称模様が見えやすいため写真では注意。'
  };

  class PanZoomViewport {
    constructor(root) {
      this.root = root;
      this.stage = root.querySelector('.panzoom-stage');
      this.toolbar = root.querySelector('.pz-toolbar');
      this.contentW = 1;
      this.contentH = 1;
      this.zoom = 1;
      this.fitZoom = 1;
      this.minZoom = 0.05;
      this.maxZoom = 12;
      this.panX = 0;
      this.panY = 0;
      this.pointers = new Map();
      this.isDragging = false;
      this.lastPointer = null;
      this.lastPinchDistance = null;
      this.bind();
    }

    bind() {
      this.root.addEventListener('wheel', (e) => {
        if (this.contentW <= 1 || this.contentH <= 1) return;
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0015);
        this.zoomAt(factor, e.clientX, e.clientY);
      }, { passive: false });

      this.root.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.pz-toolbar')) return;
        if (!this.isPrimaryPointerButton(e)) return;
        this.root.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (this.pointers.size === 1) {
          this.isDragging = true;
          this.lastPointer = { x: e.clientX, y: e.clientY };
          this.root.classList.add('is-dragging');
        } else if (this.pointers.size === 2) {
          this.isDragging = false;
          this.root.classList.remove('is-dragging');
          this.lastPinchDistance = this.getPinchDistance();
        }
      });

      this.root.addEventListener('pointermove', (e) => {
        if (!this.pointers.has(e.pointerId)) return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (this.pointers.size >= 2) {
          const distance = this.getPinchDistance();
          const center = this.getPinchCenter();
          if (this.lastPinchDistance && distance > 0) {
            const factor = distance / this.lastPinchDistance;
            this.zoomAt(factor, center.x, center.y);
          }
          this.lastPinchDistance = distance;
          this.lastPointer = center;
          return;
        }

        if (!this.isDragging || !this.lastPointer) return;
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        this.panX += dx;
        this.panY += dy;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.applyTransform();
      });

      const finishPointer = (e) => {
        this.pointers.delete(e.pointerId);
        if (this.pointers.size >= 2) {
          this.lastPinchDistance = this.getPinchDistance();
          this.lastPointer = this.getPinchCenter();
          return;
        }
        if (this.pointers.size === 1) {
          const only = [...this.pointers.values()][0];
          this.isDragging = true;
          this.lastPointer = { x: only.x, y: only.y };
          this.lastPinchDistance = null;
          this.root.classList.add('is-dragging');
          return;
        }
        this.isDragging = false;
        this.lastPointer = null;
        this.lastPinchDistance = null;
        this.root.classList.remove('is-dragging');
      };

      this.root.addEventListener('pointerup', finishPointer);
      this.root.addEventListener('pointercancel', finishPointer);
      this.root.addEventListener('pointerleave', (e) => {
        if (e.pointerType !== 'mouse') return;
        finishPointer(e);
      });

      this.root.addEventListener('dblclick', () => this.reset());

      if (this.toolbar) {
        this.toolbar.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
        });
        this.toolbar.addEventListener('dblclick', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        this.toolbar.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-action]');
          if (!btn) return;
          const rect = this.root.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const action = btn.dataset.action;
          if (action === 'zoomin') this.zoomAt(1.25, cx, cy);
          if (action === 'zoomout') this.zoomAt(0.8, cx, cy);
          if (action === 'reset') this.reset();
        });
      }
    }

    isPrimaryPointerButton(e) {
      return e.pointerType === 'touch' || e.button === 0;
    }

    getPinchDistance() {
      const pts = [...this.pointers.values()];
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }

    getPinchCenter() {
      const pts = [...this.pointers.values()];
      if (!pts.length) return { x: 0, y: 0 };
      if (pts.length === 1) return pts[0];
      return {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2
      };
    }

    setContentSize(w, h, preserve = false) {
      const nextW = Math.max(1, w || 1);
      const nextH = Math.max(1, h || 1);
      const sameSize = nextW === this.contentW && nextH === this.contentH;
      this.contentW = nextW;
      this.contentH = nextH;
      this.stage.style.width = `${this.contentW}px`;
      this.stage.style.height = `${this.contentH}px`;
      this.updateFitZoom();
      if (preserve && sameSize) {
        if (this.zoom < this.minZoom) this.zoom = this.minZoom;
        this.applyTransform();
      } else {
        this.reset();
      }
    }

    updateFitZoom() {
      const { w, h } = this.getViewportSize();
      const zoomX = w / this.contentW;
      const zoomY = h / this.contentH;
      const fit = Math.min(zoomX, zoomY);
      this.fitZoom = Number.isFinite(fit) && fit > 0 ? fit : 1;
      this.minZoom = this.fitZoom;
      this.maxZoom = Math.max(this.fitZoom * 24, this.fitZoom + 8, 12);
    }

    getViewportSize() {
      return {
        w: Math.max(1, this.root.clientWidth),
        h: Math.max(1, this.root.clientHeight)
      };
    }

    getBaseOffset() {
      const { w, h } = this.getViewportSize();
      return {
        left: (w - this.contentW) / 2,
        top: (h - this.contentH) / 2
      };
    }

    clampPan() {
      const { w: viewportW, h: viewportH } = this.getViewportSize();
      const { left: baseLeft, top: baseTop } = this.getBaseOffset();
      const scaledW = this.contentW * this.zoom;
      const scaledH = this.contentH * this.zoom;

      if (scaledW <= viewportW) {
        this.panX = (viewportW - scaledW) / 2 - baseLeft;
      } else {
        const minX = viewportW - scaledW - baseLeft;
        const maxX = -baseLeft;
        this.panX = Math.min(maxX, Math.max(minX, this.panX));
      }

      if (scaledH <= viewportH) {
        this.panY = (viewportH - scaledH) / 2 - baseTop;
      } else {
        const minY = viewportH - scaledH - baseTop;
        const maxY = -baseTop;
        this.panY = Math.min(maxY, Math.max(minY, this.panY));
      }
    }

    applyTransform() {
      if (!this.stage) return;
      this.updateFitZoom();
      if (this.zoom < this.minZoom) this.zoom = this.minZoom;
      this.clampPan();
      const { left, top } = this.getBaseOffset();
      this.stage.style.transform = `translate(${left + this.panX}px, ${top + this.panY}px) scale(${this.zoom})`;
    }

    screenToContent(clientX, clientY) {
      const rect = this.root.getBoundingClientRect();
      const { left, top } = this.getBaseOffset();
      return {
        x: (clientX - rect.left - (left + this.panX)) / this.zoom,
        y: (clientY - rect.top - (top + this.panY)) / this.zoom
      };
    }

    zoomAt(factor, clientX, clientY) {
      this.updateFitZoom();
      const oldZoom = this.zoom;
      const point = this.screenToContent(clientX, clientY);
      this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, oldZoom * factor));
      const rect = this.root.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const { left, top } = this.getBaseOffset();
      this.panX = localX - left - point.x * this.zoom;
      this.panY = localY - top - point.y * this.zoom;
      this.applyTransform();
    }

    reset() {
      this.updateFitZoom();
      this.zoom = this.fitZoom;
      this.panX = 0;
      this.panY = 0;
      this.applyTransform();
    }
  }

  const panZoom = {
    before: new PanZoomViewport($('#beforeViewport')),
    after: new PanZoomViewport($('#afterViewport')),
    split: new PanZoomViewport($('#splitViewport')),
    tile: new PanZoomViewport($('#tileViewport'))
  };


  function setProcessingOverlay(visible) {
    if (!processingOverlay) return;
    processingOverlay.classList.toggle('hidden', !visible);
    processingOverlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function setStatus(text, kind = '') {
    status.textContent = text;
    status.style.color = kind === 'ok' ? 'var(--ok)' : kind === 'warn' ? 'var(--warn)' : 'var(--muted)';
  }

  function getDirection() {
    return $('input[name="direction"]:checked').value;
  }

  function updateAlgorithmUI() {
    const alg = algorithmSelect.value;
    algorithmHelp.innerHTML = algorithmText[alg];
    const isMirror = alg === 'mirror';
    borderSection.classList.toggle('disabled-section', isMirror);
    borderNumber.disabled = isMirror;
    borderUnit.disabled = isMirror;
    borderRange.disabled = isMirror;
    curveSelect.disabled = isMirror;
    curveRow.style.opacity = isMirror ? '.45' : '1';
    scheduleProcess();
  }

  function maxBorderPx() {
    if (!hasImage) return 512;
    const dir = getDirection();
    if (dir === 'horizontal') return Math.max(1, Math.floor(sourceCanvas.width / 2) - 1);
    if (dir === 'vertical') return Math.max(1, Math.floor(sourceCanvas.height / 2) - 1);
    return Math.max(1, Math.min(Math.floor(sourceCanvas.width / 2) - 1, Math.floor(sourceCanvas.height / 2) - 1));
  }

  function updateBorderControls(from) {
    const unit = borderUnit.value;
    if (unit === 'percent') {
      borderRange.min = '0.5'; borderRange.max = '49'; borderRange.step = '0.5';
      borderNumber.min = '0.5'; borderNumber.max = '49'; borderNumber.step = '0.5';
      if (from === 'unit') borderNumber.value = '12';
      const v = Math.min(49, Math.max(0.5, Number(borderNumber.value) || 12));
      borderNumber.value = String(v);
      borderRange.value = String(v);
      borderHint.textContent = '横は画像幅、縦は画像高に対する割合です。';
    } else {
      const max = maxBorderPx();
      borderRange.min = '1'; borderRange.max = String(max); borderRange.step = '1';
      borderNumber.min = '1'; borderNumber.max = String(max); borderNumber.step = '1';
      if (from === 'unit') {
        const base = hasImage ? Math.round(Math.min(sourceCanvas.width, sourceCanvas.height) * 0.12) : 64;
        borderNumber.value = String(Math.min(max, Math.max(1, base)));
      }
      const v = Math.min(max, Math.max(1, Math.round(Number(borderNumber.value) || 1)));
      borderNumber.value = String(v);
      borderRange.value = String(v);
      borderHint.textContent = `各辺から ${v}px をブレンド帯として使用します。最大 ${max}px。`;
    }
    scheduleProcess();
  }

  function borderPixels() {
    const unit = borderUnit.value;
    const v = Number(borderNumber.value) || 1;
    if (unit === 'percent') {
      return {
        x: Math.max(1, Math.round(sourceCanvas.width * v / 100)),
        y: Math.max(1, Math.round(sourceCanvas.height * v / 100))
      };
    }
    return { x: Math.max(1, Math.round(v)), y: Math.max(1, Math.round(v)) };
  }

  async function loadBlob(blob, name = 'clipboard.png') {
    if (!blob || !blob.type.startsWith('image/')) {
      setStatus('画像データとして読み込めませんでした。', 'warn');
      return;
    }

    setStatus('画像を読み込み中…');
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        sourceCanvas.width = img.naturalWidth;
        sourceCanvas.height = img.naturalHeight;
        const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
        ctx.drawImage(img, 0, 0);
        sourceName = name || 'image.png';
        hasImage = true;
        hasResult = false;
        downloadButton.disabled = true;
        fileInfo.textContent = `${sourceName} — ${img.naturalWidth} × ${img.naturalHeight}px`;
        emptyPreview.classList.add('hidden');
        updateBorderControls('load');
        switchView(currentView);
        processImage();
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus('画像のデコードに失敗しました。', 'warn');
    };
    img.src = url;
  }

  function scheduleProcess() {
    if (!hasImage || processing) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(processImage, 140);
  }

  async function processImage() {
    if (!hasImage || processing) return;
    processing = true;
    downloadButton.disabled = true;
    setStatus('変換中…');
    setProcessingOverlay(true);

    // 2フレーム待つことで、重い同期処理へ入る前に
    // 「変換中...」オーバーレイを確実に1度ブラウザへ描画させる。
    await new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    const overlayShownAt = performance.now();

    try {
      const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
      const imageData = srcCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
      const bp = borderPixels();
      const result = SeamlessCore.process({
        data: imageData.data,
        width: imageData.width,
        height: imageData.height
      }, {
        axis: getDirection(),
        algorithm: algorithmSelect.value,
        curve: curveSelect.value,
        borderX: bp.x,
        borderY: bp.y
      });

      resultCanvas.width = result.width;
      resultCanvas.height = result.height;
      const outCtx = resultCanvas.getContext('2d', { willReadFrequently: true });
      outCtx.putImageData(new ImageData(result.data, result.width, result.height), 0, 0);

      hasResult = true;
      renderAllPreviews();
      const dirLabel = { horizontal: '横のみ', vertical: '縦のみ', both: '縦横' }[getDirection()];
      resultInfo.textContent = `${result.width} × ${result.height}px / ${dirLabel}`;
      downloadButton.disabled = false;
      setStatus('変換完了。ホイール・ドラッグ・ピンチで拡大確認できます。', 'ok');
    } catch (err) {
      console.error(err);
      setStatus(`変換に失敗しました: ${err.message || err}`, 'warn');
    } finally {
      // 非常に軽い画像でも一瞬で消えて見えないことがないよう、
      // 最低120msは表示を維持する。
      const elapsed = performance.now() - overlayShownAt;
      if (elapsed < 120) {
        await new Promise(resolve => setTimeout(resolve, 120 - elapsed));
      }
      processing = false;
      setProcessingOverlay(false);
    }
  }

  function previewScale(w, h, maxDim = 1800) {
    return Math.min(1, maxDim / Math.max(w, h));
  }

  function drawPreview(source, dest) {
    const s = previewScale(source.width, source.height, 1800);
    dest.width = Math.max(1, Math.round(source.width * s));
    dest.height = Math.max(1, Math.round(source.height * s));
    const ctx = dest.getContext('2d');
    ctx.clearRect(0, 0, dest.width, dest.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, dest.width, dest.height);
  }

  function renderSplit() {
    if (!hasResult) return;
    const maxDim = 1800;
    const sourceScale = previewScale(sourceCanvas.width, sourceCanvas.height, maxDim);
    const w = Math.max(1, Math.round(sourceCanvas.width * sourceScale));
    const h = Math.max(1, Math.round(sourceCanvas.height * sourceScale));
    splitCanvas.width = w;
    splitCanvas.height = h;
    const ctx = splitCanvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(resultCanvas, 0, 0, w, h);
    const pct = Number(splitRange.value) / 100;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, Math.round(w * pct), h);
    ctx.clip();
    ctx.drawImage(sourceCanvas, 0, 0, w, h);
    ctx.restore();
    splitLine.style.left = `${pct * 100}%`;
    panZoom.split.setContentSize(w, h, true);
  }

  function renderTile() {
    if (!hasResult) return;
    const tileMax = 1024;
    const scale = Math.min(tileMax / resultCanvas.width, tileMax / resultCanvas.height, 1);
    const tw = Math.max(1, Math.round(resultCanvas.width * scale));
    const th = Math.max(1, Math.round(resultCanvas.height * scale));
    tileCanvas.width = tw * 3;
    tileCanvas.height = th * 3;
    const ctx = tileCanvas.getContext('2d');
    ctx.clearRect(0, 0, tileCanvas.width, tileCanvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        ctx.drawImage(resultCanvas, x * tw, y * th, tw, th);
      }
    }
    panZoom.tile.setContentSize(tileCanvas.width, tileCanvas.height, true);
  }

  function renderAllPreviews() {
    if (!hasResult) return;
    drawPreview(sourceCanvas, beforePreview);
    drawPreview(resultCanvas, afterPreview);
    panZoom.before.setContentSize(beforePreview.width, beforePreview.height);
    panZoom.after.setContentSize(afterPreview.width, afterPreview.height);
    renderSplit();
    renderTile();
  }

  function switchView(view) {
    currentView = view;
    $$('.view-tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $('#sideView').classList.toggle('hidden', view !== 'side' || !hasImage);
    $('#splitView').classList.toggle('hidden', view !== 'split' || !hasImage);
    $('#tileView').classList.toggle('hidden', view !== 'tile' || !hasImage);
    if (view === 'side' && hasResult) {
      panZoom.before.applyTransform();
      panZoom.after.applyTransform();
    }
    if (view === 'split' && hasResult) renderSplit();
    if (view === 'tile' && hasResult) renderTile();
  }

  function downloadResult() {
    if (!hasResult) return;
    const stem = sourceName.replace(/\.[^.]+$/, '') || 'image';
    const alg = algorithmSelect.value;
    const filename = `${stem}_seamless_${alg}.png`;
    resultCanvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  }

  loadButton.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  dropZone.addEventListener('click', (e) => { if (e.target !== loadButton) fileInput.click(); });
  dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadBlob(fileInput.files[0], fileInput.files[0].name); });

  ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('dragover');
  }));
  dropZone.addEventListener('drop', (e) => {
    const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
    if (file) loadBlob(file, file.name);
    else setStatus('ドロップされた中に画像がありません。', 'warn');
  });

  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (!item) return;
    const blob = item.getAsFile();
    if (!blob) return;
    e.preventDefault();
    loadBlob(blob, 'clipboard.png');
  });

  algorithmSelect.addEventListener('change', updateAlgorithmUI);
  curveSelect.addEventListener('change', scheduleProcess);
  $$('input[name="direction"]').forEach(r => r.addEventListener('change', () => { updateBorderControls('direction'); scheduleProcess(); }));
  borderUnit.addEventListener('change', () => updateBorderControls('unit'));
  borderRange.addEventListener('input', () => {
    borderNumber.value = borderRange.value;
    if (borderUnit.value === 'px') borderHint.textContent = `各辺から ${borderRange.value}px をブレンド帯として使用します。最大 ${maxBorderPx()}px。`;
  });
  borderRange.addEventListener('change', scheduleProcess);
  borderNumber.addEventListener('input', () => {
    const min = Number(borderRange.min), max = Number(borderRange.max);
    const v = Math.min(max, Math.max(min, Number(borderNumber.value) || min));
    borderRange.value = String(v);
  });
  borderNumber.addEventListener('change', () => { updateBorderControls('number'); scheduleProcess(); });

  downloadButton.addEventListener('click', downloadResult);
  $$('.view-tab').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  splitRange.addEventListener('input', renderSplit);
  window.addEventListener('resize', () => {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      Object.values(panZoom).forEach(view => view.applyTransform());
    }, 60);
  });

  updateAlgorithmUI();
  updateBorderControls('init');
})();
