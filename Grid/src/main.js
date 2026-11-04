const { invoke } = window.__TAURI__.core;

const COLS = 12;
const ROWS = 8;
const TOTAL_SLOTS = COLS * ROWS; 
let apps = [];
let isEditMode = false;
let clearBackgroundFlag = false;
let editingAppId = null;

let activeDrag = null;

const grid = document.getElementById('grid');
const addBtn = document.getElementById('add-btn');
const bgBtn = document.getElementById('bg-btn');
const modalAdd = document.getElementById('add-modal');
const modalEdit = document.getElementById('edit-tile-modal');
const modalBg = document.getElementById('bg-modal');

const shortcutSelect = document.getElementById('shortcut-select');
const urlInput = document.getElementById('url-input');

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

function getOccupiedSet(ignoreIds = []) {
    let occupied = new Set();
    apps.forEach(app => {
        if (ignoreIds.includes(app.id)) return; 
        let startCol = app.index % COLS;
        let startRow = Math.floor(app.index / COLS);
        for (let r = 0; r < app.row_span; r++) {
            for (let c = 0; c < app.col_span; c++) {
                occupied.add((startRow + r) * COLS + (startCol + c));
            }
        }
    });
    return occupied;
}

function canFit(targetIndex, colSpan, rowSpan, ignoreIds = []) {
    let startCol = targetIndex % COLS;
    let startRow = Math.floor(targetIndex / COLS);
    if (startCol + colSpan > COLS) return false;
    if (startRow + rowSpan > ROWS) return false;

    let occupied = getOccupiedSet(ignoreIds);
    for (let r = 0; r < rowSpan; r++) {
        for (let c = 0; c < colSpan; c++) {
            if (occupied.has((startRow + r) * COLS + (startCol + c))) { return false; }
        }
    }
    return true;
}

function getSpannedIndices(startIndex, colSpan, rowSpan) {
    let indices = [];
    let startCol = startIndex % COLS;
    let startRow = Math.floor(startIndex / COLS);
    for (let r = 0; r < rowSpan; r++) {
        for (let c = 0; c < colSpan; c++) {
            let col = startCol + c;
            let row = startRow + r;
            if (col < COLS && row < ROWS) indices.push(row * COLS + col);
        }
    }
    return indices;
}

async function initializeApp() {
    if (!grid) {
        console.error("CRÍTICO: El contenedor 'grid' no existe en el HTML.");
        return;
    }

    try {
        const savedApps = await invoke('load_config');
        if (savedApps) apps = savedApps;
    } catch (error) { console.error("Config load failed", error); }

    try {
        const savedBg = await invoke('load_bg');
        if (savedBg && savedBg.trim() !== "") {
            document.body.style.background = savedBg;
            document.body.style.backgroundSize = "cover";
            document.body.style.backgroundPosition = "center";
            document.body.style.backgroundAttachment = "fixed";
        }
    } catch (e) { console.error("BG load failed", e); }

    renderGrid();
}

function renderGrid() {
    grid.innerHTML = '';
    
    for (let i = 0; i < TOTAL_SLOTS; i++) {
        const col = (i % COLS) + 1;
        const row = Math.floor(i / COLS) + 1;
        
        const slotDiv = document.createElement('div');
        slotDiv.className = 'grid-slot';
        slotDiv.dataset.index = i;
        slotDiv.style.gridColumn = col;
        slotDiv.style.gridRow = row;
        grid.appendChild(slotDiv);
    }

    apps.forEach(app => {
        const col = (app.index % COLS) + 1;
        const row = Math.floor(app.index / COLS) + 1;
        
        const tile = document.createElement('div');
        tile.className = 'app-tile';
        tile.dataset.id = app.id;
        
        if (isEditMode) tile.classList.add('editing');
        
        tile.style.gridColumn = `${col} / span ${app.col_span}`;
        tile.style.gridRow = `${row} / span ${app.row_span}`;
        
        if (app.bg_style) {
            tile.style.background = app.bg_style;
            tile.style.backgroundSize = "cover";
            tile.style.backgroundPosition = "center";
        }

        tile.innerHTML = '';
        if (app.icon_url && app.icon_url !== 'none') {
            const img = document.createElement('img');
            img.src = app.icon_url;
            img.className = 'app-icon-img';
            img.onerror = () => img.style.display = 'none';
            tile.appendChild(img);
        }
        if (app.label && app.label.trim() !== '') {
            const span = document.createElement('span');
            span.className = 'label';
            span.innerText = app.label;
            tile.appendChild(span);
        }
        
        if (isEditMode) {
            const editBtn = document.createElement('button');
            editBtn.className = 'edit-tile-btn';
            editBtn.innerText = '✏️';
            editBtn.onpointerdown = (e) => { e.stopPropagation(); openEditModal(app.id); };
            tile.appendChild(editBtn);

            const delBtn = document.createElement('button');
            delBtn.className = 'delete-btn';
            delBtn.innerText = '✕';
            delBtn.onpointerdown = async (e) => {
                e.stopPropagation();
                apps = apps.filter(a => a.id !== app.id);
                renderGrid();
                invoke('save_config', { state: apps }).catch(console.error);
            };
            tile.appendChild(delBtn);
            
            tile.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return; 
                if (e.target.closest('.delete-btn, .edit-tile-btn')) return;
                startCustomDrag(e, app, tile);
            });

        } else if (app.target && app.target !== '') {
            tile.addEventListener('click', async () => {
                try { await invoke('launch_app', { target: app.target }); } 
                catch (error) { console.error("Launch error:", error); }
            });
        }
        
        grid.appendChild(tile);
    });
}

