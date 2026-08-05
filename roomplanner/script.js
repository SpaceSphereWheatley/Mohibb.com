(function(){
  "use strict";
  const BASE_SCALE = 80; // px per meter at 100% zoom
  const ZOOM_MIN = 0.3, ZOOM_MAX = 4;
  const MARGIN = 60; // px reserved around the room for dimension labels — shared by render() and rotate math
  let zoom = 1;
  let SCALE = BASE_SCALE; // px per meter, recalculated whenever zoom changes

  let state = {
    room: { w: 5, h: 4, floorColor: "#e8e4da", floorLabel: "Room" },
    items: [],
    windows: [],
    selectedItemId: null,
    nextId: 1
  };

  const canvasWrap = document.getElementById("canvasWrap");

  // ---------- Local persistence (single slot, automatic) ----------
  const STORAGE_KEY = "roomPlannerState_v1";
  let persistTimer = null;

  function storageAvailable(){
    try{
      const t = "__rp_test__";
      localStorage.setItem(t, t);
      localStorage.removeItem(t);
      return true;
    }catch(err){ return false; }
  }
  const STORAGE_OK = storageAvailable();

  function showSaveStatus(msg){
    const el = document.getElementById("saveStatus");
    if(el) el.textContent = msg;
  }

  function persistNow(){
    if(!STORAGE_OK){
      showSaveStatus("Storage isn't available in this browser. Your room won't be saved between visits.");
      return;
    }
    try{
      const data = { room: state.room, items: state.items, windows: state.windows, nextId: state.nextId };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      const t = new Date();
      showSaveStatus("Saved locally at " + t.toLocaleTimeString());
    }catch(err){
      showSaveStatus("Couldn't save (storage may be full or blocked).");
    }
  }

  function persistDebounced(){
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 300);
  }

  function loadSaved(){
    if(!STORAGE_OK) return false;
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return false;
      const data = JSON.parse(raw);
      if(data && data.room){
        state.room = Object.assign({ w:5, h:4, floorColor:"#e8e4da", floorLabel:"Room" }, data.room);
        state.items = Array.isArray(data.items) ? data.items : [];
        state.windows = Array.isArray(data.windows) ? data.windows : [];
        state.nextId = typeof data.nextId === "number" ? data.nextId : 1;
        return true;
      }
    }catch(err){ /* fall back to defaults */ }
    return false;
  }

  function bindClearSaved(){
    document.getElementById("clearSavedBtn").addEventListener("click", () => {
      if(!confirm("Clear the saved room? This can't be undone.")) return;
      try{ localStorage.removeItem(STORAGE_KEY); }catch(err){}
      state = {
        room: { w:5, h:4, floorColor:"#e8e4da", floorLabel:"Room" },
        items: [], windows: [], selectedItemId: null, nextId: 1
      };
      loadRoomInputs();
      renderItemEditor();
      render();
      showSaveStatus(STORAGE_OK ? "Cleared." : "Storage isn't available in this browser.");
    });
  }

  function setZoom(z, anchorClientX, anchorClientY){
    const oldScale = SCALE;
    z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    zoom = z;
    SCALE = BASE_SCALE * zoom;
    // keep the point under the pinch/cursor roughly stationary while zooming
    if(anchorClientX != null && oldScale > 0){
      const wrapRect = canvasWrap.getBoundingClientRect();
      const ratio = SCALE / oldScale;
      const beforeX = canvasWrap.scrollLeft + (anchorClientX - wrapRect.left);
      const beforeY = canvasWrap.scrollTop + (anchorClientY - wrapRect.top);
      render();
      canvasWrap.scrollLeft = beforeX * ratio - (anchorClientX - wrapRect.left);
      canvasWrap.scrollTop = beforeY * ratio - (anchorClientY - wrapRect.top);
    } else {
      render();
    }
    updateZoomLabel();
  }

  function updateZoomLabel(){
    const lbl = document.getElementById("zoomLabel");
    if(lbl) lbl.textContent = Math.round(zoom * 100) + "%";
  }

  document.getElementById("zoomInBtn").addEventListener("click", () => setZoom(zoom * 1.2));
  document.getElementById("zoomOutBtn").addEventListener("click", () => setZoom(zoom / 1.2));
  document.getElementById("zoomResetBtn").addEventListener("click", () => setZoom(1));

  // Wheel zoom (desktop) — scoped to the canvas area only
  canvasWrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setZoom(zoom * factor, e.clientX, e.clientY);
  }, { passive: false });

  // Pinch zoom (touch) — scoped to the canvas area only, using capture phase
  // so it still sees both touches even if an item's own drag handler stops propagation.
  const activePointers = new Map();
  let pinchStartDist = null;
  let pinchStartZoom = 1;

  function pointerDist(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }

  canvasWrap.addEventListener("pointerdown", (e) => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if(activePointers.size === 2){
      const pts = Array.from(activePointers.values());
      pinchStartDist = pointerDist(pts[0], pts[1]);
      pinchStartZoom = zoom;
    }
  }, { capture: true });

  canvasWrap.addEventListener("pointermove", (e) => {
    if(!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if(activePointers.size === 2 && pinchStartDist){
      e.preventDefault();
      const pts = Array.from(activePointers.values());
      const d = pointerDist(pts[0], pts[1]);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      setZoom(pinchStartZoom * (d / pinchStartDist), mid.x, mid.y);
    }
  }, { capture: true });

  function releasePointer(e){
    activePointers.delete(e.pointerId);
    if(activePointers.size < 2){ pinchStartDist = null; }
  }
  canvasWrap.addEventListener("pointerup", releasePointer, { capture: true });
  canvasWrap.addEventListener("pointercancel", releasePointer, { capture: true });

  const svg = document.getElementById("canvas");
  const SVGNS = "http://www.w3.org/2000/svg";

  function el(tag, attrs){
    const e = document.createElementNS(SVGNS, tag);
    for(const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function newId(){ return state.nextId++; }

  // ---------- Room ----------
  function loadRoomInputs(){
    document.getElementById("roomW").value = state.room.w;
    document.getElementById("roomH").value = state.room.h;
    document.getElementById("roomLabel").value = state.room.floorLabel;
    document.getElementById("roomColor").value = state.room.floorColor;
  }

  // Keep an item's (rotated) bounding box fully inside the walls — items collide with
  // walls instead of being draggable/resizable/rotatable out of the room.
  function clampItemToRoom(item){
    const rad = item.rot * Math.PI / 180;
    const halfW = Math.abs(item.w/2 * Math.cos(rad)) + Math.abs(item.h/2 * Math.sin(rad));
    const halfH = Math.abs(item.w/2 * Math.sin(rad)) + Math.abs(item.h/2 * Math.cos(rad));
    const minX = halfW, maxX = state.room.w - halfW;
    const minY = halfH, maxY = state.room.h - halfH;
    item.x = minX > maxX ? state.room.w / 2 : Math.min(maxX, Math.max(minX, item.x));
    item.y = minY > maxY ? state.room.h / 2 : Math.min(maxY, Math.max(minY, item.y));
  }

  // Drop/clamp windows that no longer fit once the room has been resized smaller.
  function reconcileWindowsToRoom(){
    state.windows = state.windows.reduce((keep, w) => {
      const wallLen = (w.wall === "top" || w.wall === "bottom") ? state.room.w : state.room.h;
      if(w.width > wallLen){ return keep; } // window itself no longer fits at all
      if(w.offset + w.width > wallLen){ w.offset = Math.max(0, wallLen - w.width); }
      keep.push(w);
      return keep;
    }, []);
  }

  document.getElementById("applyRoom").addEventListener("click", () => {
    const w = parseFloat(document.getElementById("roomW").value);
    const h = parseFloat(document.getElementById("roomH").value);
    if(!(w > 0) || !(h > 0)){ alert("Room width and depth must be positive numbers."); return; }
    state.room.w = w;
    state.room.h = h;
    state.room.floorLabel = document.getElementById("roomLabel").value;
    state.room.floorColor = document.getElementById("roomColor").value;
    reconcileWindowsToRoom();
    state.items.forEach(clampItemToRoom);
    renderItemEditor();
    render();
    persistNow();
  });

  // ---------- Items ----------
  function addItem(){
    const id = newId();
    state.items.push({
      id, x: state.room.w/2, y: state.room.h/2,
      w: 1, h: 0.6, rot: 0,
      color: "#c9b79c", label: "Item " + id
    });
    clampItemToRoom(getItem(id));
    selectItem(id);
    render();
    persistNow();
  }
  document.getElementById("addItemBtn").addEventListener("click", addItem);

  function selectItem(id){
    state.selectedItemId = id;
    renderItemEditor();
    render();
    // on mobile the sidebar scrolls independently and is short (~45vh) —
    // bring the editor into view so picking an item doesn't leave the form off-screen
    const editor = document.getElementById("itemEditor");
    if(editor && !editor.hidden && window.matchMedia("(max-width: 800px)").matches){
      editor.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function deleteItem(id){
    state.items = state.items.filter(i => i.id !== id);
    if(state.selectedItemId === id) state.selectedItemId = null;
    renderItemEditor();
    render();
    persistNow();
  }

  function getItem(id){ return state.items.find(i => i.id === id); }

  function renderItemList(){
    const list = document.getElementById("itemList");
    list.innerHTML = "";
    if(state.items.length === 0){
      const p = document.createElement("div");
      p.className = "hint";
      p.textContent = "No items yet.";
      list.appendChild(p);
      return;
    }
    state.items.forEach(item => {
      const row = document.createElement("div");
      row.className = "list-item" + (item.id === state.selectedItemId ? " active" : "");
      row.innerHTML = `<span><span class="swatch" style="background:${item.color}"></span><span class="name">${escapeHtml(item.label)}</span></span>`;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "del";
      del.textContent = "✕";
      del.title = "Delete";
      del.setAttribute("aria-label", "Delete " + item.label);
      del.addEventListener("click", (e) => { e.stopPropagation(); deleteItem(item.id); });
      row.appendChild(del);
      row.addEventListener("click", () => selectItem(item.id));
      list.appendChild(row);
    });
  }

  function renderItemEditor(){
    const editor = document.getElementById("itemEditor");
    const item = getItem(state.selectedItemId);
    if(!item){ editor.hidden = true; return; }
    editor.hidden = false;
    document.getElementById("edLabel").value = item.label;
    document.getElementById("edW").value = item.w;
    document.getElementById("edH").value = item.h;
    document.getElementById("edX").value = round2(item.x);
    document.getElementById("edY").value = round2(item.y);
    document.getElementById("edRot").value = Math.round(item.rot);
    document.getElementById("edColor").value = item.color;
  }

  function bindEditorField(fieldId, prop, isNumber){
    const field = document.getElementById(fieldId);
    field.addEventListener("input", (e) => {
      const item = getItem(state.selectedItemId);
      if(!item) return;
      if(isNumber){
        const v = parseFloat(e.target.value);
        item[prop] = isNaN(v) ? 0 : v;
      } else {
        item[prop] = e.target.value;
      }
      // Clamp the item silently (the canvas reflects the real, wall-collided position);
      // resyncing every field on every keystroke would fight the user mid-type (e.g. typing "-2.5").
      clampItemToRoom(item);
      render();
      renderItemList();
      persistDebounced();
    });
    // Once editing finishes, snap the displayed value to whatever actually stuck after clamping.
    if(isNumber){
      field.addEventListener("change", () => { renderItemEditor(); });
    }
  }
  bindEditorField("edLabel", "label", false);
  bindEditorField("edW", "w", true);
  bindEditorField("edH", "h", true);
  bindEditorField("edX", "x", true);
  bindEditorField("edY", "y", true);
  bindEditorField("edRot", "rot", true);
  bindEditorField("edColor", "color", false);

  document.getElementById("deleteItemBtn").addEventListener("click", () => {
    if(state.selectedItemId != null) deleteItem(state.selectedItemId);
  });

  // ---------- Windows ----------
  function addWindow(){
    const wall = document.getElementById("winWall").value;
    const offset = parseFloat(document.getElementById("winOffset").value);
    const width = parseFloat(document.getElementById("winWidth").value);
    if(!(width > 0) || isNaN(offset) || offset < 0){ alert("Enter a valid offset and width."); return; }
    const wallLen = (wall === "top" || wall === "bottom") ? state.room.w : state.room.h;
    if(offset + width > wallLen + 0.001){
      alert("Window doesn't fit on that wall (wall is " + wallLen.toFixed(2) + "m long).");
      return;
    }
    state.windows.push({ id: newId(), wall, offset, width });
    render();
    renderWindowList();
    persistNow();
  }
  document.getElementById("addWinBtn").addEventListener("click", addWindow);

  function deleteWindow(id){
    state.windows = state.windows.filter(w => w.id !== id);
    render();
    renderWindowList();
    persistNow();
  }

  function renderWindowList(){
    const list = document.getElementById("windowList");
    list.innerHTML = "";
    if(state.windows.length === 0){
      const p = document.createElement("div");
      p.className = "hint";
      p.textContent = "No windows yet.";
      list.appendChild(p);
      return;
    }
    state.windows.forEach(w => {
      const row = document.createElement("div");
      row.className = "list-item";
      row.innerHTML = `<span class="name">${capitalize(w.wall)} &middot; ${w.offset.toFixed(2)}m in &middot; ${w.width.toFixed(2)}m wide</span>`;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "del";
      del.textContent = "✕";
      del.title = "Delete";
      del.setAttribute("aria-label", "Delete window on " + w.wall + " wall");
      del.addEventListener("click", () => deleteWindow(w.id));
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  // ---------- Helpers ----------
  function round2(n){ return Math.round(n * 100) / 100; }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function capitalize(s){ return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------- Rendering ----------
  function render(){
    svg.innerHTML = "";
    const W = state.room.w * SCALE + MARGIN * 2;
    const H = state.room.h * SCALE + MARGIN * 2;
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    const roomG = el("g", { transform: `translate(${MARGIN},${MARGIN})` });
    svg.appendChild(roomG);

    // Floor
    const floor = el("rect", {
      x: 0, y: 0,
      width: state.room.w * SCALE,
      height: state.room.h * SCALE,
      fill: state.room.floorColor
    });
    roomG.appendChild(floor);

    // Floor label
    if(state.room.floorLabel){
      const lbl = el("text", {
        x: state.room.w * SCALE / 2,
        y: state.room.h * SCALE / 2,
        class: "floor-label"
      });
      lbl.textContent = state.room.floorLabel;
      roomG.appendChild(lbl);
    }

    // Dimension labels (outside room)
    const dimTop = el("text", { x: state.room.w*SCALE/2, y: -14, class: "dim-label", "text-anchor":"middle" });
    dimTop.textContent = state.room.w.toFixed(2) + " m";
    roomG.appendChild(dimTop);
    const dimLeft = el("text", { x: -10, y: state.room.h*SCALE/2, class: "dim-label", "text-anchor":"end", "dominant-baseline":"middle" });
    dimLeft.textContent = state.room.h.toFixed(2) + " m";
    roomG.appendChild(dimLeft);

    // Walls (drawn as a stroked rect, on top of floor edges)
    const wall = el("rect", {
      x: 0, y: 0,
      width: state.room.w * SCALE,
      height: state.room.h * SCALE,
      class: "wall"
    });
    roomG.appendChild(wall);

    // Windows drawn as breaks on the wall line
    state.windows.forEach(w => drawWindow(roomG, w));

    // Items
    state.items.forEach(item => drawItem(roomG, item));

    renderItemList();
    renderWindowList();
  }

  function drawWindow(roomG, w){
    const RW = state.room.w * SCALE;
    const RH = state.room.h * SCALE;
    const off = w.offset * SCALE;
    const len = w.width * SCALE;
    let x1,y1,x2,y2;
    if(w.wall === "top"){ x1=off; y1=0; x2=off+len; y2=0; }
    else if(w.wall === "bottom"){ x1=off; y1=RH; x2=off+len; y2=RH; }
    else if(w.wall === "left"){ x1=0; y1=off; x2=0; y2=off+len; }
    else { x1=RW; y1=off; x2=RW; y2=off+len; }

    const mark = el("line", { x1,y1,x2,y2, class:"window-mark" });
    roomG.appendChild(mark);
    const inner = el("line", { x1,y1,x2,y2, class:"window-inner" });
    roomG.appendChild(inner);

    // label, offset outward from the wall
    const midX = (x1+x2)/2, midY=(y1+y2)/2;
    let lx=midX, ly=midY, anchor="middle";
    const pad = 16;
    if(w.wall==="top"){ ly -= pad; anchor="middle"; }
    else if(w.wall==="bottom"){ ly += pad+4; anchor="middle"; }
    else if(w.wall==="left"){ lx -= pad; anchor="end"; }
    else { lx += pad; anchor="start"; }
    const label = el("text", { x:lx, y:ly, class:"window-label", "text-anchor":anchor, "dominant-baseline":"middle" });
    label.textContent = w.width.toFixed(2) + "m";
    roomG.appendChild(label);
  }

  function drawItem(roomG, item){
    const cx = item.x * SCALE, cy = item.y * SCALE;
    const w = item.w * SCALE, h = item.h * SCALE;
    const g = el("g", {
      class: "item-group" + (item.id === state.selectedItemId ? " item-selected" : ""),
      transform: `translate(${cx},${cy}) rotate(${item.rot})`,
      "data-id": item.id
    });

    const rect = el("rect", {
      class: "item-rect",
      x: -w/2, y: -h/2, width: w, height: h,
      fill: item.color
    });
    g.appendChild(rect);

    const label = el("text", { class:"item-label", x:0, y:0 });
    label.textContent = item.label;
    g.appendChild(label);

    rect.addEventListener("pointerdown", (e) => startItemDrag(e, item));
    label.addEventListener("pointerdown", (e) => startItemDrag(e, item));
    g.addEventListener("pointerdown", () => selectItem(item.id));

    roomG.appendChild(g);

    // Rotate handle, only for selected item
    if(item.id === state.selectedItemId){
      const handleDist = h/2 + 26;
      const rad = item.rot * Math.PI / 180;
      const localX = 0, localY = -handleDist;
      const hx = cx + (localX*Math.cos(rad) - localY*Math.sin(rad));
      const hy = cy + (localX*Math.sin(rad) + localY*Math.cos(rad));
      const stemX = cx + (0*Math.cos(rad) - (-h/2)*Math.sin(rad));
      const stemY = cy + (0*Math.sin(rad) + (-h/2)*Math.cos(rad));

      const stem = el("line", { x1:stemX, y1:stemY, x2:hx, y2:hy, class:"rotate-stem" });
      roomG.appendChild(stem);

      // larger invisible hit area for touch, plus the visible dot
      const handleHit = el("circle", { cx:hx, cy:hy, r:20, class:"rotate-handle-hit" });
      handleHit.addEventListener("pointerdown", (e) => startRotateDrag(e, item));
      roomG.appendChild(handleHit);

      const handle = el("circle", { cx:hx, cy:hy, r:7, class:"rotate-handle" });
      roomG.appendChild(handle);
    }
  }

  // ---------- Drag: move ----------
  function startItemDrag(e, item){
    if(!e.isPrimary) return; // ignore secondary touch points (pinch etc.)
    e.stopPropagation();
    e.preventDefault();
    selectItem(item.id);
    try{ svg.setPointerCapture(e.pointerId); }catch(err){}
    const startClientX = e.clientX, startClientY = e.clientY;
    const startX = item.x, startY = item.y;

    function onMove(ev){
      if(ev.pointerId !== e.pointerId) return;
      const dx = (ev.clientX - startClientX) / SCALE;
      const dy = (ev.clientY - startClientY) / SCALE;
      item.x = startX + dx;
      item.y = startY + dy;
      clampItemToRoom(item); // slide along the wall instead of dragging out of the room
      render();
    }
    function onUp(ev){
      if(ev.pointerId !== e.pointerId) return;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      try{ svg.releasePointerCapture(e.pointerId); }catch(err){}
      renderItemEditor();
      persistNow();
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  // ---------- Drag: rotate ----------
  function startRotateDrag(e, item){
    if(!e.isPrimary) return;
    e.stopPropagation();
    e.preventDefault();
    try{ svg.setPointerCapture(e.pointerId); }catch(err){}
    function angleFromEvent(ev){
      const rect = svg.getBoundingClientRect();
      const px = ev.clientX - rect.left - MARGIN;
      const py = ev.clientY - rect.top - MARGIN;
      const cx = item.x * SCALE, cy = item.y * SCALE;
      let deg = Math.atan2(px - cx, -(py - cy)) * 180 / Math.PI;
      return deg;
    }
    function onMove(ev){
      if(ev.pointerId !== e.pointerId) return;
      let deg = angleFromEvent(ev);
      if(ev.shiftKey) deg = Math.round(deg / 15) * 15;
      item.rot = Math.round(deg);
      clampItemToRoom(item); // keep the rotated footprint inside the walls
      render();
    }
    function onUp(ev){
      if(ev.pointerId !== e.pointerId) return;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      try{ svg.releasePointerCapture(e.pointerId); }catch(err){}
      renderItemEditor();
      persistNow();
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  // ---------- Init ----------
  bindClearSaved();
  const hadSaved = loadSaved();
  state.items.forEach(clampItemToRoom); // self-heal any item saved out-of-bounds by an older version
  loadRoomInputs();
  render();
  showSaveStatus(
    !STORAGE_OK ? "Storage isn't available in this browser. Your room won't be saved between visits." :
    hadSaved ? "Loaded your saved room." :
    "Changes save automatically."
  );
})();
