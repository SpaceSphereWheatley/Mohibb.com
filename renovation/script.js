/* Renovation Planner — Laget av Mohibb Malik, 2026 */
(function(){
  "use strict";

  var STORAGE_KEY = "renovationPlannerState_v1";
  var STATUSES = ["planning", "progress", "done"];
  var STATUS_LABEL = { planning: "Planning", progress: "In progress", done: "Done" };
  var TASK_STATES = ["todo", "doing", "done"];
  var TASK_LABEL = { todo: "To do", doing: "Doing", done: "Done" };
  var FINISHES = ["Matt", "Eggshell", "Satin", "Semi-gloss", "Gloss"];
  var SEED_ROOMS = ["Kitchen", "Bathroom", "Living room", "Bedroom"];

  var state = { version: 1, rooms: [], selectedRoomId: null, nextId: 1 };
  var persistTimer = null;

  // ---------- Local persistence (single slot, automatic) ----------
  function storageAvailable(){
    try{
      var t = "__rv_test__";
      localStorage.setItem(t, t);
      localStorage.removeItem(t);
      return true;
    }catch(err){ return false; }
  }
  var STORAGE_OK = storageAvailable();

  function showSaveStatus(msg){
    var el = document.getElementById("saveStatus");
    if(el) el.textContent = msg;
  }

  function persistNow(){
    if(!STORAGE_OK){
      showSaveStatus("Storage isn't available in this browser. Your plan won't be saved between visits.");
      return;
    }
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      showSaveStatus("Saved locally at " + new Date().toLocaleTimeString());
    }catch(err){
      showSaveStatus("Couldn't save (storage may be full or blocked).");
    }
  }

  function persistDebounced(){
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 300);
  }

  // Defensive normalisation — an older or partial saved blob must never throw.
  function num(v){
    var n = typeof v === "number" ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }
  function str(v){ return typeof v === "string" ? v : ""; }
  function arr(v){ return Array.isArray(v) ? v : []; }

  function normaliseRoom(r, ids){
    return {
      id: typeof r.id === "number" ? r.id : ids(),
      name: str(r.name) || "Room",
      status: STATUSES.indexOf(r.status) >= 0 ? r.status : "planning",
      startDate: str(r.startDate),
      targetDate: str(r.targetDate),
      budget: num(r.budget),
      notes: str(r.notes),
      colours: arr(r.colours).map(function(c){
        var hex = /^#[0-9a-f]{6}$/i.test(str(c.hex)) ? c.hex.toUpperCase() : "#D8D2C4";
        return {
          id: typeof c.id === "number" ? c.id : ids(),
          name: str(c.name), hex: hex,
          code: str(c.code) || hex,
          paint: str(c.paint),
          finish: FINISHES.indexOf(c.finish) >= 0 ? c.finish : "Matt",
          litres: num(c.litres)
        };
      }),
      items: arr(r.items).map(function(i){
        return {
          id: typeof i.id === "number" ? i.id : ids(),
          name: str(i.name), qty: num(i.qty) === null ? 1 : num(i.qty),
          estCost: num(i.estCost), actualCost: num(i.actualCost),
          store: str(i.store), url: str(i.url), bought: i.bought === true
        };
      }),
      tasks: arr(r.tasks).map(function(t){
        return {
          id: typeof t.id === "number" ? t.id : ids(),
          text: str(t.text),
          status: TASK_STATES.indexOf(t.status) >= 0 ? t.status : "todo",
          due: str(t.due)
        };
      }),
      links: arr(r.links).map(function(l){
        return { id: typeof l.id === "number" ? l.id : ids(), label: str(l.label), url: str(l.url) };
      })
    };
  }

  function loadSaved(){
    if(!STORAGE_OK) return;
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return;
      var data = JSON.parse(raw);
      if(!data || typeof data !== "object") return;
      var next = typeof data.nextId === "number" ? data.nextId : 1;
      var ids = function(){ return next++; };
      state.rooms = arr(data.rooms).map(function(r){ return normaliseRoom(r || {}, ids); });
      state.nextId = next;
      state.selectedRoomId = state.rooms.some(function(r){ return r.id === data.selectedRoomId; })
        ? data.selectedRoomId
        : (state.rooms.length ? state.rooms[0].id : null);
    }catch(err){ /* fall back to an empty plan */ }
  }

  function nextId(){ return state.nextId++; }

  // ---------- Helpers ----------
  function esc(s){
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function money(n){
    if(n === null || !isFinite(n)) return "—";
    return Math.round(n).toLocaleString("nb-NO") + " kr";
  }
  function selectedRoom(){
    for(var i = 0; i < state.rooms.length; i++){
      if(state.rooms[i].id === state.selectedRoomId) return state.rooms[i];
    }
    return null;
  }
  function findRoom(id){
    for(var i = 0; i < state.rooms.length; i++){ if(state.rooms[i].id === id) return state.rooms[i]; }
    return null;
  }
  function findIn(list, id){
    for(var i = 0; i < list.length; i++){ if(list[i].id === id) return list[i]; }
    return null;
  }
  function lineEst(it){ return (it.estCost === null ? 0 : it.estCost) * (it.qty === null ? 1 : it.qty); }
  function lineActual(it){
    var unit = it.actualCost === null ? it.estCost : it.actualCost;
    return (unit === null ? 0 : unit) * (it.qty === null ? 1 : it.qty);
  }
  function roomTotals(room){
    var est = 0, spent = 0, remaining = 0;
    room.items.forEach(function(it){
      est += lineEst(it);
      if(it.bought) spent += lineActual(it); else remaining += lineEst(it);
    });
    var doneTasks = room.tasks.filter(function(t){ return t.status === "done"; }).length;
    return {
      est: est, spent: spent, remaining: remaining,
      doneTasks: doneTasks, totalTasks: room.tasks.length,
      overBudget: room.budget !== null && spent > room.budget
    };
  }
  function todayISO(){
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function optionsHtml(values, selected, labels){
    return values.map(function(v){
      var label = labels ? labels[v] : v;
      return '<option value="' + esc(v) + '"' + (v === selected ? " selected" : "") + ">" + esc(label) + "</option>";
    }).join("");
  }

  // ---------- Colour codes: RAL / hex / rgb / CSS names ----------
  // A hidden probe lets the browser's own CSS parser resolve anything it knows
  // (#abc, #aabbcc, rgb(), hsl(), "seagreen"), so only RAL needs a lookup table.
  var probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.display = "none";
  document.body.appendChild(probe);

  function cssToHex(value){
    probe.style.color = "";
    probe.style.color = value;               // the CSSOM drops anything invalid
    if(!probe.style.color) return null;
    var computed = window.getComputedStyle(probe).color;
    var m = computed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if(!m) return null;
    return "#" + [1, 2, 3].map(function(i){
      return ("0" + parseInt(m[i], 10).toString(16)).slice(-2);
    }).join("").toUpperCase();
  }

  // Returns { hex, label } for a recognised code, or null.
  function parseColour(input){
    var raw = String(input == null ? "" : input).trim();
    if(!raw) return null;

    var ral = raw.match(/^ral\s*[-\s]?\s*(\d{3,4})$/i);
    if(ral){
      var hex = RAL_CLASSIC[ral[1]];
      return hex ? { hex: hex, label: "RAL " + ral[1] } : null;
    }

    var css = raw;
    if(/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) css = "#" + raw;          // bare hex
    else if(/^\d{1,3}\s*[,\s]\s*\d{1,3}\s*[,\s]\s*\d{1,3}$/.test(raw)) {   // bare r,g,b
      css = "rgb(" + raw.replace(/\s*[,\s]\s*/g, ",") + ")";
    }
    var resolved = cssToHex(css);
    return resolved ? { hex: resolved, label: null } : null;
  }

  // ---------- Rendering: whole-project summary ----------
  function renderSummary(){
    var est = 0, spent = 0, remaining = 0, budget = 0, hasBudget = false, doneRooms = 0;
    state.rooms.forEach(function(room){
      var t = roomTotals(room);
      est += t.est; spent += t.spent; remaining += t.remaining;
      if(room.budget !== null){ budget += room.budget; hasBudget = true; }
      if(room.status === "done") doneRooms++;
    });
    var over = hasBudget && spent > budget;
    document.getElementById("summary").innerHTML =
      stat("Estimated", money(est), state.rooms.length + (state.rooms.length === 1 ? " room" : " rooms")) +
      stat("Spent so far", money(spent), hasBudget ? "of " + money(budget) + " budget" : "no budget set", over) +
      stat("Left to buy", money(remaining), "unbought items") +
      stat("Rooms done", doneRooms + " / " + state.rooms.length, "marked complete");
  }
  function stat(label, value, sub, over){
    return '<div class="stat"><div class="stat-label">' + esc(label) + '</div>' +
      '<div class="stat-value' + (over ? " over" : "") + '">' + esc(value) + '</div>' +
      '<div class="stat-sub">' + esc(sub) + "</div></div>";
  }

  // ---------- Rendering: room list ----------
  function renderRooms(){
    var list = document.getElementById("roomList");
    var empty = document.getElementById("roomEmpty");
    empty.hidden = state.rooms.length > 0;
    list.innerHTML = state.rooms.map(function(room){
      var t = roomTotals(room);
      var pct = t.totalTasks ? Math.round((t.doneTasks / t.totalTasks) * 100) : 0;
      var swatches = room.colours.slice(0, 6).map(function(c){
        return '<span class="room-swatch" style="background:' + esc(c.hex) + '"></span>';
      }).join("");
      return '<button type="button" class="room-card' + (room.id === state.selectedRoomId ? " active" : "") +
        '" data-act="select-room" data-id="' + room.id + '" aria-pressed="' + (room.id === state.selectedRoomId) + '">' +
        '<span class="room-card-top"><span class="room-name">' + esc(room.name) + '</span>' +
        '<span class="chip ' + room.status + '">' + esc(STATUS_LABEL[room.status]) + "</span></span>" +
        '<span class="room-swatches">' + swatches + "</span>" +
        '<span class="bar"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="room-meta"><span>' + t.doneTasks + "/" + t.totalTasks + " jobs</span>" +
        '<span class="' + (t.overBudget ? "over" : "") + '">' + esc(money(t.spent)) +
        (room.budget !== null ? " / " + esc(money(room.budget)) : "") + "</span></span></button>";
    }).join("");
  }

  // ---------- Rendering: room detail ----------
  function renderDetail(){
    var host = document.getElementById("roomDetail");
    var room = selectedRoom();
    if(!room){ host.innerHTML = ""; return; }
    var t = roomTotals(room);

    host.innerHTML =
      '<section class="card" aria-label="Room details">' +
        '<div class="detail-head">' +
          '<div><div class="detail-title">' + esc(room.name) + "</div>" +
          '<div class="detail-sub">' + esc(STATUS_LABEL[room.status]) +
            (room.targetDate ? " &middot; target " + esc(room.targetDate) : "") + "</div></div>" +
          '<button type="button" class="btn-x" data-act="delete-room" aria-label="Delete this room">Delete room</button>' +
        "</div>" +

        '<div class="grid-2">' +
          field("Room name", '<input type="text" value="' + esc(room.name) + '" data-act="room-field" data-field="name" aria-label="Room name">') +
          field("Status", '<select data-act="room-field" data-field="status" aria-label="Room status">' + optionsHtml(STATUSES, room.status, STATUS_LABEL) + "</select>") +
        "</div>" +
        '<div class="grid-3">' +
          field("Start date", '<input type="date" value="' + esc(room.startDate) + '" data-act="room-field" data-field="startDate" aria-label="Start date">') +
          field("Target date", '<input type="date" value="' + esc(room.targetDate) + '" data-act="room-field" data-field="targetDate" aria-label="Target date">') +
          field("Budget (kr)", '<input type="number" min="0" step="100" value="' + (room.budget === null ? "" : room.budget) + '" data-act="room-field" data-field="budget" aria-label="Room budget in kroner">') +
        "</div>" +

        coloursSection(room) +
        itemsSection(room, t) +
        tasksSection(room, t) +
        notesSection(room) +
      "</section>";
  }

  function field(label, control){
    return '<div class="field"><span class="lbl">' + esc(label) + "</span>" + control + "</div>";
  }

  function coloursSection(room){
    var rows = room.colours.map(function(c){
      var parsed = parseColour(c.code);
      return '<div class="row" data-id="' + c.id + '">' +
        '<span class="swatch-lg" style="background:' + esc(c.hex) + '"></span>' +
        '<div class="row-main">' +
          '<div class="grid-3">' +
            field("Surface", '<input type="text" value="' + esc(c.name) + '" placeholder="Walls" data-act="colour-field" data-field="name" aria-label="Surface name">') +
            field("Paint / product", '<input type="text" value="' + esc(c.paint) + '" placeholder="Jotun Lady Pure Colour" data-act="colour-field" data-field="paint" aria-label="Paint name or product">') +
            field("Colour code", '<input type="text" class="code-input' + (parsed ? "" : " invalid") + '" value="' + esc(c.code) +
              '" placeholder="RAL 9010" data-act="colour-field" data-field="code" aria-label="Colour code — RAL, hex or rgb">' +
              '<div class="code-note' + (parsed ? "" : " bad") + '">' + esc(codeNote(c.code, parsed)) + "</div>") +
          "</div>" +
          '<div class="grid-3">' +
            field("Finish", '<select data-act="colour-field" data-field="finish" aria-label="Paint finish">' + optionsHtml(FINISHES, c.finish) + "</select>") +
            field("Litres needed", '<input type="number" min="0" step="0.5" value="' + (c.litres === null ? "" : c.litres) + '" data-act="colour-field" data-field="litres" aria-label="Litres needed">') +
            field("Or pick", '<input type="color" value="' + esc(c.hex) + '" data-act="colour-field" data-field="hex" aria-label="Pick a colour">') +
          "</div>" +
        "</div>" +
        '<button type="button" class="btn-x" data-act="delete-colour" aria-label="Delete this colour">&times;</button>' +
      "</div>";
    }).join("");
    return '<div class="sub-card" data-sec="colours">' +
      '<div class="sec-head"><h3 class="sec-title">Colours</h3>' +
      '<button type="button" class="btn-sm" data-act="add-colour">+ Add colour</button></div>' +
      (rows || '<p class="empty-hint">No colours picked yet &mdash; add one per surface (walls, trim, ceiling).</p>') +
      '<p class="hint mt-12">Colour codes accept RAL Classic (RAL 9010), hex (#EDE8DD or EDE8DD), ' +
      'rgb(237, 232, 221) or 237,232,221, and CSS names like seagreen. RAL swatches are an ' +
      'approximate on-screen match &mdash; check a physical fan deck before you buy.</p>' +
      "</div>";
  }

  function syncSwatch(row, hex){
    var swatch = row.querySelector(".swatch-lg");
    if(swatch) swatch.style.background = hex;
  }

  function codeNote(code, parsed){
    if(!String(code || "").trim()) return "Empty — using the picked colour.";
    if(!parsed) return "Not recognised.";
    return parsed.label ? parsed.label + " · " + parsed.hex : parsed.hex;
  }

  function itemsSection(room, t){
    var sorted = room.items.slice().sort(function(a, b){ return (a.bought ? 1 : 0) - (b.bought ? 1 : 0); });
    var rows = sorted.map(function(it){
      return '<div class="row' + (it.bought ? " item-done" : "") + '" data-id="' + it.id + '">' +
        '<input type="checkbox"' + (it.bought ? " checked" : "") + ' data-act="toggle-bought" aria-label="Mark ' + esc(it.name || "item") + ' as bought">' +
        '<div class="row-main">' +
          '<div class="grid-3">' +
            field("Item", '<input type="text" value="' + esc(it.name) + '" placeholder="Tiles" data-act="item-field" data-field="name" aria-label="Item name">') +
            field("Qty", '<input type="number" min="0" step="1" value="' + (it.qty === null ? "" : it.qty) + '" data-act="item-field" data-field="qty" aria-label="Quantity">') +
            field("Store", '<input type="text" value="' + esc(it.store) + '" placeholder="Maxbo" data-act="item-field" data-field="store" aria-label="Store">') +
          "</div>" +
          '<div class="grid-3">' +
            field("Est. each (kr)", '<input type="number" min="0" step="10" value="' + (it.estCost === null ? "" : it.estCost) + '" data-act="item-field" data-field="estCost" aria-label="Estimated price each">') +
            field("Actual each (kr)", '<input type="number" min="0" step="10" value="' + (it.actualCost === null ? "" : it.actualCost) + '" data-act="item-field" data-field="actualCost" aria-label="Actual price each">') +
            field("Link", '<input type="url" value="' + esc(it.url) + '" placeholder="https://" data-act="item-field" data-field="url" aria-label="Product link">') +
          "</div>" +
          '<div class="row-line"><span class="money">Line total ' + esc(money(it.bought ? lineActual(it) : lineEst(it))) + "</span>" +
          (it.url ? ' <a class="link-row" href="' + esc(it.url) + '" target="_blank" rel="noopener">Open product</a>' : "") + "</div>" +
        "</div>" +
        '<button type="button" class="btn-x" data-act="delete-item" aria-label="Delete this item">&times;</button>' +
      "</div>";
    }).join("");
    return '<div class="sub-card" data-sec="items">' +
      '<div class="sec-head"><h3 class="sec-title">To buy</h3>' +
      '<button type="button" class="btn-sm" data-act="add-item">+ Add item</button></div>' +
      (rows || '<p class="empty-hint">Nothing on the list yet.</p>') +
      '<div class="totals"><span>Estimated ' + esc(money(t.est)) + "</span>" +
      '<span>Left to buy ' + esc(money(t.remaining)) + "</span>" +
      '<span class="' + (t.overBudget ? "over" : "") + '">Spent ' + esc(money(t.spent)) +
      (room.budget !== null ? " of " + esc(money(room.budget)) : "") + "</span></div>" +
      "</div>";
  }

  function tasksSection(room, t){
    var today = todayISO();
    var rows = room.tasks.map(function(task){
      var overdue = task.due && task.due < today && task.status !== "done";
      return '<div class="row' + (task.status === "done" ? " task-done" : "") + '" data-id="' + task.id + '">' +
        '<button type="button" class="task-status ' + task.status + '" data-act="cycle-task" aria-label="Change status of this job, currently ' +
          esc(TASK_LABEL[task.status]) + '">' + esc(TASK_LABEL[task.status]) + "</button>" +
        '<div class="row-main"><div class="grid-2">' +
          field("Job", '<input type="text" class="task-text" value="' + esc(task.text) + '" placeholder="Sand the skirting" data-act="task-field" data-field="text" aria-label="Job description">') +
          field("Due", '<input type="date" value="' + esc(task.due) + '" data-act="task-field" data-field="due" aria-label="Due date">') +
        "</div>" +
        (overdue ? '<div class="due overdue">Overdue &mdash; was due ' + esc(task.due) + "</div>" : "") +
        "</div>" +
        '<button type="button" class="btn-x" data-act="delete-task" aria-label="Delete this job">&times;</button>' +
      "</div>";
    }).join("");
    var pct = t.totalTasks ? Math.round((t.doneTasks / t.totalTasks) * 100) : 0;
    return '<div class="sub-card" data-sec="tasks">' +
      '<div class="sec-head"><h3 class="sec-title">Jobs</h3>' +
      '<button type="button" class="btn-sm" data-act="add-task">+ Add job</button></div>' +
      '<div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
      '<p class="hint">' + t.doneTasks + " of " + t.totalTasks + " done</p>" +
      (rows || '<p class="empty-hint">No jobs listed yet.</p>') +
      "</div>";
  }

  function notesSection(room){
    var links = room.links.map(function(l){
      return '<div class="row" data-id="' + l.id + '">' +
        '<div class="row-main"><div class="grid-2">' +
          field("Label", '<input type="text" value="' + esc(l.label) + '" placeholder="Tap I liked" data-act="link-field" data-field="label" aria-label="Link label">') +
          field("URL", '<input type="url" value="' + esc(l.url) + '" placeholder="https://" data-act="link-field" data-field="url" aria-label="Link URL">') +
        "</div>" +
        (l.url ? '<div class="row-line link-row"><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label || l.url) + "</a></div>" : "") +
        "</div>" +
        '<button type="button" class="btn-x" data-act="delete-link" aria-label="Delete this link">&times;</button>' +
      "</div>";
    }).join("");
    return '<div class="sub-card" data-sec="links">' +
      '<div class="sec-head"><h3 class="sec-title">Notes &amp; inspiration</h3>' +
      '<button type="button" class="btn-sm" data-act="add-link">+ Add link</button></div>' +
      field("Notes", '<textarea data-act="room-field" data-field="notes" placeholder="Measurements, quotes, what the electrician said…" aria-label="Room notes">' + esc(room.notes) + "</textarea>") +
      (links || '<p class="empty-hint">No reference links yet.</p>') +
      "</div>";
  }

  function render(){
    renderSummary();
    renderRooms();
    renderDetail();
  }
  // Light refresh for while someone is typing — rewrites only the derived
  // read-outs, never the inputs, so the focused control keeps its cursor.
  function refreshLight(){
    renderSummary();
    renderRooms();
    refreshDerived();
  }

  // Re-write the numbers that depend on what was just typed: per-line totals,
  // the room's money summary, and the jobs progress bar.
  function refreshDerived(){
    var room = selectedRoom();
    if(!room) return;
    var t = roomTotals(room);

    detail.querySelectorAll('[data-sec="items"] .row').forEach(function(row){
      var item = findIn(room.items, parseInt(row.getAttribute("data-id"), 10));
      var cell = row.querySelector(".money");
      if(item && cell) cell.textContent = "Line total " + money(item.bought ? lineActual(item) : lineEst(item));
    });

    var totals = detail.querySelector('[data-sec="items"] .totals');
    if(totals){
      totals.innerHTML = "<span>Estimated " + esc(money(t.est)) + "</span>" +
        "<span>Left to buy " + esc(money(t.remaining)) + "</span>" +
        '<span class="' + (t.overBudget ? "over" : "") + '">Spent ' + esc(money(t.spent)) +
        (room.budget !== null ? " of " + esc(money(room.budget)) : "") + "</span>";
    }

    var bar = detail.querySelector('[data-sec="tasks"] .bar-fill');
    if(bar) bar.style.width = (t.totalTasks ? Math.round((t.doneTasks / t.totalTasks) * 100) : 0) + "%";
    var progress = detail.querySelector('[data-sec="tasks"] .hint');
    if(progress) progress.textContent = t.doneTasks + " of " + t.totalTasks + " done";
  }

  // ---------- Mutations ----------
  function addRoom(name){
    var room = normaliseRoom({ id: nextId(), name: name || "New room" }, nextId);
    state.rooms.push(room);
    state.selectedRoomId = room.id;
    return room;
  }

  document.getElementById("addRoomBtn").addEventListener("click", function(){
    addRoom("New room");
    render();
    persistNow();
  });

  document.getElementById("seedRoomsBtn").addEventListener("click", function(){
    var first = null;
    SEED_ROOMS.forEach(function(n){ var r = addRoom(n); if(!first) first = r; });
    if(first) state.selectedRoomId = first.id;
    render();
    persistNow();
  });

  document.getElementById("clearAllBtn").addEventListener("click", function(){
    if(!confirm("Clear the whole renovation plan? This can't be undone.")) return;
    try{ localStorage.removeItem(STORAGE_KEY); }catch(err){ /* nothing saved to clear */ }
    state = { version: 1, rooms: [], selectedRoomId: null, nextId: 1 };
    render();
    showSaveStatus(STORAGE_OK ? "Cleared." : "Storage isn't available in this browser.");
  });

  document.getElementById("roomList").addEventListener("click", function(ev){
    var btn = ev.target.closest("[data-act='select-room']");
    if(!btn) return;
    state.selectedRoomId = parseInt(btn.getAttribute("data-id"), 10);
    render();
    persistDebounced();
  });

  var detail = document.getElementById("roomDetail");

  function rowId(el){
    var row = el.closest("[data-id]");
    return row ? parseInt(row.getAttribute("data-id"), 10) : null;
  }

  detail.addEventListener("click", function(ev){
    var el = ev.target.closest("[data-act]");
    if(!el) return;
    var act = el.getAttribute("data-act");
    var room = selectedRoom();
    if(!room) return;

    if(act === "delete-room"){
      if(!confirm('Delete "' + room.name + '" and everything in it?')) return;
      state.rooms = state.rooms.filter(function(r){ return r.id !== room.id; });
      state.selectedRoomId = state.rooms.length ? state.rooms[0].id : null;
    } else if(act === "add-colour"){
      room.colours.push({ id: nextId(), name: "", hex: "#D8D2C4", code: "#D8D2C4", paint: "", finish: "Matt", litres: null });
    } else if(act === "delete-colour"){
      room.colours = room.colours.filter(function(c){ return c.id !== rowId(el); });
    } else if(act === "add-item"){
      room.items.push({ id: nextId(), name: "", qty: 1, estCost: null, actualCost: null, store: "", url: "", bought: false });
    } else if(act === "delete-item"){
      room.items = room.items.filter(function(i){ return i.id !== rowId(el); });
    } else if(act === "add-task"){
      room.tasks.push({ id: nextId(), text: "", status: "todo", due: "" });
    } else if(act === "delete-task"){
      room.tasks = room.tasks.filter(function(t){ return t.id !== rowId(el); });
    } else if(act === "cycle-task"){
      var task = findIn(room.tasks, rowId(el));
      if(task) task.status = TASK_STATES[(TASK_STATES.indexOf(task.status) + 1) % TASK_STATES.length];
    } else if(act === "add-link"){
      room.links.push({ id: nextId(), label: "", url: "" });
    } else if(act === "delete-link"){
      room.links = room.links.filter(function(l){ return l.id !== rowId(el); });
    } else {
      return;
    }
    render();
    persistNow();
  });

  detail.addEventListener("change", function(ev){
    var el = ev.target.closest("[data-act]");
    if(!el) return;
    var room = selectedRoom();
    if(!room) return;
    if(el.getAttribute("data-act") === "toggle-bought"){
      var item = findIn(room.items, rowId(el));
      if(item){
        item.bought = el.checked;
        render();
        persistNow();
      }
      return;
    }
    // A committed select/date change can safely re-render the whole detail pane.
    if(el.tagName === "SELECT" || el.type === "date"){
      applyFieldEdit(el, room);
      render();
      persistNow();
    }
  });

  detail.addEventListener("input", function(ev){
    var el = ev.target.closest("[data-act]");
    if(!el || el.tagName === "SELECT" || el.type === "date") return;
    var room = selectedRoom();
    if(!room) return;
    if(!applyFieldEdit(el, room)) return;

    // Update the bits that can change under a keystroke without re-rendering
    // the pane the caret lives in.
    if(el.getAttribute("data-act") === "colour-field"){
      var fieldName = el.getAttribute("data-field");
      var row = el.closest("[data-id]");
      var colour = row && findIn(room.colours, parseInt(row.getAttribute("data-id"), 10));

      if(colour && fieldName === "code"){
        // Typed a code: resolve it, and keep the swatch and picker in step.
        var parsed = parseColour(colour.code);
        if(parsed) colour.hex = parsed.hex;
        el.classList.toggle("invalid", !parsed && colour.code.trim() !== "");
        var note = row.querySelector(".code-note");
        if(note){
          note.textContent = codeNote(colour.code, parsed);
          note.classList.toggle("bad", !parsed && colour.code.trim() !== "");
        }
        syncSwatch(row, colour.hex);
        var picker = row.querySelector('input[type="color"]');
        if(picker && parsed) picker.value = colour.hex;
      }

      if(colour && fieldName === "hex"){
        // Picked from the swatch: mirror it back into the code field as hex.
        colour.hex = String(el.value).toUpperCase();
        colour.code = colour.hex;
        var codeInput = row.querySelector(".code-input");
        if(codeInput){
          codeInput.value = colour.hex;
          codeInput.classList.remove("invalid");
        }
        var hexNote = row.querySelector(".code-note");
        if(hexNote){
          hexNote.textContent = colour.hex;
          hexNote.classList.remove("bad");
        }
        syncSwatch(row, colour.hex);
      }
    }
    if(el.getAttribute("data-act") === "room-field" && el.getAttribute("data-field") === "name"){
      var title = detail.querySelector(".detail-title");
      if(title) title.textContent = el.value;
    }
    refreshLight();
    persistDebounced();
  });

  // Writes one edited control back into state. Returns false if it wasn't a field.
  function applyFieldEdit(el, room){
    var act = el.getAttribute("data-act");
    var fieldName = el.getAttribute("data-field");
    if(!fieldName) return false;
    var value = el.type === "number" ? num(el.value) : el.value;

    if(act === "room-field"){
      room[fieldName] = value;
    } else if(act === "colour-field"){
      var colour = findIn(room.colours, rowId(el));
      if(colour) colour[fieldName] = value;
    } else if(act === "item-field"){
      var item = findIn(room.items, rowId(el));
      if(item) item[fieldName] = value;
    } else if(act === "task-field"){
      var task = findIn(room.tasks, rowId(el));
      if(task) task[fieldName] = value;
    } else if(act === "link-field"){
      var link = findIn(room.links, rowId(el));
      if(link) link[fieldName] = value;
    } else {
      return false;
    }
    return true;
  }

  // ---------- Boot ----------
  document.getElementById("year").textContent = new Date().getFullYear();
  loadSaved();
  render();
  if(!STORAGE_OK){
    showSaveStatus("Storage isn't available in this browser. Your plan won't be saved between visits.");
  } else {
    showSaveStatus(state.rooms.length ? "Loaded your saved plan." : "Nothing saved yet — changes save automatically.");
  }
})();