function startCustomDrag(e, app, originalTile) {
    e.preventDefault();
    originalTile.style.opacity = '0.3';
    
    const clone = originalTile.cloneNode(true);
    clone.style.position = 'fixed';
    clone.style.zIndex = '9999';
    clone.style.pointerEvents = 'none'; 
    clone.style.width = originalTile.offsetWidth + 'px';
    clone.style.height = originalTile.offsetHeight + 'px';
    clone.style.margin = '0';
    clone.style.transition = 'none';
    clone.style.transform = 'scale(1.05)';
    
    const offsetX = originalTile.offsetWidth / 2;
    const offsetY = originalTile.offsetHeight / 2;
    clone.style.left = (e.clientX - offsetX) + 'px';
    clone.style.top = (e.clientY - offsetY) + 'px';
    
    document.body.appendChild(clone);
    activeDrag = { app, originalTile, clone, offsetX, offsetY };
    
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
}

function getTargetInfo(clientX, clientY) {
    const elements = document.elementsFromPoint(clientX, clientY);
    const hoverTile = elements.find(el => el.classList.contains('app-tile') && el !== activeDrag.originalTile);
    if (hoverTile) {
        const targetApp = apps.find(a => a.id === hoverTile.dataset.id);
        if (targetApp) return { type: 'app', index: targetApp.index, targetApp };
    }
    const hoverSlot = elements.find(el => el.classList.contains('grid-slot'));
    if (hoverSlot) return { type: 'slot', index: parseInt(hoverSlot.dataset.index) };
    return null;
}

function onPointerMove(e) {
    if (!activeDrag) return;
    activeDrag.clone.style.left = (e.clientX - activeDrag.offsetX) + 'px';
    activeDrag.clone.style.top = (e.clientY - activeDrag.offsetY) + 'px';
    
    document.querySelectorAll('.grid-slot').forEach(el => {
        el.style.border = '';
        el.style.backgroundColor = '';
    });
    
    const info = getTargetInfo(e.clientX, e.clientY);
    if (!info) return;

    let targetIndex = info.type === 'app' ? info.targetApp.index : info.index;
    let fits = false;

    if (info.type === 'app') {
        const ignoreIds = [activeDrag.app.id, info.targetApp.id];
        const canDragFit = canFit(targetIndex, activeDrag.app.col_span, activeDrag.app.row_span, ignoreIds);
        const canAppFit = canFit(activeDrag.app.index, info.targetApp.col_span, info.targetApp.row_span, ignoreIds);
        fits = canDragFit && canAppFit;
    } else {
        fits = canFit(targetIndex, activeDrag.app.col_span, activeDrag.app.row_span, [activeDrag.app.id]);
    }

    const highlightIndices = getSpannedIndices(targetIndex, activeDrag.app.col_span, activeDrag.app.row_span);
    highlightIndices.forEach(idx => {
        const slotEl = document.querySelector(`.grid-slot[data-index="${idx}"]`);
        if (slotEl) {
            slotEl.style.border = fits ? '2px dashed #00ffff' : '2px dashed #f38ba8';
            slotEl.style.backgroundColor = fits ? 'rgba(0, 255, 255, 0.15)' : 'rgba(243, 139, 168, 0.15)';
        }
    });
}

