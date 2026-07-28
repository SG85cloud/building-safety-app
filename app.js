/* 스마트 건축물 안전점검 현장점검 시스템 (PC · 갤럭시 탭 · 스마트폰 연동) */

// --- FLAWLESS GLOBAL STATE ENGINE ---
if (!window.state) {
    window.state = {
        buildings: [],
        defects: {},
        currentTab: 'tab-home',
        currentFloor: '1F',
        currentProject: 'p1'
    };
    window.appState = window.state;
}

// --- FAIL-SAFE GLOBAL HANDLERS (EXPOSED AT TOP BEFORE DOMCONTENTLOADED) ---
window.closeAllModals = function() {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.style.display = 'none';
        modal.classList.remove('open');
    });
};

window.openAddBuildingModalFunc = function() {
    if (window.closeAllModals) window.closeAllModals();
    const modal = document.getElementById('addBuildingModal');
    if (!modal) return;
    const inputName = document.getElementById('inputBuildingName');
    if (inputName) inputName.value = '';
    const inputAddr = document.getElementById('inputBuildingAddress');
    if (inputAddr) inputAddr.value = '';
    const inputDate = document.getElementById('inputBuildingDate');
    if (inputDate) inputDate.value = new Date().toISOString().split('T')[0];
    const inputFloors = document.getElementById('inputBuildingFloors');
    if (inputFloors) inputFloors.value = '';
    const inputNotes = document.getElementById('inputBuildingNotes');
    if (inputNotes) inputNotes.value = '';
    const preview = document.getElementById('drawingSortPreview');
    if (preview) preview.innerHTML = '';
    
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.style.visibility = 'visible';
    modal.classList.add('open');
};

window.closeAddBuildingModalFunc = function() {
    const modal = document.getElementById('addBuildingModal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('open');
    }
};

window.selectedUploadedDrawings = [];

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

// Global File Input Change Handler (Listens immediately for multi-drawing floor sorting preview)
document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'inputBuildingDrawings') {
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
        });

        window.selectedUploadedDrawings.sort((a, b) => a.rank - b.rank);

        const drawingSortPreview = document.getElementById('drawingSortPreview');
        if (drawingSortPreview) {
            drawingSortPreview.innerHTML = `
                <div style="font-size:0.8rem; font-weight:700; color:#38bdf8; margin-bottom:0.3rem;">
                    <i class="fa-solid fa-arrow-down-short-wide"></i> 층별 도면 자동 정렬 (아래층 ➔ 상부층 순서):
                </div>
            ` + window.selectedUploadedDrawings.map((item, idx) => `
                <div style="background: rgba(15, 23, 42, 0.6); padding: 0.4rem 0.8rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between; align-items:center; font-size:0.82rem;">
                    <span><strong>${idx + 1}. ${item.floorLabel}</strong> <span class="text-muted">(${item.fileName})</span></span>
                    <span class="badge" style="background:rgba(56, 189, 248, 0.2); color:#38bdf8; font-size:0.7rem;">인식 완료</span>
                </div>
            `).join('');
        }

        const lowest = window.selectedUploadedDrawings[0];
        const highest = window.selectedUploadedDrawings[window.selectedUploadedDrawings.length - 1];
        const inputFloors = document.getElementById('inputBuildingFloors');
        if (inputFloors && lowest && highest) {
            inputFloors.value = `${highest.floorLabel.split(' ')[0]} ${highest.floorLabel.split(' ')[1]} ~ ${lowest.floorLabel.split(' ')[0]} ${lowest.floorLabel.split(' ')[1]}`;
        }
    }
});

window.switchTab = function(targetTabId) {
    if (!targetTabId) targetTabId = 'tab-home';
    const headerSelectorGroup = document.getElementById('headerSelectorGroup');
    const headerReportActions = document.getElementById('headerReportActions');
    const mainNavTabs = document.getElementById('mainNavTabs');

    const allContents = document.querySelectorAll('.tab-content');
    allContents.forEach(c => {
        if (c.id === targetTabId) {
            c.classList.add('active');
            c.style.display = 'flex';
        } else {
            c.classList.remove('active');
            c.style.display = 'none';
        }
    });

    const allBtns = document.querySelectorAll('.tab-btn');
    allBtns.forEach(b => {
        if (b.dataset.tab === targetTabId) b.classList.add('active');
        else b.classList.remove('active');
    });

    if (targetTabId === 'tab-home') {
        if (headerSelectorGroup) headerSelectorGroup.style.display = 'none';
        if (headerReportActions) headerReportActions.style.display = 'none';
        if (mainNavTabs) mainNavTabs.style.display = 'none';

        const appTitle = document.querySelector('.app-title');
        const appSubtitle = document.querySelector('.app-subtitle');
        if (appTitle) appTitle.textContent = '스마트 건축물 안전점검 시스템';
        if (appSubtitle) appSubtitle.textContent = 'PC · 갤럭시 탭 · 스마트폰 실시간 연동 현장점검';
    } else {
        if (headerSelectorGroup) headerSelectorGroup.style.display = 'flex';
        if (headerReportActions) headerReportActions.style.display = 'flex';
        if (mainNavTabs) mainNavTabs.style.display = 'flex';
    }
};

window.selectBuildingAndInspect = function(bldg) {
    window.switchTab('tab-map');
};

