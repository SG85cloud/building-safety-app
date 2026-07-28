/* ==========================================================================
   스마트 건축물 안전점검 현장점검 시스템 (Clean Architecture Engine v18.0)
   ========================================================================== */

// --- 1. GLOBAL UNIFIED STATE ENGINE ---
if (!window.state) {
    window.state = {
        buildings: [],
        currentBuilding: null,
        currentBuildingId: null,
        currentTab: 'tab-home',
        currentFloor: '1F',
        defects: {}, // { 'bldg-id_1F': [ ...defects ] }
        view: { offsetX: 0, offsetY: 0, scale: 1.0 },
        mode: 'PAN', // 'PAN' | 'MARK'
        rotationAngle: 0,
        pinShape: 'square', // 'square' | 'circle'
        tipShape: 'arrow',  // 'arrow' | 'circle'
        pinSizeScale: 1.0,
        bgImage: null,
        canvas: null,
        ctx: null
    };
}
window.appState = window.state;

// --- 2. IMAGE COMPRESSION & FLOOR PARSER HELPERS ---

/**
 * HTML5 Canvas Image Compressor
 * Reduces 4K/8K drawing photos (5~20MB) to lightweight JPEG (~150KB)
 */
window.compressDrawingImage = function(file, maxDim = 1400, quality = 0.8) {
    return new Promise((resolve) => {
        if (!file || !(file instanceof Blob)) {
            return resolve(null);
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width;
                let h = img.height;
                if (w > maxDim || h > maxDim) {
                    if (w > h) {
                        h = Math.round((h * maxDim) / w);
                        w = maxDim;
                    } else {
                        w = Math.round((w * maxDim) / h);
                        h = maxDim;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => resolve(e.target.result);
            img.src = e.target.result;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
};

/**
 * Intelligent Floor Parser from File Names (e.g. B2.jpg -> 지하 2층)
 */
window.parseFloorInfoFromFilename = function(fileName) {
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
    const cleanName = nameWithoutExt.toUpperCase();

    if (cleanName.includes('ROOF') || cleanName.includes('옥상') || cleanName.includes('PH')) {
        return { rank: 999, floorCode: 'ROOF', floorLabel: '옥상 층 (ROOF)' };
    }

    const bMatch = cleanName.match(/(?:B|지하)\s*([0-9]{1,2})(?![0-9])/i);
    if (bMatch) {
        const num = parseInt(bMatch[1], 10);
        if (num > 0 && num <= 99) {
            return { rank: -num, floorCode: `B${num}F`, floorLabel: `지하 ${num}층 (B${num}F)` };
        }
    }

    const fMatch = cleanName.match(/(?:F|층|지상)\s*([0-9]{1,2})(?![0-9])/i) || 
                   cleanName.match(/([0-9]{1,2})\s*(?:F|층)(?![0-9])/i) ||
                   cleanName.match(/(?<![0-9])([0-9]{1,2})(?![0-9])/);
    if (fMatch) {
        const num = parseInt(fMatch[1], 10);
        if (num > 0 && num <= 99) {
            return { rank: num, floorCode: `${num}F`, floorLabel: `지상 ${num}층 (${num}F)` };
        }
    }

    return { rank: 1, floorCode: '1F', floorLabel: '지상 1층 (1F)' };
};

window.selectedUploadedDrawings = [];
window.selectedEditUploadedDrawings = [];

// --- 3. DOM CONTENT LOADED MAIN MODULE ---
document.addEventListener('DOMContentLoaded', () => {
    
    // UI Elements Map
    const elements = {
        appTitle: document.querySelector('.app-title'),
        appSubtitle: document.querySelector('.app-subtitle'),
        headerSelectorGroup: document.getElementById('headerSelectorGroup'),
        headerReportActions: document.getElementById('headerReportActions'),
        mainNavTabs: document.getElementById('mainNavTabs'),
        projectSelect: document.getElementById('projectSelect'),
        floorSelect: document.getElementById('floorSelect'),
        buildingListGrid: document.getElementById('buildingListGrid'),
        
        // Modals
        addBuildingModal: document.getElementById('addBuildingModal'),
        editBuildingModal: document.getElementById('editBuildingModal'),
        defectModal: document.getElementById('defectModal'),
        reportPreviewModal: document.getElementById('reportPreviewModal'),
        mobileQrModal: document.getElementById('mobileQrModal'),
        modalReportPreviewBody: document.getElementById('modalReportPreviewBody'),
        
        // Canvas & Viewport
        canvasContainer: document.getElementById('canvasContainer'),
        planCanvas: document.getElementById('planCanvas'),
        zoomScaleText: document.getElementById('zoomScaleText'),
        pinSizeRange: document.getElementById('pinSizeRange'),
        pinSizeLabel: document.getElementById('pinSizeLabel'),
        
        // Tables & Albums
        surveyTableBody: document.getElementById('surveyTableBody'),
        photoAlbumGrid: document.getElementById('photoAlbumGrid'),
        surveyFloorTitle: document.getElementById('surveyFloorTitle'),
        albumFloorTitle: document.getElementById('albumFloorTitle')
    };

    // --- 4. PERSISTENCE ENGINE (LOCAL STORAGE) ---
    function saveStateToLocalStorage() {
        try {
            const dataToSave = {
                defects: window.state.defects || {},
                buildings: window.state.buildings || [],
                lastUsedBuildingId: window.state.currentBuildingId || null
            };
            localStorage.setItem('building_safety_app_state_v2', JSON.stringify(dataToSave));
        } catch (e) {
            console.warn('LocalStorage save warning:', e);
        }
    }

    function loadStateFromLocalStorage() {
        try {
            // Wipe any legacy test data to guarantee 100% clean initial state
            localStorage.removeItem('building_safety_app_state_v2');
            window.state.buildings = [];
            window.state.defects = {};
            window.state.currentBuilding = null;
            window.state.currentBuildingId = null;
        } catch (e) {
            console.error('LocalStorage load failed:', e);
        }
    }

    // --- 5. TAB MANAGER ---
    window.switchTab = function(targetTabId = 'tab-home') {
        window.state.currentTab = targetTabId;

        document.querySelectorAll('.tab-content').forEach(content => {
            if (content.id === targetTabId) {
                content.classList.add('active');
                content.style.display = 'flex';
            } else {
                content.classList.remove('active');
                content.style.display = 'none';
            }
        });

        document.querySelectorAll('.tab-btn').forEach(btn => {
            if (btn.dataset.tab === targetTabId) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        if (targetTabId === 'tab-home') {
            if (elements.headerSelectorGroup) elements.headerSelectorGroup.style.display = 'none';
            if (elements.headerReportActions) elements.headerReportActions.style.display = 'none';
            if (elements.mainNavTabs) elements.mainNavTabs.style.display = 'none';

            if (elements.appTitle) elements.appTitle.textContent = '스마트 건축물 안전점검 시스템';
            if (elements.appSubtitle) elements.appSubtitle.textContent = 'PC · 갤럭시 탭 · 스마트폰 실시간 연동 현장점검';
            renderDashboard();
        } else {
            if (elements.headerSelectorGroup) elements.headerSelectorGroup.style.display = 'flex';
            if (elements.headerReportActions) elements.headerReportActions.style.display = 'flex';
            if (elements.mainNavTabs) elements.mainNavTabs.style.display = 'flex';

            if (targetTabId === 'tab-map') {
                setTimeout(() => {
                    resizeCanvas();
                    fitToScreen();
                    drawCanvas();
                }, 50);
            } else if (targetTabId === 'tab-survey') {
                renderSurveyTable();
            } else if (targetTabId === 'tab-album') {
                renderPhotoAlbum();
            }
        }
    };

    // --- 6. BUILDING MANAGEMENT ENGINE ---

    window.renderDashboard = function() {
        if (!elements.buildingListGrid) return;
        const bldgs = window.state.buildings || [];

        if (bldgs.length === 0) {
            elements.buildingListGrid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 4rem 2rem; background: rgba(15, 23, 42, 0.6); border: 2px dashed rgba(255,255,255,0.15); border-radius: 16px;">
                    <i class="fa-solid fa-building-circle-exclamation" style="font-size: 3.5rem; color: #64748b; margin-bottom: 1rem;"></i>
                    <h3 style="font-size: 1.3rem; color: #f8fafc; margin-bottom: 0.5rem;">등록된 점검 대상 건축물이 없습니다</h3>
                    <p style="color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.5rem;">새로운 건축물을 등록하고 층별 도면을 올려 현장점검을 시작하세요!</p>
                    <button type="button" class="btn btn-primary" onclick="window.openAddBuildingModalFunc()" style="padding: 0.8rem 1.6rem; font-size: 1rem;">
                        <i class="fa-solid fa-plus"></i> ➕ 신규 건축물 등록하기
                    </button>
                </div>
            `;
            return;
        }

        elements.buildingListGrid.innerHTML = bldgs.map(bldg => {
            const drawingBadge = (bldg.floorsList && bldg.floorsList.length > 0)
                ? `<span style="font-size: 0.78rem; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.15); padding: 0.25rem 0.6rem; border-radius: 12px; border: 1px solid rgba(56, 189, 248, 0.3);"><i class="fa-solid fa-file-image"></i> 도면 ${bldg.floorsList.length}개 층 보유</span>`
                : `<span style="font-size: 0.78rem; font-weight: 600; color: #94a3b8; background: rgba(148, 163, 184, 0.15); padding: 0.25rem 0.6rem; border-radius: 12px;">도면 미등록</span>`;

            return `
                <div class="building-card" data-id="${bldg.id}" style="padding: 1.5rem; display: flex; flex-direction: column; justify-content: space-between; gap: 1.2rem; min-height: 160px; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; backdrop-filter: blur(10px); box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                    <div class="building-card-header" style="margin-bottom: 0;">
                        <h3 class="building-title" style="font-size: 1.25rem; font-weight: 800; color: #f8fafc; display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; width: 100%;">
                            <span>${bldg.name}</span>
                            ${drawingBadge}
                        </h3>
                        <p style="font-size: 0.88rem; color: #94a3b8; margin-top: 0.4rem;">
                            <i class="fa-solid fa-location-dot" style="color: #ef4444;"></i> ${bldg.address || '서울특별시 강남구'} | 🏢 ${bldg.floors || '지상 10층 ~ 지하 2층'}
                        </p>
                    </div>
                    <div class="building-card-actions" style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
                        <button type="button" class="btn btn-open-building-map" onclick="window.selectBuildingAndInspect('${bldg.id}')" style="flex: 2; min-width: 180px; justify-content: center; padding: 0.8rem 1rem; font-size: 0.95rem; font-weight: 700; background: linear-gradient(135deg, #0284c7, #2563eb); border-radius: 8px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);">
                            <i class="fa-solid fa-map-location-dot"></i> 🚀 현장 도면 점검 시작
                        </button>
                        <button type="button" class="btn btn-edit-building" onclick="window.openEditBuildingModalFunc('${bldg.id}')" style="flex: 1; min-width: 130px; justify-content: center; padding: 0.8rem 0.8rem; font-size: 0.88rem; font-weight: 700; background: rgba(168, 85, 247, 0.15); border: 1px solid #a855f7; color: #d8b4fe; border-radius: 8px;">
                            <i class="fa-solid fa-pen-to-square"></i> ✏️ 명칭/도면 수정
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    };

    window.selectBuildingAndInspect = function(bldgOrId) {
        if (!window.state.buildings) window.state.buildings = [];

        let bldg = null;
        if (typeof bldgOrId === 'string') {
            bldg = window.state.buildings.find(b => b.id === bldgOrId || b.name === bldgOrId || (b.name && b.name.includes(bldgOrId)));
        } else if (bldgOrId && typeof bldgOrId === 'object') {
            bldg = bldgOrId;
        }

        if (!bldg && window.state.buildings.length > 0) {
            bldg = window.state.buildings[0];
        }

        if (!bldg) return;

        window.state.currentBuilding = bldg;
        window.state.currentBuildingId = bldg.id;

        // Header Title Update
        const cleanName = bldg.name ? bldg.name.replace(/^🏢\s*/, '') : '건축물';
        if (elements.appTitle) elements.appTitle.textContent = `${cleanName} 점검 시스템`;
        if (elements.appSubtitle) elements.appSubtitle.textContent = `📍 주소: ${bldg.address || '서울특별시 강남구'} | 👤 책임점검자: ${bldg.inspector || '홍길동 수석점검자'} | 📅 점검일: ${bldg.date || '2026-07-28'}`;

        // Populate Header Selectors
        updateProjectSelectDropdown();
        populateFloorSelectDropdown(bldg);

        // Switch to Map Tab & Load Drawing
        loadFloorDrawing(window.state.currentFloor || '1F');
        window.switchTab('tab-map');
    };

    function updateProjectSelectDropdown() {
        if (!elements.projectSelect) return;
        const bldgs = window.state.buildings || [];
        elements.projectSelect.innerHTML = bldgs.map(b => 
            `<option value="${b.id}" ${b.id === window.state.currentBuildingId ? 'selected' : ''}>${b.name}</option>`
        ).join('');
    }

    function populateFloorSelectDropdown(bldg) {
        if (!elements.floorSelect) return;
        let availableFloors = [];

        if (bldg.floorsList && bldg.floorsList.length > 0) {
            availableFloors = bldg.floorsList;
        } else if (bldg.floorDrawings && Object.keys(bldg.floorDrawings).length > 0) {
            availableFloors = Object.keys(bldg.floorDrawings).map(code => {
                let label = code;
                if (code === 'ROOF') label = '옥상 층 (ROOF)';
                else if (code.startsWith('B')) label = `지하 ${code.replace('B','').replace('F','')}층 (${code})`;
                else if (code.endsWith('F')) label = `지상 ${code.replace('F','')}층 (${code})`;
                return { floorCode: code, floorLabel: label };
            });
        }

        if (availableFloors.length > 0) {
            elements.floorSelect.innerHTML = availableFloors.map(f => 
                `<option value="${f.floorCode}">${f.floorLabel}</option>`
            ).join('');
            window.state.currentFloor = availableFloors[0].floorCode;
        } else {
            elements.floorSelect.innerHTML = `
                <option value="1F">지상 1층 (1F)</option>
                <option value="2F">지상 2층 (2F)</option>
                <option value="B1F">지하 1층 (B1F)</option>
                <option value="B2F">지하 2층 (B2F)</option>
                <option value="ROOF">옥상 층 (ROOF)</option>
            `;
            window.state.currentFloor = '1F';
        }
    }

    // --- 7. BUILDING REGISTRATION MODAL HANDLERS ---

    window.openAddBuildingModalFunc = function() {
        if (elements.addBuildingModal) {
            const nameInput = document.getElementById('inputBuildingName');
            if (nameInput) nameInput.value = '';
            const addrInput = document.getElementById('inputBuildingAddress');
            if (addrInput) addrInput.value = '';
            const dateInput = document.getElementById('inputBuildingDate');
            if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
            const preview = document.getElementById('drawingSortPreview');
            if (preview) preview.innerHTML = '';
            window.selectedUploadedDrawings = [];

            elements.addBuildingModal.style.display = 'flex';
            elements.addBuildingModal.classList.add('open');
        }
    };

    window.closeAddBuildingModalFunc = function() {
        if (elements.addBuildingModal) {
            elements.addBuildingModal.style.display = 'none';
            elements.addBuildingModal.classList.remove('open');
        }
    };

    // Listening for Add Modal Multi-Drawing Uploads
    const inputDrawings = document.getElementById('inputBuildingDrawings');
    if (inputDrawings) {
        inputDrawings.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;

            window.selectedUploadedDrawings = files.map(file => {
                const info = window.parseFloorInfoFromFilename(file.name);
                return {
                    file: file,
                    fileName: file.name,
                    rank: info.rank,
                    floorCode: info.floorCode,
                    floorLabel: info.floorLabel
                };
            }).sort((a, b) => a.rank - b.rank);

            const preview = document.getElementById('drawingSortPreview');
            if (preview) {
                preview.innerHTML = `
                    <div style="font-size:0.82rem; font-weight:700; color:#38bdf8; margin-bottom:0.2rem;">
                        ✅ 총 ${window.selectedUploadedDrawings.length}개 층 도면 파일이 정렬되었습니다:
                    </div>
                    ${window.selectedUploadedDrawings.map((item, idx) => `
                        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.06); padding:0.4rem 0.7rem; border-radius:6px; font-size:0.8rem;">
                            <span><strong>[순서 ${idx + 1}]</strong> ${item.floorLabel}</span>
                            <span style="color:#94a3b8; font-size:0.75rem;">${item.fileName}</span>
                        </div>
                    `).join('')}
                `;
            }

            const floorsInput = document.getElementById('inputBuildingFloors');
            if (floorsInput && window.selectedUploadedDrawings.length > 0) {
                const lowest = window.selectedUploadedDrawings[0];
                const highest = window.selectedUploadedDrawings[window.selectedUploadedDrawings.length - 1];
                floorsInput.value = `${highest.floorLabel.split(' ')[0]} ${highest.floorLabel.split(' ')[1]} ~ ${lowest.floorLabel.split(' ')[0]} ${lowest.floorLabel.split(' ')[1]}`;
            }
        });
    }

    // Save New Building Action
    const btnSaveBuilding = document.getElementById('btnSaveBuilding');
    if (btnSaveBuilding) {
        btnSaveBuilding.addEventListener('click', async () => {
            const nameInput = document.getElementById('inputBuildingName');
            const name = (nameInput ? nameInput.value : '').trim();
            if (!name) {
                alert('⚠️ 건축물 명칭을 입력해 주세요!');
                if (nameInput) nameInput.focus();
                return;
            }

            const address = (document.getElementById('inputBuildingAddress')?.value || '').trim() || '서울특별시 강남구 테헤란로 123';
            const date = document.getElementById('inputBuildingDate')?.value || new Date().toISOString().split('T')[0];
            const floors = document.getElementById('inputBuildingFloors')?.value || '지상 10층 ~ 지하 2층';
            const notes = document.getElementById('inputBuildingNotes')?.value || '';

            const safeUploadedDrawings = Array.isArray(window.selectedUploadedDrawings) ? window.selectedUploadedDrawings : [];
            const floorDrawingsMap = {};
            const floorsList = [];

            if (safeUploadedDrawings.length > 0) {
                for (const item of safeUploadedDrawings) {
                    floorsList.push({
                        floorCode: item.floorCode,
                        floorLabel: item.floorLabel
                    });
                    if (item.file) {
                        try {
                            const compressedDataUrl = await window.compressDrawingImage(item.file);
                            if (compressedDataUrl) {
                                floorDrawingsMap[item.floorCode] = compressedDataUrl;
                            }
                        } catch (err) {
                            console.error('Drawing compression error:', err);
                        }
                    }
                }
            }

            const newBldg = {
                id: 'bldg-' + Date.now(),
                name: name.startsWith('🏢') ? name : '🏢 ' + name,
                address: address,
                inspector: '홍길동 수석점검자',
                date: date,
                floors: floors,
                floorsList: floorsList.length > 0 ? floorsList : null,
                floorDrawings: floorDrawingsMap,
                notes: notes
            };

            window.state.buildings.unshift(newBldg);
            saveStateToLocalStorage();
            window.closeAddBuildingModalFunc();

            renderDashboard();
            window.selectBuildingAndInspect(newBldg);
            alert(`🏢 '${name}' 건축물이 성공적으로 등록되었습니다!`);
        });
    }

    // --- 8. DRAWING CANVAS ENGINE (PAN/ZOOM/ROTATE & PINS) ---

    function setupCanvas() {
        state.canvas = elements.planCanvas;
        if (!state.canvas) return;
        state.ctx = state.canvas.getContext('2d');
        resizeCanvas();
    }

    function resizeCanvas() {
        const container = elements.canvasContainer || document.getElementById('canvasContainer');
        const canvas = state.canvas || document.getElementById('planCanvas');
        if (!canvas) return;

        let w = container ? (container.clientWidth || container.offsetWidth) : 0;
        let h = container ? (container.clientHeight || container.offsetHeight) : 0;

        if (w <= 50) w = window.innerWidth - 40;
        if (h <= 50) h = Math.max(500, window.innerHeight - 220);

        canvas.width = w;
        canvas.height = h;
        drawCanvas();
    }

    function fitToScreen() {
        if (!state.canvas) return;
        const cw = state.canvas.width;
        const ch = state.canvas.height;

        let imgW = 1200;
        let imgH = 700;
        if (state.bgImage) {
            imgW = state.bgImage.naturalWidth || state.bgImage.width || 1200;
            imgH = state.bgImage.naturalHeight || state.bgImage.height || 700;
        }

        const scaleX = (cw - 40) / imgW;
        const scaleY = (ch - 40) / imgH;
        state.view.scale = Math.min(scaleX, scaleY, 1.2);
        state.view.offsetX = Math.max(20, (cw - imgW * state.view.scale) / 2);
        state.view.offsetY = Math.max(20, (ch - imgH * state.view.scale) / 2);
        
        if (elements.zoomScaleText) {
            elements.zoomScaleText.textContent = `${Math.round(state.view.scale * 100)}%`;
        }
    }

    function loadFloorDrawing(floorCode) {
        state.currentFloor = floorCode;
        state.bgImage = null;

        const bldg = state.currentBuilding;
        let dataUrl = null;
        if (bldg && bldg.floorDrawings && bldg.floorDrawings[floorCode]) {
            dataUrl = bldg.floorDrawings[floorCode];
        }

        if (!dataUrl) {
            dataUrl = getDefaultBlueprintSvgDataUrl(floorCode || '1F');
        }

        const img = new Image();
        img.onload = () => {
            state.bgImage = img;
            resizeCanvas();
            fitToScreen();
            drawCanvas();
        };
        img.onerror = () => {
            drawCanvas();
        };
        img.src = dataUrl;
    }

    function getDefaultBlueprintSvgDataUrl(floorName) {
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700">
                <rect width="1200" height="700" fill="#0f172a"/>
                <g stroke="#334155" stroke-width="1">
                    ${Array.from({length: 24}).map((_, i) => `<line x1="${i*50}" y1="0" x2="${i*50}" y2="700"/>`).join('')}
                    ${Array.from({length: 14}).map((_, i) => `<line x1="0" y1="${i*50}" x2="1200" y2="${i*50}"/>`).join('')}
                </g>
                <rect x="100" y="80" width="1000" height="540" fill="none" stroke="#38bdf8" stroke-width="4"/>
                <text x="600" y="340" fill="#94a3b8" font-size="28" font-weight="bold" text-anchor="middle">${floorName} 건축물 기본 평면도 (CAD CAD CAD)</text>
                <text x="600" y="380" fill="#64748b" font-size="16" text-anchor="middle">도면 사진을 추가 등록하시면 본인의 도면 사진이 선명하게 표시됩니다.</text>
            </svg>
        `;
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    function drawCanvas() {
        if (!state.ctx || !state.canvas) return;
        const ctx = state.ctx;
        const cw = state.canvas.width;
        const ch = state.canvas.height;

        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#1b2333';
        ctx.fillRect(0, 0, cw, ch);

        ctx.save();
        ctx.translate(state.view.offsetX, state.view.offsetY);
        ctx.scale(state.view.scale, state.view.scale);

        if (state.bgImage) {
            ctx.drawImage(state.bgImage, 0, 0);
        }

        // Draw Defect Pins
        const currentDefects = getCurrentFloorDefects();
        currentDefects.forEach(defect => drawPin(ctx, defect));

        ctx.restore();
    }

    function getCurrentFloorDefects() {
        if (!state.currentBuildingId) return [];
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        return state.defects[key] || [];
    }

    function drawPin(ctx, defect) {
        const x = defect.x || 100;
        const y = defect.y || 100;
        const scale = state.pinSizeScale || 1.0;

        ctx.save();
        ctx.translate(x, y);

        // Color based on category
        let color = '#ef4444';
        if (defect.category === '비구조체') color = '#3b82f6';
        if (defect.category === '마감재') color = '#f97316';

        // Pin Box
        ctx.fillStyle = color;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 6;

        if (state.pinShape === 'circle') {
            ctx.beginPath();
            ctx.arc(0, 0, 16 * scale, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillRect(-18 * scale, -14 * scale, 36 * scale, 28 * scale);
        }

        // Pin Text Label
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(12 * scale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(defect.no || '01-1', 0, 0);

        ctx.restore();
    }

    // Canvas Mouse / Touch Event Handlers for Pan & Marking
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    if (elements.planCanvas) {
        elements.planCanvas.addEventListener('mousedown', (e) => {
            const rect = elements.planCanvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            if (state.mode === 'MARK') {
                const imgX = (mouseX - state.view.offsetX) / state.view.scale;
                const imgY = (mouseY - state.view.offsetY) / state.view.scale;
                openAddDefectModal(imgX, imgY);
            } else {
                isDragging = true;
                startX = mouseX - state.view.offsetX;
                startY = mouseY - state.view.offsetY;
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging || !elements.planCanvas) return;
            const rect = elements.planCanvas.getBoundingClientRect();
            state.view.offsetX = (e.clientX - rect.left) - startX;
            state.view.offsetY = (e.clientY - rect.top) - startY;
            drawCanvas();
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
        });

        // Wheel Zoom
        elements.planCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            state.view.scale = Math.min(Math.max(0.3, state.view.scale * zoomFactor), 4.0);
            if (elements.zoomScaleText) elements.zoomScaleText.textContent = `${Math.round(state.view.scale * 100)}%`;
            drawCanvas();
        }, { passive: false });
    }

    function openAddDefectModal(x, y) {
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        const defects = state.defects[key] || [];
        const seq = defects.length + 1;
        const seqStr = seq < 10 ? `0${seq}` : `${seq}`;
        const defectNoStr = `${state.currentFloor.replace('F','')}-${seqStr}`;

        document.getElementById('defectPinId').value = '';
        document.getElementById('defectNo').value = defectNoStr;
        document.getElementById('defectSize').value = '';
        document.getElementById('defectAction').value = '';

        window._pendingPinCoords = { x, y };

        if (elements.defectModal) {
            elements.defectModal.style.display = 'flex';
            elements.defectModal.classList.add('open');
        }
    }

    const btnSaveDefect = document.getElementById('btnSaveDefect');
    if (btnSaveDefect) {
        btnSaveDefect.addEventListener('click', () => {
            if (!state.currentBuildingId) return;
            const key = `${state.currentBuildingId}_${state.currentFloor}`;
            if (!state.defects[key]) state.defects[key] = [];

            const coords = window._pendingPinCoords || { x: 200, y: 200 };
            const newDefect = {
                id: 'pin-' + Date.now(),
                no: document.getElementById('defectNo').value,
                category: document.getElementById('defectCategory').value,
                component: document.getElementById('defectComponent').value,
                defectType: document.getElementById('defectType').value,
                size: document.getElementById('defectSize').value || 'W=0.2mm',
                grade: document.getElementById('defectGrade').value,
                action: document.getElementById('defectAction').value || '에폭시 주입',
                x: coords.x,
                y: coords.y
            };

            state.defects[key].push(newDefect);
            saveStateToLocalStorage();

            if (elements.defectModal) {
                elements.defectModal.style.display = 'none';
                elements.defectModal.classList.remove('open');
            }

            drawCanvas();
        });
    }

    // --- 9. BUTTON CONTROLS & LISTENERS ---

    // Logo & Persistent Home
    const btnLogoHome = document.getElementById('btnLogoHome');
    if (btnLogoHome) btnLogoHome.addEventListener('click', () => window.switchTab('tab-home'));

    const btnPersistentHome = document.getElementById('btnPersistentHome');
    if (btnPersistentHome) btnPersistentHome.addEventListener('click', () => window.switchTab('tab-home'));

    // Open Add Building Modal CTA
    const btnOpenAddBuildingModal = document.getElementById('btnOpenAddBuildingModal');
    if (btnOpenAddBuildingModal) btnOpenAddBuildingModal.addEventListener('click', () => window.openAddBuildingModalFunc());

    const btnCloseAddBuildingModal = document.getElementById('btnCloseAddBuildingModal');
    if (btnCloseAddBuildingModal) btnCloseAddBuildingModal.addEventListener('click', () => window.closeAddBuildingModalFunc());

    const btnCancelAddBuilding = document.getElementById('btnCancelAddBuilding');
    if (btnCancelAddBuilding) btnCancelAddBuilding.addEventListener('click', () => window.closeAddBuildingModalFunc());

    // Project Select Change
    if (elements.projectSelect) {
        elements.projectSelect.addEventListener('change', (e) => {
            window.selectBuildingAndInspect(e.target.value);
        });
    }

    // Floor Select Change
    if (elements.floorSelect) {
        elements.floorSelect.addEventListener('change', (e) => {
            window.state.currentFloor = e.target.value;
            loadFloorDrawing(e.target.value);
        });
    }

    // Mode Toggle (PAN vs MARK)
    const btnModePan = document.getElementById('btnModePan');
    const btnModeMark = document.getElementById('btnModeMark');
    if (btnModePan && btnModeMark) {
        btnModePan.addEventListener('click', () => {
            state.mode = 'PAN';
            btnModePan.classList.add('active');
            btnModeMark.classList.remove('active');
        });
        btnModeMark.addEventListener('click', () => {
            state.mode = 'MARK';
            btnModeMark.classList.add('active');
            btnModePan.classList.remove('active');
        });
    }

    // Zoom Buttons
    const btnZoomIn = document.getElementById('btnZoomIn');
    if (btnZoomIn) btnZoomIn.addEventListener('click', () => {
        state.view.scale = Math.min(4.0, state.view.scale * 1.2);
        if (elements.zoomScaleText) elements.zoomScaleText.textContent = `${Math.round(state.view.scale * 100)}%`;
        drawCanvas();
    });

    const btnZoomOut = document.getElementById('btnZoomOut');
    if (btnZoomOut) btnZoomOut.addEventListener('click', () => {
        state.view.scale = Math.max(0.3, state.view.scale / 1.2);
        if (elements.zoomScaleText) elements.zoomScaleText.textContent = `${Math.round(state.view.scale * 100)}%`;
        drawCanvas();
    });

    const btnZoomFit = document.getElementById('btnZoomFit');
    if (btnZoomFit) btnZoomFit.addEventListener('click', () => {
        fitToScreen();
        drawCanvas();
    });

    // Pin Size Adjuster Slider
    if (elements.pinSizeRange) {
        elements.pinSizeRange.addEventListener('input', (e) => {
            state.pinSizeScale = parseFloat(e.target.value);
            if (elements.pinSizeLabel) elements.pinSizeLabel.textContent = `${Math.round(state.pinSizeScale * 100)}%`;
            drawCanvas();
        });
    }

    // --- 10. SURVEY TABLE & ALBUM RENDERING ---

    function renderSurveyTable() {
        if (!elements.surveyTableBody) return;
        const defects = getCurrentFloorDefects();
        if (elements.surveyFloorTitle) elements.surveyFloorTitle.textContent = state.currentFloor;

        if (defects.length === 0) {
            elements.surveyTableBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 2rem;">등록된 결함이 없습니다. 도면 점검 탭에서 결함을 마킹해 보세요.</td></tr>`;
            return;
        }

        elements.surveyTableBody.innerHTML = defects.map(d => `
            <tr>
                <td><strong>${d.no}</strong></td>
                <td><span class="tag-chip tag-${d.category === '구조체' ? 'structural' : d.category === '비구조체' ? 'nonstructural' : 'finishing'}">${d.category}</span></td>
                <td>${d.component}</td>
                <td>${d.defectType}</td>
                <td>${d.size}</td>
                <td><span class="grade-badge grade-${(d.grade || 'C').toLowerCase()}">${d.grade || 'C'}등급</span></td>
                <td>${d.action}</td>
                <td>📷 사진 미첨부</td>
                <td><button type="button" class="btn btn-sm btn-danger-outline" onclick="deleteDefectById('${d.id}')">삭제</button></td>
            </tr>
        `).join('');
    }

    function renderPhotoAlbum() {
        if (!elements.photoAlbumGrid) return;
        const defects = getCurrentFloorDefects();
        if (elements.albumFloorTitle) elements.albumFloorTitle.textContent = state.currentFloor;

        if (defects.length === 0) {
            elements.photoAlbumGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:3rem;">등록된 결함 사진이 없습니다.</div>`;
            return;
        }

        elements.photoAlbumGrid.innerHTML = defects.map(d => `
            <div class="photo-card" style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 0.8rem;">
                <div style="height: 160px; background: #334155; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #94a3b8;">
                    📷 현장 사진 (${d.component} ${d.defectType})
                </div>
                <div style="margin-top: 0.6rem; font-size: 0.88rem; font-weight: 700;">
                    [${d.no}] ${d.component} ${d.defectType} (${d.grade}등급)
                </div>
            </div>
        `).join('');
    }

    window.deleteDefectById = function(id) {
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        if (state.defects[key]) {
            state.defects[key] = state.defects[key].filter(d => d.id !== id);
            saveStateToLocalStorage();
            renderSurveyTable();
            drawCanvas();
        }
    };

    // --- 11. INITIALIZATION ---
    function init() {
        loadStateFromLocalStorage();
        setupCanvas();
        renderDashboard();
        window.switchTab('tab-home');
    }

    init();
    window.addEventListener('resize', resizeCanvas);
});