function onPointerUp(e) {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    
    if (!activeDrag) return;
    
    const info = getTargetInfo(e.clientX, e.clientY);
    let stateChanged = false;
    
    if (info && info.index !== activeDrag.app.index) {
        if (info.type === 'app') {
            const ignoreIds = [activeDrag.app.id, info.targetApp.id];
            const canDragFit = canFit(info.index, activeDrag.app.col_span, activeDrag.app.row_span, ignoreIds);
            const canAppFit = canFit(activeDrag.app.index, info.targetApp.col_span, info.targetApp.row_span, ignoreIds);
            
            if (canDragFit && canAppFit) {
                const temp = activeDrag.app.index;
                activeDrag.app.index = info.index;
                info.targetApp.index = temp;
                stateChanged = true;
            }
        } else {
            const fits = canFit(info.index, activeDrag.app.col_span, activeDrag.app.row_span, [activeDrag.app.id]);
            if (fits) {
                activeDrag.app.index = info.index;
                stateChanged = true;
            }
        }
    }
    
    activeDrag.clone.remove();
    activeDrag.originalTile.style.opacity = '1';
    activeDrag = null;
    
    renderGrid();
    if (stateChanged) invoke('save_config', { state: apps }).catch(console.error);
}

// ------------------------------------
// UI CONTROLES (Encadenamiento opcional para evitar colapsos)
// ------------------------------------
document.getElementById('close-btn')?.addEventListener('click', () => invoke('close_app'));
document.getElementById('fullscreen-btn')?.addEventListener('click', () => invoke('toggle_fullscreen'));
document.getElementById('edit-btn')?.addEventListener('click', () => {
    isEditMode = !isEditMode;
    if(addBtn) addBtn.style.display = isEditMode ? 'block' : 'none';
    if(bgBtn) bgBtn.style.display = isEditMode ? 'block' : 'none';
    renderGrid(); 
});

document.getElementById('titlebar')?.addEventListener('pointerdown', (e) => {
    // Aborta el arrastre si el clic se hizo sobre un botón de la barra (ej. la X de cerrar)
    if (e.target.closest('.window-control')) return;
    
    // Solo permite arrastrar con el botón izquierdo del ratón
    if (e.button === 0) {
        invoke('start_drag').catch(console.error);
    }
});

bgBtn?.addEventListener('click', () => {
    const fileInput = document.getElementById('global-bg-file');
    const gradientCb = document.getElementById('global-gradient-cb');
    if(fileInput) fileInput.value = "";
    if(gradientCb) gradientCb.checked = false;
    modalBg?.showModal();
});
document.getElementById('cancel-global-bg')?.addEventListener('click', () => modalBg?.close());
document.getElementById('clear-global-bg-btn')?.addEventListener('click', async () => {
    document.body.style.background = 'linear-gradient(135deg, #4b0082 0%, #00ffff 100%)';
    await invoke('save_bg', { bg: "" });
    modalBg?.close();
});
document.getElementById('save-global-bg')?.addEventListener('click', async () => {
    const bgFile = document.getElementById('global-bg-file')?.files[0];
    const applyGradient = document.getElementById('global-gradient-cb')?.checked;
    let newBg = "";

    if (bgFile) {
        const bgB64 = await fileToBase64(bgFile);
        newBg = `url(${bgB64})`;
    } else if (applyGradient) {
        const c1 = document.getElementById('global-bg-color1')?.value || '#4b0082';
        const c2 = document.getElementById('global-bg-color2')?.value || '#00ffff';
        newBg = `linear-gradient(135deg, ${c1}, ${c2})`;
    }

    if (newBg) {
        document.body.style.background = newBg;
        document.body.style.backgroundSize = "cover";
        document.body.style.backgroundPosition = "center";
        document.body.style.backgroundAttachment = "fixed";
        await invoke('save_bg', { bg: newBg });
    }
    modalBg?.close();
});

addBtn?.addEventListener('click', async () => {
    try {
        const shortcuts = await invoke('get_shortcuts');
        if(shortcutSelect) {
            shortcutSelect.innerHTML = '<option value="">-- Select local shortcut --</option>';
            shortcuts.forEach(sc => {
                const opt = document.createElement('option');
                opt.value = sc.path; opt.textContent = sc.name;
                shortcutSelect.appendChild(opt);
            });
        }
    } catch(e) {}
    modalAdd?.showModal();
});