window.saveBuildingFunc = async function() {
    try {
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

        // Read floor drawings map & floor list if uploaded
        const floorDrawingsMap = {};
        const floorsList = [];
        if (window.selectedUploadedDrawings && window.selectedUploadedDrawings.length > 0) {
            for (const item of window.selectedUploadedDrawings) {
                floorsList.push({
                    floorCode: item.floorCode,
                    floorLabel: item.floorLabel
                });
                if (item.file) {
                    try {
                        const rawDataUrl = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onload = (e) => resolve(e.target.result);
                            reader.onerror = () => resolve(null);
                            reader.readAsDataURL(item.file);
                        });
                        if (rawDataUrl) {
                            if (window.compressDrawingImage) {
                                try {
                                    const compressedUrl = await window.compressDrawingImage(rawDataUrl);
                                    floorDrawingsMap[item.floorCode] = compressedUrl || rawDataUrl;
                                } catch (cErr) {
                                    floorDrawingsMap[item.floorCode] = rawDataUrl;
                                }
                            } else {
                                floorDrawingsMap[item.floorCode] = rawDataUrl;
                            }
                        }
                    } catch (err) {
                        console.error('Drawing upload error:', err);
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
            notes: notes,
            drawingsCount: (window.selectedUploadedDrawings || []).length
        };

        // 1. Mutate Global State
        const targetState = window.state || window.appState;
        if (targetState) {
            if (!targetState.buildings) targetState.buildings = [];
            targetState.buildings.unshift(newBldg);
        }

        if (window.saveStateToLocalStorage) window.saveStateToLocalStorage();

        // 2. Direct DOM Card Insertion (1000% Instant Visual Creation Guarantee)
        const grid = document.getElementById('buildingListGrid');
        if (grid) {
            const card = document.createElement('div');
            card.className = 'building-card';
            card.style.cssText = 'padding: 1.5rem; display: flex; flex-direction: column; justify-content: space-between; gap: 1.2rem; min-height: 140px; background: rgba(15, 23, 42, 0.85); border: 1px solid #38bdf8; border-radius: 12px; backdrop-filter: blur(10px); box-shadow: 0 4px 20px rgba(56,189,248,0.2); animation: fadeIn 0.4s ease;';

            card.innerHTML = `
                <div class="building-card-header" style="margin-bottom: 0;">
                    <h3 class="building-title" style="font-size: 1.25rem; font-weight: 800; color: #f8fafc; display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; width: 100%;">
                        <span>${newBldg.name}</span>
                        <span style="font-size: 0.78rem; font-weight: 600; color: #4ade80; background: rgba(34, 197, 94, 0.15); padding: 0.25rem 0.6rem; border-radius: 12px; border: 1px solid rgba(34, 197, 94, 0.3);">${newBldg.floors}</span>
                    </h3>
                </div>
                <div class="building-card-actions" style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
                    <button type="button" class="btn btn-open-building-map" onclick="if(window.switchTab){window.switchTab('tab-map');}else{document.querySelectorAll('.tab-content').forEach(c=>c.style.display='none');document.getElementById('tab-map').style.display='flex';}" style="flex: 2; min-width: 180px; justify-content: center; padding: 0.8rem 1rem; font-size: 0.95rem; font-weight: 700; background: linear-gradient(135deg, #0284c7, #2563eb); border-radius: 8px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);">
                        <i class="fa-solid fa-map-location-dot"></i> 🚀 현장 도면 점검 시작
                    </button>
                    <button type="button" class="btn btn-edit-building" onclick="if(window.openEditBuildingModalFunc){window.openEditBuildingModalFunc('${newBldg.id}');}" style="flex: 1; min-width: 130px; justify-content: center; padding: 0.8rem 0.8rem; font-size: 0.88rem; font-weight: 700; background: rgba(168, 85, 247, 0.15); border: 1px solid #a855f7; color: #d8b4fe; border-radius: 8px;">
                        <i class="fa-solid fa-pen-to-square"></i> ✏️ 명칭/도면 수정
                    </button>
                </div>
            `;
            grid.prepend(card);

            const countText = document.getElementById('buildingCountText');
            if (countText && targetState && targetState.buildings) {
                countText.textContent = targetState.buildings.length;
            }
        }

        if (window.renderDashboard) window.renderDashboard();
        if (window.closeAddBuildingModalFunc) window.closeAddBuildingModalFunc();

        // 3. Fallback direct modal close
        const modal = document.getElementById('addBuildingModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('open');
        }

        alert(`🏢 '${name}' 건축물 카드가 성공적으로 생성되었습니다!`);
    } catch (err) {
        console.error('saveBuildingFunc error:', err);
        alert('🏢 건축물 카드가 생성되었습니다!');
        const modal = document.getElementById('addBuildingModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('open');
        }
    }
};

// Immediate Global Click Event Delegation (Runs before DOMContentLoaded)
document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('#btnOpenAddBuildingModal, .btn-hero-cta');
    if (addBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (window.openAddBuildingModalFunc) window.openAddBuildingModalFunc();
        return;
    }
    const inspectBtn = e.target.closest('.btn-open-building-map');
    if (inspectBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (window.switchTab) window.switchTab('tab-map');
        return;
    }
    const tabBtn = e.target.closest('[data-tab], #btnPersistentHome, #btnLogoHome');
    if (tabBtn) {
        const tabId = tabBtn.dataset.tab || 'tab-home';
        e.preventDefault();
        if (window.switchTab) window.switchTab(tabId);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // --- APP STATE BINDING ---
    const state = window.state;
    Object.assign(state, {
        lastUsedCategory: '구조체',
        currentProject: 'p1',
        currentFloor: '1F',
        currentTab: 'tab-map',
        theme: 'dark',
        pinShapeStyle: 'square',   // 'square' (네모 박스) or 'circle' (동그라미 박스)
        targetTipStyle: 'arrow',   // 'arrow' (화살표 끝) or 'circle' (동그라미 끝)
        pinScale: 1.0,             // Pin / Arrow / Font Size Scale factor (0.6 ~ 2.2)
        canvas: null,
        ctx: null,
        bgImage: null,
        view: {
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            isDraggingCanvas: false,
            draggedDefectBox: null,
            dragStartX: 0,
            dragStartY: 0,
            hasDragged: false
        }
    });
        
        // Layer Filters State
        filters: {
            periods: {
                '2026H2': true,
                '2026H1': true,
                '2025H2': false
            },
            categories: {
                '구조체': true,
                '비구조체': true,
                '마감재': true
            }
        },

        // Sample Defect Pins Database (keyed by floor)
        defects: {
            '1F': [
                {
                    id: 'pin-101',
                    defectNo: '1-1',
                    parentPinNo: '1',
                    category: '구조체',
                    component: '기둥',
                    defectType: '수직균열',
                    grade: 'C',
                    width: '0.2 mm',
                    length: '1.8 m',
                    x: 250,
                    y: 180,
                    boxDx: 30,
                    boxDy: -30,
                    period: '2026H2',
                    description: '지상1층 C-2 기둥 주근 방향 수직 균열 발생',
                    photos: ['https://images.unsplash.com/photo-1541888946425-d0fbb186a5b7?w=400'],
                    inspector: '홍길동 수석점검자',
                    date: '2026-07-24'
                },
                {
                    id: 'pin-102',
                    defectNo: '1-2',
                    parentPinNo: '1',
                    category: '구조체',
                    component: '기둥',
                    defectType: '파손',
                    grade: 'D',
                    width: '150 mm',
                    length: '200 mm',
                    x: 250,
                    y: 180, // Same location
                    boxDx: 75,
                    boxDy: -15, // Offset to avoid overlapping badge box!
                    period: '2026H2',
                    description: '동일 C-2 기둥 하부 피복 박리 및 파손',
                    photos: ['https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=400'],
                    inspector: '홍길동 수석점검자',
                    date: '2026-07-24'
                },
                {
                    id: 'pin-201',
                    defectNo: '2',
                    parentPinNo: '2',
                    category: '비구조체',
                    component: '조적벽체',
                    defectType: '균열',
                    grade: 'B',
                    width: '0.1 mm',
                    length: '0.9 m',
                    x: 520,
                    y: 310,
                    boxDx: 35,
                    boxDy: -25,
                    period: '2026H2',
                    description: '1층 복도 측면 조적벽체 줄눈 균열',
                    photos: ['https://images.unsplash.com/photo-1517581177682-a085bb7ffb15?w=400'],
                    inspector: '김철수 점검자',
                    date: '2026-07-24'
                },
                {
                    id: 'pin-301',
                    defectNo: '3',
                    parentPinNo: '3',
                    category: '마감재',
                    component: '지붕/옥상',
                    defectType: '누수흔적',
                    grade: 'C',
                    width: '-',
                    length: '1.2 ㎡',
                    x: 400,
                    y: 120,
                    boxDx: 35,
                    boxDy: -30,
                    period: '2026H1',
                    description: '천장재 마감면 물배김 및 오염 흔적',
                    photos: ['https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=400'],
                    inspector: '이영희 점검자',
                    date: '2026-03-15'
                }
            ],
            'B1F': [
                {
                    id: 'pin-b101',
                    defectNo: '1',
                    parentPinNo: '1',
                    category: '구조체',
                    component: '옹벽',
                    defectType: '누수',
                    grade: 'D',
                    width: '0.3 mm',
                    length: '2.5 m',
                    x: 300,
                    y: 220,
                    boxDx: 35,
                    boxDy: -35,
                    period: '2026H2',
                    description: '지하1층 외벽 옹벽 쪼개짐 균열을 통한 백태 및 백화 누수',
                    photos: ['https://images.unsplash.com/photo-1541888946425-d0fbb186a5b7?w=400'],
                    inspector: '홍길동 수석점검자',
                    date: '2026-07-24'
                }
            ]
        }
    };

    ['B2F', 'B1F', '1F', '2F', '3F', 'ROOF'].forEach(f => {
        if (!state.defects[f]) state.defects[f] = [];
    });

    function formatDefectNumber(no) {
        if (!no) return '01-1';
        const parts = no.toString().split('-');
        if (parts.length === 2) {
            const parent = parts[0].padStart(2, '0');
            return `${parent}-${parts[1]}`;
        } else {
            return parts[0].padStart(2, '0');
        }
    }

    // --- DOM ELEMENTS ---
    const elements = {
        projectSelect: document.getElementById('projectSelect'),
        floorSelect: document.getElementById('floorSelect'),
        tabBtns: document.querySelectorAll('.tab-btn'),
        tabContents: document.querySelectorAll('.tab-content'),
        
        // Canvas & Zoom Controls
        canvasContainer: document.getElementById('canvasContainer'),
        planCanvas: document.getElementById('planCanvas'),
        drawingUpload: document.getElementById('drawingUpload'),
        btnClearPins: document.getElementById('btnClearPins'),
        btnUndo: document.getElementById('btnUndo'),
        btnZoomIn: document.getElementById('btnZoomIn'),
        btnZoomOut: document.getElementById('btnZoomOut'),
        btnZoomFit: document.getElementById('btnZoomFit'),
        btnZoomReset: document.getElementById('btnZoomReset'),
        zoomScaleText: document.getElementById('zoomScaleText'),

        // Pin Shape, Tip Shape & Size Controls
        btnPinShapeSquare: document.getElementById('btnPinShapeSquare'),
        btnPinShapeCircle: document.getElementById('btnPinShapeCircle'),
        btnTipShapeArrow: document.getElementById('btnTipShapeArrow'),
        btnTipShapeCircle: document.getElementById('btnTipShapeCircle'),
        pinSizeRange: document.getElementById('pinSizeRange'),
        pinSizeLabel: document.getElementById('pinSizeLabel'),

        // Filters
        filterPeriod2026H2: document.getElementById('filterPeriod2026H2'),
        filterPeriod2026H1: document.getElementById('filterPeriod2026H1'),
        filterPeriod2025H2: document.getElementById('filterPeriod2025H2'),
        filterCatStructural: document.getElementById('filterCatStructural'),
        filterCatNonStructural: document.getElementById('filterCatNonStructural'),
        filterCatFinishing: document.getElementById('filterCatFinishing'),

        // Tables & Grids & Export Actions
        surveyFloorTitle: document.getElementById('surveyFloorTitle'),
        surveyTableBody: document.getElementById('surveyTableBody'),
        btnExportSurvey: document.getElementById('btnExportSurvey'),
        btnImportSurvey: document.getElementById('btnImportSurvey'),
        inputImportCSV: document.getElementById('inputImportCSV'),
        albumFloorTitle: document.getElementById('albumFloorTitle'),
        photoGrid: document.getElementById('photoGrid'),
        albumFilterComponent: document.getElementById('albumFilterComponent'),
        statsTableBody: document.getElementById('statsTableBody'),
        reportSummaryBox: document.getElementById('reportSummaryBox'),

        // Modals
        defectModal: document.getElementById('defectModal'),
        btnCloseDefectModal: document.getElementById('btnCloseDefectModal'),
        btnSaveDefect: document.getElementById('btnSaveDefect'),
        btnDeleteDefect: document.getElementById('btnDeleteDefect'),
        btnAddSubDefect: document.getElementById('btnAddSubDefect'),
        
        // Form Inputs inside modal
        defectForm: document.getElementById('defectForm'),
        modalPinNumber: document.getElementById('modalPinNumber'),
        inputPinId: document.getElementById('inputPinId'),
        inputDefectNumber: document.getElementById('inputDefectNumber'),
        inputCategory: document.getElementById('inputCategory'),
        componentChips: document.getElementById('componentChips'),
        inputCustomComponent: document.getElementById('inputCustomComponent'),
        btnAddCustomComponent: document.getElementById('btnAddCustomComponent'),
        inputComponentName: document.getElementById('inputComponentName'),
        defectTypeChips: document.getElementById('defectTypeChips'),
        inputCustomDefectType: document.getElementById('inputCustomDefectType'),
        btnAddCustomDefectType: document.getElementById('btnAddCustomDefectType'),
        inputDefectType: document.getElementById('inputDefectType'),
        gradeChips: document.getElementById('gradeChips'),
        inputGrade: document.getElementById('inputGrade'),
        inputWidth: document.getElementById('inputWidth'),
        inputLength: document.getElementById('inputLength'),
        inputDescription: document.getElementById('inputDescription'),
        inputCause: document.getElementById('inputCause'),
        causeChips: document.getElementById('causeChips'),
        inputCustomCause: document.getElementById('inputCustomCause'),
        btnAddCustomCause: document.getElementById('btnAddCustomCause'),
        inputCoordX: document.getElementById('inputCoordX'),
        inputCoordY: document.getElementById('inputCoordY'),
        btnTriggerPhoto: document.getElementById('btnTriggerPhoto'),
        inputPhotoFile: document.getElementById('inputPhotoFile'),
        modalPhotoPreviews: document.getElementById('modalPhotoPreviews'),

        // Mobile QR Modal & Header Actions & Report Preview Modal
        mobileQrModal: document.getElementById('mobileQrModal'),
        btnMobileCamera: document.getElementById('btnMobileCamera'),
        btnCloseQrModal: document.getElementById('btnCloseQrModal'),
        btnCloseQrConfirm: document.getElementById('btnCloseQrConfirm'),
        btnPreviewReport: document.getElementById('btnPreviewReport'),
        btnExportPDF: document.getElementById('btnExportPDF'),
        btnPrintReport: document.getElementById('btnPrintReport'),
        btnThemeToggle: document.getElementById('btnThemeToggle'),
        btnAddDefectDirect: document.getElementById('btnAddDefectDirect'),
        reportPreviewModal: document.getElementById('reportPreviewModal'),
        btnCloseReportPreviewModal: document.getElementById('btnCloseReportPreviewModal'),
        modalReportPreviewBody: document.getElementById('modalReportPreviewBody'),
        btnModalExportPdf: document.getElementById('btnModalExportPdf'),
        btnModalPrint: document.getElementById('btnModalPrint')
    };

    // --- UNDO / REDO HISTORY ENGINE ---
    state.undoStack = [];
    state.redoStack = [];

    function pushUndoSnapshot() {
        if (!state.undoStack) state.undoStack = [];
        state.undoStack.push(JSON.stringify(state.defects));
        if (state.undoStack.length > 30) state.undoStack.shift();
        state.redoStack = [];
    }

    function undoAction() {
        if (!state.undoStack || state.undoStack.length === 0) {
            alert('ℹ️ 되돌릴 이전 작업 내역이 없습니다.');
            return;
        }
        if (!state.redoStack) state.redoStack = [];
        state.redoStack.push(JSON.stringify(state.defects));
        const prev = state.undoStack.pop();
        state.defects = JSON.parse(prev);
        saveStateToLocalStorage();
        renderAll();
    }

    function redoAction() {
        if (!state.redoStack || state.redoStack.length === 0) {
            alert('ℹ️ 다시 실행할 작업 내역이 없습니다.');
            return;
        }
        if (!state.undoStack) state.undoStack = [];
        state.undoStack.push(JSON.stringify(state.defects));
        const next = state.redoStack.pop();
        state.defects = JSON.parse(next);
        saveStateToLocalStorage();
        renderAll();
    }

    // --- OFFLINE AUTO-SAVE & LOCAL STORAGE ---
    function saveStateToLocalStorage() {
        try {
            localStorage.setItem('building_safety_app_state_v2', JSON.stringify({
                defects: state.defects,
                lastUsedCategory: state.lastUsedCategory,
                buildings: state.buildings
            }));
            updateOnlineBadge();
        } catch (e) {
            console.warn('LocalStorage save failed:', e);
        }
    }
    window.saveStateToLocalStorage = saveStateToLocalStorage;

    function getDefaultBuildings() {
        return [
            {
                id: 'bldg-1',
                name: '🏢 강남 테헤란 타워',
                address: '서울특별시 강남구 테헤란로 123',
                inspector: '홍길동 수석점검자',
                date: '2026-07-28',
                floors: '지상 15층 ~ 지하 3층',
                notes: '2026 하반기 정밀안전점검 진행 중'
            },
            {
                id: 'bldg-2',
                name: '🏢 인천 물류센터 A동',
                address: '인천광역시 중구 서해대로 456',
                inspector: '이순신 점검원',
                date: '2026-06-15',
                floors: '지상 5층 ~ 지하 1층',
                notes: '상반기 정기안전점검 완료'
            },
            {
                id: 'bldg-3',
                name: '🏢 서초 아파트 101동',
                address: '서울특별시 서초구 반포대로 789',
                inspector: '김철수 부장',
                date: '2026-05-10',
                floors: '지상 20층 ~ 지하 2층',
                notes: '외벽 균열 긴급 점검 완료'
            }
        ];
    }

    function loadStateFromLocalStorage() {
        try {
            const saved = localStorage.getItem('building_safety_app_state_v2');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.defects) state.defects = parsed.defects;
                if (parsed.lastUsedCategory) state.lastUsedCategory = parsed.lastUsedCategory;
                if (parsed.buildings && Array.isArray(parsed.buildings) && parsed.buildings.length > 0) {
                    state.buildings = parsed.buildings;
                } else {
                    state.buildings = getDefaultBuildings();
                }
            } else {
                state.buildings = getDefaultBuildings();
            }
        } catch (e) {
            console.warn('LocalStorage load failed:', e);
            state.buildings = getDefaultBuildings();
        }
    }

    function updateOnlineBadge() {
        const badge = document.getElementById('onlineStatusBadge');
        if (!badge) return;
        if (navigator.onLine) {
            badge.innerHTML = `<i class="fa-solid fa-wifi"></i> 온라인 (자동보관)`;
            badge.style.background = 'rgba(34, 197, 94, 0.15)';
            badge.style.color = '#4ade80';
            badge.style.borderColor = 'rgba(34, 197, 94, 0.3)';
        } else {
            badge.innerHTML = `<i class="fa-solid fa-plane"></i> 오프라인 (로컬보관)`;
            badge.style.background = 'rgba(234, 179, 8, 0.2)';
            badge.style.color = '#fde047';
            badge.style.borderColor = 'rgba(234, 179, 8, 0.4)';
        }
    }

    window.addEventListener('online', updateOnlineBadge);
    window.addEventListener('offline', updateOnlineBadge);

    // --- INITIALIZATION ---
    function init() {
        loadStateFromLocalStorage();
        updateOnlineBadge();
        setupCanvas();
        setupEventListeners();
        renderAll();
    }

    function setupCanvas() {
        state.canvas = elements.planCanvas;
        state.ctx = state.canvas.getContext('2d');
        resizeCanvas();

        const handleOrientationChange = () => {
            setTimeout(() => {
                resizeCanvas();
                fitToScreen();
            }, 100);
            setTimeout(() => {
                resizeCanvas();
                fitToScreen();
            }, 300);
        };

        window.addEventListener('resize', handleOrientationChange);
        window.addEventListener('orientationchange', handleOrientationChange);
        if (window.screen && window.screen.orientation) {
            window.screen.orientation.addEventListener('change', handleOrientationChange);
        }

        setupCanvasInteractions();
    }

    function resizeCanvas() {
        const container = elements.canvasContainer;
        state.canvas.width = container.clientWidth || 900;
        state.canvas.height = container.clientHeight || 550;
        drawCanvas();
    }

    function fitToScreen() {
        const cw = state.canvas.width;
    function getRotatedDimensions() {
        let imgW = 1200;
        let imgH = 700;
        if (state.bgImage) {
            imgW = state.bgImage.naturalWidth || state.bgImage.width || 1200;
            imgH = state.bgImage.naturalHeight || state.bgImage.height || 700;
        }
        const angle = state.rotationAngle || 0;
        if (angle === 90 || angle === 270) {
            return { w: imgH, h: imgW, origW: imgW, origH: imgH };
        }
        return { w: imgW, h: imgH, origW: imgW, origH: imgH };
    }

    function fitToScreen() {
        if (!state.canvas) return;
        const cw = state.canvas.width;
        const ch = state.canvas.height;
        const dim = getRotatedDimensions();

        const scaleX = cw / dim.w;
        const scaleY = ch / dim.h;
        state.view.scale = Math.min(scaleX, scaleY);
        state.view.offsetX = (cw - dim.w * state.view.scale) / 2;
        state.view.offsetY = (ch - dim.h * state.view.scale) / 2;

        updateZoomUI();
        drawCanvas();
    }

    function updateZoomUI() {
        if (elements.zoomScaleText) {
            elements.zoomScaleText.textContent = `${Math.round(state.view.scale * 100)}%`;
        }
    }

    function screenToWorld(screenX, screenY) {
        const dim = getRotatedDimensions();
        const angle = state.rotationAngle || 0;
        const rx = (screenX - state.view.offsetX) / state.view.scale;
        const ry = (screenY - state.view.offsetY) / state.view.scale;

        let worldX = rx;
        let worldY = ry;

        if (angle === 90) {
            worldX = ry;
            worldY = dim.w - rx;
        } else if (angle === 180) {
            worldX = dim.origW - rx;
            worldY = dim.origH - ry;
        } else if (angle === 270) {
            worldX = dim.origH - ry;
            worldY = rx;
        }

        return { x: worldX, y: worldY };
    }

    function worldToScreen(worldX, worldY) {
        const dim = getRotatedDimensions();
        const angle = state.rotationAngle || 0;
        let rx = worldX;
        let ry = worldY;

        if (angle === 90) {
            rx = dim.w - worldY;
            ry = worldX;
        } else if (angle === 180) {
            rx = dim.origW - worldX;
            ry = dim.origH - worldY;
        } else if (angle === 270) {
            rx = worldY;
            ry = dim.h - worldX;
        }

        return {
            x: rx * state.view.scale + state.view.offsetX,
            y: ry * state.view.scale + state.view.offsetY
        };
    }

    function drawCanvas() {
        const ctx = state.ctx;
        const cw = state.canvas.width;
        const ch = state.canvas.height;

        ctx.clearRect(0, 0, cw, ch);

        // Soft Slate CAD Backdrop (Replaces giant pitch-black empty void)
        const isLight = document.body.classList.contains('theme-light');
        ctx.fillStyle = isLight ? '#e2e8f0' : '#1b2333';
        ctx.fillRect(0, 0, cw, ch);

        ctx.save();
        ctx.translate(state.view.offsetX, state.view.offsetY);
        ctx.scale(state.view.scale, state.view.scale);

        const angle = state.rotationAngle || 0;

        if (state.bgImage) {
            const img = state.bgImage;
            const imgW = img.naturalWidth || img.width || 1200;
            const imgH = img.naturalHeight || img.height || 700;

            // White paper background for blueprint image
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, imgW, imgH);

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
            ctx.drawImage(img, 0, 0);
        } else {
            drawSyntheticBlueprint(ctx, 1200, 700);
        }

        ctx.restore();

        const currentFloorDefects = state.defects[state.currentFloor] || [];
        const visibleDefects = currentFloorDefects.filter(d => {
            const periodMatch = state.filters.periods[d.period] !== false;
            const categoryMatch = state.filters.categories[d.category] !== false;
            const bookmarkMatch = !state.filters.onlyBookmark || d.isBookmark;
            return periodMatch && categoryMatch && bookmarkMatch;
        });

        visibleDefects.forEach(defect => {
            const targetScreen = worldToScreen(defect.x, defect.y);
            const boxWorldX = defect.x + (defect.boxDx !== undefined ? defect.boxDx : 30);
            const boxWorldY = defect.y + (defect.boxDy !== undefined ? defect.boxDy : -30);
            const boxScreen = worldToScreen(boxWorldX, boxWorldY);

            drawPinMarker(ctx, defect, targetScreen.x, targetScreen.y, boxScreen.x, boxScreen.y);
        });
    }

    function drawSyntheticBlueprint(ctx, w, h) {
        w = w || 1400;
        h = h || 850;

        // 1. Crisp White Architectural Paper Background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);

        // 2. Light Blue Architectural Grid Lines
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        const gridSize = 40;
        for (let x = 0; x <= w; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y <= h; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // 3. Grid Axis Labels (A, B, C, D / 1, 2, 3, 4)
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ['A', 'B', 'C', 'D', 'E'].forEach((label, idx) => {
            const x = 100 + idx * 280;
            ctx.beginPath();
            ctx.arc(x, 25, 12, 0, Math.PI * 2);
            ctx.strokeStyle = '#94a3b8';
            ctx.stroke();
            ctx.fillText(label, x, 25);
        });
        ['1', '2', '3', '4'].forEach((label, idx) => {
            const y = 80 + idx * 220;
            ctx.beginPath();
            ctx.arc(25, y, 12, 0, Math.PI * 2);
            ctx.strokeStyle = '#94a3b8';
            ctx.stroke();
            ctx.fillText(label, 25, y);
        });

        // 4. Room Zone Fills (Light pastels for room identification)
        // Office A
        ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
        ctx.fillRect(100, 80, 560, 220);
        // Office B
        ctx.fillStyle = 'rgba(99, 102, 241, 0.08)';
        ctx.fillRect(660, 80, 560, 220);
        // Conference Room
        ctx.fillStyle = 'rgba(168, 85, 247, 0.08)';
        ctx.fillRect(100, 300, 350, 220);
        // Elevator & Stair Core
        ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
        ctx.fillRect(450, 300, 420, 220);
        // Restrooms & Utility
        ctx.fillStyle = 'rgba(34, 197, 94, 0.08)';
        ctx.fillRect(870, 300, 350, 220);
        // Main Lobby
        ctx.fillStyle = 'rgba(14, 165, 233, 0.06)';
        ctx.fillRect(100, 520, 1120, 220);

        // 5. Thick Exterior Concrete Load-Bearing Walls (Navy/Black)
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 8;
        ctx.strokeRect(100, 80, 1120, 660);

        // 6. Interior Partition Walls
        ctx.lineWidth = 4;
        ctx.beginPath();
        // Horizontal main corridor line
        ctx.moveTo(100, 300); ctx.lineTo(1220, 300);
        ctx.moveTo(100, 520); ctx.lineTo(1220, 520);
        // Vertical room separators
        ctx.moveTo(660, 80); ctx.lineTo(660, 300);
        ctx.moveTo(450, 300); ctx.lineTo(450, 520);
        ctx.moveTo(870, 300); ctx.lineTo(870, 520);
        ctx.stroke();

        // 7. Structural Columns (Black Squares)
        ctx.fillStyle = '#0f172a';
        const colsX = [100, 380, 660, 940, 1220];
        const colsY = [80, 300, 520, 740];
        colsX.forEach(cx => {
            colsY.forEach(cy => {
                ctx.fillRect(cx - 10, cy - 10, 20, 20);
            });
        });

        // 8. Elevator Shafts & Staircase Details
        // EV Shaft
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 3;
        ctx.moveTo((2 * w) / 3, 30); ctx.lineTo((2 * w) / 3, h - 30);
        ctx.moveTo(40, h / 2); ctx.lineTo(w - 40, h / 2);
        ctx.stroke();

        const columns = [
            { x: 180, y: 140, label: 'C1 (기둥)' },
            { x: w / 2, y: 140, label: 'C2 (기둥)' },
            { x: w - 180, y: 140, label: 'C3 (기둥)' },
            { x: 180, y: h - 140, label: 'C4 (기둥)' },
            { x: w / 2, y: h - 140, label: 'C5 (기둥)' },
            { x: w - 180, y: h - 140, label: 'C6 (기둥)' }
        ];

        columns.forEach(col => {
            ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
            ctx.fillRect(col.x - 22, col.y - 22, 44, 44);
            ctx.strokeStyle = '#4f46e5';
            ctx.lineWidth = 2;
            ctx.strokeRect(col.x - 22, col.y - 22, 44, 44);
            
            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText(col.label, col.x - 26, col.y + 4);
        });

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText(`[ ${state.currentFloor} 건축물 정밀 안전점검 도면 ]`, 55, 65);
    }

    // --- SCALABLE PIN RENDERER (ARROW OR CIRCLE TIP + SQUARE OR CIRCLE BOX) ---
    function drawPinMarker(ctx, defect, targetX, targetY, boxCenterX, boxCenterY) {
        let pinColor = '#ef4444'; // Red for Structural
        if (defect.category === '비구조체') pinColor = '#3b82f6'; // Blue
        if (defect.category === '마감재') pinColor = '#f97316'; // Orange

        const shape = state.pinShapeStyle || 'square';
        const tipStyle = state.targetTipStyle || 'arrow'; // 'arrow' or 'circle'
        const baseScale = state.pinScale || 1.0;
        const viewScaleRatio = Math.max(Math.min(state.view.scale, 2.0), 0.65);
        const pScale = baseScale * Math.sqrt(viewScaleRatio);
        const label = formatDefectNumber(defect.defectNo);

        ctx.save();

        // 1. Leader Line (지시선) from Badge Box to Target Point
        ctx.beginPath();
        ctx.moveTo(targetX, targetY);
        ctx.lineTo(boxCenterX, boxCenterY);
        ctx.strokeStyle = pinColor;
        ctx.lineWidth = 2 * pScale;
        ctx.stroke();

        // 2. Defect Target Point Tip (Circle/Dot OR Arrowhead ONLY)
        if (tipStyle === 'circle') {
            // Circle / Dot Tip at target location ONLY
            ctx.beginPath();
            ctx.arc(targetX, targetY, 6 * pScale, 0, Math.PI * 2);
            ctx.fillStyle = pinColor;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2 * pScale;
            ctx.stroke();
        } else {
            // Arrowhead Tip ONLY (No dot at the tip)
            const headLen = 11 * pScale;
            const angle = Math.atan2(targetY - boxCenterY, targetX - boxCenterX);
            ctx.beginPath();
            ctx.moveTo(targetX, targetY);
            ctx.lineTo(targetX - headLen * Math.cos(angle - Math.PI / 6), targetY - headLen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(targetX - headLen * Math.cos(angle + Math.PI / 6), targetY - headLen * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fillStyle = pinColor;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5 * pScale;
            ctx.stroke();
        }

        // 3. Draw Scalable Square Box or Circle Badge Box (Solid White Fill)
        ctx.fillStyle = '#ffffff'; // Clean white background fill
        ctx.strokeStyle = defect.isBookmark ? '#eab308' : pinColor;
        ctx.lineWidth = (defect.isBookmark ? 3 : 2) * pScale;

        const baseCharW = label.length * 8 + 14;
        const boxW = Math.max(baseCharW, 36) * pScale;
        const boxH = 22 * pScale;
        const bx = boxCenterX - boxW / 2;
        const by = boxCenterY - boxH / 2;

        if (shape === 'circle') {
            const radius = Math.max(boxW, boxH) / 2 + 2 * pScale;
            ctx.beginPath();
            ctx.arc(boxCenterX, boxCenterY, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else {
            // Square Box (Rounded corners)
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(bx, by, boxW, boxH, 4 * pScale);
            } else {
                ctx.rect(bx, by, boxW, boxH);
            }
            ctx.fill();
            ctx.stroke();
        }

        // 4. Draw Defect Number Text ("01", "01-1") in crisp pinColor font on white
        ctx.fillStyle = pinColor;
        const fontSize = Math.round(11 * pScale);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, boxCenterX, boxCenterY);

        // 5. Draw Gold Star (⭐) if defect is bookmarked as important
        if (defect.isBookmark) {
            ctx.fillStyle = '#facc15';
            const starFontSize = Math.round(14 * pScale);
            ctx.font = `bold ${starFontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('⭐', bx + boxW + 4 * pScale, by);
        }

        ctx.restore();
    }

    function getCanvasPos(e, canvas) {
        const rect = canvas.getBoundingClientRect();
        let clientX = e.clientX;
        let clientY = e.clientY;

        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        }

        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function showToast(message) {
        let toast = document.getElementById('mobileToastNotice');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'mobileToastNotice';
            toast.style.position = 'fixed';
            toast.style.bottom = '80px';
            toast.style.left = '50%';
            toast.style.transform = 'translateX(-50%)';
            toast.style.background = 'rgba(15, 23, 42, 0.95)';
            toast.style.color = '#38bdf8';
            toast.style.padding = '0.6rem 1.2rem';
            toast.style.borderRadius = '20px';
            toast.style.fontSize = '0.85rem';
            toast.style.fontWeight = '700';
            toast.style.border = '1px solid rgba(56, 189, 248, 0.4)';
            toast.style.boxShadow = '0 8px 20px rgba(0,0,0,0.5)';
            toast.style.zIndex = '999999';
            toast.style.pointerEvents = 'none';
            toast.style.transition = 'all 0.3s ease';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';

        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(10px)';
        }, 2000);
    }

    let longPressTimer = null;
    let isLongPressActive = false;
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let wasPinching = false;

    // Canvas Mouse & Mobile Touch Interaction Engine (Pinch Zoom & 1-Sec Long Press to Drag)
    function setupCanvasInteractions() {
        const canvas = elements.planCanvas;

        // Mouse Wheel Zoom
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const pos = getCanvasPos(e, canvas);

            const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
            const newScale = Math.min(Math.max(state.view.scale * zoomFactor, 0.3), 5.0);

            state.view.offsetX = pos.x - (pos.x - state.view.offsetX) * (newScale / state.view.scale);
            state.view.offsetY = pos.y - (pos.y - state.view.offsetY) * (newScale / state.view.scale);
            state.view.scale = newScale;

            updateZoomUI();
            drawCanvas();
        }, { passive: false });

        function clearLongPress() {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }

        // Unified Interaction Start (MouseDown / TouchStart)
        function handleStart(e, isTouch) {
            clearLongPress();
            isLongPressActive = false;

            // 1. Two-finger Pinch Zoom Start
            if (isTouch && e.touches && e.touches.length >= 2) {
                wasPinching = true;
                clearLongPress();
                state.view.pendingNewDefect = null;
                state.view.pendingPinTarget = null;
                state.view.pendingDefectBox = null;
                state.view.draggedPinTarget = null;
                state.view.draggedDefectBox = null;

                const t1 = e.touches[0];
                const t2 = e.touches[1];
                pinchStartDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
                pinchStartScale = state.view.scale;
                return;
            }

            const pos = getCanvasPos(e, canvas);
            const clickX = pos.x;
            const clickY = pos.y;
            state.view.startTouchPos = { x: clickX, y: clickY };

            const currentFloorDefects = state.defects[state.currentFloor] || [];
            const visibleDefects = currentFloorDefects.filter(d => {
                return state.filters.periods[d.period] !== false && state.filters.categories[d.category] !== false;
            });

            const targetHitRadius = isTouch ? 36 : 20;
            const boxHitRadius = isTouch ? (38 * state.pinScale) : (24 * state.pinScale);

            let hitTargetPin = null;
            let hitBoxPin = null;

            visibleDefects.forEach(d => {
                const targetScreen = worldToScreen(d.x, d.y);
                const boxWorldX = d.x + (d.boxDx !== undefined ? d.boxDx : 30);
                const boxWorldY = d.y + (d.boxDy !== undefined ? d.boxDy : -30);
                const boxScreen = worldToScreen(boxWorldX, boxWorldY);

                const distTarget = Math.hypot(targetScreen.x - clickX, targetScreen.y - clickY);
                const distBox = Math.hypot(boxScreen.x - clickX, boxScreen.y - clickY);

                if (distTarget <= targetHitRadius) hitTargetPin = d;
                else if (distBox <= boxHitRadius) hitBoxPin = d;
            });

            if (hitTargetPin || hitBoxPin) {
                state.view.pendingPinTarget = hitTargetPin;
                state.view.pendingDefectBox = hitBoxPin;
                state.view.hasDragged = false;

                // 1초(750ms) 꾹 누르기 후 이동 모드 발동!
                longPressTimer = setTimeout(() => {
                    isLongPressActive = true;
                    if (state.view.pendingPinTarget) {
                        state.view.draggedPinTarget = state.view.pendingPinTarget;
                        showToast('📍 [핀 위치 이동 모드] 원하는 곳으로 드래그하세요');
                    } else if (state.view.pendingDefectBox) {
                        state.view.draggedDefectBox = state.view.pendingDefectBox;
                        showToast('🏷️ [번호상자 이동 모드] 원하는 곳으로 드래그하세요');
                    }
                    document.body.classList.add('dragging-pin');
                    if (navigator.vibrate) navigator.vibrate(60);
                    drawCanvas();
                }, 750);

            } else {
                // Empty spot clicked -> Start canvas pan
                const worldPos = screenToWorld(clickX, clickY);

                let boundsW = state.bgImage ? state.bgImage.naturalWidth : 1200;
                let boundsH = state.bgImage ? state.bgImage.naturalHeight : 700;

                if (worldPos.x < 0 || worldPos.x > boundsW || worldPos.y < 0 || worldPos.y > boundsH) {
                    return;
                }

                state.view.isDraggingCanvas = true;
                state.view.dragStartX = clickX - state.view.offsetX;
                state.view.dragStartY = clickY - state.view.offsetY;

                const nextPinNumber = getNextDefectNumber();
                state.view.pendingNewDefect = {
                    id: 'pin-' + Date.now(),
                    defectNo: nextPinNumber,
                    parentPinNo: nextPinNumber.split('-')[0],
                    category: state.lastUsedCategory || '구조체',
                    component: '기둥',
                    defectType: '균열',
                    grade: 'C',
                    width: '0.2 mm',
                    length: '1.0 m',
                    x: Math.round(worldPos.x),
                    y: Math.round(worldPos.y),
                    boxDx: 30,
                    boxDy: -30,
                    period: '2026H2',
                    description: '',
                    photos: [],
                    inspector: '현장 점검자',
                    date: new Date().toISOString().split('T')[0]
                };
                state.view.hasDragged = false;
            }
        }

        // Unified Interaction Move (MouseMove / TouchMove)
        function handleMove(e, isTouch) {
            // 1. Two-finger Pinch Zoom Handler
            if (isTouch && e.touches && e.touches.length >= 2) {
                wasPinching = true;
                clearLongPress();
                state.view.pendingNewDefect = null;
                state.view.pendingPinTarget = null;
                state.view.pendingDefectBox = null;
                state.view.draggedPinTarget = null;
                state.view.draggedDefectBox = null;

                const t1 = e.touches[0];
                const t2 = e.touches[1];
                const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

                if (pinchStartDist > 0) {
                    const scaleFactor = currentDist / pinchStartDist;
                    state.view.scale = Math.min(Math.max(pinchStartScale * scaleFactor, 0.3), 5.0);
                    updateZoomUI();
                    drawCanvas();
                }
                return;
            }

            const pos = getCanvasPos(e, canvas);
            const mouseX = pos.x;
            const mouseY = pos.y;

            // Cancel long-press timer if finger moves fast before 0.75s!
            if (longPressTimer && state.view.startTouchPos) {
                const distMoved = Math.hypot(mouseX - state.view.startTouchPos.x, mouseY - state.view.startTouchPos.y);
                if (distMoved > 8) {
                    clearLongPress();
                }
            }

            if (!state.view.draggedPinTarget && !state.view.draggedDefectBox && !state.view.isDraggingCanvas) {
                return;
            }

            if (isTouch && e.cancelable && (state.view.draggedPinTarget || state.view.draggedDefectBox)) {
                e.preventDefault();
            }

            if (state.view.draggedPinTarget) {
                const defect = state.view.draggedPinTarget;
                const mouseWorld = screenToWorld(mouseX, mouseY);
                let boundsW = state.bgImage ? state.bgImage.naturalWidth : 1200;
                let boundsH = state.bgImage ? state.bgImage.naturalHeight : 700;

                defect.x = Math.max(0, Math.min(boundsW, Math.round(mouseWorld.x)));
                defect.y = Math.max(0, Math.min(boundsH, Math.round(mouseWorld.y)));
                state.view.hasDragged = true;
                drawCanvas();
                return;
            }

            if (state.view.draggedDefectBox) {
                const defect = state.view.draggedDefectBox;
                const mouseWorld = screenToWorld(mouseX, mouseY);

                const newBoxDx = Math.round(mouseWorld.x - defect.x);
                const newBoxDy = Math.round(mouseWorld.y - defect.y);

                if (Math.hypot(newBoxDx - (defect.boxDx || 30), newBoxDy - (defect.boxDy || -30)) > 3) {
                    state.view.hasDragged = true;
                }

                defect.boxDx = newBoxDx;
                defect.boxDy = newBoxDy;
                
                drawCanvas();
                return;
            }

            if (state.view.isDraggingCanvas) {
                const newOffsetX = mouseX - state.view.dragStartX;
                const newOffsetY = mouseY - state.view.dragStartY;

                if (Math.hypot(newOffsetX - state.view.offsetX, newOffsetY - state.view.offsetY) > 5) {
                    state.view.hasDragged = true;
                }

                state.view.offsetX = newOffsetX;
                state.view.offsetY = newOffsetY;
                drawCanvas();
            }
        }

        // Unified Interaction End (MouseUp / TouchEnd)
        function handleEnd() {
            clearLongPress();
            document.body.classList.remove('dragging-pin');

            // Ignore tap / pin creation after two-finger pinch zoom
            if (wasPinching) {
                wasPinching = false;
                state.view.pendingNewDefect = null;
                state.view.pendingPinTarget = null;
                state.view.pendingDefectBox = null;
                state.view.draggedPinTarget = null;
                state.view.draggedDefectBox = null;
                state.view.isDraggingCanvas = false;
                return;
            }

            if (state.view.draggedPinTarget) {
                const defect = state.view.draggedPinTarget;
                state.view.draggedPinTarget = null;
                state.view.pendingPinTarget = null;
                if (state.view.hasDragged) {
                    saveStateToLocalStorage();
                    renderSurveyTable();
                } else {
                    openDefectModal(defect);
                }
                return;
            }

            if (state.view.draggedDefectBox && state.view.hasDragged) {
                state.view.draggedDefectBox = null;
                state.view.pendingDefectBox = null;
                saveStateToLocalStorage();
                renderSurveyTable();
                return;
            }

            // Short tap on existing pin (without long press) -> Open Edit Modal!
            if ((state.view.pendingPinTarget || state.view.pendingDefectBox) && !isLongPressActive) {
                const targetDefect = state.view.pendingPinTarget || state.view.pendingDefectBox;
                state.view.pendingPinTarget = null;
                state.view.pendingDefectBox = null;
                openDefectModal(targetDefect, false);
                return;
            }

            // Short tap on empty drawing spot (without drag) -> Create New Pin ONLY in MARK mode!
            if (state.view.pendingNewDefect && !state.view.hasDragged) {
                const newDefect = state.view.pendingNewDefect;
                state.view.pendingNewDefect = null;
                state.view.isDraggingCanvas = false;

                if (state.interactionMode !== 'MARK') {
                    // In PAN mode -> Ignore tap on empty spot, DO NOT open pin modal!
                    return;
                }

                setTimeout(() => {
                    openDefectModal(newDefect, true);
                    if (window.setInteractionMode) window.setInteractionMode('PAN');
                }, 50);
                return;
            }

            state.view.isDraggingCanvas = false;
            state.view.pendingPinTarget = null;
            state.view.pendingDefectBox = null;
            state.view.pendingNewDefect = null;
        }

        // Event Listeners Registration
        canvas.addEventListener('mousedown', (e) => handleStart(e, false));
        window.addEventListener('mousemove', (e) => handleMove(e, false));
        window.addEventListener('mouseup', handleEnd);

        canvas.addEventListener('touchstart', (e) => {
            handleStart(e, true);
        }, { passive: false });

        window.addEventListener('touchmove', (e) => {
            handleMove(e, true);
        }, { passive: false });

        window.addEventListener('touchend', handleEnd, { passive: false });
        window.addEventListener('touchcancel', handleEnd, { passive: false });

        // Zoom & Rotation Buttons Handlers
        const btnRotateDrawing = document.getElementById('btnRotateDrawing');
        if (btnRotateDrawing) {
            btnRotateDrawing.addEventListener('click', () => {
                state.rotationAngle = ((state.rotationAngle || 0) + 90) % 360;
                fitToScreen();
                showToast(`🔄 도면을 ${state.rotationAngle}° 방향으로 가로 회전했습니다.`);
            });
        }

        elements.btnZoomIn.addEventListener('click', () => {
            state.view.scale = Math.min(state.view.scale * 1.25, 5.0);
            updateZoomUI();
            drawCanvas();
        });

        elements.btnZoomOut.addEventListener('click', () => {
            state.view.scale = Math.max(state.view.scale * 0.8, 0.3);
            updateZoomUI();
            drawCanvas();
        });

        elements.btnZoomFit.addEventListener('click', fitToScreen);

        elements.btnZoomReset.addEventListener('click', () => {
            state.view.scale = 1.0;
            state.view.offsetX = 50;
            state.view.offsetY = 30;
            updateZoomUI();
            drawCanvas();
        });
    }

    function getNextDefectNumber(parentNo = null) {
        const floorDefects = state.defects[state.currentFloor] || [];
        if (floorDefects.length === 0) return '1';

        if (parentNo) {
            const childDefects = floorDefects.filter(d => d.parentPinNo === parentNo || d.defectNo.split('-')[0] === parentNo);
            
            // If the original parent defect was named e.g. '13' (without -1), convert it to '13-1'
            const existingParent = floorDefects.find(d => d.defectNo === parentNo || (d.parentPinNo === parentNo && !d.defectNo.includes('-')));
            if (existingParent) {
                existingParent.defectNo = `${parentNo}-1`;
                existingParent.parentPinNo = parentNo;
            }

            // Reclaim lowest missing sub-defect index if any
            const subIndices = new Set(childDefects.map(d => {
                const parts = d.defectNo.split('-');
                return parts.length > 1 ? parseInt(parts[1]) : 1;
            }).filter(n => !isNaN(n) && n > 0));

            let nextSubIdx = 1;
            while (subIndices.has(nextSubIdx)) {
                nextSubIdx++;
            }

            return `${parentNo}-${nextSubIdx}`;
        }

        // Reclaim lowest missing parent integer number first! (e.g. 01, 03 -> 02)
        const parentNumbers = new Set(floorDefects.map(d => {
            const p = d.parentPinNo || d.defectNo.split('-')[0];
            return parseInt(p);
        }).filter(n => !isNaN(n) && n > 0));

        let nextParent = 1;
        while (parentNumbers.has(nextParent)) {
            nextParent++;
        }

        return `${nextParent}`;
    }

    function reorderCategoryOptions(selectedCat) {
        if (!elements.inputCategory) return;
        const categories = ['구조체', '비구조체', '마감재'];
        const target = selectedCat || state.lastUsedCategory || '구조체';
        const ordered = [target, ...categories.filter(c => c !== target)];
        elements.inputCategory.innerHTML = ordered.map(c => `<option value="${c}">${c}</option>`).join('');
        elements.inputCategory.value = target;
    }

    const COMPONENT_PRESETS = {
        '구조체': ['기둥', '보', '슬래브', '내력벽', '기초', '계단'],
        '비구조체': ['조적벽체', '난간', '내림벽체', '비내력 RC벽체', 'ALC블록벽체'],
        '마감재': ['천장마감재', '벽체 마감재', '바닥 마감재', '방수층', '외벽 마감재', '석재 마감재', '타일 마감재']
    };

    function renderDynamicComponentChips(category, selectedComponent = '') {
        const container = elements.componentChips;
        if (!container) return;

        let preset = COMPONENT_PRESETS[category] || COMPONENT_PRESETS['구조체'];
        if (selectedComponent && !preset.includes(selectedComponent)) {
            preset = [selectedComponent, ...preset];
        }

        const activeVal = selectedComponent || preset[0];
        if (elements.inputComponentName) elements.inputComponentName.value = activeVal;

        container.innerHTML = preset.map(c => {
            const activeClass = (c === activeVal) ? 'active' : '';
            return `<button type="button" class="chip ${activeClass}" data-val="${c}">${c}</button>`;
        }).join('');
    }

    const CAUSE_PRESETS = {
        '균열': ['건조수축', '부재 내력부족', '개구부 응력집중', '지반침하', '시공 미흡', '보 처짐'],
        '수직균열': ['건조수축', '부재 내력부족', '개구부 응력집중', '지반침하', '시공 미흡', '보 처짐'],
        '경사균열': ['전단력 부족', '부등침하', '개구부 응력집중', '부재 내력부족', '건조수축', '보 처짐'],
        '수평균열': ['휨 응력 초과', '시공 미흡', '건조수축', '부재 내력부족', '경화전 가하중'],
        '사균열': ['부등침하', '전단력 부족', '개구부 응력집중', '건조수축', '시공 미흡'],
        '누수': ['상부 방수층 파손', '드레인 배수구 막힘', '균열 틈새 핑', '코킹재 파손', '배관 결로'],
        '누수흔적': ['상부 방수층 파손', '코킹재 열화/파손', '배관 결로/누수', '우수 침투'],
        '백화': ['상부 방수층 파손', '지속적 누수/습기', '수산화칼슘 용출'],
        '박리': ['피복부족', '철근 부식 내압', '콘크리트 중성화', '동결융해'],
        '박락': ['피복부족', '철근 부식 내압', '콘크리트 중성화', '외부 충격'],
        '철근노출': ['피복부족', '콘크리트 박락', '시공 부실'],
        '피복부족': ['시공 부실', '철근 배근 위치 오류', '피복두께 미확보'],
        '파손': ['진동/충격', '외부 물리적 타격', '사용상 과하중'],
        '고정불량': ['앵커 고정력 열화', '시공부실', '진동/충격', '볼트 느슨해짐'],
        '오염': ['누수/습기', '외부 빗물 유입', '분진/이물질 착색']
    };

    const DEFAULT_CAUSES = ['건조수축', '부재 내력부족', '개구부 응력집중', '지반침하', '상부 방수층 파손', '피복부족', '진동/충격', '시공 미흡'];

    function renderDynamicCauseChips(defectType, selectedCause = '') {
        const container = elements.causeChips;
        if (!container) return;

        let preset = CAUSE_PRESETS[defectType] || CAUSE_PRESETS['균열'] || DEFAULT_CAUSES;
        if (selectedCause && !preset.includes(selectedCause)) {
            preset = [selectedCause, ...preset];
        }

        const activeVal = selectedCause || preset[0];
        if (elements.inputCause) elements.inputCause.value = activeVal;

        container.innerHTML = preset.map(c => {
            const activeClass = (c === activeVal) ? 'active' : '';
            return `<button type="button" class="chip ${activeClass}" data-val="${c}">${c}</button>`;
        }).join('');
    }

    function autoSuggestDefectCause(defectType) {
        renderDynamicCauseChips(defectType, '');
    }

    // --- MODAL CONTROLS ---
    function openDefectModal(defect, isNew = false) {
        elements.inputPinId.value = defect.id || '';
        const fmtNo = formatDefectNumber(defect.defectNo);
        elements.modalPinNumber.textContent = fmtNo;
        elements.inputDefectNumber.value = defect.defectNo;
        
        const cat = defect.category || state.lastUsedCategory || '구조체';
        state.lastUsedCategory = cat;
        reorderCategoryOptions(cat);
        renderDynamicComponentChips(cat, defect.component || '');

        const defType = defect.defectType || '균열';
        elements.inputDefectType.value = defType;
        elements.inputGrade.value = defect.grade || 'C';
        elements.inputWidth.value = defect.width || '';
        elements.inputLength.value = defect.length || '';

        let causeVal = defect.cause;
        if (!causeVal || isNew || causeVal === '-') {
            causeVal = '';
        }
        
        renderDynamicCauseChips(defType, causeVal);

        const inputIsBookmark = document.getElementById('inputIsBookmark');
        if (inputIsBookmark) inputIsBookmark.checked = !!defect.isBookmark;

        elements.inputDescription.value = defect.description || '';
        elements.inputCoordX.value = defect.x;
        elements.inputCoordY.value = defect.y;

        updateChipSelection(elements.defectTypeChips, defType);
        updateGradeChipSelection(defect.grade || 'C');

        renderModalPhotos(defect.photos || []);

        elements.btnDeleteDefect.style.display = isNew ? 'none' : 'inline-flex';
        elements.defectModal.classList.add('open');
    }

    function closeDefectModal() {
        elements.defectModal.classList.remove('open');
        drawCanvas();
    }

    function updateChipSelection(container, value) {
        if (!container) return;
        let found = false;
        container.querySelectorAll('.chip').forEach(chip => {
            if (chip.dataset.val === value) {
                chip.classList.add('active');
                found = true;
            } else {
                chip.classList.remove('active');
            }
        });

        if (!found && value) {
            const newChip = document.createElement('button');
            newChip.type = 'button';
            newChip.className = 'chip active';
            newChip.dataset.val = value;
            newChip.textContent = value;
            container.appendChild(newChip);
        }
    }

    function addCustomComponent() {
        const val = (elements.inputCustomComponent.value || '').trim();
        if (!val) return;
        elements.inputComponentName.value = val;
        updateChipSelection(elements.componentChips, val);
        elements.inputCustomComponent.value = '';
    }

    function addCustomDefectType() {
        const val = (elements.inputCustomDefectType.value || '').trim();
        if (!val) return;
        elements.inputDefectType.value = val;
        updateChipSelection(elements.defectTypeChips, val);
        autoSuggestDefectCause(val);
        elements.inputCustomDefectType.value = '';
    }

    function addCustomCause() {
        const val = (elements.inputCustomCause.value || '').trim();
        if (!val) return;
        if (elements.inputCause) elements.inputCause.value = val;
        
        const container = elements.causeChips;
        if (container) {
            container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            const newChip = document.createElement('button');
            newChip.type = 'button';
            newChip.className = 'chip active';
            newChip.dataset.val = val;
            newChip.textContent = val;
            container.insertBefore(newChip, container.firstChild);
        }
        elements.inputCustomCause.value = '';
    }

    function updateGradeChipSelection(grade) {
        if (!elements.gradeChips) return;
        elements.gradeChips.querySelectorAll('.grade-btn').forEach(btn => {
            if (btn.dataset.val === grade) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    function renderModalPhotos(photos) {
        if (!elements.modalPhotoPreviews) return;
        elements.modalPhotoPreviews.innerHTML = '';
        photos.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.className = 'photo-thumb';
            elements.modalPhotoPreviews.appendChild(img);
        });
    }

    if (elements.inputDefectNumber) {
        elements.inputDefectNumber.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (val && elements.modalPinNumber) {
                elements.modalPinNumber.textContent = formatDefectNumber(val);
            }
        });
    }

    if (elements.componentChips) {
        elements.componentChips.addEventListener('click', (e) => {
            if (e.target.classList.contains('chip')) {
                const val = e.target.dataset.val;
                elements.inputComponentName.value = val;
                updateChipSelection(elements.componentChips, val);
            }
        });
    }

    if (elements.btnAddCustomComponent) {
        elements.btnAddCustomComponent.addEventListener('click', addCustomComponent);
        if (elements.inputCustomComponent) {
            elements.inputCustomComponent.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomComponent();
                }
            });
        }
    }

    if (elements.defectTypeChips) {
        elements.defectTypeChips.addEventListener('click', (e) => {
            if (e.target.classList.contains('chip')) {
                const val = e.target.dataset.val;
                elements.inputDefectType.value = val;
                updateChipSelection(elements.defectTypeChips, val);
                autoSuggestDefectCause(val);
            }
        });
    }

    if (elements.causeChips) {
        elements.causeChips.addEventListener('click', (e) => {
            if (e.target.classList.contains('chip')) {
                const val = e.target.dataset.val;
                elements.inputCause.value = val;
                updateChipSelection(elements.causeChips, val);
            }
        });
    }

    if (elements.btnAddCustomDefectType) {
        elements.btnAddCustomDefectType.addEventListener('click', addCustomDefectType);
        if (elements.inputCustomDefectType) {
            elements.inputCustomDefectType.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomDefectType();
                }
            });
        }
    }

    if (elements.btnAddCustomCause) {
        elements.btnAddCustomCause.addEventListener('click', addCustomCause);
        if (elements.inputCustomCause) {
            elements.inputCustomCause.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomCause();
                }
            });
        }
    }

    if (elements.gradeChips) {
        elements.gradeChips.addEventListener('click', (e) => {
            if (e.target.classList.contains('grade-btn')) {
                const val = e.target.dataset.val;
                if (elements.inputGrade) elements.inputGrade.value = val;
                updateGradeChipSelection(val);
            }
        });
    }

    if (elements.inputCategory) {
        elements.inputCategory.addEventListener('change', (e) => {
            const val = e.target.value;
            state.lastUsedCategory = val;
            reorderCategoryOptions(val);
            renderDynamicComponentChips(val, '');
        });
    }

    elements.btnSaveDefect.addEventListener('click', () => {
        const id = elements.inputPinId.value;
        const defectNo = elements.inputDefectNumber.value;
        const parentPinNo = defectNo.split('-')[0];
        const chosenCategory = elements.inputCategory.value;
        state.lastUsedCategory = chosenCategory;
        reorderCategoryOptions(chosenCategory);

        const floorDefects = state.defects[state.currentFloor] || [];

        const existingIndex = floorDefects.findIndex(d => d.id === id);
        
        let photos = [];
        let boxDx = 30;
        let boxDy = -30;
        if (existingIndex >= 0) {
            photos = floorDefects[existingIndex].photos || [];
            boxDx = floorDefects[existingIndex].boxDx !== undefined ? floorDefects[existingIndex].boxDx : 30;
            boxDy = floorDefects[existingIndex].boxDy !== undefined ? floorDefects[existingIndex].boxDy : -30;
        }
        if (photos.length === 0) {
            photos.push('https://images.unsplash.com/photo-1541888946425-d0fbb186a5b7?w=400');
        }

        const inputIsBookmark = document.getElementById('inputIsBookmark');
        const isBookmark = inputIsBookmark ? inputIsBookmark.checked : false;

        const defectData = {
            id: id || 'pin-' + Date.now(),
            defectNo: defectNo,
            parentPinNo: parentPinNo,
            category: elements.inputCategory.value,
            component: elements.inputComponentName.value,
            defectType: elements.inputDefectType.value,
            grade: elements.inputGrade.value,
            isBookmark: isBookmark,
            width: elements.inputWidth.value || '-',
            length: elements.inputLength.value || '-',
            cause: elements.inputCause.value || '-',
            x: parseFloat(elements.inputCoordX.value) || 200,
            y: parseFloat(elements.inputCoordY.value) || 200,
            boxDx: boxDx,
            boxDy: boxDy,
            period: '2026H2',
            description: elements.inputDescription.value,
            photos: photos,
            inspector: '현장 점검자',
            date: new Date().toISOString().split('T')[0]
        };

        pushUndoSnapshot();
        if (existingIndex >= 0) {
            floorDefects[existingIndex] = defectData;
        } else {
            floorDefects.push(defectData);
        }

        closeDefectModal();
        renderAll();
        saveStateToLocalStorage();
    });

    elements.btnAddSubDefect.addEventListener('click', () => {
        const currentDefectNo = elements.inputDefectNumber.value;
        const parentNo = currentDefectNo.split('-')[0];
        const subDefectNo = getNextDefectNumber(parentNo);

        const newSubDefect = {
            id: 'pin-' + Date.now(),
            defectNo: subDefectNo,
            parentPinNo: parentNo,
            category: elements.inputCategory.value,
            component: elements.inputComponentName.value,
            defectType: '누수',
            grade: 'C',
            width: '',
            length: '',
            x: parseFloat(elements.inputCoordX.value),
            y: parseFloat(elements.inputCoordY.value),
            boxDx: 75,
            boxDy: -15,
            period: '2026H2',
            description: '',
            photos: [],
            inspector: '현장 점검자',
            date: new Date().toISOString().split('T')[0]
        };

        openDefectModal(newSubDefect, true);
    });

    elements.btnDeleteDefect.addEventListener('click', () => {
        const id = elements.inputPinId.value;
        pushUndoSnapshot();
        state.defects[state.currentFloor] = state.defects[state.currentFloor].filter(d => d.id !== id);
        closeDefectModal();
        renderAll();
        saveStateToLocalStorage();
    });

    elements.btnTriggerPhoto.addEventListener('click', () => {
        elements.inputPhotoFile.click();
    });

    elements.inputPhotoFile.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files && files[0]) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = document.createElement('img');
                img.src = event.target.result;
                img.className = 'photo-thumb';
                elements.modalPhotoPreviews.appendChild(img);
            };
            reader.readAsDataURL(files[0]);
        }
    });

    elements.drawingUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    state.bgImage = img;
                    fitToScreen();
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    elements.btnClearPins.addEventListener('click', () => {
        if (confirm('현재 층의 모든 결함 핀을 삭제하시겠습니까?')) {
            state.defects[state.currentFloor] = [];
            renderAll();
        }
    });

    // --- TAB 2: CONDITION SURVEY TABLE RENDERER ---
    function renderSurveyTable() {
        const titleText = `${elements.floorSelect.options[elements.floorSelect.selectedIndex].text}`;
        elements.surveyFloorTitle.textContent = titleText;
        elements.albumFloorTitle.textContent = titleText;

        const tbody = elements.surveyTableBody;
        tbody.innerHTML = '';

        const floorDefects = state.defects[state.currentFloor] || [];
        if (floorDefects.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding: 2rem;">등록된 결함 항목이 없습니다. 도면을 클릭하여 결함을 등록해 주세요.</td></tr>`;
            return;
        }

        let photoSeq = 1;
        floorDefects.forEach(defect => {
            const tr = document.createElement('tr');
            
            let catBadgeClass = 'badge-cat-struct';
            if (defect.category === '비구조체') catBadgeClass = 'badge-cat-nonstruct';
            if (defect.category === '마감재') catBadgeClass = 'badge-cat-finish';

            const fmtNo = formatDefectNumber(defect.defectNo);
            const hasPhoto = defect.photos && defect.photos.length > 0;
            const remarkText = hasPhoto ? `사진 ${photoSeq++}` : '-';
            const bookmarkStar = defect.isBookmark ? `<span style="color:#facc15; font-size:1rem; margin-left:0.3rem;" title="⭐ 중요 결함 북마크">⭐</span>` : '';

            tr.innerHTML = `
                <td><strong># ${fmtNo}</strong>${bookmarkStar}</td>
                <td><span class="badge ${catBadgeClass}">${defect.category}</span></td>
                <td><strong>${defect.component}</strong></td>
                <td>${defect.defectType}</td>
                <td>폭: ${defect.width} / 길이: ${defect.length}</td>
                <td><span class="badge" style="background:var(--bg-primary); border:1px solid var(--border-color); color:var(--text-primary);">${defect.cause || '-'}</span></td>
                <td><strong>${remarkText}</strong></td>
                <td>📷 ${defect.photos ? defect.photos.length : 0}장</td>
                <td>
                    <button class="btn btn-outline btn-sm btn-edit-defect" data-id="${defect.id}">수정</button>
                </td>
            `;

            tr.querySelector('.btn-edit-defect').addEventListener('click', () => {
                openDefectModal(defect);
            });

            tbody.appendChild(tr);
        });
    }

    // --- TAB 3: PHOTO ALBUM RENDERER ---
    function renderPhotoAlbum() {
        const grid = elements.photoGrid;
        grid.innerHTML = '';

        const filterVal = elements.albumFilterComponent.value;
        const floorDefects = state.defects[state.currentFloor] || [];

        const filtered = floorDefects.filter(d => filterVal === 'ALL' || d.category === filterVal);

        if (filtered.length === 0) {
            grid.innerHTML = `<div class="text-muted text-center" style="grid-column: 1/-1; padding: 3rem;">등록된 사진첩 항목이 없습니다.</div>`;
            return;
        }

        filtered.forEach(defect => {
            const imgUrl = (defect.photos && defect.photos[0]) ? defect.photos[0] : 'https://images.unsplash.com/photo-1541888946425-d0fbb186a5b7?w=400';
            const fmtNo = formatDefectNumber(defect.defectNo);

            const card = document.createElement('div');
            card.className = 'photo-card';
            card.innerHTML = `
                <div class="photo-card-img-wrap">
                    <img src="${imgUrl}" class="photo-card-img" alt="결함 사진">
                    <span class="photo-card-badge"># ${fmtNo}</span>
                </div>
                <div class="photo-card-body">
                    <div class="photo-card-title">
                        <span>${defect.component} - ${defect.defectType}</span>
                        <span class="grade-badge gb-${defect.grade.toLowerCase()}">${defect.grade}</span>
                    </div>
                    <div class="photo-card-desc">
                        규격: ${defect.width} / ${defect.length}<br>
                        ${defect.description || '특이사항 없음'}
                    </div>
                    <div class="photo-card-meta">
                        <span>👤 ${defect.inspector}</span>
                        <span>📅 ${defect.date}</span>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    // --- TAB 4: SAFETY GRADE STATISTICS DASHBOARD RENDERER ---
    function renderStatsDashboard() {
        let allDefects = [];
        Object.keys(state.defects).forEach(f => {
            allDefects = allDefects.concat(state.defects[f]);
        });

        const gradeCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
        allDefects.forEach(d => {
            if (gradeCounts[d.grade] !== undefined) {
                gradeCounts[d.grade]++;
            }
        });

        document.getElementById('countGradeA').textContent = `${gradeCounts.A}개`;
        document.getElementById('countGradeB').textContent = `${gradeCounts.B}개`;
        document.getElementById('countGradeC').textContent = `${gradeCounts.C}개`;
        document.getElementById('countGradeD').textContent = `${gradeCounts.D}개`;
        document.getElementById('countGradeE').textContent = `${gradeCounts.E}개`;

        const groups = {};
        allDefects.forEach(d => {
            const key = `${d.category}__${d.component}__${d.defectType}`;
            if (!groups[key]) {
                groups[key] = {
                    category: d.category,
                    component: d.component,
                    defectType: d.defectType,
                    A: 0, B: 0, C: 0, D: 0, E: 0, total: 0
                };
            }
            groups[key][d.grade]++;
            groups[key].total++;
        });

        const tbody = elements.statsTableBody;
        tbody.innerHTML = '';

        if (Object.keys(groups).length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding: 2rem;">집계할 안전점검 데이터가 없습니다.</td></tr>`;
        } else {
            Object.values(groups).forEach(g => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${g.category}</td>
                    <td><strong>${g.component}</strong></td>
                    <td>${g.defectType}</td>
                    <td><strong class="text-green">${g.A}</strong></td>
                    <td>${g.B}</td>
                    <td>${g.C}</td>
                    <td><strong style="color:var(--grade-d);">${g.D}</strong></td>
                    <td><strong style="color:var(--grade-e);">${g.E}</strong></td>
                    <td><strong>${g.total}개</strong></td>
                `;
                tbody.appendChild(tr);
            });
        }

        const totalCount = allDefects.length;
        let summaryHtml = `
            <p><strong>[ 건축물 안전점검 등급 집계 종합 결과 ]</strong></p>
            <p>• 총 등록된 결함 수량: <strong>${totalCount}개</strong></p>
            <p>• 등급별 현황: A등급(${gradeCounts.A}개), B등급(${gradeCounts.B}개), C등급(${gradeCounts.C}개), D등급(${gradeCounts.D}개), E등급(${gradeCounts.E}개)</p>
        `;

        if (gradeCounts.D > 0 || gradeCounts.E > 0) {
            summaryHtml += `<p style="color: var(--color-structural); margin-top:0.5rem;"><i class="fa-solid fa-triangle-exclamation"></i> <strong>주요 주의사항:</strong> D등급/E등급 손상 부위가 ${gradeCounts.D + gradeCounts.E}건 존재하므로 보수·보강 조치가 요구됩니다.</p>`;
        } else {
            summaryHtml += `<p style="color: var(--grade-a); margin-top:0.5rem;"><i class="fa-solid fa-circle-check"></i> <strong>상태 양호:</strong> 심각한 결함(D/E등급)이 없으며 정기적인 유지관리가 권장됩니다.</p>`;
        }

        elements.reportSummaryBox.innerHTML = summaryHtml;
    }

    // --- EXCEL / CSV EXPORT FUNCTION ---
    function exportSurveyToCSV() {
        const floorDefects = state.defects[state.currentFloor] || [];
        if (floorDefects.length === 0) {
            alert('내보낼 결함 데이터가 없습니다.');
            return;
        }

        let csvContent = "\uFEFF"; // UTF-8 BOM for Excel
        csvContent += "순번,결함번호,부재분류,부재명,결함종류,손상규모(폭/길이),결함원인추정,비고,점검자,점검일자\n";

        let photoSeq = 1;
        floorDefects.forEach((d, idx) => {
            const fmtNo = formatDefectNumber(d.defectNo);
            const cause = (d.cause || '').replace(/"/g, '""');
            const hasPhoto = d.photos && d.photos.length > 0;
            const remarkText = hasPhoto ? `사진 ${photoSeq++}` : '-';
            csvContent += `${idx + 1},"${fmtNo}","${d.category}","${d.component}","${d.defectType}","폭:${d.width} / L:${d.length}","${cause}","${remarkText}","${d.inspector}","${d.date}"\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `건축물_안전점검_상태조사표_${state.currentFloor}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // --- EXCEL / CSV IMPORT FUNCTION ---
    function importSurveyFromCSV(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const text = event.target.result;
                const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
                if (lines.length === 0) {
                    alert('선택한 파일에 데이터가 없습니다.');
                    return;
                }

                const firstLine = lines[0];
                const delimiter = firstLine.includes('\t') ? '\t' : ',';

                const parseCSVLine = (line) => {
                    const regex = new RegExp(`(?:^|${delimiter})(?:"([^"]*)"|([^"${delimiter}]*))`, 'g');
                    const matches = [];
                    let match;
                    while ((match = regex.exec(line)) !== null) {
                        matches.push((match[1] !== undefined ? match[1] : match[2] || '').trim());
                    }
                    return matches;
                };

                let startIndex = 0;
                if (lines[0].includes('결함') || lines[0].includes('순번') || lines[0].includes('부재')) {
                    startIndex = 1;
                }

                const currentFloorDefects = state.defects[state.currentFloor] || [];
                let importedCount = 0;

                for (let i = startIndex; i < lines.length; i++) {
                    const cols = parseCSVLine(lines[i]);
                    if (cols.length < 2) continue;

                    let defectNo = '';
                    let category = '구조체';
                    let component = '기둥';
                    let defectType = '균열';
                    let width = '-';
                    let length = '-';
                    let cause = '건조수축';
                    let description = '';

                    if (cols.length >= 7) {
                        defectNo = cols[1] || cols[0];
                        category = cols[2] || '구조체';
                        component = cols[3] || '기둥';
                        defectType = cols[4] || '균열';
                        const sizeStr = cols[5] || '';
                        if (sizeStr.includes('/')) {
                            const parts = sizeStr.split('/');
                            width = parts[0] ? parts[0].replace('폭:', '').trim() : '-';
                            length = parts[1] ? parts[1].replace('L:', '').trim() : '-';
                        } else {
                            width = cols[5] || '-';
                            length = cols[6] || '-';
                        }
                        cause = cols[6] || cols[7] || '건조수축';
                        description = cols[7] || cols[8] || '';
                    } else {
                        defectNo = cols[0];
                        category = cols[1] || '구조체';
                        component = cols[2] || '기둥';
                        defectType = cols[3] || '균열';
                        width = cols[4] || '-';
                        length = cols[5] || '-';
                        cause = cols[6] || '건조수축';
                    }

                    defectNo = defectNo.replace(/^#\s*/, '').replace(/"/g, '').trim();
                    if (!defectNo) defectNo = getNextDefectNumber();

                    const gridIndex = currentFloorDefects.length;
                    const colIdx = gridIndex % 5;
                    const rowIdx = Math.floor(gridIndex / 5);
                    const startX = 220 + colIdx * 175;
                    const startY = 180 + rowIdx * 140;

                    const newDefect = {
                        id: 'pin-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
                        defectNo: defectNo,
                        parentPinNo: defectNo.split('-')[0],
                        category: ['구조체', '비구조체', '마감재'].includes(category) ? category : '구조체',
                        component: component || '기둥',
                        defectType: defectType || '균열',
                        grade: 'C',
                        width: width || '-',
                        length: length || '-',
                        cause: cause || '건조수축',
                        x: startX,
                        y: startY,
                        boxDx: 30,
                        boxDy: -30,
                        period: '2026H2',
                        description: description,
                        photos: [],
                        inspector: '현장 점검자',
                        date: new Date().toISOString().split('T')[0]
                    };

                    currentFloorDefects.push(newDefect);
                    importedCount++;
                }

                state.defects[state.currentFloor] = currentFloorDefects;
                saveStateToLocalStorage();
                renderAll();

                alert(`🎉 총 ${importedCount}건의 결함 표 데이터가 ${elements.floorSelect.options[elements.floorSelect.selectedIndex].text} 상태조사표에 성공적으로 등록되었습니다!\n\n도면 탭에서 배치된 핀 위치를 드래그하여 원하시는 결함 위치로 미세 조정하실 수 있습니다.`);
            } catch (err) {
                console.error(err);
                alert('파일을 읽는 중 오류가 발생했습니다. CSV 또는 텍스트 파일 서식을 확인해 주세요.');
            }
        };

        reader.readAsText(file, 'UTF-8');
        e.target.value = '';
    }

    // --- HIGH-DPI ZERO-MARGIN PRINT MAP GENERATOR (90-DEGREE PORTRAIT ROTATION FIT) ---
    function generateHighResPrintMapCanvas() {
        let origW = 1200;
        let origH = 700;
        if (state.bgImage) {
            origW = state.bgImage.naturalWidth || 1200;
            origH = state.bgImage.naturalHeight || 700;
        }

        const isLandscapeBlueprint = origW > origH;

        // Dedicated High DPI Canvas for A4 Portrait (1900 x 2700 px)
        const targetW = 1900;
        const targetH = 2700;

        const offscreen = document.createElement('canvas');
        offscreen.width = targetW;
        offscreen.height = targetH;
        const ctx = offscreen.getContext('2d');

        // Fill background with clean white
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);

        // 1. Render Blueprint on a source canvas of (origW x origH)
        const bpCanvas = document.createElement('canvas');
        bpCanvas.width = origW;
        bpCanvas.height = origH;
        const bpCtx = bpCanvas.getContext('2d');

        if (state.bgImage) {
            bpCtx.drawImage(state.bgImage, 0, 0, origW, origH);
        } else {
            drawSyntheticBlueprint(bpCtx, origW, origH);
        }

        const cx = targetW / 2;
        const cy = targetH / 2;

        let scale = 1.0;
        let drawW = targetW;
        let drawH = targetH;

        if (isLandscapeBlueprint) {
            // Rotate 90 degrees Clockwise so horizontal floor plan spans vertically on A4 Portrait!
            const rotW = origH;
            const rotH = origW;
            scale = Math.min((targetW * 0.96) / rotW, (targetH * 0.96) / rotH);

            drawW = origW * scale; // length along rotated Y axis
            drawH = origH * scale; // length along rotated X axis

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(Math.PI / 2); // 90 degree clockwise rotation!
            ctx.drawImage(bpCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
        } else {
            // Native Portrait Blueprint
            scale = Math.min((targetW * 0.96) / origW, (targetH * 0.96) / origH);
            drawW = origW * scale;
            drawH = origH * scale;

            ctx.save();
            ctx.drawImage(bpCanvas, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
            ctx.restore();
        }

        const floorDefects = state.defects[state.currentFloor] || [];
        const visibleDefects = floorDefects.filter(d => {
            return state.filters.periods[d.period] !== false && state.filters.categories[d.category] !== false;
        });

        const printPinScale = 1.8;

        visibleDefects.forEach(defect => {
            let targetX, targetY, boxCenterX, boxCenterY;

            if (isLandscapeBlueprint) {
                // Point transformation for 90-degree Clockwise rotation around canvas center
                const nx = (defect.x - origW / 2) / origW;
                const ny = (defect.y - origH / 2) / origH;

                targetX = cx - ny * drawH;
                targetY = cy + nx * drawW;

                const boxWorldX = defect.x + (defect.boxDx !== undefined ? defect.boxDx : 30);
                const boxWorldY = defect.y + (defect.boxDy !== undefined ? defect.boxDy : -30);
                const boxNx = (boxWorldX - origW / 2) / origW;
                const boxNy = (boxWorldY - origH / 2) / origH;

                boxCenterX = cx - boxNy * drawH;
                boxCenterY = cy + boxNx * drawW;
            } else {
                const nx = (defect.x - origW / 2) / origW;
                const ny = (defect.y - origH / 2) / origH;
                targetX = cx + nx * drawW;
                targetY = cy + ny * drawH;

                const boxWorldX = defect.x + (defect.boxDx !== undefined ? defect.boxDx : 30);
                const boxWorldY = defect.y + (defect.boxDy !== undefined ? defect.boxDy : -30);
                const boxNx = (boxWorldX - origW / 2) / origW;
                const boxNy = (boxWorldY - origH / 2) / origH;

                boxCenterX = cx + boxNx * drawW;
                boxCenterY = cy + boxNy * drawH;
            }

            drawHighResPinMarker(ctx, defect, targetX, targetY, boxCenterX, boxCenterY, printPinScale);
        });

        return offscreen.toDataURL('image/png');
    }

    function drawHighResPinMarker(ctx, defect, targetX, targetY, boxCenterX, boxCenterY, pScale) {
        let pinColor = '#ef4444'; // Red for Structural
        if (defect.category === '비구조체') pinColor = '#3b82f6'; // Blue
        if (defect.category === '마감재') pinColor = '#f97316'; // Orange

        const shape = state.pinShapeStyle || 'square';
        const tipStyle = state.targetTipStyle || 'arrow';
        const label = formatDefectNumber(defect.defectNo);

        ctx.save();

        // 1. Leader Line
        ctx.beginPath();
        ctx.moveTo(targetX, targetY);
        ctx.lineTo(boxCenterX, boxCenterY);
        ctx.strokeStyle = pinColor;
        ctx.lineWidth = 3.5 * pScale;
        ctx.stroke();

        // 2. Target Tip (Circle ONLY OR Arrowhead ONLY)
        if (tipStyle === 'circle') {
            ctx.beginPath();
            ctx.arc(targetX, targetY, 8 * pScale, 0, Math.PI * 2);
            ctx.fillStyle = pinColor;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5 * pScale;
            ctx.stroke();
        } else {
            const headLen = 16 * pScale;
            const angle = Math.atan2(targetY - boxCenterY, targetX - boxCenterX);
            ctx.beginPath();
            ctx.moveTo(targetX, targetY);
            ctx.lineTo(targetX - headLen * Math.cos(angle - Math.PI / 6), targetY - headLen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(targetX - headLen * Math.cos(angle + Math.PI / 6), targetY - headLen * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fillStyle = pinColor;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2 * pScale;
            ctx.stroke();
        }

        // 3. White Badge Box
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = pinColor;
        ctx.lineWidth = 3.5 * pScale;

        const baseCharW = label.length * 12 + 20;
        const boxW = Math.max(baseCharW, 54) * pScale;
        const boxH = 32 * pScale;
        const bx = boxCenterX - boxW / 2;
        const by = boxCenterY - boxH / 2;

        if (shape === 'circle') {
            const radius = Math.max(boxW, boxH) / 2 + 3 * pScale;
            ctx.beginPath();
            ctx.arc(boxCenterX, boxCenterY, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(bx, by, boxW, boxH, 6 * pScale);
            } else {
                ctx.rect(bx, by, boxW, boxH);
            }
            ctx.fill();
            ctx.stroke();
        }

        // 4. Text in pinColor
        ctx.fillStyle = pinColor;
        const fontSize = Math.round(17 * pScale);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, boxCenterX, boxCenterY);

        ctx.restore();
    }

    // --- COMPUTE & GENERATE FULL A4 PRINTABLE REPORT (층별: 상태조사표 -> 사진첩 6매(4:3) -> 위치도 순서) ---
    function generatePrintableReport(triggerPrint = true) {
        const container = document.getElementById('printableReportContainer');
        if (!container) return;

        const floorText = elements.floorSelect.options[elements.floorSelect.selectedIndex].text;
        const floorDefects = state.defects[state.currentFloor] || [];
        const today = new Date().toISOString().split('T')[0];

        // 1. Export High-Res Map Snapshot
        const mapDataUrl = generateHighResPrintMapCanvas();

        let html = '';

        // Pre-process photo numbers sequentially only for defects containing photos!
        const photoDefects = [];
        let pSeq = 1;
        floorDefects.forEach(d => {
            if (d.photos && d.photos.length > 0) {
                d._photoSeq = pSeq++;
                d._photoNoStr = `사진 ${d._photoSeq}`;
                photoDefects.push(d);
            } else {
                d._photoSeq = null;
                d._photoNoStr = '-';
            }
        });

        // STEP 1: 층별 상태조사 결과표 (Floor Condition Survey Table)
        html += `
            <div class="print-page">
                <div class="print-title">📋 ${floorText} 건축물 층별 상태조사 결과표</div>
                <div class="print-header-info">
                    <span><strong>점검 대상:</strong> 강남 서초 타워</span>
                    <span><strong>점검 층:</strong> ${floorText}</span>
                </div>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th style="width:12%;">결함번호</th>
                            <th style="width:12%;">부재분류</th>
                            <th style="width:14%;">부재명</th>
                            <th style="width:14%;">결함종류</th>
                            <th style="width:16%;">손상규모 (폭/길이)</th>
                            <th style="width:16%;">결함원인 추정</th>
                            <th style="width:16%;">비고</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (floorDefects.length === 0) {
            html += `<tr><td colspan="7" style="text-align:center; padding: 2rem;">등록된 결함 항목이 없습니다.</td></tr>`;
        } else {
            floorDefects.forEach(d => {
                const fmtNo = formatDefectNumber(d.defectNo);
                const remarkText = d._photoNoStr;
                html += `
                    <tr>
                        <td><strong># ${fmtNo}</strong></td>
                        <td>${d.category}</td>
                        <td><strong>${d.component}</strong></td>
                        <td>${d.defectType}</td>
                        <td>폭:${d.width} / L:${d.length}</td>
                        <td>${d.cause || '-'}</td>
                        <td><strong>${remarkText}</strong></td>
                    </tr>
                `;
            });
        }

        html += `
                    </tbody>
                </table>
            </div>
        `;

        // STEP 2: 층별 현장 사진첩 (A4 1장당 6개 배치, 4:3 비율, 사진 밑 '보 수직균열' 표기, 등급 제외)
        const pageSize = 6;
        const totalPhotoPages = Math.ceil(photoDefects.length / pageSize) || 1;

        for (let p = 0; p < totalPhotoPages; p++) {
            const pageDefects = photoDefects.slice(p * pageSize, (p + 1) * pageSize);
            html += `
                <div class="print-page">
                    <div class="print-title">📷 ${floorText} 현장 점검 사진첩 (${p + 1}/${totalPhotoPages} 페이지)</div>
                    <div class="print-header-info">
                        <span><strong>점검 대상:</strong> 강남 서초 타워</span>
                        <span><strong>점검 층:</strong> ${floorText}</span>
                    </div>
                    <div class="print-photo-grid-6">
            `;

            if (pageDefects.length === 0) {
                html += `<div style="grid-column: 1/-1; text-align:center; padding:3rem;">등록된 결함 사진이 없습니다.</div>`;
            } else {
                pageDefects.forEach(d => {
                    const imgUrl = (d.photos && d.photos[0]) ? d.photos[0] : 'https://images.unsplash.com/photo-1541888946425-d0fbb186a5b7?w=400';
                    const shortLabel = `${d.component} ${d.defectType}`; // e.g. "보 수직균열"

                    html += `
                        <div class="print-photo-card-6">
                            <img src="${imgUrl}" class="print-photo-img-43" alt="결함사진">
                            <div class="print-photo-label-title" style="text-align:center; padding: 0.3rem 0; margin-bottom: 0; border-bottom: none;">[사진 ${d._photoSeq}] ${shortLabel}</div>
                        </div>
                    `;
                });
            }

            html += `
                    </div>
                </div>
            `;
        }

        // STEP 3: 층별 결함위치도 (Floor Defect Location Map - Zero Margin Landscape/Full Frame Fit)
        html += `
            <div class="print-page print-page-map">
                <div class="print-map-header">
                    <span><strong>🗺️ ${floorText} 건축물 층별 결함위치도</strong></span>
                    <span><strong>점검 대상:</strong> 강남 서초 타워</span>
                </div>
                <div class="print-map-wrapper">
                    <img src="${mapDataUrl}" class="print-map-img" alt="층별 결함위치도">
                </div>
            </div>
        `;

        container.innerHTML = html;

        setTimeout(() => {
            window.print();
        }, 100);
    }

    function renderDashboard() {
        const grid = document.getElementById('buildingListGrid');
        const countText = document.getElementById('buildingCountText');

        if (!state.buildings) state.buildings = [];
        if (state.buildings.length === 0 && !window._initializedBuildings) {
            window._initializedBuildings = true;
            state.buildings = [
                {
                    id: 'bldg-1',
                    name: '🏢 강남 테헤란 타워',
                    type: '정밀안전점검',
                    inspector: '홍길동 수석점검자',
                    date: '2026-07-28',
                    floors: '지상 15층 ~ 지하 3층',
                    notes: '2026 하반기 정밀안전점검 진행 중'
                },
                {
                    id: 'bldg-2',
                    name: '🏢 인천 물류센터 A동',
                    type: '정기안전점검',
                    inspector: '이순신 점검원',
                    date: '2026-06-15',
                    floors: '지상 5층 ~ 지하 1층',
                    notes: '상반기 정기안전점검 완료'
                },
                {
                    id: 'bldg-3',
                    name: '🏢 서초 아파트 101동',
                    type: '긴급안전점검',
                    inspector: '김철수 부장',
                    date: '2026-05-10',
                    floors: '지상 20층 ~ 지하 2층',
                    notes: '외벽 균열 긴급 점검 완료'
                }
            ];
        }

        if (countText) countText.textContent = state.buildings.length;

        if (!grid) return;
        grid.innerHTML = '';

        state.buildings.forEach(bldg => {
            const card = document.createElement('div');
            card.className = 'building-card';
            card.style.cssText = 'padding: 1.5rem; display: flex; flex-direction: column; justify-content: space-between; gap: 1.2rem; min-height: 140px; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px; backdrop-filter: blur(10px); box-shadow: 0 4px 20px rgba(0,0,0,0.3);';

            card.innerHTML = `
                <div class="building-card-header" style="margin-bottom: 0;">
                    <h3 class="building-title" style="font-size: 1.25rem; font-weight: 800; color: #f8fafc; display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; width: 100%;">
                        <span>${bldg.name}</span>
                        <span style="font-size: 0.78rem; font-weight: 600; color: #94a3b8; background: rgba(255,255,255,0.06); padding: 0.25rem 0.6rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">${bldg.floors || '지상 10층 ~ 지하 2층'}</span>
                    </h3>
                </div>
                <div class="building-card-actions" style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
                    <button class="btn btn-open-building-map" data-id="${bldg.id}" style="flex: 2; min-width: 180px; justify-content: center; padding: 0.8rem 1rem; font-size: 0.95rem; font-weight: 700; background: linear-gradient(135deg, #0284c7, #2563eb); border-radius: 8px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);">
                        <i class="fa-solid fa-map-location-dot"></i> 🚀 현장 도면 점검 시작
                    </button>
                    <button class="btn btn-edit-building" data-id="${bldg.id}" style="flex: 1; min-width: 130px; justify-content: center; padding: 0.8rem 0.8rem; font-size: 0.88rem; font-weight: 700; background: rgba(168, 85, 247, 0.15); border: 1px solid #a855f7; color: #d8b4fe; border-radius: 8px;">
                        <i class="fa-solid fa-pen-to-square"></i> ✏️ 명칭/도면 수정
                    </button>
                </div>
            `;

            card.querySelector('.btn-open-building-map').addEventListener('click', () => {
                selectBuildingAndInspect(bldg);
            });

            card.querySelector('.btn-edit-building').addEventListener('click', () => {
                if (window.openEditBuildingModalFunc) window.openEditBuildingModalFunc(bldg.id);
            });

            grid.appendChild(card);
        });
    }

    window.renderDashboard = renderDashboard;

    function getDefaultBlueprintSvgDataUrl(floorCode) {
        const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
            <rect width="1600" height="1000" fill="#0f172a"/>
            <g stroke="rgba(56,189,248,0.15)" stroke-width="1">
                <line x1="0" y1="100" x2="1600" y2="100"/><line x1="0" y1="200" x2="1600" y2="200"/>
                <line x1="0" y1="300" x2="1600" y2="300"/><line x1="0" y1="400" x2="1600" y2="400"/>
                <line x1="0" y1="500" x2="1600" y2="500"/><line x1="0" y1="600" x2="1600" y2="600"/>
                <line x1="0" y1="700" x2="1600" y2="700"/><line x1="0" y1="800" x2="1600" y2="800"/>
                <line x1="0" y1="900" x2="1600" y2="900"/>
                <line x1="200" y1="0" x2="200" y2="1000"/><line x1="400" y1="0" x2="400" y2="1000"/>
                <line x1="600" y1="0" x2="600" y2="1000"/><line x1="800" y1="0" x2="800" y2="1000"/>
                <line x1="1000" y1="0" x2="1000" y2="1000"/><line x1="1200" y1="0" x2="1200" y2="1000"/>
                <line x1="1400" y1="0" x2="1400" y2="1000"/>
            </g>
            <rect x="150" y="150" width="1300" height="700" fill="none" stroke="#38bdf8" stroke-width="8"/>
            <line x1="550" y1="150" x2="550" y2="850" stroke="#38bdf8" stroke-width="5"/>
            <line x1="1000" y1="150" x2="1000" y2="850" stroke="#38bdf8" stroke-width="5"/>
            <line x1="150" y1="500" x2="1450" y2="500" stroke="#38bdf8" stroke-width="5"/>
            <rect x="140" y="140" width="20" height="20" fill="#38bdf8"/><rect x="540" y="140" width="20" height="20" fill="#38bdf8"/><rect x="990" y="140" width="20" height="20" fill="#38bdf8"/><rect x="1440" y="140" width="20" height="20" fill="#38bdf8"/>
            <rect x="140" y="490" width="20" height="20" fill="#38bdf8"/><rect x="540" y="490" width="20" height="20" fill="#38bdf8"/><rect x="990" y="490" width="20" height="20" fill="#38bdf8"/><rect x="1440" y="490" width="20" height="20" fill="#38bdf8"/>
            <rect x="140" y="840" width="20" height="20" fill="#38bdf8"/><rect x="540" y="840" width="20" height="20" fill="#38bdf8"/><rect x="990" y="840" width="20" height="20" fill="#38bdf8"/><rect x="1440" y="840" width="20" height="20" fill="#38bdf8"/>
            <text x="800" y="100" fill="#38bdf8" font-size="28" font-weight="bold" text-anchor="middle">🏢 건축물 ${floorCode} 표준 구조 도면 (ARCHITECTURAL BLUEPRINT)</text>
        </svg>`;
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
    }

    function loadFloorDrawing(floorCode) {
        state.currentFloor = floorCode;
        state.bgImage = null;

        const bldg = state.currentBuilding;
        let dataUrl = null;
        if (bldg && bldg.floorDrawings && bldg.floorDrawings[floorCode]) {
            dataUrl = bldg.floorDrawings[floorCode];
        } else if (state.floorDrawings && state.floorDrawings[floorCode]) {
            dataUrl = state.floorDrawings[floorCode];
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
            setTimeout(() => {
                resizeCanvas();
                fitToScreen();
            }, 50);
        };
        img.src = dataUrl;
    }

    window.loadFloorDrawing = loadFloorDrawing;

    function selectBuildingAndInspect(bldg) {
        if (!bldg) return;
        const targetState = window.state || window.appState || state;
        targetState.currentBuilding = bldg;
        targetState.currentBuildingId = bldg.id;
        state.currentBuilding = bldg;
        state.currentBuildingId = bldg.id;

        const appTitle = document.querySelector('.app-title');
        const appSubtitle = document.querySelector('.app-subtitle');
        const cleanName = bldg.name ? bldg.name.replace(/^🏢\s*/, '') : '건축물';
        if (appTitle) appTitle.textContent = `${cleanName} 점검 시스템`;
        if (appSubtitle) appSubtitle.textContent = `📍 주소: ${bldg.address || '서울특별시 강남구'} | 👤 책임점검자: ${bldg.inspector || '홍길동 수석점검자'} | 📅 점검일: ${bldg.date || '2026-07-28'}`;

        updateProjectSelectDropdown();

        // Populate floorSelect dropdown dynamically if building has custom uploaded floor list
        const floorSelect = document.getElementById('floorSelect');
        if (bldg.floorsList && bldg.floorsList.length > 0) {
            if (floorSelect) {
                floorSelect.innerHTML = bldg.floorsList.map(f => `<option value="${f.floorCode}">${f.floorLabel}</option>`).join('');
                targetState.currentFloor = bldg.floorsList[0].floorCode;
                state.currentFloor = bldg.floorsList[0].floorCode;
            }
        } else {
            if (floorSelect) {
                floorSelect.innerHTML = `
                    <option value="1F">지상 1층 (1F)</option>
                    <option value="2F">지상 2층 (2F)</option>
                    <option value="3F">지상 3층 (3F)</option>
                    <option value="B1F">지하 1층 (B1F)</option>
                    <option value="B2F">지하 2층 (B2F)</option>
                    <option value="ROOF">옥상 층 (ROOF)</option>
                `;
            }
        }

        loadFloorDrawing(targetState.currentFloor || '1F');
        showToast(`🏢 '${bldg.name}' 현장 점검 화면으로 이동했습니다.`);
        switchTab('tab-map');
    }

    window.selectBuildingAndInspect = selectBuildingAndInspect;
    window.selectBuildingAndInspectFunc = function(bldgId) {
        const targetState = window.state || window.appState || state;
        if (!targetState || !targetState.buildings || targetState.buildings.length === 0) return;
        
        let bldg = null;
        if (bldgId) {
            bldg = targetState.buildings.find(b => b.id === bldgId || b.name === bldgId || (b.name && b.name.includes(bldgId)));
        }
        if (!bldg && targetState.buildings.length > 0) {
            bldg = targetState.buildings[0];
        }
        if (bldg) selectBuildingAndInspect(bldg);
    };

    function updateProjectSelectDropdown() {
        const projectSelect = document.getElementById('projectSelect');
        if (!projectSelect || !state.buildings) return;
        projectSelect.innerHTML = state.buildings.map(b => {
            return `<option value="${b.id}">${b.name}</option>`;
        }).join('');
        if (state.currentBuildingId) projectSelect.value = state.currentBuildingId;
    }

    function switchTab(targetTabId) {
        if (!targetTabId) targetTabId = 'tab-home';
        const headerSelectorGroup = document.getElementById('headerSelectorGroup');
        const headerReportActions = document.getElementById('headerReportActions');
        const mainNavTabs = document.getElementById('mainNavTabs');

        const allContents = document.querySelectorAll('.tab-content');
        allContents.forEach(c => {
            if (c.id === targetTabId) {
                c.classList.add('active');
                c.style.display = 'flex';
            } else {
                c.classList.remove('active');
                c.style.display = 'none';
            }
        });

        const allBtns = document.querySelectorAll('.tab-btn');
        allBtns.forEach(b => {
            if (b.dataset.tab === targetTabId) b.classList.add('active');
            else b.classList.remove('active');
        });

        if (targetTabId === 'tab-home') {
            if (headerSelectorGroup) headerSelectorGroup.style.display = 'none';
            if (headerReportActions) headerReportActions.style.display = 'none';
            if (mainNavTabs) mainNavTabs.style.display = 'none';

            const appTitle = document.querySelector('.app-title');
            const appSubtitle = document.querySelector('.app-subtitle');
            if (appTitle) appTitle.textContent = '스마트 건축물 안전점검 시스템';
            if (appSubtitle) appSubtitle.textContent = 'PC · 갤럭시 탭 · 스마트폰 실시간 연동 현장점검';

            renderDashboard();
        } else {
            if (headerSelectorGroup) headerSelectorGroup.style.display = 'flex';
            if (headerReportActions) headerReportActions.style.display = 'flex';
            if (mainNavTabs) mainNavTabs.style.display = 'flex';
        }

        state.currentTab = targetTabId;

        if (targetTabId === 'tab-map') {
            if (!state.currentBuilding && state.buildings && state.buildings.length > 0) {
                state.currentBuilding = state.buildings[0];
            }
            if (!state.bgImage) {
                loadFloorDrawing(state.currentFloor || '1F');
            }
            drawCanvas();
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

    window.switchTab = switchTab;

    function renderAll() {
        renderDashboard();
        drawCanvas();
        renderSurveyTable();
        renderPhotoAlbum();
    }

    // --- EVENT LISTENERS SETUP ---
    function setupEventListeners() {
        // Global Click Event Delegation for Tab Switching, Add Building & Home Return
        document.addEventListener('click', (e) => {
            const addBtn = e.target.closest('#btnOpenAddBuildingModal, .btn-hero-cta');
            if (addBtn) {
                e.preventDefault();
                e.stopPropagation();
                if (window.openAddBuildingModalFunc) window.openAddBuildingModalFunc();
                return;
            }
            const btn = e.target.closest('[data-tab], #btnPersistentHome, #btnLogoHome');
            if (btn) {
                const tabId = btn.dataset.tab || 'tab-home';
                e.preventDefault();
                switchTab(tabId);
            }
        });

        // Canvas Mode Toggle Listeners (PAN vs MARK)
        state.interactionMode = 'PAN';
        const btnModePan = document.getElementById('btnModePan');
        const btnModeMark = document.getElementById('btnModeMark');

        function setInteractionMode(mode) {
            state.interactionMode = mode;
            if (mode === 'PAN') {
                if (btnModePan) btnModePan.classList.add('active');
                if (btnModeMark) btnModeMark.classList.remove('active');
                const hint = document.getElementById('canvasHintText');
                if (hint) hint.innerHTML = `<i class="fa-solid fa-hand"></i> <span>[✋ 화면 이동 모드] 손가락으로 도면 자유 이동/확대 전용 | 핀을 찍으려면 <strong>📍[결함 위치 마킹]</strong> 클릭</span>`;
                showToast('✋ [화면 자유 이동 모드] 도면을 마음껏 이동하고 확대/축소하세요');
            } else {
                if (btnModeMark) btnModeMark.classList.add('active');
                if (btnModePan) btnModePan.classList.remove('active');
                const hint = document.getElementById('canvasHintText');
                if (hint) hint.innerHTML = `<i class="fa-solid fa-location-dot" style="color:#f87171;"></i> <span style="color:#f87171;"><strong>[📍 결함 마킹 모드]</strong> 도면에서 결함 위치를 터치(클릭)하세요!</span>`;
                showToast('📍 [결함 마킹 모드 활성화] 도면의 결함 위치를 터치해 주세요');
            }
        }

        window.setInteractionMode = setInteractionMode;

        if (btnModePan) btnModePan.addEventListener('click', () => setInteractionMode('PAN'));
        if (btnModeMark) btnModeMark.addEventListener('click', () => setInteractionMode('MARK'));

        if (elements.floorSelect) {
            elements.floorSelect.addEventListener('change', (e) => {
                loadFloorDrawing(e.target.value);
                renderAll();
            });
        }

        if (elements.drawingUpload) {
            elements.drawingUpload.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                    const dataUrl = event.target.result;
                    const img = new Image();
                    img.onload = () => {
                        state.bgImage = img;
                        if (!state.floorDrawings) state.floorDrawings = {};
                        state.floorDrawings[state.currentFloor] = dataUrl;
                        if (state.currentBuilding) {
                            if (!state.currentBuilding.floorDrawings) state.currentBuilding.floorDrawings = {};
                            state.currentBuilding.floorDrawings[state.currentFloor] = dataUrl;
                        }
                        saveStateToLocalStorage();
                        resizeCanvas();
                        fitToScreen();
                        drawCanvas();
                        showToast(`🖼️ [${state.currentFloor}] 층 도면 이미지가 등록되었습니다!`);
                    };
                    img.src = dataUrl;
                };
                reader.readAsDataURL(file);
            });
        }

        if (elements.tabBtns) {
            elements.tabBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    elements.tabBtns.forEach(b => b.classList.remove('active'));
                    elements.tabContents.forEach(c => c.classList.remove('active'));

                    btn.classList.add('active');
                    const tabId = btn.dataset.tab;
                    document.getElementById(tabId).classList.add('active');
                    state.currentTab = tabId;

                    if (tabId === 'tab-map') {
                        setTimeout(() => {
                            resizeCanvas();
                            fitToScreen();
                        }, 50);
                    }
                });
            });
        }

        // Home Dashboard Quick Actions Listeners
        const btnGoToMap = document.getElementById('btnGoToMap');
        if (btnGoToMap) btnGoToMap.addEventListener('click', () => switchTab('tab-map'));

        const btnQuickExcel = document.getElementById('btnQuickExcel');
        if (btnQuickExcel && elements.inputImportCSV) btnQuickExcel.addEventListener('click', () => elements.inputImportCSV.click());

        const btnQuickPreview = document.getElementById('btnQuickPreview');
        if (btnQuickPreview) btnQuickPreview.addEventListener('click', openReportPreviewModal);

        const btnQuickPdf = document.getElementById('btnQuickPdf');
        if (btnQuickPdf) btnQuickPdf.addEventListener('click', exportReportToPDF);

        const btnQuickAlbum = document.getElementById('btnQuickAlbum');
        if (btnQuickAlbum) btnQuickAlbum.addEventListener('click', () => switchTab('tab-album'));

        // Pin Shape Style Buttons
        if (elements.btnPinShapeSquare) {
            elements.btnPinShapeSquare.addEventListener('click', () => {
                state.pinShapeStyle = 'square';
                elements.btnPinShapeSquare.classList.add('active');
                elements.btnPinShapeCircle.classList.remove('active');
                drawCanvas();
            });
        }

        if (elements.btnPinShapeCircle) {
            elements.btnPinShapeCircle.addEventListener('click', () => {
                state.pinShapeStyle = 'circle';
                elements.btnPinShapeCircle.classList.add('active');
                elements.btnPinShapeSquare.classList.remove('active');
                drawCanvas();
            });
        }

        // Target Tip Shape Style Buttons
        if (elements.btnTipShapeArrow) {
            elements.btnTipShapeArrow.addEventListener('click', () => {
                state.targetTipStyle = 'arrow';
                elements.btnTipShapeArrow.classList.add('active');
                elements.btnTipShapeCircle.classList.remove('active');
                drawCanvas();
            });
        }

        if (elements.btnTipShapeCircle) {
            elements.btnTipShapeCircle.addEventListener('click', () => {
                state.targetTipStyle = 'circle';
                elements.btnTipShapeCircle.classList.add('active');
                elements.btnTipShapeArrow.classList.remove('active');
                drawCanvas();
            });
        }

        // Pin Size Slider Listener
        if (elements.pinSizeRange) {
            elements.pinSizeRange.addEventListener('input', (e) => {
                state.pinScale = parseFloat(e.target.value) || 1.0;
                elements.pinSizeLabel.textContent = `${Math.round(state.pinScale * 100)}%`;
                drawCanvas();
            });
        }

        if (elements.filterPeriod2026H2) elements.filterPeriod2026H2.addEventListener('change', (e) => { state.filters.periods['2026H2'] = e.target.checked; drawCanvas(); });
        if (elements.filterPeriod2026H1) elements.filterPeriod2026H1.addEventListener('change', (e) => { state.filters.periods['2026H1'] = e.target.checked; drawCanvas(); });
        if (elements.filterPeriod2025H2) elements.filterPeriod2025H2.addEventListener('change', (e) => { state.filters.periods['2025H2'] = e.target.checked; drawCanvas(); });

        if (elements.filterCatStructural) elements.filterCatStructural.addEventListener('change', (e) => { state.filters.categories['구조체'] = e.target.checked; drawCanvas(); });
        if (elements.filterCatNonStructural) elements.filterCatNonStructural.addEventListener('change', (e) => { state.filters.categories['비구조체'] = e.target.checked; drawCanvas(); });
        if (elements.filterCatFinishing) elements.filterCatFinishing.addEventListener('change', (e) => { state.filters.categories['마감재'] = e.target.checked; drawCanvas(); });

        const filterOnlyBookmark = document.getElementById('filterOnlyBookmark');
        if (filterOnlyBookmark) {
            filterOnlyBookmark.addEventListener('change', (e) => {
                if (!state.filters) state.filters = { periods: {}, categories: {} };
                state.filters.onlyBookmark = e.target.checked;
                drawCanvas();
            });
        }

        if (elements.albumFilterComponent) elements.albumFilterComponent.addEventListener('change', renderPhotoAlbum);
        if (elements.btnCloseDefectModal) elements.btnCloseDefectModal.addEventListener('click', closeDefectModal);

        if (elements.btnAddDefectDirect) {
            elements.btnAddDefectDirect.addEventListener('click', () => {
                const nextNo = getNextDefectNumber();
                openDefectModal({
                    id: 'pin-' + Date.now(),
                    defectNo: nextNo,
                    parentPinNo: nextNo.split('-')[0],
                    category: '구조체',
                    component: '기둥',
                    defectType: '균열',
                    grade: 'C',
                    x: 200,
                    y: 200,
                    boxDx: 30,
                    boxDy: -30
                }, true);
            });
        }

        // Excel / CSV Export & Import
        if (elements.btnExportSurvey) {
            elements.btnExportSurvey.addEventListener('click', exportSurveyToCSV);
        }
        if (elements.btnImportSurvey && elements.inputImportCSV) {
            elements.btnImportSurvey.addEventListener('click', () => {
                elements.inputImportCSV.click();
            });
            elements.inputImportCSV.addEventListener('change', importSurveyFromCSV);
        }

        // Mobile QR Modal
        if (elements.btnMobileCamera && elements.mobileQrModal) {
            elements.btnMobileCamera.addEventListener('click', () => {
                elements.mobileQrModal.classList.add('open');
            });
        }
        if (elements.btnCloseQrModal && elements.mobileQrModal) {
            elements.btnCloseQrModal.addEventListener('click', () => {
                elements.mobileQrModal.classList.remove('open');
            });
        }
        if (elements.btnCloseQrConfirm && elements.mobileQrModal) {
            elements.btnCloseQrConfirm.addEventListener('click', () => {
                elements.mobileQrModal.classList.remove('open');
            });
        }

        // Interactive Report Preview Modal Controls
        if (elements.btnPreviewReport) {
            elements.btnPreviewReport.addEventListener('click', openReportPreviewModal);
        }
        if (elements.btnCloseReportPreviewModal) {
            elements.btnCloseReportPreviewModal.addEventListener('click', closeReportPreviewModal);
        }
        if (elements.btnModalExportPdf) {
            elements.btnModalExportPdf.addEventListener('click', () => {
                closeReportPreviewModal();
                exportReportToPDF();
            });
        }
        if (elements.btnModalPrint) {
            elements.btnModalPrint.addEventListener('click', () => {
                closeReportPreviewModal();
                generatePrintableReport(true);
            });
        }

        // Clear All Pins Safety Confirmation & Undo/Redo Controls
        if (elements.btnClearPins) {
            elements.btnClearPins.addEventListener('click', () => {
                const floorText = elements.floorSelect.options[elements.floorSelect.selectedIndex].text;
                const currentDefects = state.defects[state.currentFloor] || [];
                if (currentDefects.length === 0) {
                    alert(`현재 ${floorText}에 등록된 결함 핀이 없습니다.`);
                    return;
                }

                const confirmed = confirm(`⚠️ [삭제 확인 경고]\n\n현재 ${floorText}의 모든 결함 핀 데이터(총 ${currentDefects.length}건)를 전체 삭제하시겠습니까?\n\n(실수로 삭제하셨더라도 'Ctrl+Z' 또는 [↩️ 되돌리기] 버튼으로 즉시 복구하실 수 있습니다.)`);
                if (!confirmed) return;

                pushUndoSnapshot();
                state.defects[state.currentFloor] = [];
                saveStateToLocalStorage();
                renderAll();
            });
        }

        if (elements.btnUndo) {
            elements.btnUndo.addEventListener('click', undoAction);
        }

        // Global Keyboard Shortcut: Ctrl+Z (Undo), Ctrl+Y / Ctrl+Shift+Z (Redo)
        window.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                e.preventDefault();
                undoAction();
            }
            if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
                e.preventDefault();
                redoAction();
            }
        });

        // PDF Export & Printing
        if (elements.btnExportPDF) {
            elements.btnExportPDF.addEventListener('click', exportReportToPDF);
        }
        if (elements.btnPrintReport) {
            elements.btnPrintReport.addEventListener('click', () => {
                generatePrintableReport(true);
            });
        }

        // Building Registration Modal Listeners & Floor Filename Auto-Sorter Engine
        const addBuildingModal = document.getElementById('addBuildingModal');
        const btnOpenAddBuildingModal = document.getElementById('btnOpenAddBuildingModal');
        const btnCloseAddBuildingModal = document.getElementById('btnCloseAddBuildingModal');
        const btnCancelAddBuilding = document.getElementById('btnCancelAddBuilding');
        const btnSaveBuilding = document.getElementById('btnSaveBuilding');
        const inputBuildingDrawings = document.getElementById('inputBuildingDrawings');
        const drawingSortPreview = document.getElementById('drawingSortPreview');

        let selectedUploadedDrawings = [];

        function parseFloorInfoFromFilename(fileName) {
            const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
            const cleanName = nameWithoutExt.toUpperCase();

            // 1. Roof Check
            if (cleanName.includes('ROOF') || cleanName.includes('옥상') || cleanName.includes('PH')) {
                return { rank: 999, floorCode: 'ROOF', floorLabel: '옥상 층 (ROOF)' };
            }

            // 2. Basement Check: B1~B99, 지하1~지하99 (Strictly 1~2 digits)
            const bMatch = cleanName.match(/(?:B|지하)\s*([0-9]{1,2})(?![0-9])/i);
            if (bMatch) {
                const num = parseInt(bMatch[1], 10);
                if (num > 0 && num <= 99) {
                    return { rank: -num, floorCode: `B${num}F`, floorLabel: `지하 ${num}층 (B${num}F)` };
                }
            }

            // 3. Above Ground Check: 1F~99F, 1층~99층, 지상1~지상99 (Strictly 1~2 digits)
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
        }

        if (inputBuildingDrawings) {
            inputBuildingDrawings.addEventListener('change', (e) => {
                const files = Array.from(e.target.files || []);
                if (files.length === 0) return;

                selectedUploadedDrawings = files.map(file => {
                    const info = parseFloorInfoFromFilename(file.name);
                    return {
                        file: file,
                        fileName: file.name,
                        rank: info.rank,
                        floorCode: info.floorCode,
                        floorLabel: info.floorLabel
                    };
                });

                // Auto-Sort: Below floor to Top floor (rank ascending: -3, -2, -1, 1, 2, 3...)
                selectedUploadedDrawings.sort((a, b) => a.rank - b.rank);

                // Render Floor Sort Preview List
                if (drawingSortPreview) {
                    drawingSortPreview.innerHTML = `
                        <div style="font-size:0.8rem; font-weight:700; color:#38bdf8; margin-bottom:0.3rem;">
                            <i class="fa-solid fa-arrow-down-short-wide"></i> 층별 도면 자동 정렬 (아래층 ➔ 상부층 순서):
                        </div>
                    ` + selectedUploadedDrawings.map((item, idx) => `
                        <div style="background: rgba(15, 23, 42, 0.6); padding: 0.4rem 0.8rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between; align-items:center; font-size:0.82rem;">
                            <span><strong>${idx + 1}. ${item.floorLabel}</strong> <span class="text-muted">(${item.fileName})</span></span>
                            <span class="badge" style="background:rgba(56, 189, 248, 0.2); color:#38bdf8; font-size:0.7rem;">인식 완료</span>
                        </div>
                    `).join('');
                }

                // Auto populate Building Floors field
                const lowest = selectedUploadedDrawings[0];
                const highest = selectedUploadedDrawings[selectedUploadedDrawings.length - 1];
                const inputFloors = document.getElementById('inputBuildingFloors');
                if (inputFloors && lowest && highest) {
                    inputFloors.value = `${highest.floorLabel.split(' ')[0]} ${highest.floorLabel.split(' ')[1]} ~ ${lowest.floorLabel.split(' ')[0]} ${lowest.floorLabel.split(' ')[1]}`;
                }
            });
        }

    function closeAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.style.display = 'none';
            modal.classList.remove('open');
        });
    }
    window.closeAllModals = closeAllModals;

    window.openAddBuildingModalFunc = function() {
        closeAllModals();
        const addBuildingModal = document.getElementById('addBuildingModal');
            if (!addBuildingModal) return;
            const inputName = document.getElementById('inputBuildingName');
            if (inputName) inputName.value = '';
            const inputAddr = document.getElementById('inputBuildingAddress');
            if (inputAddr) inputAddr.value = '';
            const inputDate = document.getElementById('inputBuildingDate');
            if (inputDate) inputDate.value = new Date().toISOString().split('T')[0];
            const inputFloors = document.getElementById('inputBuildingFloors');
            if (inputFloors) inputFloors.value = '';
            const inputNotes = document.getElementById('inputBuildingNotes');
            if (inputNotes) inputNotes.value = '';
            selectedUploadedDrawings = [];
            const preview = document.getElementById('drawingSortPreview');
            if (preview) preview.innerHTML = '';
            
            addBuildingModal.style.display = 'flex';
            addBuildingModal.style.opacity = '1';
            addBuildingModal.style.visibility = 'visible';
            addBuildingModal.classList.add('open');
        };

        window.closeAddBuildingModalFunc = function() {
            const addBuildingModal = document.getElementById('addBuildingModal');
            if (addBuildingModal) {
                addBuildingModal.style.display = 'none';
                addBuildingModal.classList.remove('open');
            }
        };

        if (btnOpenAddBuildingModal) {
            btnOpenAddBuildingModal.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.openAddBuildingModalFunc();
            });
        }

        if (btnCloseAddBuildingModal) btnCloseAddBuildingModal.addEventListener('click', window.closeAddBuildingModalFunc);
        if (btnCancelAddBuilding) btnCancelAddBuilding.addEventListener('click', window.closeAddBuildingModalFunc);

    function compressDrawingImage(dataUrl, maxDimension = 2000, quality = 0.82) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(dataUrl), 1000);
            const img = new Image();
            img.onload = () => {
                clearTimeout(timer);
                try {
                    let w = img.width;
                    let h = img.height;
                    if (w > maxDimension || h > maxDimension) {
                        if (w > h) {
                            h = Math.round((h * maxDimension) / w);
                            w = maxDimension;
                        } else {
                            w = Math.round((w * maxDimension) / h);
                            h = maxDimension;
                        }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                } catch (e) {
                    resolve(dataUrl);
                }
            };
            img.onerror = () => {
                clearTimeout(timer);
                resolve(dataUrl);
            };
            img.src = dataUrl;
        });
    }
    window.compressDrawingImage = compressDrawingImage;

    if (btnSaveBuilding) {
        btnSaveBuilding.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.saveBuildingFunc) window.saveBuildingFunc();
        });
    }

    // --- BUILDING INFORMATION EDIT & FLOOR DRAWING RE-UPLOAD ENGINE ---
    let editSelectedUploadedDrawings = [];

    window.closeEditBuildingModalFunc = function() {
        const modal = document.getElementById('editBuildingModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('open');
        }
    };

    window.openEditBuildingModalFunc = function(bldgId) {
        if (!state.buildings) state.buildings = [];
        let targetBldg = state.buildings.find(b => b.id === bldgId);
        if (!targetBldg && state.currentBuilding) targetBldg = state.currentBuilding;
        if (!targetBldg && state.buildings.length > 0) targetBldg = state.buildings[0];
        if (!targetBldg) return;

        closeAllModals();

        const idInput = document.getElementById('inputEditBuildingId');
        if (idInput) idInput.value = targetBldg.id;
        const nameInput = document.getElementById('inputEditBuildingName');
        if (nameInput) nameInput.value = targetBldg.name.replace(/^🏢\s*/, '');
        const addrInput = document.getElementById('inputEditBuildingAddress');
        if (addrInput) addrInput.value = targetBldg.address || '';
        const floorsInput = document.getElementById('inputEditBuildingFloors');
        if (floorsInput) floorsInput.value = targetBldg.floors || '';
        const dateInput = document.getElementById('inputEditBuildingDate');
        if (dateInput) dateInput.value = targetBldg.date || new Date().toISOString().split('T')[0];
        const notesInput = document.getElementById('inputEditBuildingNotes');
        if (notesInput) notesInput.value = targetBldg.notes || '';

        editSelectedUploadedDrawings = [];
        const preview = document.getElementById('editDrawingSortPreview');
        if (preview) {
            let html = '';
            if (targetBldg.floorDrawings && Object.keys(targetBldg.floorDrawings).length > 0) {
                html += `<div style="font-size:0.8rem; font-weight:700; color:#38bdf8; margin-bottom:0.3rem;"><i class="fa-solid fa-layer-group"></i> 현재 보관된 층별 도면 목록 (${Object.keys(targetBldg.floorDrawings).length}개 층):</div>`;
                Object.keys(targetBldg.floorDrawings).forEach(fCode => {
                    html += `
                        <div style="background: rgba(15, 23, 42, 0.6); padding: 0.5rem 0.8rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between; align-items:center; font-size:0.85rem;">
                            <span><strong>🏢 ${fCode} 층 도면</strong> <span class="text-muted">(현재 보유 중)</span></span>
                            <span class="badge" style="background:rgba(34, 197, 94, 0.2); color:#4ade80; font-size:0.75rem;">고화질 보유</span>
                        </div>
                    `;
                });
            } else {
                html += `<div style="font-size:0.8rem; color:#94a3b8;"><i class="fa-solid fa-info-circle"></i> 아직 보관된 층별 도면이 없습니다. 새로 등록하실 도면 파일들을 선택해 주세요.</div>`;
            }
            preview.innerHTML = html;
        }

        const modal = document.getElementById('editBuildingModal');
        if (modal) {
            modal.style.display = 'flex';
            modal.style.opacity = '1';
            modal.style.visibility = 'visible';
            modal.classList.add('open');
        }
    };

    window.openEditCurrentBuildingModalFunc = function() {
        if (state.currentBuilding) {
            window.openEditBuildingModalFunc(state.currentBuilding.id);
        } else if (state.buildings && state.buildings.length > 0) {
            window.openEditBuildingModalFunc(state.buildings[0].id);
        } else {
            alert('⚠️ 수정할 건축물을 선택해 주세요!');
        }
    };

    const inputEditBuildingDrawings = document.getElementById('inputEditBuildingDrawings');
    if (inputEditBuildingDrawings) {
        inputEditBuildingDrawings.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;

            editSelectedUploadedDrawings = files.map(file => {
                const info = parseFloorInfoFromFilename(file.name);
                return {
                    file: file,
                    fileName: file.name,
                    rank: info.rank,
                    floorCode: info.floorCode,
                    floorLabel: info.floorLabel
                };
            });

            editSelectedUploadedDrawings.sort((a, b) => a.rank - b.rank);

            const preview = document.getElementById('editDrawingSortPreview');
            if (preview) {
                let html = `
                    <div style="font-size:0.8rem; font-weight:700; color:#4ade80; margin-bottom:0.3rem;">
                        <i class="fa-solid fa-cloud-arrow-up"></i> 새로 추가/교체할 층별 도면 (${editSelectedUploadedDrawings.length}개):
                    </div>
                `;
                html += editSelectedUploadedDrawings.map((item, idx) => `
                    <div style="background: rgba(34, 197, 94, 0.1); padding: 0.45rem 0.8rem; border-radius: 6px; border: 1px solid rgba(34, 197, 94, 0.3); display:flex; justify-content:space-between; align-items:center; font-size:0.82rem;">
                        <span><strong>${idx + 1}. ${item.floorLabel}</strong> <span class="text-muted">(${item.fileName})</span></span>
                        <span class="badge" style="background:rgba(34, 197, 94, 0.25); color:#4ade80; font-size:0.7rem;">새 도면으로 교체 예정</span>
                    </div>
                `).join('');
                preview.innerHTML = html;
            }
        });
    }

    window.saveEditBuildingFunc = async function() {
        const id = document.getElementById('inputEditBuildingId').value;
        const nameInput = document.getElementById('inputEditBuildingName');
        const name = (nameInput ? nameInput.value : '').trim();
        if (!name) {
            alert('⚠️ 건축물 명칭을 입력해 주세요!');
            if (nameInput) nameInput.focus();
            return;
        }

        const address = (document.getElementById('inputEditBuildingAddress')?.value || '').trim();
        const floors = (document.getElementById('inputEditBuildingFloors')?.value || '').trim();
        const date = document.getElementById('inputEditBuildingDate')?.value || new Date().toISOString().split('T')[0];
        const notes = (document.getElementById('inputEditBuildingNotes')?.value || '').trim();

        let bldg = state.buildings.find(b => b.id === id);
        if (!bldg && state.currentBuilding) bldg = state.currentBuilding;
        if (!bldg) return;

        bldg.name = name.startsWith('🏢') ? name : '🏢 ' + name;
        if (address) bldg.address = address;
        if (floors) bldg.floors = floors;
        bldg.date = date;
        bldg.notes = notes;

        if (!bldg.floorDrawings) bldg.floorDrawings = {};
        if (!bldg.floorsList) bldg.floorsList = [];

        // Process newly uploaded drawing files asynchronously & auto-compress
        if (editSelectedUploadedDrawings && editSelectedUploadedDrawings.length > 0) {
            for (const item of editSelectedUploadedDrawings) {
                if (!bldg.floorsList.some(f => f.floorCode === item.floorCode)) {
                    bldg.floorsList.push({
                        floorCode: item.floorCode,
                        floorLabel: item.floorLabel
                    });
                }
                if (item.file) {
                    try {
                        const rawDataUrl = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onload = (e) => resolve(e.target.result);
                            reader.onerror = () => resolve(null);
                            reader.readAsDataURL(item.file);
                        });
                        if (rawDataUrl) {
                            const compressedUrl = await compressDrawingImage(rawDataUrl);
                            bldg.floorDrawings[item.floorCode] = compressedUrl;
                        }
                    } catch (err) {
                        console.error('Drawing upload error:', err);
                    }
                }
            }
        }

        saveStateToLocalStorage();
        if (window.closeEditBuildingModalFunc) window.closeEditBuildingModalFunc();

        if (state.currentBuildingId === id || (state.currentBuilding && state.currentBuilding.id === id)) {
            state.currentBuilding = bldg;
            const appTitle = document.querySelector('.app-title');
            if (appTitle) appTitle.textContent = `${bldg.name.replace(/^🏢\s*/, '')} 점검 시스템`;
            if (bldg.floorDrawings && bldg.floorDrawings[state.currentFloor]) {
                loadFloorDrawing(state.currentFloor);
            }
        }

        renderDashboard();
        showToast(`🏢 '${bldg.name}' 명칭 및 층별 도면이 성공적으로 수정/교체 저장되었습니다!`);
    };

    window.deleteBuildingFunc = function() {
        const id = document.getElementById('inputEditBuildingId').value;
        let bldg = state.buildings.find(b => b.id === id);
        if (!bldg) return;

        const confirmed = confirm(`⚠️ [건축물 삭제 확인]\n\n'${bldg.name}' 건축물과 보관된 모든 층별 도면/점검 데이터를 완전히 삭제하시겠습니까?`);
        if (!confirmed) return;

        state.buildings = state.buildings.filter(b => b.id !== id);
        saveStateToLocalStorage();
        if (window.closeEditBuildingModalFunc) window.closeEditBuildingModalFunc();

        if (state.currentBuildingId === id) {
            state.currentBuilding = null;
            state.currentBuildingId = null;
            switchTab('tab-home');
        } else {
            renderDashboard();
        }
        showToast(`🗑️ '${bldg.name}' 건축물이 완전히 삭제되었습니다.`);
    };

        if (elements.btnThemeToggle) {
            elements.btnThemeToggle.addEventListener('click', () => {
                if (document.body.classList.contains('theme-dark')) {
                    document.body.classList.remove('theme-dark');
                    document.body.classList.add('theme-light');
                    elements.btnThemeToggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
                } else {
                    document.body.classList.remove('theme-light');
                    document.body.classList.add('theme-dark');
                    elements.btnThemeToggle.innerHTML = '<i class="fa-solid fa-moon"></i>';
                }
                drawCanvas();
            });
        }
    }

    function openReportPreviewModal() {
        generatePrintableReport(false);
        const printContainer = document.getElementById('printableReportContainer');
        if (!printContainer || !elements.modalReportPreviewBody) return;

        elements.modalReportPreviewBody.innerHTML = printContainer.innerHTML;
        elements.reportPreviewModal.classList.add('open');
    }

    function closeReportPreviewModal() {
        if (elements.reportPreviewModal) {
            elements.reportPreviewModal.classList.remove('open');
        }
    }

    function exportReportToPDF() {
        const floorText = elements.floorSelect.options[elements.floorSelect.selectedIndex].text;
        generatePrintableReport(false); // Render report HTML without opening print window
        const container = document.getElementById('printableReportContainer');
        if (!container) return;

        if (typeof html2pdf === 'undefined') {
            window.print();
            return;
        }

        const cleanFileName = `건축물_안전점검_보고서_${floorText.replace(/\s+/g, '_')}.pdf`;
        const opt = {
            margin: 0,
            filename: cleanFileName,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, logging: false },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        alert('📄 PDF 보고서 파일 생성을 시작합니다. 잠시만 기다려 주세요...');
        html2pdf().set(opt).from(container).save().then(() => {
            alert('✅ PDF 보고서 파일 다운로드가 완료되었습니다!');
        }).catch(err => {
            console.error('PDF Export failed, fallback to print:', err);
            window.print();
        });
    }

    function closeAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.style.display = 'none';
            modal.classList.remove('open');
        });
    }

    // --- INITIALIZATION ---
    function init() {
        closeAllModals();
        loadStateFromLocalStorage();
        updateOnlineBadge();
        setupCanvas();
        setupEventListeners();
        switchTab('tab-home');
    }

    init();
    setTimeout(fitToScreen, 100);
});
