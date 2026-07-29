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
        arrowSizeScale: 1.0,
        bgImage: null,
        canvas: null,
        ctx: null,
        floorSnapshots: {}
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
        arrowSizeRange: document.getElementById('arrowSizeRange'),
        arrowSizeLabel: document.getElementById('arrowSizeLabel'),
        
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
                lastUsedBuildingId: window.state.currentBuildingId || null,
                customDefectTypes: window.state.customDefectTypes || {},
                customDefectCauses: window.state.customDefectCauses || {}
            };
            localStorage.setItem('building_safety_app_state_v2', JSON.stringify(dataToSave));
        } catch (e) {
            console.warn('LocalStorage save warning:', e);
        }
    }

    function getDefaultBuildings() {
        return [
            {
                id: 'bldg-cheomdan-hospital',
                name: '🏢 첨단병원',
                address: '광주광역시 광산구 첨단중앙로 123 (첨단병원)',
                inspector: '홍길동 수석점검자',
                date: '2026-07-29',
                floors: '지상 5층 ~ 지하 1층',
                floorsList: [
                    { floorCode: '1F', floorLabel: '지상 1층 (1F)' },
                    { floorCode: '2F', floorLabel: '지상 2층 (2F)' },
                    { floorCode: '3F', floorLabel: '지상 3층 (3F)' },
                    { floorCode: '4F', floorLabel: '지상 4층 (4F)' },
                    { floorCode: '5F', floorLabel: '지상 5층 (5F)' }
                ],
                floorDrawings: {},
                notes: '첨단병원 정밀 안전점검 현장점검 도면 세트'
            }
        ];
    }

    function loadStateFromLocalStorage() {
        try {
            const saved = localStorage.getItem('building_safety_app_state_v2');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.buildings && Array.isArray(parsed.buildings) && parsed.buildings.length > 0) {
                    window.state.buildings = parsed.buildings.map(bldg => {
                        // Migration for legacy dong-based keys (101동 -> 1F, etc.)
                        if (bldg.floorDrawings || bldg.floorsList) {
                            const dongToFloor = { '101동': '1F', '102동': '2F', '103동': '3F', '104동': '4F', '105동': '5F' };
                            const floorToDong = { '1F': '101동', '2F': '102동', '3F': '103동', '4F': '104동', '5F': '105동' };
                            
                            if (bldg.floorDrawings) {
                                const newMap = { ...bldg.floorDrawings };
                                Object.entries(dongToFloor).forEach(([dKey, fKey]) => {
                                    if (newMap[dKey] && !newMap[fKey]) newMap[fKey] = newMap[dKey];
                                    if (newMap[fKey] && !newMap[dKey]) newMap[dKey] = newMap[fKey];
                                });
                                bldg.floorDrawings = newMap;
                            }
                        }
                        return bldg;
                    });
                } else {
                    window.state.buildings = getDefaultBuildings();
                }
                if (parsed.defects) {
                    window.state.defects = parsed.defects;
                }
                if (parsed.customDefectTypes) {
                    window.state.customDefectTypes = parsed.customDefectTypes;
                }
                if (parsed.customDefectCauses) {
                    window.state.customDefectCauses = parsed.customDefectCauses;
                }
            } else {
                window.state.buildings = getDefaultBuildings();
            }
        } catch (e) {
            console.error('LocalStorage load failed:', e);
            window.state.buildings = getDefaultBuildings();
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

        const isRotated = (state.rotationAngle === 90 || state.rotationAngle === 270);
        const drawW = isRotated ? imgH : imgW;
        const drawH = isRotated ? imgW : imgH;

        const scaleX = (cw - 40) / drawW;
        const scaleY = (ch - 40) / drawH;
        state.view.scale = Math.min(scaleX, scaleY, 1.2);
        state.view.offsetX = Math.max(20, (cw - drawW * state.view.scale) / 2);
        state.view.offsetY = Math.max(20, (ch - drawH * state.view.scale) / 2);
        
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

        const isLocalFileUrl = (typeof dataUrl === 'string' && dataUrl.startsWith('file:///'));

        const tryLoadImage = (srcUrl, isFallback = false) => {
            const img = new Image();
            img.onload = () => {
                state.bgImage = img;
                resizeCanvas();
                fitToScreen();
                drawCanvas();
            };
            img.onerror = () => {
                if (!isFallback) {
                    // Mobile or broken path fallback -> load high-res CAD Blueprint Data-URL
                    tryLoadImage(getDefaultBlueprintSvgDataUrl(floorCode || '1F'), true);
                } else {
                    resizeCanvas();
                    drawCanvas();
                }
            };
            img.src = srcUrl;
        };

        if (!dataUrl || (isLocalFileUrl && window.location.protocol !== 'file:')) {
            // Mobile browser or web server accessing local file:/// path -> use high-res CAD SVG immediately
            tryLoadImage(getDefaultBlueprintSvgDataUrl(floorCode || '1F'), true);
        } else {
            tryLoadImage(dataUrl, false);
        }
    }

    function getDefaultBlueprintSvgDataUrl(floorName) {
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="1400" height="850" viewBox="0 0 1400 850">
                <rect width="1400" height="850" fill="#0b1329"/>
                <!-- CAD Grid Lines -->
                <g stroke="rgba(56, 189, 248, 0.12)" stroke-width="1">
                    ${Array.from({length: 35}).map((_, i) => `<line x1="${i*40}" y1="0" x2="${i*40}" y2="850"/>`).join('')}
                    ${Array.from({length: 22}).map((_, i) => `<line x1="0" y1="${i*40}" x2="1400" y2="${i*40}"/>`).join('')}
                </g>
                <!-- Building Outer Boundary & Walls -->
                <rect x="120" y="90" width="1160" height="670" fill="none" stroke="#38bdf8" stroke-width="5"/>
                <rect x="135" y="105" width="1130" height="640" fill="none" stroke="rgba(56, 189, 248, 0.4)" stroke-width="2" stroke-dasharray="8 4"/>
                
                <!-- Internal Structural Rooms & Walls -->
                <rect x="150" y="120" width="340" height="280" fill="rgba(30, 41, 59, 0.5)" stroke="#38bdf8" stroke-width="3"/>
                <rect x="520" y="120" width="360" height="280" fill="rgba(30, 41, 59, 0.5)" stroke="#38bdf8" stroke-width="3"/>
                <rect x="910" y="120" width="340" height="280" fill="rgba(30, 41, 59, 0.5)" stroke="#38bdf8" stroke-width="3"/>
                
                <rect x="150" y="430" width="530" height="300" fill="rgba(30, 41, 59, 0.5)" stroke="#38bdf8" stroke-width="3"/>
                <rect x="710" y="430" width="540" height="300" fill="rgba(30, 41, 59, 0.5)" stroke="#38bdf8" stroke-width="3"/>

                <!-- Structural Columns (C1, C2, C3) -->
                ${[[150,120],[490,120],[520,120],[880,120],[910,120],[1250,120],
                   [150,400],[490,400],[520,400],[880,400],[910,400],[1250,400],
                   [150,430],[680,430],[710,430],[1250,430],
                   [150,730],[680,730],[710,730],[1250,730]].map(([cx, cy]) => `
                    <rect x="${cx-10}" y="${cy-10}" width="20" height="20" fill="#f43f5e" stroke="#fff" stroke-width="1.5"/>
                `).join('')}

                <!-- Dimension Lines -->
                <line x1="120" y1="55" x2="1280" y2="55" stroke="#f59e0b" stroke-width="2"/>
                <text x="700" y="45" fill="#f59e0b" font-size="16" font-weight="bold" text-anchor="middle">X-AXIS DIMENSION: 28,400 mm</text>
                
                <line x1="55" y1="90" x2="55" y2="760" stroke="#f59e0b" stroke-width="2"/>
                <text x="45" y="435" fill="#f59e0b" font-size="16" font-weight="bold" text-anchor="middle" transform="rotate(-90 45 435)">Y-AXIS DIMENSION: 16,800 mm</text>

                <!-- Zone Labels -->
                <text x="320" y="270" fill="#e2e8f0" font-size="22" font-weight="bold" text-anchor="middle">ZONE A (${floorName})</text>
                <text x="700" y="270" fill="#e2e8f0" font-size="22" font-weight="bold" text-anchor="middle">코어 및 계단실 (CORE)</text>
                <text x="1080" y="270" fill="#e2e8f0" font-size="22" font-weight="bold" text-anchor="middle">ZONE B (${floorName})</text>
                <text x="415" y="590" fill="#94a3b8" font-size="20" text-anchor="middle">주차장 / 로비 구역</text>
                <text x="980" y="590" fill="#94a3b8" font-size="20" text-anchor="middle">기계실 / 전기실 구역</text>

                <!-- Architectural Title Block -->
                <rect x="850" y="650" width="390" height="70" fill="rgba(15, 23, 42, 0.9)" stroke="#38bdf8" stroke-width="2"/>
                <text x="865" y="678" fill="#38bdf8" font-size="16" font-weight="bold">도휘에드가9차 현장점검 CAD 평면도 [${floorName}]</text>
                <text x="865" y="704" fill="#94a3b8" font-size="13">스마트 건축물 안전점검 시스템 | SCALE 1:100</text>
            </svg>
        `;
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    function viewToImgCoords(vx, vy) {
        const angle = state.rotationAngle || 0;
        const img = state.bgImage;
        const imgW = img ? (img.naturalWidth || img.width || 1200) : 1200;
        const imgH = img ? (img.naturalHeight || img.height || 700) : 700;

        if (angle === 90) {
            return { x: vy, y: imgH - vx };
        } else if (angle === 180) {
            return { x: imgW - vx, y: imgH - vy };
        } else if (angle === 270) {
            return { x: imgW - vy, y: vx };
        }
        return { x: vx, y: vy };
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

        const angle = state.rotationAngle || 0;
        const img = state.bgImage;
        const imgW = img ? (img.naturalWidth || img.width || 1200) : 1200;
        const imgH = img ? (img.naturalHeight || img.height || 700) : 700;

        ctx.save();
        if (angle === 90) {
            ctx.translate(imgH, 0);
            ctx.rotate((90 * Math.PI) / 180);
        } else if (angle === 180) {
            ctx.translate(imgW, imgH);
            ctx.rotate((180 * Math.PI) / 180);
        } else if (angle === 270) {
            ctx.translate(0, imgW);
            ctx.rotate((270 * Math.PI) / 180);
        }

        if (state.bgImage) {
            ctx.drawImage(state.bgImage, 0, 0);
        }

        // Draw Defect Pins INSIDE the rotated context so pins rotate WITH the drawing!
        const currentDefects = getCurrentFloorDefects();
        currentDefects.forEach(defect => drawPin(ctx, defect));

        // Draw Live Marking Drag Preview
        if (isMarkingDrag) {
            const nextSeq = (currentDefects.length + 1);
            const nextSeqStr = nextSeq < 10 ? `0${nextSeq}` : `${nextSeq}`;
            const liveNoStr = `NO.${nextSeqStr}`;
            drawPin(ctx, {
                no: liveNoStr,
                category: document.getElementById('defectCategory')?.value || '구조체',
                x: liveBoxImgX,
                y: liveBoxImgY,
                targetX: markTargetImgX,
                targetY: markTargetImgY
            });
        }

        ctx.restore(); // Restore drawing rotation matrix

        ctx.restore(); // Restore view offset & scale

        if (state.canvas && state.currentFloor) {
            try {
                if (!state.floorSnapshots) state.floorSnapshots = {};
                state.floorSnapshots[state.currentFloor] = state.canvas.toDataURL('image/png');
            } catch(e) {}
        }
    }

    function getCurrentFloorDefects() {
        if (!state.currentBuildingId) return [];
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        return state.defects[key] || [];
    }

    function drawPin(ctx, defect) {
        const boxX = defect.x || 100;
        const boxY = defect.y || 100;
        const scale = state.pinSizeScale || 1.0;
        const arrowScale = state.arrowSizeScale || 1.0;
        const isBeingDragged = (typeof activeDragPin !== 'undefined' && activeDragPin && activeDragPin.id === defect.id);

        // Category Theme Color: Red (구조체), Blue (비구조체), Orange (마감재)
        let mainColor = '#ef4444'; // Red
        if (defect.category === '비구조체') mainColor = '#3b82f6'; // Blue
        if (defect.category === '마감재') mainColor = '#f97316'; // Orange

        const activeColor = isBeingDragged ? '#facc15' : mainColor;

        // Leader Line & Arrow Tip Rendering (Color matched to Red/Blue/Orange)
        if (defect.targetX !== undefined && defect.targetY !== undefined) {
            const targetX = defect.targetX;
            const targetY = defect.targetY;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(boxX, boxY);
            ctx.lineTo(targetX, targetY);
            ctx.strokeStyle = activeColor;
            ctx.lineWidth = (isBeingDragged ? 3 : 2) * arrowScale;
            ctx.setLineDash([4, 3]);
            ctx.stroke();

            ctx.fillStyle = activeColor;
            if (state.tipShape === 'circle') {
                ctx.beginPath();
                ctx.arc(targetX, targetY, (isBeingDragged ? 6 : 4.5) * arrowScale, 0, Math.PI * 2);
                ctx.fill();
            } else {
                const dx = targetX - boxX;
                const dy = targetY - boxY;
                const angle = Math.atan2(dy, dx);
                const arrowLen = (isBeingDragged ? 13 : 10) * arrowScale;

                ctx.beginPath();
                ctx.moveTo(targetX, targetY);
                ctx.lineTo(targetX - arrowLen * Math.cos(angle - Math.PI / 6), targetY - arrowLen * Math.sin(angle - Math.PI / 6));
                ctx.lineTo(targetX - arrowLen * Math.cos(angle + Math.PI / 6), targetY - arrowLen * Math.sin(angle + Math.PI / 6));
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        }

        // Pin Box & Text Label Rendering (Transparent Background + Red/Blue/Orange Border & Text)
        ctx.save();
        ctx.translate(boxX, boxY);

        ctx.shadowColor = isBeingDragged ? '#facc15' : 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = (isBeingDragged ? 16 : 6) * scale;

        // Pure White Solid Background
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = (isBeingDragged ? 3 : 2) * scale;

        const w = 38 * scale;
        const h = 26 * scale;

        if (state.pinShape === 'circle') {
            ctx.beginPath();
            ctx.arc(0, 0, 16 * scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.fillRect(-w / 2, -h / 2, w, h);
            ctx.strokeRect(-w / 2, -h / 2, w, h);
        }

        // Text matching Red / Blue / Orange
        ctx.fillStyle = activeColor;
        ctx.font = `bold ${Math.round(13 * scale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(defect.no || 'NO.01', 0, 0);

        ctx.restore();
    }

    // --- Dynamic Defect Type Presets & Custom Adding ---
    const categoryDefectPreset = {
        '구조체': [
            '균열 (Crack)', 
            '누수 (Leakage)', 
            '철근노출 (Rebar Exposure)', 
            '백태/유출 (Efflorescence)', 
            '박리/박락 (Spalling)', 
            '신축이음/재료분리 손상', 
            '기타'
        ],
        '비구조체': [
            '조적벽체 균열', 
            '조인트 이격/파손', 
            '천장재 들뜸/탈락', 
            '설비 배관 누수/손상', 
            '창호/유리 이격', 
            '기타'
        ],
        '마감재': [
            '타일 들뜸/탈락', 
            '몰탈 균열', 
            '도장 페인트 변색/탈락', 
            '방수층 손상/들뜸', 
            '석재 팟칭/Crack', 
            '기타'
        ]
    };

    function updateDefectTypeDropdown(category, currentVal = null) {
        const select = document.getElementById('defectType');
        if (!select) return;

        if (!window.state.customDefectTypes) {
            window.state.customDefectTypes = { '구조체': [], '비구조체': [], '마감재': [] };
        }

        const presetList = categoryDefectPreset[category] || categoryDefectPreset['구조체'];
        const customList = window.state.customDefectTypes[category] || [];

        let html = '';
        presetList.forEach(item => {
            const sel = (currentVal && currentVal === item) ? 'selected' : '';
            html += `<option value="${item}" ${sel}>${item}</option>`;
        });

        customList.forEach(item => {
            if (!presetList.includes(item)) {
                const sel = (currentVal && currentVal === item) ? 'selected' : '';
                html += `<option value="${item}" ${sel}>⭐ [추가됨] ${item}</option>`;
            }
        });

        html += `<option value="__ADD_CUSTOM__">➕ [결함 종류 직접 추가...]</option>`;
        select.innerHTML = html;

        if (currentVal && !presetList.includes(currentVal) && !customList.includes(currentVal)) {
            const customOpt = document.createElement('option');
            customOpt.value = currentVal;
            customOpt.textContent = `⭐ ${currentVal}`;
            customOpt.selected = true;
            select.insertBefore(customOpt, select.lastElementChild);
        }

        // Trigger cause update for current defect type
        updateDefectCauseDropdown(select.value);
    }

    // --- Dynamic Defect Cause Presets & Custom Adding ---
    const defectCausePreset = {
        '균열': ['건조수축', '내력부족', '건축물 부등침하', '시공불량', '신축이음 불량', '온도변화/열응력', '기타'],
        '누수': ['상부 방수층 파손', '수분침투', '배관 파손/연결부 누수', '지하수 유입', '균열부 틈새 유입', '기타'],
        '철근노출': ['피복두께 부족', '콘크리트 중성화', '염해 손상', '시공 다짐불량', '기타'],
        '백태': ['수분 유입 및 찌꺼기 용해', '방수 손상', '백태 현상(Efflorescence)', '기타'],
        '박리': ['철근 부식 부팽창', '동결융해 팽창', '부착력 저하', '기타'],
        '조적': ['기단부 침하', '지진/진동', '접합부 마감재 이격', '기타'],
        '타일': ['부착 접착제 경화', '온도변화 열팽창', '습기 침투', '기타'],
        '몰탈': ['건조수축', '초기 배합비 불량', '바탕재 부착불량', '기타'],
        '도장': ['습기 유입', '자외선 노후화', '바탕면 시공불량', '기타'],
        '방수': ['방수재 노후화', '시공 시 바탕재 미흡', '구조체 변형', '기타']
    };

    function getCauseKey(defectType) {
        let key = '기타';
        for (const k in defectCausePreset) {
            if (defectType && defectType.includes(k)) {
                key = k;
                break;
            }
        }
        return key;
    }

    function updateDefectCauseDropdown(defectType, currentVal = null) {
        const select = document.getElementById('defectCause');
        if (!select) return;

        if (!window.state.customDefectCauses) {
            window.state.customDefectCauses = {};
        }

        const key = getCauseKey(defectType);
        const presetList = defectCausePreset[key] || ['건조수축', '내력부족', '건축물 부등침하', '시공불량', '방수층 파손', '자연 노후화', '기타'];
        const customList = window.state.customDefectCauses[key] || [];

        let html = '';
        presetList.forEach(item => {
            const sel = (currentVal && currentVal === item) ? 'selected' : '';
            html += `<option value="${item}" ${sel}>${item}</option>`;
        });

        customList.forEach(item => {
            if (!presetList.includes(item)) {
                const sel = (currentVal && currentVal === item) ? 'selected' : '';
                html += `<option value="${item}" ${sel}>⭐ [추가됨] ${item}</option>`;
            }
        });

        html += `<option value="__ADD_CUSTOM_CAUSE__">➕ [결함 원인 직접 추가...]</option>`;
        select.innerHTML = html;

        if (currentVal && !presetList.includes(currentVal) && !customList.includes(currentVal)) {
            const customOpt = document.createElement('option');
            customOpt.value = currentVal;
            customOpt.textContent = `⭐ ${currentVal}`;
            customOpt.selected = true;
            select.insertBefore(customOpt, select.lastElementChild);
        }
    }

    // Category Change Listener & Custom Option Click
    const defectCategorySelect = document.getElementById('defectCategory');
    if (defectCategorySelect) {
        defectCategorySelect.addEventListener('change', (e) => {
            updateDefectTypeDropdown(e.target.value);
        });
    }

    const defectTypeSelect = document.getElementById('defectType');
    if (defectTypeSelect) {
        defectTypeSelect.addEventListener('change', (e) => {
            if (e.target.value === '__ADD_CUSTOM__') {
                const newType = prompt('추가하실 결함 종류를 입력하세요 (예: 에어컨 배관 이격):');
                const cat = document.getElementById('defectCategory')?.value || '구조체';
                if (newType && newType.trim()) {
                    const trimmed = newType.trim();
                    if (!window.state.customDefectTypes) window.state.customDefectTypes = { '구조체': [], '비구조체': [], '마감재': [] };
                    if (!window.state.customDefectTypes[cat]) window.state.customDefectTypes[cat] = [];
                    if (!window.state.customDefectTypes[cat].includes(trimmed)) {
                        window.state.customDefectTypes[cat].push(trimmed);
                        saveStateToLocalStorage();
                    }
                    updateDefectTypeDropdown(cat, trimmed);
                } else {
                    updateDefectTypeDropdown(cat);
                }
            } else {
                updateDefectCauseDropdown(e.target.value);
            }
        });
    }

    const defectCauseSelect = document.getElementById('defectCause');
    if (defectCauseSelect) {
        defectCauseSelect.addEventListener('change', (e) => {
            if (e.target.value === '__ADD_CUSTOM_CAUSE__') {
                const newCause = prompt('추가하실 결함 원인 추정 내용을 입력하세요 (예: 지하수관 수압 유입):');
                const dType = document.getElementById('defectType')?.value || '균열';
                const key = getCauseKey(dType);
                if (newCause && newCause.trim()) {
                    const trimmed = newCause.trim();
                    if (!window.state.customDefectCauses) window.state.customDefectCauses = {};
                    if (!window.state.customDefectCauses[key]) window.state.customDefectCauses[key] = [];
                    if (!window.state.customDefectCauses[key].includes(trimmed)) {
                        window.state.customDefectCauses[key].push(trimmed);
                        saveStateToLocalStorage();
                    }
                    updateDefectCauseDropdown(dType, trimmed);
                } else {
                    updateDefectCauseDropdown(dType);
                }
            }
        });
    }

    // Canvas Mouse & Touch Event Handlers with 1-second Long-Press Pin & Arrow Dragging
    let isDragging = false;
    let isMarkingDrag = false;
    let longPressTimer = null;
    let isDraggingPin = false;
    let activeDragPin = null;
    let activeDragPart = 'BOX'; // 'BOX' or 'TIP'

    let markTargetImgX = 0;
    let markTargetImgY = 0;
    let liveBoxImgX = 0;
    let liveBoxImgY = 0;

    let startMouseX = 0;
    let startMouseY = 0;
    let initialOffsetX = 0;
    let initialOffsetY = 0;

    function findHitPinPart(imgX, imgY) {
        const defects = getCurrentFloorDefects();
        const scale = state.pinSizeScale || 1.0;
        const arrowScale = state.arrowSizeScale || 1.0;

        for (let i = defects.length - 1; i >= 0; i--) {
            const d = defects[i];
            
            // 1. Check Hit on Arrowhead Tip (targetX, targetY)
            if (d.targetX !== undefined && d.targetY !== undefined) {
                const distTip = Math.hypot(imgX - d.targetX, imgY - d.targetY);
                if (distTip <= 28 * arrowScale) {
                    return { defect: d, part: 'TIP' };
                }
            }

            // 2. Check Hit on Pin Box (x, y)
            const bx = d.x || 100;
            const by = d.y || 100;
            const distBox = Math.hypot(imgX - bx, imgY - by);
            if (distBox <= 32 * scale) {
                return { defect: d, part: 'BOX' };
            }
        }
        return null;
    }

    function handleDragStart(clientX, clientY) {
        if (!elements.planCanvas) return;
        const rect = elements.planCanvas.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;
        const vx = (mouseX - state.view.offsetX) / state.view.scale;
        const vy = (mouseY - state.view.offsetY) / state.view.scale;
        const coords = viewToImgCoords(vx, vy);
        const imgX = coords.x;
        const imgY = coords.y;

        startMouseX = clientX;
        startMouseY = clientY;
        initialOffsetX = state.view.offsetX;
        initialOffsetY = state.view.offsetY;

        // Check if existing pin box or arrowhead tip was clicked
        const hitInfo = findHitPinPart(imgX, imgY);
        if (hitInfo) {
            // Start 1-second (1000ms) long-press timer for moving box or tip
            longPressTimer = setTimeout(() => {
                isDraggingPin = true;
                activeDragPin = hitInfo.defect;
                activeDragPart = hitInfo.part;
                elements.planCanvas.style.cursor = 'move';
                drawCanvas();
            }, 1000);
            return;
        }

        if (state.mode === 'MARK') {
            isMarkingDrag = true;
            markTargetImgX = imgX;
            markTargetImgY = imgY;
            liveBoxImgX = markTargetImgX + 35;
            liveBoxImgY = markTargetImgY - 35;
            drawCanvas();
        } else {
            isDragging = true;
            elements.planCanvas.style.cursor = 'grabbing';
        }
    }

    function handleDragMove(clientX, clientY) {
        if (!elements.planCanvas) return;
        const rect = elements.planCanvas.getBoundingClientRect();

        if (longPressTimer && !isDraggingPin) {
            const dx = clientX - startMouseX;
            const dy = clientY - startMouseY;
            if (Math.hypot(dx, dy) > 8) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                if (state.mode !== 'MARK') {
                    isDragging = true;
                }
            }
        }

        if (isDraggingPin && activeDragPin) {
            const mouseX = clientX - rect.left;
            const mouseY = clientY - rect.top;
            const vx = (mouseX - state.view.offsetX) / state.view.scale;
            const vy = (mouseY - state.view.offsetY) / state.view.scale;
            const coords = viewToImgCoords(vx, vy);
            const currentImgX = coords.x;
            const currentImgY = coords.y;

            if (activeDragPart === 'TIP') {
                activeDragPin.targetX = currentImgX;
                activeDragPin.targetY = currentImgY;
            } else {
                activeDragPin.x = currentImgX;
                activeDragPin.y = currentImgY;
            }
            drawCanvas();
        } else if (isMarkingDrag) {
            const mouseX = clientX - rect.left;
            const mouseY = clientY - rect.top;
            const vx = (mouseX - state.view.offsetX) / state.view.scale;
            const vy = (mouseY - state.view.offsetY) / state.view.scale;
            const coords = viewToImgCoords(vx, vy);
            liveBoxImgX = coords.x;
            liveBoxImgY = coords.y;
            drawCanvas();
        } else if (isDragging) {
            const dx = clientX - startMouseX;
            const dy = clientY - startMouseY;
            state.view.offsetX = initialOffsetX + dx;
            state.view.offsetY = initialOffsetY + dy;
            drawCanvas();
        }
    }

    function handleDragEnd() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;

            // If released before 1-second long-press without dragging, open edit modal for existing pin
            if (!isDraggingPin && elements.planCanvas) {
                const rect = elements.planCanvas.getBoundingClientRect();
                const mouseX = startMouseX - rect.left;
                const mouseY = startMouseY - rect.top;
                const vx = (mouseX - state.view.offsetX) / state.view.scale;
                const vy = (mouseY - state.view.offsetY) / state.view.scale;
                const coords = viewToImgCoords(vx, vy);
                const imgX = coords.x;
                const imgY = coords.y;
                const hitInfo = findHitPinPart(imgX, imgY);
                if (hitInfo) {
                    openAddDefectModal(hitInfo.defect.x, hitInfo.defect.y, hitInfo.defect.targetX, hitInfo.defect.targetY, hitInfo.defect);
                    return;
                }
            }
        }

        if (isDraggingPin) {
            isDraggingPin = false;
            activeDragPin = null;
            saveStateToLocalStorage();
            drawCanvas();
        }

        if (isMarkingDrag) {
            isMarkingDrag = false;
            openAddDefectModal(liveBoxImgX, liveBoxImgY, markTargetImgX, markTargetImgY);
        }

        isDragging = false;
        if (elements.planCanvas) {
            elements.planCanvas.style.cursor = state.mode === 'MARK' ? 'crosshair' : 'grab';
        }
    }

    if (elements.planCanvas) {
        // Mouse Events
        elements.planCanvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) handleDragStart(e.clientX, e.clientY);
        });

        window.addEventListener('mousemove', (e) => {
            if (isDragging || isMarkingDrag || isDraggingPin || longPressTimer) handleDragMove(e.clientX, e.clientY);
        });

        window.addEventListener('mouseup', () => {
            if (isDragging || isMarkingDrag || isDraggingPin || longPressTimer) handleDragEnd();
        });

        // Touch Events (Galaxy Tab & Smartphone Support)
        elements.planCanvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: true });

        window.addEventListener('touchmove', (e) => {
            if ((isDragging || isMarkingDrag || isDraggingPin || longPressTimer) && e.touches.length === 1) {
                handleDragMove(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: true });

        window.addEventListener('touchend', () => {
            if (isDragging || isMarkingDrag || isDraggingPin || longPressTimer) handleDragEnd();
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

    function closeDefectModal() {
        if (elements.defectModal) {
            elements.defectModal.style.display = 'none';
            elements.defectModal.classList.remove('open');
        }
    }

    function openAddDefectModal(boxX, boxY, targetX, targetY, existingPin = null) {
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        const defects = state.defects[key] || [];

        const pinIdEl = document.getElementById('defectPinId');
        const noEl = document.getElementById('defectNo');
        const catEl = document.getElementById('defectCategory');
        const compEl = document.getElementById('defectComponent');
        const locEl = document.getElementById('defectLocation');
        const sizeEl = document.getElementById('defectSize');
        const progCheckEl = document.getElementById('defectProgressCheck');
        const leakCheckEl = document.getElementById('defectLeakCheck');

        if (existingPin) {
            if (pinIdEl) pinIdEl.value = existingPin.id;
            if (noEl) noEl.value = existingPin.no || 'NO.01';
            if (catEl) catEl.value = existingPin.category || '구조체';
            updateDefectTypeDropdown(existingPin.category || '구조체', existingPin.defectType);
            updateDefectCauseDropdown(existingPin.defectType || '균열', existingPin.cause);
            if (compEl) compEl.value = existingPin.component || '기둥';
            if (locEl) locEl.value = existingPin.location || `${state.currentFloor} ${existingPin.component || '기둥'}`;
            if (sizeEl) sizeEl.value = existingPin.size || 'W=0.2mm';
            if (progCheckEl) progCheckEl.checked = !!existingPin.isProgress;
            if (leakCheckEl) leakCheckEl.checked = !!existingPin.isLeak;

            window._pendingPhotos = existingPin.photos || [];
            window._pendingPinCoords = { x: existingPin.x, y: existingPin.y, targetX: existingPin.targetX, targetY: existingPin.targetY };
        } else {
            const seq = defects.length + 1;
            const seqStr = seq < 10 ? `0${seq}` : `${seq}`;
            const defectNoStr = `NO.${seqStr}`;

            if (pinIdEl) pinIdEl.value = '';
            if (noEl) noEl.value = defectNoStr;
            if (catEl) catEl.value = '구조체';
            updateDefectTypeDropdown('구조체');
            updateDefectCauseDropdown('균열 (Crack)');
            if (compEl) compEl.value = '기둥';
            if (locEl) locEl.value = `${state.currentFloor} 기둥 C1`;
            if (sizeEl) sizeEl.value = '';
            if (progCheckEl) progCheckEl.checked = false;
            if (leakCheckEl) leakCheckEl.checked = false;

            window._pendingPhotos = [];
            window._pendingPinCoords = { 
                x: boxX, 
                y: boxY, 
                targetX: targetX !== undefined ? targetX : (boxX - 35), 
                targetY: targetY !== undefined ? targetY : (boxY + 35) 
            };
        }

        renderPhotoPreviewList();

        if (elements.defectModal) {
            elements.defectModal.style.display = 'flex';
            elements.defectModal.classList.add('open');
        }
    }

    function renderPhotoPreviewList() {
        const previewList = document.getElementById('photoPreviewList');
        if (!previewList) return;
        const photos = window._pendingPhotos || [];
        if (photos.length === 0) {
            previewList.innerHTML = '';
            return;
        }
        previewList.innerHTML = photos.map((src, idx) => `
            <div style="display:inline-block; position:relative; margin-right:8px; margin-top:8px;">
                <img src="${src}" style="width:65px; height:65px; object-fit:cover; border-radius:6px; border:1px solid #38bdf8;">
                <span style="position:absolute; top:-6px; right:-6px; background:#ef4444; color:#fff; border-radius:50%; width:18px; height:18px; text-align:center; font-size:12px; cursor:pointer; line-height:18px;" onclick="window.removePendingPhoto(${idx})">×</span>
            </div>
        `).join('');
    }

    window.removePendingPhoto = function(idx) {
        if (window._pendingPhotos) {
            window._pendingPhotos.splice(idx, 1);
            renderPhotoPreviewList();
        }
    };

    const inputDefectPhoto = document.getElementById('inputDefectPhoto');
    const photoUploadArea = document.getElementById('photoUploadArea');
    if (photoUploadArea && inputDefectPhoto) {
        photoUploadArea.onclick = () => inputDefectPhoto.click();
        inputDefectPhoto.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                window.compressDrawingImage(file, 1000, 0.85).then(compressedUrl => {
                    if (!window._pendingPhotos) window._pendingPhotos = [];
                    window._pendingPhotos.push(compressedUrl);
                    renderPhotoPreviewList();
                });
            }
        };
    }

    const btnCloseDefectModal = document.getElementById('btnCloseDefectModal');
    if (btnCloseDefectModal) {
        btnCloseDefectModal.addEventListener('click', closeDefectModal);
    }

    const btnCancelDefect = document.getElementById('btnCancelDefect');
    if (btnCancelDefect) {
        btnCancelDefect.addEventListener('click', closeDefectModal);
    }

    const btnDeleteDefect = document.getElementById('btnDeleteDefect');
    if (btnDeleteDefect) {
        btnDeleteDefect.addEventListener('click', () => {
            const pinId = document.getElementById('defectPinId').value;
            if (pinId) {
                window.deleteDefectById(pinId);
            }
            closeDefectModal();
        });
    }

    const btnSaveDefect = document.getElementById('btnSaveDefect');
    if (btnSaveDefect) {
        btnSaveDefect.addEventListener('click', () => {
            if (!state.currentBuildingId) return;
            const key = `${state.currentBuildingId}_${state.currentFloor}`;
            if (!state.defects[key]) state.defects[key] = [];

            const pinId = document.getElementById('defectPinId').value;
            const coords = window._pendingPinCoords || { x: 200, y: 200, targetX: 165, targetY: 235 };

            const locVal = document.getElementById('defectLocation')?.value || `${state.currentFloor} ${document.getElementById('defectComponent')?.value || '기둥'}`;
            const isProgress = document.getElementById('defectProgressCheck')?.checked || false;
            const isLeak = document.getElementById('defectLeakCheck')?.checked || false;
            const photosVal = window._pendingPhotos || [];

            if (pinId) {
                // Update existing defect
                const idx = state.defects[key].findIndex(d => d.id === pinId);
                if (idx !== -1) {
                    state.defects[key][idx].no = document.getElementById('defectNo')?.value || 'NO.01';
                    state.defects[key][idx].category = document.getElementById('defectCategory')?.value || '구조체';
                    state.defects[key][idx].component = document.getElementById('defectComponent')?.value || '기둥';
                    state.defects[key][idx].location = locVal;
                    state.defects[key][idx].defectType = document.getElementById('defectType')?.value || '균열';
                    state.defects[key][idx].cause = document.getElementById('defectCause')?.value || '건조수축';
                    state.defects[key][idx].size = document.getElementById('defectSize')?.value || 'W=0.2mm';
                    state.defects[key][idx].isProgress = isProgress;
                    state.defects[key][idx].isLeak = isLeak;
                    state.defects[key][idx].photos = photosVal;
                }
            } else {
                // Add new defect
                const newDefect = {
                    id: 'pin-' + Date.now(),
                    no: document.getElementById('defectNo')?.value || 'NO.01',
                    category: document.getElementById('defectCategory')?.value || '구조체',
                    component: document.getElementById('defectComponent')?.value || '기둥',
                    location: locVal,
                    defectType: document.getElementById('defectType')?.value || '균열',
                    cause: document.getElementById('defectCause')?.value || '건조수축',
                    size: document.getElementById('defectSize')?.value || 'W=0.2mm',
                    isProgress: isProgress,
                    isLeak: isLeak,
                    photos: photosVal,
                    x: coords.x,
                    y: coords.y,
                    targetX: coords.targetX,
                    targetY: coords.targetY
                };
                state.defects[key].push(newDefect);
            }

            saveStateToLocalStorage();
            closeDefectModal();
            drawCanvas();
        });
    }

    // --- 9. BUTTON CONTROLS & LISTENERS ---

    // Main Navigation Tabs Click Listener
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetTab = e.currentTarget.dataset.tab;
            if (targetTab) {
                window.switchTab(targetTab);
            }
        });
    });

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

    // Drawing Rotate Button
    const btnRotateDrawing = document.getElementById('btnRotateDrawing');
    if (btnRotateDrawing) {
        btnRotateDrawing.addEventListener('click', () => {
            state.rotationAngle = ((state.rotationAngle || 0) + 90) % 360;
            fitToScreen();
            drawCanvas();
        });
    }

    // Pin Size Adjuster Slider
    if (elements.pinSizeRange) {
        elements.pinSizeRange.addEventListener('input', (e) => {
            state.pinSizeScale = parseFloat(e.target.value);
            if (elements.pinSizeLabel) elements.pinSizeLabel.textContent = `${Math.round(state.pinSizeScale * 100)}%`;
            drawCanvas();
        });
    }

    // Arrow Size Adjuster Slider
    if (elements.arrowSizeRange) {
        elements.arrowSizeRange.addEventListener('input', (e) => {
            state.arrowSizeScale = parseFloat(e.target.value);
            if (elements.arrowSizeLabel) elements.arrowSizeLabel.textContent = `${Math.round(state.arrowSizeScale * 100)}%`;
            drawCanvas();
        });
    }

    // --- 10. SURVEY TABLE & ALBUM RENDERING ---

    function renderSurveyTable() {
        if (!elements.surveyTableBody) return;
        const defects = getCurrentFloorDefects();
        if (elements.surveyFloorTitle) elements.surveyFloorTitle.textContent = state.currentFloor;

        if (defects.length === 0) {
            elements.surveyTableBody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding: 2.5rem; color:#64748b; font-weight:600;">등록된 결함이 없습니다. 도면 점검 탭에서 결함을 마킹해 보세요.</td></tr>`;
            return;
        }

        elements.surveyTableBody.innerHTML = defects.map(d => {
            // Photo Remarks: 사진01 사진02 format, - if no photo
            let photoRemark = '-';
            if (d.photos && d.photos.length > 0) {
                photoRemark = d.photos.map((_, pIdx) => {
                    const num = (pIdx + 1) < 10 ? `0${pIdx + 1}` : `${pIdx + 1}`;
                    return `사진${num}`;
                }).join(' ');
            } else if (d.photoUrl || d.hasPhoto) {
                photoRemark = '사진01';
            }

            const structDisplay = (d.category === '구조체') ? '○' : '-';
            const progressDisplay = d.isProgress ? '진행중' : '-';
            const leakDisplay = d.isLeak ? '누수중' : '-';

            return `
                <tr>
                    <td><strong style="color:#0284c7; font-size:0.95rem;">${d.no}</strong></td>
                    <td><span style="font-weight:700; color:#1e293b;">${d.location || (state.currentFloor + ' ' + (d.component || '기둥'))}</span></td>
                    <td><span style="font-weight:700; color:#0369a1;">${d.defectType}</span></td>
                    <td><span style="font-weight:800; font-size:1.15rem; color:${structDisplay === '○' ? '#ef4444' : '#94a3b8'};">${structDisplay}</span></td>
                    <td>${d.size || 'W=0.2mm'}</td>
                    <td><span style="font-weight:800; font-size:0.92rem; color:${progressDisplay === '진행중' ? '#dc2626' : '#94a3b8'};">${progressDisplay}</span></td>
                    <td><span style="font-weight:800; font-size:0.92rem; color:${leakDisplay === '누수중' ? '#0284c7' : '#94a3b8'};">${leakDisplay}</span></td>
                    <td><span style="font-weight:700; color:#334155;">🔍 ${d.cause || '건조수축'}</span></td>
                    <td><span style="font-weight:700; color:${photoRemark !== '-' ? '#2563eb' : '#94a3b8'};">${photoRemark}</span></td>
                    <td><button type="button" class="btn btn-sm btn-danger-outline" onclick="deleteDefectById('${d.id}')">삭제</button></td>
                </tr>
            `;
        }).join('');
    }

    function renderPhotoAlbum() {
        if (!elements.photoAlbumGrid) return;
        const defects = getCurrentFloorDefects();
        if (elements.albumFloorTitle) elements.albumFloorTitle.textContent = state.currentFloor;

        if (defects.length === 0) {
            elements.photoAlbumGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:3rem; color:#94a3b8; font-weight:600;">등록된 결함 사진이 없습니다. 도면 점검 탭에서 결함을 마킹해 보세요.</div>`;
            return;
        }

        let photoCounter = 0;
        let html = '';

        defects.forEach(d => {
            const componentDefectTitle = `${d.component || '부재'} ${d.defectType || '결함'}`;
            const photos = (d.photos && d.photos.length > 0) ? d.photos : [null];

            photos.forEach(photoSrc => {
                photoCounter++;
                const photoNumStr = photoCounter < 10 ? `0${photoCounter}` : `${photoCounter}`;
                const photoLabel = `사진${photoNumStr}`;

                html += `
                    <div class="photo-card" style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); color: #0f172a;">
                        <div class="photo-card-img-wrap" style="height: 190px; background: #f1f5f9; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center;">
                            ${photoSrc ? `<img src="${photoSrc}" style="width:100%; height:100%; object-fit:cover;">` : `<div style="text-align:center; color:#64748b; font-weight:700;"><i class="fa-solid fa-camera" style="font-size:2rem; margin-bottom:0.4rem; color:#cbd5e1;"></i><br>📷 ${photoLabel} 현장 사진 미첨부</div>`}
                            <span style="position: absolute; top: 10px; left: 10px; background: #0284c7; color: #ffffff; font-weight: 800; font-size: 0.85rem; padding: 0.25rem 0.7rem; border-radius: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">
                                ${photoLabel}
                            </span>
                        </div>
                        <div style="padding: 0.8rem; text-align: center;">
                            <div style="font-size: 1rem; font-weight: 800; color: #0369a1;">
                                ${photoLabel}. ${componentDefectTitle}
                            </div>
                        </div>
                    </div>
                `;
            });
        });

        elements.photoAlbumGrid.innerHTML = html;
    }

    function drawPinSafe(ctx, defect) {
        try {
            const boxX = defect.x || 100;
            const boxY = defect.y || 100;

            let color = '#ef4444'; // 구조체 Red
            if (defect.category === '비구조체') color = '#3b82f6'; // 비구조체 Blue
            if (defect.category === '마감재') color = '#f97316'; // 마감재 Orange

            // Draw Leader Line & Arrowhead/Tip
            if (defect.targetX !== undefined && defect.targetY !== undefined) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(boxX, boxY);
                ctx.lineTo(defect.targetX, defect.targetY);
                ctx.strokeStyle = color;
                ctx.lineWidth = 2.5;
                ctx.setLineDash([4, 3]);
                ctx.stroke();

                ctx.fillStyle = color;
                const dx = defect.targetX - boxX;
                const dy = defect.targetY - boxY;
                const angle = Math.atan2(dy, dx);
                const arrowLen = 11;

                ctx.beginPath();
                ctx.moveTo(defect.targetX, defect.targetY);
                ctx.lineTo(defect.targetX - arrowLen * Math.cos(angle - Math.PI / 6), defect.targetY - arrowLen * Math.sin(angle - Math.PI / 6));
                ctx.lineTo(defect.targetX - arrowLen * Math.cos(angle + Math.PI / 6), defect.targetY - arrowLen * Math.sin(angle + Math.PI / 6));
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }

            // Draw Pure White Box with Category-colored Border & Text Label
            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.fillRect(boxX - 22, boxY - 15, 44, 30);
            ctx.strokeRect(boxX - 22, boxY - 15, 44, 30);

            ctx.fillStyle = color;
            ctx.font = 'bold 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(defect.no || 'NO.01', boxX, boxY);
            ctx.restore();
        } catch(e) {
            console.warn('drawPinSafe error:', e);
        }
    }

    function getFloorDrawingSrc(bldg, floorCode) {
        if (!bldg || !bldg.floorDrawings) return null;
        const drawings = bldg.floorDrawings;

        // 1. Direct key match
        if (drawings[floorCode]) return drawings[floorCode];

        // 2. Dong-to-Floor & Floor-to-Dong Mapping Lookup
        const dongToFloor = { '101동': '1F', '102동': '2F', '103동': '3F', '104동': '4F', '105동': '5F' };
        const floorToDong = { '1F': '101동', '2F': '102동', '3F': '103동', '4F': '104동', '5F': '105동' };
        
        if (dongToFloor[floorCode] && drawings[dongToFloor[floorCode]]) return drawings[dongToFloor[floorCode]];
        if (floorToDong[floorCode] && drawings[floorToDong[floorCode]]) return drawings[floorToDong[floorCode]];

        // 3. Case-insensitive / clean string match
        const cleanFloor = (floorCode || '').replace(/\s+/g, '').toUpperCase();
        for (const [k, v] of Object.entries(drawings)) {
            const cleanK = k.replace(/\s+/g, '').toUpperCase();
            if (cleanK === cleanFloor || cleanK.includes(cleanFloor) || cleanFloor.includes(cleanK)) {
                return v;
            }
        }

        // 4. Number extraction match (e.g. '1F' matches '지상 1층' or '101동 1층' or '101동')
        const numMatch = floorCode ? floorCode.match(/\d+/) : null;
        if (numMatch) {
            const numStr = numMatch[0];
            for (const [k, v] of Object.entries(drawings)) {
                if (k.includes(numStr)) return v;
            }
        }

        // 5. Index-based fallback (e.g. 1st floor in list matches 1st drawing in map)
        if (bldg.floorsList && Array.isArray(bldg.floorsList)) {
            const fIdx = bldg.floorsList.findIndex(f => f.floorCode === floorCode);
            if (fIdx >= 0) {
                const values = Object.values(drawings);
                if (values[fIdx]) return values[fIdx];
            }
        }

        // 6. Single drawing fallback
        const keys = Object.keys(drawings);
        if (keys.length > 0 && drawings[keys[0]]) return drawings[keys[0]];

        return null;
    }

    async function preloadFloorDrawings(bldg) {
        if (!state.floorImageCache) state.floorImageCache = {};
        if (!bldg) return;

        let availableFloors = [];
        if (bldg.floorsList && bldg.floorsList.length > 0) {
            availableFloors = bldg.floorsList.map(f => f.floorCode);
        } else if (bldg.floorDrawings) {
            availableFloors = Object.keys(bldg.floorDrawings);
        }

        const promises = availableFloors.map((floorCode) => {
            return new Promise((resolve) => {
                const src = getFloorDrawingSrc(bldg, floorCode);
                if (!src) return resolve();
                if (state.floorImageCache[floorCode] && state.floorImageCache[floorCode].complete && state.floorImageCache[floorCode].naturalWidth > 0) {
                    return resolve();
                }
                const img = new Image();
                img.onload = () => {
                    state.floorImageCache[floorCode] = img;
                    resolve();
                };
                img.onerror = () => {
                    resolve();
                };
                img.src = src;
            });
        });
        await Promise.all(promises);
    }

    function renderFloorPlanCanvasDataUrl(floorCode) {
        try {
            const bldg = window.state.currentBuilding || {};
            const currentBldgId = bldg.id || state.currentBuildingId || 'default';
            const key = `${currentBldgId}_${floorCode}`;
            const defects = state.defects[key] || (state.currentFloor === floorCode ? getCurrentFloorDefects() : []);

            // 1. Check preloaded image cache or image source for this floor
            let loadedImg = state.floorImageCache ? state.floorImageCache[floorCode] : null;
            let floorDrawingSrc = getFloorDrawingSrc(bldg, floorCode);
            if (!floorDrawingSrc && state.currentFloor === floorCode && state.bgImage && state.bgImage.src) {
                floorDrawingSrc = state.bgImage.src;
            }

            // 2. If image exists (either preloaded in cache or source string), draw it onto PURE WHITE canvas with defect pins!
            if (loadedImg || floorDrawingSrc) {
                const drawImageOnPureWhiteCanvas = (imgObj) => {
                    const canvas = document.createElement('canvas');
                    const imgW = imgObj.naturalWidth || imgObj.width || 1400;
                    const imgH = imgObj.naturalHeight || imgObj.height || 900;

                    // Check if drawing is vertical/lying (height > width): rotate 90 degrees left (counter-clockwise -90°)
                    const needsRotation = imgH > imgW;

                    const cw = 1400;
                    const ch = 900;
                    canvas.width = cw;
                    canvas.height = ch;
                    const ctx = canvas.getContext('2d');

                    // Pure white background - ZERO BLACK/DARK NAVY COLOR!
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, cw, ch);

                    ctx.save();
                    if (needsRotation) {
                        // Rotate 90 degrees left (counter-clockwise)
                        ctx.translate(cw / 2, ch / 2);
                        ctx.rotate(-Math.PI / 2);
                        
                        // Exact aspect ratio scaling to prevent ANY distortion or warping!
                        const scale = Math.min(cw / imgH, ch / imgW);
                        const drawW = imgW * scale;
                        const drawH = imgH * scale;

                        ctx.drawImage(imgObj, -drawW / 2, -drawH / 2, drawW, drawH);
                    } else {
                        // Landscape format: fit to canvas while preserving exact original aspect ratio
                        const scale = Math.min(cw / imgW, ch / imgH);
                        const drawW = imgW * scale;
                        const drawH = imgH * scale;
                        const drawX = (cw - drawW) / 2;
                        const drawY = (ch - drawH) / 2;

                        ctx.drawImage(imgObj, drawX, drawY, drawW, drawH);
                    }
                    ctx.restore();

                    // Render defect pins on top
                    defects.forEach(defect => drawPinSafe(ctx, defect));
                    return canvas.toDataURL('image/png');
                };

                if (loadedImg && loadedImg.complete && loadedImg.naturalWidth > 0) {
                    return drawImageOnPureWhiteCanvas(loadedImg);
                } else if (floorDrawingSrc) {
                    const tempImg = new Image();
                    tempImg.src = floorDrawingSrc;
                    if (tempImg.complete && tempImg.naturalWidth > 0) {
                        return drawImageOnPureWhiteCanvas(tempImg);
                    }
                }
            }

            // 3. If NO registered floor drawing exists, return null (DO NOT DRAW FAKE CAD COLUMNS/BEAMS!)
            return null;
        } catch (err) {
            console.error('Error rendering floor plan data URL:', err);
            return null;
        }
    }

    // --- REPORT PREVIEW MODAL (Instant Modal Open & Pure White Paper Theme) ---
    window.openReportPreviewModalFunc = async function() {
        try {
            const modal = document.getElementById('reportPreviewModal');
            const container = document.getElementById('modalReportPreviewBody');
            if (!modal || !container) return;

            // 1. OPEN MODAL INSTANTLY ON CLICK! (Zero-delay visual feedback)
            modal.style.display = 'flex';
            modal.classList.add('open');

            const bldg = window.state.currentBuilding || { id: 'default', name: '건축물', address: '서울특별시 강남구', inspector: '홍길동', date: '2026-07-29' };
            const currentBldgId = bldg.id || state.currentBuildingId || 'default';
            
            // 2. Preload all floor drawing images asynchronously BEFORE rendering report pages!
            await preloadFloorDrawings(bldg);
            
            let availableFloors = [];
            if (bldg.floorsList && bldg.floorsList.length > 0) {
                availableFloors = bldg.floorsList.map(f => f.floorCode);
            } else if (bldg.floorDrawings && Object.keys(bldg.floorDrawings).length > 0) {
                availableFloors = Object.keys(bldg.floorDrawings);
            } else {
                availableFloors = [window.state.currentFloor || '1F'];
            }

            let reportPagesHtml = '';

            availableFloors.forEach((floorCode, floorIdx) => {
                const key = `${currentBldgId}_${floorCode}`;
                const defects = state.defects[key] || (state.currentFloor === floorCode ? getCurrentFloorDefects() : []);

                // --- 1. 상태조사표 (한 페이지당 최대 15개) ---
                const surveyPages = [];
                for (let i = 0; i < defects.length; i += 15) {
                    surveyPages.push(defects.slice(i, i + 15));
                }
                if (surveyPages.length === 0) surveyPages.push([]);

                surveyPages.forEach((sDefects, sPageIdx) => {
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 2.5rem; margin-bottom: 2.5rem; font-family: sans-serif; font-size:0.9rem; border-radius:8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; box-sizing: border-box;">
                            <div style="text-align:center; border-bottom: 3px double #0284c7; padding-bottom: 0.8rem; margin-bottom: 1.5rem;">
                                <h1 style="font-size:1.6rem; font-weight:800; color:#0284c7; margin:0 0 0.3rem 0;">📋 ${bldg.name.replace(/^🏢\s*/,'')} 정밀 안전점검 현장 조사 보고서</h1>
                                <div style="font-size:0.85rem; color:#475569; font-weight:600;">
                                    📍 위치: ${bldg.address} | 🏢 대상층: ${floorCode} | 👤 점검자: ${bldg.inspector} | 📅 점검일시: ${bldg.date}
                                </div>
                            </div>

                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem;">
                                <h2 style="font-size:1.15rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.6rem; margin:0;">
                                    1. ${floorCode} 상태조사표 (총 ${defects.length}개 중 ${sDefects.length}개 표시)
                                </h2>
                                <span style="font-size:0.8rem; background:#e0f2fe; color:#0369a1; font-weight:700; padding:0.2rem 0.6rem; border-radius:12px;">
                                    페이지 ${sPageIdx + 1} / ${surveyPages.length} (페이지당 최대 15개)
                                </span>
                            </div>

                            <table style="width: 100%; border-collapse: collapse; font-size: 0.83rem; text-align: center;">
                                <thead>
                                    <tr style="background: #f8fafc; color: #1e293b; border-bottom: 2px solid #cbd5e1;">
                                        <th style="padding: 0.6rem; border: 1px solid #cbd5e1;">결함번호</th>
                                        <th style="padding: 0.6rem; border: 1px solid #cbd5e1;">위치</th>
                                        <th style="padding: 0.6rem; border: 1px solid #cbd5e1;">조사내용</th>
                                        <th style="padding: 0.6rem; border: 1px solid #cbd5e1;">구조체여부</th>
                                        <th style="padding: 0.6rem; border: 1px solid #cbd5e1;">결함크기</th>
                                        <th style="padding: 0.6rem; border: 1px solid #cbd5e1;">진행여부</th>
                                        <th style="padding: 0.6rem; border: 1px solid #cbd5e1;">누수여부</th>
                                        <th style="padding: 0.6rem; border: 1px solid #cbd5e1;">결함원인추정</th>
                                        <th style="padding: 0.6rem; border: 1px solid #cbd5e1;">비고</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${sDefects.length > 0 ? sDefects.map(d => {
                                        let pRemark = '-';
                                        if (d.photos && d.photos.length > 0) {
                                            pRemark = d.photos.map((_, idx) => `사진${(idx + 1) < 10 ? '0' + (idx + 1) : (idx + 1)}`).join(' ');
                                        }
                                        return `
                                            <tr>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:700; color:#0284c7;">${d.no}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:700;">${d.location || (floorCode + ' ' + d.component)}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:700; color:#0369a1;">${d.defectType}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:800; color:${d.category === '구조체' ? '#ef4444' : '#94a3b8'};">${d.category === '구조체' ? '○' : '-'}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0;">${d.size || 'W=0.2mm'}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:800; color:${d.isProgress ? '#dc2626' : '#94a3b8'};">${d.isProgress ? '진행중' : '-'}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:800; color:${d.isLeak ? '#0284c7' : '#94a3b8'};">${d.isLeak ? '누수중' : '-'}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:700;">${d.cause || '건조수축'}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:700; color:#2563eb;">${pRemark}</td>
                                            </tr>
                                        `;
                                    }).join('') : `<tr><td colspan="9" style="padding:2rem; color:#94a3b8;">${floorCode}층에 등록된 결함이 없습니다.</td></tr>`}
                                </tbody>
                            </table>
                        </div>
                    `;
                });

                // --- 2. 현장 사진첩 ---
                let photoItems = [];
                let pCount = 0;
                defects.forEach(d => {
                    const componentDefectTitle = `${d.component || '부재'} ${d.defectType || '결함'}`;
                    const photos = (d.photos && d.photos.length > 0) ? d.photos : [null];
                    photos.forEach(src => {
                        pCount++;
                        const pNumStr = pCount < 10 ? `0${pCount}` : `${pCount}`;
                        photoItems.push({
                            label: `사진${pNumStr}`,
                            title: componentDefectTitle,
                            defectNo: d.no,
                            location: d.location || `${floorCode} ${d.component}`,
                            cause: d.cause || '건조수축',
                            size: d.size || 'W=0.2mm',
                            src: src
                        });
                    });
                });

                const photoPages = [];
                for (let i = 0; i < photoItems.length; i += 6) {
                    photoPages.push(photoItems.slice(i, i + 6));
                }
                if (photoPages.length === 0) photoPages.push([]);

                photoPages.forEach((pagePhotos, pPageIdx) => {
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 2.5rem; margin-bottom: 2.5rem; font-family: sans-serif; font-size:0.9rem; border-radius:8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; box-sizing: border-box;">
                            <div style="text-align:center; border-bottom: 3px double #0284c7; padding-bottom: 0.8rem; margin-bottom: 1.5rem;">
                                <h1 style="font-size:1.6rem; font-weight:800; color:#0284c7; margin:0 0 0.3rem 0;">📋 ${bldg.name.replace(/^🏢\s*/,'')} 정밀 안전점검 현장 사진첩</h1>
                                <div style="font-size:0.85rem; color:#475569; font-weight:600;">
                                    📍 위치: ${bldg.address} | 🏢 대상층: ${floorCode} | 👤 점검자: ${bldg.inspector} | 📅 점검일시: ${bldg.date}
                                </div>
                            </div>

                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                                <h2 style="font-size:1.15rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.6rem; margin:0;">
                                    2. ${floorCode} 현장 결함 사진첩
                                </h2>
                                <span style="font-size:0.8rem; background:#e0f2fe; color:#0369a1; font-weight:700; padding:0.2rem 0.6rem; border-radius:12px;">
                                    사진첩 페이지 ${pPageIdx + 1} / ${photoPages.length} (규격 6개 배치)
                                </span>
                            </div>

                            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.2rem;">
                                ${pagePhotos.map(p => `
                                    <div style="border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #fafafa;">
                                        <div style="height: 180px; background: #e2e8f0; display: flex; align-items: center; justify-content: center; position: relative;">
                                            ${p.src ? `<img src="${p.src}" style="width:100%; height:100%; object-fit:cover;">` : `<div style="text-align:center; color:#64748b; font-weight:700;"><i class="fa-solid fa-camera" style="font-size:1.8rem; margin-bottom:0.3rem; color:#cbd5e1;"></i><br>📷 ${p.label} 현장 사진 미첨부</div>`}
                                            <span style="position:absolute; top:8px; left:8px; background:#0284c7; color:#fff; font-weight:800; font-size:0.8rem; padding:0.2rem 0.6rem; border-radius:12px;">
                                                ${p.label}
                                            </span>
                                        </div>
                                        <div style="padding: 0.75rem; text-align: center;">
                                            <div style="font-size:0.95rem; font-weight:800; color:#0369a1;">
                                                ${p.label}. ${p.title}
                                            </div>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                });

                // --- 3. 결함 위치도 (사용자 등록 평면도 A4 용지 100% 꽉 차게 렌더링) ---
                const drawingDataUrl = renderFloorPlanCanvasDataUrl(floorCode);

                reportPagesHtml += `
                    <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 2.5rem; margin-bottom: 2.5rem; font-family: sans-serif; font-size:0.9rem; border-radius:8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; box-sizing: border-box;">
                        <div style="text-align:center; border-bottom: 3px double #0284c7; padding-bottom: 0.8rem; margin-bottom: 1.5rem;">
                            <h1 style="font-size:1.6rem; font-weight:800; color:#0284c7; margin:0 0 0.3rem 0;">📋 ${bldg.name.replace(/^🏢\s*/,'')} 정밀 안전점검 결함 위치도</h1>
                            <div style="font-size:0.85rem; color:#475569; font-weight:600;">
                                📍 위치: ${bldg.address} | 🏢 대상층: ${floorCode} | 👤 점검자: ${bldg.inspector} | 📅 점검일시: ${bldg.date}
                            </div>
                        </div>

                        <h2 style="font-size:1.15rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.6rem; margin-bottom: 1.2rem;">
                            3. ${floorCode} 결함 위치도 (도면 마킹 평면도)
                        </h2>

                        ${drawingDataUrl ? `
                            <div style="width: 100%; border: 2px solid #0284c7; border-radius: 8px; overflow: hidden; background: #ffffff; text-align: center; padding: 0; box-sizing: border-box; margin-top: 0.5rem;">
                                <img src="${drawingDataUrl}" style="width: 100%; height: auto; min-height: 600px; max-height: 950px; object-fit: fill; border-radius: 4px; display: block; margin: 0 auto;">
                            </div>
                        ` : `
                            <div style="width: 100%; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 4rem 2rem; background: #f8fafc; text-align: center; color: #64748b; font-weight: 700; font-size: 1.05rem;">
                                <i class="fa-solid fa-map-location-dot" style="font-size: 2.8rem; color: #94a3b8; margin-bottom: 0.8rem; display: block;"></i>
                                📍 ${floorCode} 등록된 평면도 도면이 없습니다.<br>
                                <span style="font-size: 0.88rem; color: #94a3b8; font-weight: 500; margin-top: 0.4rem; display: inline-block;">
                                    (층별 도면 점검 탭에서 평면도 이미지를 등록하시면 결함 위치도가 자동으로 완성됩니다)
                                </span>
                            </div>
                        `}
                    </div>
                `;
            });

            container.innerHTML = `<div id="printableReportArea" style="width:100%; max-width: 1100px; margin: 0 auto;">${reportPagesHtml}</div>`;
        } catch (err) {
            console.error('Error in openReportPreviewModalFunc:', err);
            const modal = document.getElementById('reportPreviewModal');
            if (modal) {
                modal.style.display = 'flex';
                modal.classList.add('open');
            }
        }
    };

    // --- PDF EXPORT ENGINE (비동기 A4 풀다운로드 & 반응 즉시 활성화) ---
    window.exportPDF = async function() {
        try {
            // 1. Ensure report preview content is fully generated and preloaded
            await window.openReportPreviewModalFunc();
            await new Promise(r => setTimeout(r, 200));

            const bldg = window.state.currentBuilding || { name: '건축물_점검보고서' };
            const bldgName = (bldg.name || '건축물').replace(/^🏢\s*/, '').replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
            const filename = `${bldgName}_정밀안전점검_상태조사표_${window.state.currentFloor || '1F'}.pdf`;

            const element = document.getElementById('printableReportArea') || document.getElementById('modalReportPreviewBody');
            if (!element) {
                window.print();
                return;
            }

            if (typeof html2pdf !== 'undefined') {
                const opt = {
                    margin:       [5, 5, 5, 5],
                    filename:     filename,
                    image:        { type: 'jpeg', quality: 0.98 },
                    html2canvas:  { scale: 2, useCORS: true, logging: false },
                    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
                };
                html2pdf().set(opt).from(element).save().catch(() => {
                    window.print();
                });
            } else {
                window.print();
            }
        } catch(err) {
            console.error('PDF export error:', err);
            window.print();
        }
    };

    // Binding All Header & Survey Report Action Buttons
    const btnPreviewReport = document.getElementById('btnPreviewReport');
    if (btnPreviewReport) {
        btnPreviewReport.addEventListener('click', window.openReportPreviewModalFunc);
    }

    const btnOpenReportPreview = document.getElementById('btnOpenReportPreview');
    if (btnOpenReportPreview) {
        btnOpenReportPreview.addEventListener('click', window.openReportPreviewModalFunc);
    }

    const btnExportPDF = document.getElementById('btnExportPDF');
    if (btnExportPDF) {
        btnExportPDF.addEventListener('click', window.exportPDF);
    }

    const btnModalExportPdf = document.getElementById('btnModalExportPdf');
    if (btnModalExportPdf) {
        btnModalExportPdf.addEventListener('click', window.exportPDF);
    }

    const btnPrintReport = document.getElementById('btnPrintReport');
    if (btnPrintReport) {
        btnPrintReport.addEventListener('click', () => {
            window.openReportPreviewModalFunc();
            setTimeout(() => window.print(), 300);
        });
    }

    const btnModalPrint = document.getElementById('btnModalPrint');
    if (btnModalPrint) {
        btnModalPrint.addEventListener('click', () => window.print());
    }

    const btnCloseReportPreviewModal = document.getElementById('btnCloseReportPreviewModal');
    if (btnCloseReportPreviewModal) {
        btnCloseReportPreviewModal.addEventListener('click', () => {
            const modal = document.getElementById('reportPreviewModal');
            if (modal) {
                modal.style.display = 'none';
                modal.classList.remove('open');
            }
        });
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