document.getElementById('open-folder-btn')?.addEventListener('click', () => invoke('open_shortcuts_folder'));
document.getElementById('refresh-shortcuts-btn')?.addEventListener('click', async () => {
    try {
        const shortcuts = await invoke('get_shortcuts');
        if(shortcutSelect) {
            shortcutSelect.innerHTML = '<option value="">-- Select local shortcut --</option>';
            shortcuts.forEach(sc => {
                const opt = document.createElement('option');
                opt.value = sc.path; opt.textContent = sc.name;
                shortcutSelect.appendChild(opt);
            });
        }
    } catch(e) {}
});
document.getElementById('cancel-new-app')?.addEventListener('click', () => modalAdd?.close());

shortcutSelect?.addEventListener('change', (e) => {
    if (e.target.selectedIndex > 0 && urlInput) {
        urlInput.value = '';
        const appName = document.getElementById('app-name');
        if(appName) appName.value = e.target.options[e.target.selectedIndex].text;
    }
});
urlInput?.addEventListener('input', () => { if (urlInput.value.length > 0 && shortcutSelect) shortcutSelect.selectedIndex = 0; });

document.getElementById('save-new-app')?.addEventListener('click', async () => {
    const isUrl = urlInput ? urlInput.value.trim().length > 0 : false;
    let target = isUrl ? urlInput.value.trim() : (shortcutSelect ? shortcutSelect.value : "");
    const nameEl = document.getElementById('app-name');
    const name = nameEl ? nameEl.value.trim() : "";
    const sizeSelect = document.getElementById('size-select');
    const [col_span, row_span] = sizeSelect ? sizeSelect.value.split(',').map(Number) : [1,1];
    
    let emptyIndex = -1;
    for(let i = 0; i < TOTAL_SLOTS; i++) {
        if(canFit(i, col_span, row_span)) { emptyIndex = i; break; }
    }
    if (emptyIndex === -1) { alert("Not enough space."); return; }

    let iconUrl = "none";
    if (target) {
        if (isUrl) {
            try {
                const urlObj = new URL(target.startsWith('http') ? target : `https://${target}`);
                iconUrl = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=128`;
                target = urlObj.href;
            } catch(e) {}
        } else {
            try { iconUrl = await invoke('extract_icon', { path: target }); } catch(e) {}
        }
    }

    apps.push({
        id: Date.now().toString(),
        label: name,
        icon_url: iconUrl,
        target: target,
        is_url: isUrl,
        index: emptyIndex,
        col_span: col_span,
        row_span: row_span,
        bg_style: ""
    });

    renderGrid();
    invoke('save_config', { state: apps }).catch(console.error);
    modalAdd?.close();
});

function openEditModal(id) {
    editingAppId = id;
    clearBackgroundFlag = false;
    
    const targetApp = apps.find(a => a.id === id);
    const labelInput = document.getElementById('edit-label-input');
    const iconFile = document.getElementById('edit-icon-file');
    const bgFile = document.getElementById('edit-bg-file');
    const gradCb = document.getElementById('apply-gradient-cb');
    
    if(labelInput) labelInput.value = targetApp && targetApp.label ? targetApp.label : "";
    if(iconFile) iconFile.value = "";
    if(bgFile) bgFile.value = "";
    if(gradCb) gradCb.checked = false;
    
    modalEdit?.showModal();
}

document.getElementById('clear-bg-btn')?.addEventListener('click', () => {
    clearBackgroundFlag = true;
    alert("Background cleared. Click 'Save Changes'.");
});

document.getElementById('cancel-tile-edit')?.addEventListener('click', () => modalEdit?.close());

document.getElementById('save-tile-edit')?.addEventListener('click', async () => {
    const targetApp = apps.find(a => a.id === editingAppId);
    if (!targetApp) return;

    const labelInput = document.getElementById('edit-label-input');
    if(labelInput) targetApp.label = labelInput.value.trim();
    
    const iconFile = document.getElementById('edit-icon-file')?.files[0];
    const bgFile = document.getElementById('edit-bg-file')?.files[0];
    const applyGradient = document.getElementById('apply-gradient-cb')?.checked;

    if (iconFile) targetApp.icon_url = await fileToBase64(iconFile);
    
    if (clearBackgroundFlag) {
        targetApp.bg_style = ""; 
    } else if (bgFile) {
        const bgB64 = await fileToBase64(bgFile);
        targetApp.bg_style = `url(${bgB64})`;
    } else if (applyGradient) {
        const c1 = document.getElementById('edit-bg-color1')?.value || '#800080';
        const c2 = document.getElementById('edit-bg-color2')?.value || '#00ffff';
        targetApp.bg_style = `linear-gradient(135deg, ${c1}, ${c2})`;
    }

    renderGrid();
    invoke('save_config', { state: apps }).catch(console.error);
    modalEdit?.close();
});

initializeApp();