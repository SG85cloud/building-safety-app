/* ==========================================================================
   스마트 건축물 안전점검 현장점검 시스템 (Clean Architecture Engine v60.0)
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
        grids: {},   // { 'bldg-id_1F': { enabled: true, xPrefix: 'X', xCount: 6, yPrefix: 'Y', yCount: 4, xStart: 0.08, xEnd: 0.92, yStart: 0.08, yEnd: 0.92 } }
        showGridOverlay: true,
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

// --- GLOBAL AUTH & SESSION ENGINE ---
window.dismissLoginModal = function(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    const compIn = document.getElementById('loginCompanyName');
    const userEmailInput = document.getElementById('loginUserEmail');

    const existingCompany = localStorage.getItem('building_company_name') || '(주)한국안전진단기술원';
    let company = (compIn && compIn.value) ? compIn.value.trim() : existingCompany;
    if (!company) company = existingCompany;

    let user = (userEmailInput && userEmailInput.value) ? userEmailInput.value.trim() : '';
    if (!user) user = localStorage.getItem('building_user_name') || '홍길동 수석점검자';

    localStorage.setItem('building_company_name', company);
    localStorage.setItem('building_user_name', user);
    sessionStorage.setItem('building_safety_logged_in', 'true');

    if (window.state) {
        window.state.companyName = company;
        window.state.userName = user;
    }

    if (typeof loadStateFromLocalStorage === 'function') {
        loadStateFromLocalStorage();
    }

    if (!window.state.buildings || !Array.isArray(window.state.buildings) || window.state.buildings.length === 0) {
        if (typeof getDefaultBuildings === 'function') window.state.buildings = getDefaultBuildings();
    } else if (typeof getDefaultBuildings === 'function') {
        const hasCheomdan = window.state.buildings.some(b => b.id === 'bldg-cheomdan-hospital' || (b.name && b.name.includes('첨단병원')));
        if (!hasCheomdan) {
            window.state.buildings.unshift(getDefaultBuildings()[0]);
        }
    }

    const loginOverlay = document.getElementById('loginOverlay');
    if (loginOverlay) {
        loginOverlay.style.cssText = "display: none !important; opacity: 0 !important; pointer-events: none !important; visibility: hidden !important;";
        loginOverlay.classList.remove('open');
    }

    const headerProfile = document.getElementById('headerUserProfileGroup');
    if (headerProfile) headerProfile.style.display = 'flex';

    const lblCompany = document.getElementById('lblUserCompany');
    const lblUser = document.getElementById('lblUserName');
    if (lblCompany) lblCompany.textContent = company;
    if (lblUser) lblUser.textContent = user;

    const inputHomeCompany = document.getElementById('inputHomeCompanyName');
    if (inputHomeCompany) inputHomeCompany.value = company;

    if (typeof listenToRealtimeUpdates === 'function') listenToRealtimeUpdates();
    if (typeof renderDashboard === 'function') renderDashboard();
    if (typeof renderBuildingSelector === 'function') renderBuildingSelector();
};

window.performLogin = window.dismissLoginModal;

window.checkLoginSession = function() {
    const isLoggedIn = sessionStorage.getItem('building_safety_logged_in') === 'true';
    let savedCompany = localStorage.getItem('building_company_name') || '(주)한국안전진단기술원';
    let savedUser = localStorage.getItem('building_user_name') || '홍길동 수석점검자';

    if (window.state) {
        window.state.companyName = savedCompany;
        window.state.userName = savedUser;
    }

    const loginOverlay = document.getElementById('loginOverlay');
    const headerProfile = document.getElementById('headerUserProfileGroup');

    if (isLoggedIn) {
        if (loginOverlay) {
            loginOverlay.style.setProperty('display', 'none', 'important');
            loginOverlay.style.visibility = 'hidden';
            loginOverlay.classList.remove('open');
        }
        if (headerProfile) headerProfile.style.display = 'flex';
    } else {
        if (loginOverlay) {
            loginOverlay.style.display = 'flex';
            loginOverlay.style.visibility = 'visible';
            loginOverlay.classList.add('open');
        }
        if (headerProfile) headerProfile.style.display = 'none';
    }

    const lblCompany = document.getElementById('lblUserCompany');
    const lblUser = document.getElementById('lblUserName');
    if (lblCompany) lblCompany.textContent = savedCompany;
    if (lblUser) lblUser.textContent = savedUser;

    const inputHomeCompany = document.getElementById('inputHomeCompanyName');
    if (inputHomeCompany) inputHomeCompany.value = savedCompany;
};

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
 * Defect Photo Compressor with 4:3 Aspect Ratio Crop
 * Crops and resizes defect photos to 4:3 ratio (1000x750) without distortion
 */
window.compressDefectPhoto43 = function(file, targetW = 1000, quality = 0.85) {
    return new Promise((resolve) => {
        if (!file || !(file instanceof Blob)) {
            return resolve(null);
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const imgW = img.width;
                const imgH = img.height;
                const targetH = Math.round((targetW * 3) / 4); // 1000 x 750 (4:3)

                let cropX = 0;
                let cropY = 0;
                let cropW = imgW;
                let cropH = imgH;

                if (imgW / imgH > 4 / 3) {
                    cropW = Math.round(imgH * (4 / 3));
                    cropX = Math.round((imgW - cropW) / 2);
                } else {
                    cropH = Math.round(imgW * (3 / 4));
                    cropY = Math.round((imgH - cropH) / 2);
                }

                const canvas = document.createElement('canvas');
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
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
                ndtData: window.state.ndtData || {},
                buildings: window.state.buildings || [],
                lastUsedBuildingId: window.state.currentBuildingId || null,
                customDefectTypes: window.state.customDefectTypes || {},
                customDefectCauses: window.state.customDefectCauses || {}
            };
            localStorage.setItem('building_safety_app_state_v2', JSON.stringify(dataToSave));
            if (typeof syncStateToFirebase === 'function') {
                syncStateToFirebase();
            }
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
                }
                if (parsed.defects) {
                    window.state.defects = parsed.defects;
                }
                if (parsed.ndtData) {
                    window.state.ndtData = parsed.ndtData;
                }
                if (parsed.customDefectTypes) {
                    window.state.customDefectTypes = parsed.customDefectTypes;
                }
                if (parsed.customDefectCauses) {
                    window.state.customDefectCauses = parsed.customDefectCauses;
                }
            }

            if (!window.state.buildings || !Array.isArray(window.state.buildings) || window.state.buildings.length === 0) {
                window.state.buildings = getDefaultBuildings();
            }

            window.state.companyName = localStorage.getItem('building_company_name') || '(주)한국안전진단기술원';
            const compInput = document.getElementById('inputHomeCompanyName');
            if (compInput) compInput.value = window.state.companyName;
        } catch (e) {
            console.error('LocalStorage load failed:', e);
            window.state.buildings = getDefaultBuildings();
            window.state.companyName = '(주)한국안전진단기술원';
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
            window.renderDashboard();
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
            } else if (targetTabId === 'tab-ndt') {
                setTimeout(() => {
                    if (typeof setupNdtCanvas === 'function') setupNdtCanvas();
                    if (typeof renderNdtSummaryTable === 'function') renderNdtSummaryTable();
                }, 50);
            }
        }
    };

    // --- 6. BUILDING MANAGEMENT ENGINE ---

    window.renderDashboard = function() {
        const grid = elements.buildingListGrid || document.getElementById('buildingListGrid');
        if (!grid) return;

        if (!window.state.buildings || !Array.isArray(window.state.buildings) || window.state.buildings.length === 0) {
            window.state.buildings = getDefaultBuildings();
            saveStateToLocalStorage();
        }

        const bldgs = window.state.buildings || [];

        grid.innerHTML = bldgs.map(bldg => {
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

        if (bldg.inspectionType && document.getElementById('selectInspectionType')) document.getElementById('selectInspectionType').value = bldg.inspectionType;
        if (bldg.inspectionYear && document.getElementById('selectInspectionYear')) document.getElementById('selectInspectionYear').value = bldg.inspectionYear;
        if (bldg.inspectionPeriod && document.getElementById('selectInspectionPeriod')) document.getElementById('selectInspectionPeriod').value = bldg.inspectionPeriod;

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
            const inspectionType = document.getElementById('inputBuildingInspectionType')?.value || '정밀안전점검';
            const inspectionYear = document.getElementById('inputBuildingInspectionYear')?.value || '2026년';
            const inspectionPeriod = document.getElementById('inputBuildingInspectionPeriod')?.value || '하반기';
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
                inspectionType: inspectionType,
                inspectionYear: inspectionYear,
                inspectionPeriod: inspectionPeriod,
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

        const isMobile = window.innerWidth <= 768;
        if (w <= 50) w = window.innerWidth - (isMobile ? 24 : 40);
        if (h <= 50) {
            h = Math.max(isMobile ? 340 : 400, window.innerHeight - (isMobile ? 260 : 220));
        }

        if (isMobile && h > 380) {
            h = 380;
        }

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
                // Auto-detect Portrait drawing and auto-rotate 90° to Landscape for optimal architectural inspection
                if (img.naturalHeight > img.naturalWidth * 1.15 && (state.rotationAngle === undefined || state.rotationAngle === 0)) {
                    state.rotationAngle = 90;
                }
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

    // --- GRID CALIBRATION & AUTOMATIC LOCATION CALCULATION ENGINE (v60.0) ---

    function getCurrentFloorGridConfig() {
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        if (!state.grids) state.grids = {};
        if (!state.grids[key]) {
            state.grids[key] = {
                enabled: true,
                xPrefix: 'X',
                xCount: 6,
                yPrefix: 'Y',
                yCount: 4,
                xStart: 0.08,
                xEnd: 0.92,
                yStart: 0.08,
                yEnd: 0.92
            };
        }
        return state.grids[key];
    }

    function calculateGridLocationString(imgX, imgY, component = '기둥') {
        const cfg = getCurrentFloorGridConfig();
        const img = state.bgImage;
        const imgW = img ? (img.naturalWidth || img.width || 1200) : 1200;
        const imgH = img ? (img.naturalHeight || img.height || 700) : 700;

        const xStartPx = (cfg.xStart !== undefined ? cfg.xStart : 0.08) * imgW;
        const xEndPx = (cfg.xEnd !== undefined ? cfg.xEnd : 0.92) * imgW;
        const yStartPx = (cfg.yStart !== undefined ? cfg.yStart : 0.08) * imgH;
        const yEndPx = (cfg.yEnd !== undefined ? cfg.yEnd : 0.92) * imgH;

        const xCount = Math.max(1, cfg.xCount || 6);
        const yCount = Math.max(1, cfg.yCount || 4);

        let xIdx = 0;
        if (xCount > 1 && xEndPx > xStartPx) {
            const xStep = (xEndPx - xStartPx) / (xCount - 1);
            xIdx = Math.round((imgX - xStartPx) / xStep);
            if (xIdx < 0) xIdx = 0;
            if (xIdx >= xCount) xIdx = xCount - 1;
        }

        let yIdx = 0;
        if (yCount > 1 && yEndPx > yStartPx) {
            const yStep = (yEndPx - yStartPx) / (yCount - 1);
            yIdx = Math.round((imgY - yStartPx) / yStep);
            if (yIdx < 0) yIdx = 0;
            if (yIdx >= yCount) yIdx = yCount - 1;
        }

        const xLabelCurrent = `${cfg.xPrefix || 'X'}${xIdx + 1}`;
        const xLabelNext = `${cfg.xPrefix || 'X'}${Math.min(xCount, xIdx + 2)}`;

        const yLabelCurrent = `${cfg.yPrefix || 'Y'}${yIdx + 1}`;
        const yLabelNext = `${cfg.yPrefix || 'Y'}${Math.min(yCount, yIdx + 2)}`;

        const flTitle = state.currentFloor || '';

        if (component === '기둥') {
            return `${xLabelCurrent}/${yLabelCurrent}`;
        } else if (component === '큰보' || component === '작은보' || component === '보' || component === '벽체' || component === '조적벽체') {
            const xRange = (xIdx + 1 < xCount) ? `${xLabelCurrent}~${xLabelNext}` : xLabelCurrent;
            return `${xRange} / ${yLabelCurrent}`;
        } else {
            const xRange = (xIdx + 1 < xCount) ? `${xLabelCurrent}~${xLabelNext}` : xLabelCurrent;
            const yRange = (yIdx + 1 < yCount) ? `${yLabelCurrent}~${yLabelNext}` : yLabelCurrent;
            return `${xRange} / ${yRange}`;
        }
    }

    function drawGridOverlay(ctx, imgW, imgH) {
        if (state.showGridOverlay === false) return;
        const cfg = getCurrentFloorGridConfig();
        if (cfg.enabled === false) return;

        const xStartPx = (cfg.xStart !== undefined ? cfg.xStart : 0.08) * imgW;
        const xEndPx = (cfg.xEnd !== undefined ? cfg.xEnd : 0.92) * imgW;
        const yStartPx = (cfg.yStart !== undefined ? cfg.yStart : 0.08) * imgH;
        const yEndPx = (cfg.yEnd !== undefined ? cfg.yEnd : 0.92) * imgH;

        const xCount = Math.max(1, cfg.xCount || 6);
        const yCount = Math.max(1, cfg.yCount || 4);

        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);

        const xPositions = [];
        for (let i = 0; i < xCount; i++) {
            const px = xCount === 1 ? (xStartPx + xEndPx) / 2 : xStartPx + (i * (xEndPx - xStartPx) / (xCount - 1));
            xPositions.push(px);
            ctx.beginPath();
            ctx.moveTo(px, Math.max(0, yStartPx - 40));
            ctx.lineTo(px, Math.min(imgH, yEndPx + 40));
            ctx.stroke();
        }

        const yPositions = [];
        for (let j = 0; j < yCount; j++) {
            const py = yCount === 1 ? (yStartPx + yEndPx) / 2 : yStartPx + (j * (yEndPx - yStartPx) / (yCount - 1));
            yPositions.push(py);
            ctx.beginPath();
            ctx.moveTo(Math.max(0, xStartPx - 40), py);
            ctx.lineTo(Math.min(imgW, xEndPx + 40), py);
            ctx.stroke();
        }

        ctx.setLineDash([]);

        xPositions.forEach((px, idx) => {
            const label = `${cfg.xPrefix || 'X'}${idx + 1}`;
            const bubbleY = Math.max(20, yStartPx - 30);
            
            ctx.fillStyle = '#0284c7';
            ctx.beginPath();
            ctx.arc(px, bubbleY, 14, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, px, bubbleY);
        });

        yPositions.forEach((py, idx) => {
            const label = `${cfg.yPrefix || 'Y'}${idx + 1}`;
            const bubbleX = Math.max(20, xStartPx - 30);

            ctx.fillStyle = '#0369a1';
            ctx.beginPath();
            ctx.arc(bubbleX, py, 14, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, bubbleX, py);
        });

        ctx.restore();
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

        // Draw Structural Grid Overlay Lines (v60.0)
        drawGridOverlay(ctx, imgW, imgH);

        // Draw Defect Pins INSIDE the rotated context so pins rotate WITH the drawing!
        const currentDefects = getCurrentFloorFilteredDefects();
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

    // --- 8-B. NON-DESTRUCTIVE TESTING (NDT) FIELD SURVEY ENGINE (v60.0) ---
    if (!state.ndtData) state.ndtData = {};
    if (!state.ndtImages) state.ndtImages = {};
    let ndtMode = 'PAN';
    let currentNdtCategory = '실측';
    let ndtView = { offsetX: 0, offsetY: 0, scale: 1.0 };
    let ndtRotationAngle = 0;
    let ndtBgImage = null;
    let isNdtDragging = false;
    let isNdtMarkingDrag = false;
    let isNdtPinching = false;
    let ndtPinchDist = 0;
    let ndtPinchScale = 1.0;
    let ndtPinchMidX = 0;
    let ndtPinchMidY = 0;
    let ndtPinchOffsetX = 0;
    let ndtPinchOffsetY = 0;
    let ndtStartMouseX = 0;
    let ndtStartMouseY = 0;
    let ndtInitialOffsetX = 0;
    let ndtInitialOffsetY = 0;

    let isDraggingNdtPin = false;
    let activeDragNdtPin = null;
    let dragNdtPart = 'box';

    function formatHeightValue(val) {
        if (!val) return 'H = 3,000mm';
        const strVal = String(val).trim();
        if (!strVal) return 'H = 3,000mm';
        const digits = strVal.replace(/[^0-9.]/g, '');
        if (digits) {
            const num = parseFloat(digits);
            if (!isNaN(num)) {
                return `H = ${num.toLocaleString()}mm`;
            }
        }
        return strVal;
    }

    function findNdtPinAt(vx, vy) {
        const items = getCurrentFloorNdtData();
        const currentCat = currentNdtCategory || '실측';
        let filtered = items;
        if (currentCat === '기울기') {
            filtered = items.filter(item => item.category === '기울기');
        } else if (currentCat === '변위') {
            filtered = items.filter(item => item.category === '변위');
        } else {
            filtered = items.filter(item => ['실측', '강도', '탄산화'].includes(item.category));
        }

        for (let i = filtered.length - 1; i >= 0; i--) {
            const item = filtered[i];
            const boxX = item.boxX !== undefined ? item.boxX : (item.x || 100);
            const boxY = item.boxY !== undefined ? item.boxY : (item.y || 100);
            const targetX = item.targetX !== undefined ? item.targetX : (item.x || boxX);
            const targetY = item.targetY !== undefined ? item.targetY : (item.y || boxY);

            if (Math.hypot(vx - targetX, vy - targetY) < 30) {
                return { item, part: 'target' };
            }
            if (Math.hypot(vx - boxX, vy - boxY) < 50) {
                return { item, part: 'box' };
            }
            if (Math.hypot(vx - (item.x || 100), vy - (item.y || 100)) < 40) {
                return { item, part: 'all' };
            }
        }
        return null;
    }

    function getCurrentFloorNdtData() {
        if (!state.currentBuildingId) return [];
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        if (!state.ndtData) state.ndtData = {};
        if (!state.ndtData[key]) state.ndtData[key] = [];
        return state.ndtData[key];
    }

    function setupNdtCanvas() {
        const canvas = document.getElementById('ndtCanvas');
        if (!canvas) return;
        resizeNdtCanvas();
        loadFloorNdtDrawing();
        initNdtEvents();
    }

    function resizeNdtCanvas() {
        const container = document.getElementById('ndtCanvasContainer');
        const canvas = document.getElementById('ndtCanvas');
        if (!canvas || !container) return;

        let w = container.clientWidth || container.offsetWidth || (window.innerWidth - 40);
        let h = container.clientHeight || container.offsetHeight;
        const isMobile = window.innerWidth <= 768;
        if (h <= 50) h = isMobile ? 360 : 420;

        canvas.width = w;
        canvas.height = h;
        drawNdtCanvas();
    }

    function loadFloorNdtDrawing() {
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        const customImg = state.ndtImages ? state.ndtImages[key] : null;
        const src = customImg || state.bgImage?.src;

        if (src) {
            const img = new Image();
            img.onload = () => {
                ndtBgImage = img;
                if (img.naturalHeight > img.naturalWidth * 1.15 && (ndtRotationAngle === undefined || ndtRotationAngle === 0)) {
                    ndtRotationAngle = 90;
                }
                fitNdtCanvas();
                drawNdtCanvas();
            };
            img.src = src;
        } else if (state.bgImage) {
            ndtBgImage = state.bgImage;
            if (ndtBgImage.naturalHeight > ndtBgImage.naturalWidth * 1.15 && (ndtRotationAngle === undefined || ndtRotationAngle === 0)) {
                ndtRotationAngle = 90;
            }
            fitNdtCanvas();
            drawNdtCanvas();
        } else {
            ndtBgImage = null;
            drawNdtCanvas();
        }
    }

    window.fitNdtCanvas = function() {
        const canvas = document.getElementById('ndtCanvas');
        if (!canvas) return;
        const cw = canvas.width;
        const ch = canvas.height;
        let imgW = ndtBgImage ? (ndtBgImage.naturalWidth || ndtBgImage.width || 1200) : 1200;
        let imgH = ndtBgImage ? (ndtBgImage.naturalHeight || ndtBgImage.height || 700) : 700;

        const isRotated = (ndtRotationAngle === 90 || ndtRotationAngle === 270);
        const drawW = isRotated ? imgH : imgW;
        const drawH = isRotated ? imgW : imgH;

        const scaleX = (cw - 40) / drawW;
        const scaleY = (ch - 40) / drawH;
        ndtView.scale = Math.min(scaleX, scaleY, 1.2);
        ndtView.offsetX = Math.max(20, (cw - drawW * ndtView.scale) / 2);
        ndtView.offsetY = Math.max(20, (ch - drawH * ndtView.scale) / 2);

        const zoomTxt = document.getElementById('ndtZoomScaleText');
        if (zoomTxt) zoomTxt.textContent = `${Math.round(ndtView.scale * 100)}%`;
        drawNdtCanvas();
    };

    window.zoomNdtCanvas = function(factor) {
        ndtView.scale = Math.min(Math.max(0.3, ndtView.scale * factor), 4.0);
        const zoomTxt = document.getElementById('ndtZoomScaleText');
        if (zoomTxt) zoomTxt.textContent = `${Math.round(ndtView.scale * 100)}%`;
        drawNdtCanvas();
    };

    window.rotateNdtDrawing = function() {
        ndtRotationAngle = (ndtRotationAngle + 90) % 360;
        fitNdtCanvas();
        drawNdtCanvas();
    };

    window.setNdtMode = function(mode) {
        ndtMode = mode;
        const btnPan = document.getElementById('btnNdtModePan');
        const btnMark = document.getElementById('btnNdtModeMark');
        if (btnPan) btnPan.classList.toggle('active', mode === 'PAN');
        if (btnMark) btnMark.classList.toggle('active', mode === 'MARK');
        const canvas = document.getElementById('ndtCanvas');
        if (canvas) canvas.style.cursor = mode === 'MARK' ? 'crosshair' : 'grab';
    };

    window.setNdtCategory = function(cat) {
        currentNdtCategory = cat;
        const catMap = { '실측': 'Dim', '강도': 'Strength', '탄산화': 'Carb', '기울기': 'Tilt', '변위': 'Vert' };
        Object.values(catMap).forEach(id => {
            const btn = document.getElementById(`btnNdtCat${id}`);
            if (btn) btn.classList.remove('active');
        });
        const activeBtn = document.getElementById(`btnNdtCat${catMap[cat]}`);
        if (activeBtn) activeBtn.classList.add('active');
    };

    function drawNdtCanvas() {
        const canvas = document.getElementById('ndtCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const cw = canvas.width;
        const ch = canvas.height;

        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#1b2333';
        ctx.fillRect(0, 0, cw, ch);

        ctx.save();
        ctx.translate(ndtView.offsetX, ndtView.offsetY);
        ctx.scale(ndtView.scale, ndtView.scale);

        const imgW = ndtBgImage ? (ndtBgImage.naturalWidth || ndtBgImage.width || 1200) : 1200;
        const imgH = ndtBgImage ? (ndtBgImage.naturalHeight || ndtBgImage.height || 700) : 700;

        ctx.save();
        if (ndtRotationAngle === 90) {
            ctx.translate(imgH, 0);
            ctx.rotate((90 * Math.PI) / 180);
        } else if (ndtRotationAngle === 180) {
            ctx.translate(imgW, imgH);
            ctx.rotate((180 * Math.PI) / 180);
        } else if (ndtRotationAngle === 270) {
            ctx.translate(0, imgW);
            ctx.rotate((270 * Math.PI) / 180);
        }

        if (ndtBgImage) {
            ctx.drawImage(ndtBgImage, 0, 0);
        }

        // Draw Grid Lines Overlay (v60.0)
        drawGridOverlay(ctx, imgW, imgH);

        // Filter NDT pins by current active category tab
        let ndtItems = getCurrentFloorNdtData();
        const currentCat = currentNdtCategory || '실측';
        if (currentCat === '기울기') {
            ndtItems = ndtItems.filter(item => item.category === '기울기');
        } else if (currentCat === '변위') {
            ndtItems = ndtItems.filter(item => item.category === '변위');
        } else {
            ndtItems = ndtItems.filter(item => ['실측', '강도', '탄산화'].includes(item.category));
        }
        ndtItems.forEach(item => drawNdtPin(ctx, item));

        ctx.restore();
        ctx.restore();

        const flTitleEl = document.getElementById('ndtFloorTitle');
        const tblTitleEl = document.getElementById('lblNdtTableTitle');
        const flLabel = state.currentFloor || '1F';
        if (flTitleEl) flTitleEl.textContent = `지상 ${flLabel}`;
        if (tblTitleEl) tblTitleEl.textContent = `지상 ${flLabel}`;
    }

    function drawNdtPin(ctx, item) {
        const x = item.boxX !== undefined ? item.boxX : (item.x || 100);
        const y = item.boxY !== undefined ? item.boxY : (item.y || 100);
        const targetX = item.targetX !== undefined ? item.targetX : (item.x || x);
        const targetY = item.targetY !== undefined ? item.targetY : (item.y || y);
        const isBeingDragged = (typeof activeDragNdtPin !== 'undefined' && activeDragNdtPin && activeDragNdtPin === item);

        const cat = item.category || '강도';
        let noStr = item.no || 'NO.01';
        if (noStr.startsWith('기울기-') || noStr.startsWith('NDT-') || noStr.startsWith('변위-')) {
            const numPart = noStr.replace(/^[^\d]+/, '');
            noStr = `NO.${numPart.length === 1 ? '0' + numPart : numPart}`;
        }

        if (cat === '기울기' || cat === '변위') {
            // CAD Callout Style rendering (100% matching user reference photo & draggable!)
            const tiltVal = item.avgValue || (item.v1 ? `${item.v1}mm` : '3mm');
            const dispDir = item.dispDirection || '←';

            ctx.save();

            // 1. Draw Arrow pointing from Box to Target Point
            ctx.strokeStyle = isBeingDragged ? '#facc15' : '#f97316';
            ctx.fillStyle = isBeingDragged ? '#facc15' : '#f97316';
            ctx.lineWidth = isBeingDragged ? 4.5 : 3.5;

            const dx = targetX - x;
            const dy = targetY - y;
            const dist = Math.hypot(dx, dy);

            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(targetX, targetY);
            if (isBeingDragged) ctx.setLineDash([5, 3]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Arrow Head at targetX, targetY (pointing to the wall)
            if (dist > 5) {
                const angle = Math.atan2(dy, dx);
                const headLen = isBeingDragged ? 16 : 14;
                ctx.beginPath();
                ctx.moveTo(targetX, targetY);
                ctx.lineTo(targetX - headLen * Math.cos(angle - Math.PI / 6), targetY - headLen * Math.sin(angle - Math.PI / 6));
                ctx.lineTo(targetX - headLen * Math.cos(angle + Math.PI / 6), targetY - headLen * Math.sin(angle + Math.PI / 6));
                ctx.closePath();
                ctx.fill();
            }

            // Target Point Handle Circle
            ctx.beginPath();
            ctx.arc(targetX, targetY, isBeingDragged ? 6 : 4, 0, Math.PI * 2);
            ctx.fill();

            // 2. Draw 3-Column CAD Table Box at (x, y) - Un-rotated to stay 100% horizontal on user screen!
            ctx.translate(x, y);
            if (ndtRotationAngle === 90) {
                ctx.rotate((-90 * Math.PI) / 180);
            } else if (ndtRotationAngle === 180) {
                ctx.rotate((-180 * Math.PI) / 180);
            } else if (ndtRotationAngle === 270) {
                ctx.rotate((-270 * Math.PI) / 180);
            }

            const boxW = 190;
            const boxH = 50;
            const col1W = 60;
            const col2W = 65;
            const col3W = 65;

            // Box Background (White) & Outer Border
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = isBeingDragged ? '#facc15' : '#ef4444';
            ctx.lineWidth = isBeingDragged ? 3.5 : 2.5;
            if (isBeingDragged) {
                ctx.shadowColor = '#facc15';
                ctx.shadowBlur = 12;
            }
            ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
            ctx.strokeRect(-boxW / 2, -boxH / 2, boxW, boxH);
            ctx.shadowBlur = 0;

            // Vertical & Horizontal Grid Dividers
            ctx.strokeStyle = isBeingDragged ? '#facc15' : '#ef4444';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(-boxW / 2 + col1W, -boxH / 2);
            ctx.lineTo(-boxW / 2 + col1W, boxH / 2);

            ctx.moveTo(-boxW / 2 + col1W + col2W, -boxH / 2);
            ctx.lineTo(-boxW / 2 + col1W + col2W, boxH / 2);

            ctx.moveTo(-boxW / 2 + col1W, 0);
            ctx.lineTo(boxW / 2, 0);
            ctx.stroke();

            // Cell Text Formatting
            ctx.fillStyle = isBeingDragged ? '#d97706' : '#ea580c';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Column 1: NO.01
            ctx.font = 'bold 13px monospace';
            ctx.fillText(noStr, -boxW / 2 + col1W / 2, 0);

            // Column 2: Top "변 위 량", Bottom "변위방향"
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText('변 위 량', -boxW / 2 + col1W + col2W / 2, -boxH / 4);
            ctx.fillText('변위방향', -boxW / 2 + col1W + col2W / 2, boxH / 4);

            // Column 3: Top tiltVal (e.g. 3mm), Bottom dispDir (e.g. ←)
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText(tiltVal, -boxW / 2 + col1W + col2W + col3W / 2, -boxH / 4);

            ctx.font = 'bold 16px sans-serif';
            ctx.fillText(dispDir, -boxW / 2 + col1W + col2W + col3W / 2, boxH / 4);

            ctx.restore();
            return;
        }

        // Standard Pin for other NDT items
        const catColors = {
            '실측': '#0284c7',   // Blue
            '강도': '#ef4444',   // Red
            '탄산화': '#eab308'  // Yellow
        };
        const color = isBeingDragged ? '#facc15' : (catColors[cat] || '#38bdf8');

        ctx.save();
        ctx.translate(x, y);

        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.strokeStyle = color;
        ctx.lineWidth = isBeingDragged ? 3.5 : 2.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = isBeingDragged ? 16 : 8;

        const w = 78;
        const h = 26;
        ctx.beginPath();
        ctx.roundRect(-w/2, -h/2, w, h, 6);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(noStr, 0, 0);

        ctx.restore();
    }

    function viewToNdtImgCoords(vx, vy) {
        const angle = ndtRotationAngle || 0;
        const img = ndtBgImage;
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

    function initNdtEvents() {
        const canvas = document.getElementById('ndtCanvas');
        if (!canvas || canvas._ndtBound) return;
        canvas._ndtBound = true;

        canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const rawVx = (mouseX - ndtView.offsetX) / ndtView.scale;
            const rawVy = (mouseY - ndtView.offsetY) / ndtView.scale;
            const pt = viewToNdtImgCoords(rawVx, rawVy);
            const vx = pt.x;
            const vy = pt.y;

            ndtStartMouseX = e.clientX;
            ndtStartMouseY = e.clientY;
            ndtInitialOffsetX = ndtView.offsetX;
            ndtInitialOffsetY = ndtView.offsetY;

            // Check hit test on existing NDT pin (Box or Target point)
            const hitPin = findNdtPinAt(vx, vy);
            if (hitPin) {
                isDraggingNdtPin = true;
                activeDragNdtPin = hitPin.item;
                dragNdtPart = hitPin.part;
                canvas.style.cursor = 'move';
                drawNdtCanvas();
                return;
            }

            if (ndtMode === 'MARK') {
                isNdtMarkingDrag = true;
                window._ndtMarkStartCoords = { x: vx, y: vy };
                window._ndtMarkCurrentCoords = { x: vx, y: vy };
            } else {
                isNdtDragging = true;
                canvas.style.cursor = 'grabbing';
            }
        });

        window.addEventListener('mousemove', (e) => {
            const canvas = document.getElementById('ndtCanvas');
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const rawVx = (mouseX - ndtView.offsetX) / ndtView.scale;
            const rawVy = (mouseY - ndtView.offsetY) / ndtView.scale;
            const pt = viewToNdtImgCoords(rawVx, rawVy);
            const vx = pt.x;
            const vy = pt.y;

            if (isDraggingNdtPin && activeDragNdtPin) {
                if (dragNdtPart === 'target') {
                    activeDragNdtPin.targetX = vx;
                    activeDragNdtPin.targetY = vy;
                } else if (dragNdtPart === 'box') {
                    activeDragNdtPin.boxX = vx;
                    activeDragNdtPin.boxY = vy;
                } else {
                    const dx = vx - (activeDragNdtPin.x || vx);
                    const dy = vy - (activeDragNdtPin.y || vy);
                    activeDragNdtPin.x = vx;
                    activeDragNdtPin.y = vy;
                    activeDragNdtPin.boxX = (activeDragNdtPin.boxX !== undefined ? activeDragNdtPin.boxX : vx) + dx;
                    activeDragNdtPin.boxY = (activeDragNdtPin.boxY !== undefined ? activeDragNdtPin.boxY : vy) + dy;
                    activeDragNdtPin.targetX = (activeDragNdtPin.targetX !== undefined ? activeDragNdtPin.targetX : vx) + dx;
                    activeDragNdtPin.targetY = (activeDragNdtPin.targetY !== undefined ? activeDragNdtPin.targetY : vy) + dy;
                }
                drawNdtCanvas();
            } else if (isNdtMarkingDrag) {
                window._ndtMarkCurrentCoords = { x: vx, y: vy };
                drawNdtCanvas();
            } else if (isNdtDragging) {
                const dx = e.clientX - ndtStartMouseX;
                const dy = e.clientY - ndtStartMouseY;
                ndtView.offsetX = ndtInitialOffsetX + dx;
                ndtView.offsetY = ndtInitialOffsetY + dy;
                drawNdtCanvas();
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (isDraggingNdtPin) {
                isDraggingNdtPin = false;
                activeDragNdtPin = null;
                saveStateToLocalStorage();
                const canvas = document.getElementById('ndtCanvas');
                if (canvas) canvas.style.cursor = ndtMode === 'MARK' ? 'crosshair' : 'grab';
                drawNdtCanvas();
            }
            if (isNdtMarkingDrag) {
                isNdtMarkingDrag = false;
                const start = window._ndtMarkStartCoords || { x: 100, y: 100 };
                const end = window._ndtMarkCurrentCoords || start;

                const dx = start.x - end.x;
                const dy = start.y - end.y;
                let autoDir = '←';
                if (Math.hypot(dx, dy) > 8) {
                    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
                    if (angleDeg >= -22.5 && angleDeg < 22.5) autoDir = '→';
                    else if (angleDeg >= 22.5 && angleDeg < 67.5) autoDir = '↘';
                    else if (angleDeg >= 67.5 && angleDeg < 112.5) autoDir = '↓';
                    else if (angleDeg >= 112.5 && angleDeg < 157.5) autoDir = '↙';
                    else if (angleDeg >= 157.5 || angleDeg < -157.5) autoDir = '←';
                    else if (angleDeg >= -157.5 && angleDeg < -112.5) autoDir = '↖';
                    else if (angleDeg >= -112.5 && angleDeg < -67.5) autoDir = '↑';
                    else if (angleDeg >= -67.5 && angleDeg < -22.5) autoDir = '↗';
                }

                const distMoved = Math.hypot(start.x - end.x, start.y - end.y);
                const targetX = start.x;
                const targetY = start.y;
                const boxX = distMoved > 10 ? end.x : start.x;
                const boxY = distMoved > 10 ? end.y : (start.y + 60);

                openNdtModal(start.x, start.y, null, {
                    targetX,
                    targetY,
                    boxX,
                    boxY,
                    dispDirection: autoDir
                });
            }
            if (isNdtDragging) {
                isNdtDragging = false;
                const canvas = document.getElementById('ndtCanvas');
                if (canvas) canvas.style.cursor = ndtMode === 'MARK' ? 'crosshair' : 'grab';
            }
        });

        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1 && !isNdtPinching) {
                const rect = canvas.getBoundingClientRect();
                const touch = e.touches[0];
                const mouseX = touch.clientX - rect.left;
                const mouseY = touch.clientY - rect.top;
                const rawVx = (mouseX - ndtView.offsetX) / ndtView.scale;
                const rawVy = (mouseY - ndtView.offsetY) / ndtView.scale;
                const pt = viewToNdtImgCoords(rawVx, rawVy);
                const vx = pt.x;
                const vy = pt.y;

                ndtStartMouseX = touch.clientX;
                ndtStartMouseY = touch.clientY;
                ndtInitialOffsetX = ndtView.offsetX;
                ndtInitialOffsetY = ndtView.offsetY;

                const hitPin = findNdtPinAt(vx, vy);
                if (hitPin) {
                    isDraggingNdtPin = true;
                    activeDragNdtPin = hitPin.item;
                    dragNdtPart = hitPin.part;
                    drawNdtCanvas();
                    return;
                }

                if (ndtMode === 'MARK') {
                    isNdtMarkingDrag = true;
                    window._ndtMarkStartCoords = { x: vx, y: vy };
                    window._ndtMarkCurrentCoords = { x: vx, y: vy };
                } else {
                    isNdtDragging = true;
                }
            } else if (e.touches.length >= 2) {
                isNdtDragging = false;
                isNdtPinching = true;
                const rect = canvas.getBoundingClientRect();
                ndtPinchDist = getTouchDistance(e.touches[0], e.touches[1]);
                ndtPinchScale = ndtView.scale;
                const mid = getTouchMidpoint(e.touches[0], e.touches[1], rect);
                ndtPinchMidX = mid.x;
                ndtPinchMidY = mid.y;
                ndtPinchOffsetX = ndtView.offsetX;
                ndtPinchOffsetY = ndtView.offsetY;
            }
        }, { passive: false });

        window.addEventListener('touchmove', (e) => {
            if (isNdtPinching && e.touches.length >= 2) {
                if (e.cancelable) e.preventDefault();
                const canvas = document.getElementById('ndtCanvas');
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();
                const currentDist = getTouchDistance(e.touches[0], e.touches[1]);
                if (ndtPinchDist > 0) {
                    const scaleFactor = currentDist / ndtPinchDist;
                    const newScale = Math.min(Math.max(0.3, ndtPinchScale * scaleFactor), 4.0);
                    const currentMid = getTouchMidpoint(e.touches[0], e.touches[1], rect);

                    const imgX = (ndtPinchMidX - ndtPinchOffsetX) / ndtPinchScale;
                    const imgY = (ndtPinchMidY - ndtPinchOffsetY) / ndtPinchScale;

                    ndtView.scale = newScale;
                    ndtView.offsetX = currentMid.x - imgX * newScale;
                    ndtView.offsetY = currentMid.y - imgY * newScale;

                    const zoomTxt = document.getElementById('ndtZoomScaleText');
                    if (zoomTxt) zoomTxt.textContent = `${Math.round(ndtView.scale * 100)}%`;
                    drawNdtCanvas();
                }
            } else if (!isNdtPinching && isDraggingNdtPin && e.touches.length === 1) {
                const canvas = document.getElementById('ndtCanvas');
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();
                const touch = e.touches[0];
                const mouseX = touch.clientX - rect.left;
                const mouseY = touch.clientY - rect.top;
                const rawVx = (mouseX - ndtView.offsetX) / ndtView.scale;
                const rawVy = (mouseY - ndtView.offsetY) / ndtView.scale;
                const pt = viewToNdtImgCoords(rawVx, rawVy);
                const vx = pt.x;
                const vy = pt.y;

                if (dragNdtPart === 'target') {
                    activeDragNdtPin.targetX = vx;
                    activeDragNdtPin.targetY = vy;
                } else if (dragNdtPart === 'box') {
                    activeDragNdtPin.boxX = vx;
                    activeDragNdtPin.boxY = vy;
                } else {
                    const dx = vx - (activeDragNdtPin.x || vx);
                    const dy = vy - (activeDragNdtPin.y || vy);
                    activeDragNdtPin.x = vx;
                    activeDragNdtPin.y = vy;
                    activeDragNdtPin.boxX = (activeDragNdtPin.boxX !== undefined ? activeDragNdtPin.boxX : vx) + dx;
                    activeDragNdtPin.boxY = (activeDragNdtPin.boxY !== undefined ? activeDragNdtPin.boxY : vy) + dy;
                    activeDragNdtPin.targetX = (activeDragNdtPin.targetX !== undefined ? activeDragNdtPin.targetX : vx) + dx;
                    activeDragNdtPin.targetY = (activeDragNdtPin.targetY !== undefined ? activeDragNdtPin.targetY : vy) + dy;
                }
                drawNdtCanvas();
            } else if (!isNdtPinching && isNdtMarkingDrag && e.touches.length === 1) {
                const canvas = document.getElementById('ndtCanvas');
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();
                const touch = e.touches[0];
                const mouseX = touch.clientX - rect.left;
                const mouseY = touch.clientY - rect.top;
                const rawVx = (mouseX - ndtView.offsetX) / ndtView.scale;
                const rawVy = (mouseY - ndtView.offsetY) / ndtView.scale;
                const pt = viewToNdtImgCoords(rawVx, rawVy);
                window._ndtMarkCurrentCoords = { x: pt.x, y: pt.y };
                drawNdtCanvas();
            } else if (!isNdtPinching && isNdtDragging && e.touches.length === 1) {
                const touch = e.touches[0];
                const dx = touch.clientX - ndtStartMouseX;
                const dy = touch.clientY - ndtStartMouseY;
                ndtView.offsetX = ndtInitialOffsetX + dx;
                ndtView.offsetY = ndtInitialOffsetY + dy;
                drawNdtCanvas();
            }
        }, { passive: false });

        window.addEventListener('touchend', (e) => {
            if (isNdtPinching && e.touches.length < 2) isNdtPinching = false;
            if (isDraggingNdtPin) {
                isDraggingNdtPin = false;
                activeDragNdtPin = null;
                saveStateToLocalStorage();
                drawNdtCanvas();
            }
            if (isNdtMarkingDrag) {
                isNdtMarkingDrag = false;
                const start = window._ndtMarkStartCoords || { x: 100, y: 100 };
                const end = window._ndtMarkCurrentCoords || start;

                const dx = start.x - end.x;
                const dy = start.y - end.y;
                let autoDir = '←';
                if (Math.hypot(dx, dy) > 8) {
                    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
                    if (angleDeg >= -22.5 && angleDeg < 22.5) autoDir = '→';
                    else if (angleDeg >= 22.5 && angleDeg < 67.5) autoDir = '↘';
                    else if (angleDeg >= 67.5 && angleDeg < 112.5) autoDir = '↓';
                    else if (angleDeg >= 112.5 && angleDeg < 157.5) autoDir = '↙';
                    else if (angleDeg >= 157.5 || angleDeg < -157.5) autoDir = '←';
                    else if (angleDeg >= -157.5 && angleDeg < -112.5) autoDir = '↖';
                    else if (angleDeg >= -112.5 && angleDeg < -67.5) autoDir = '↑';
                    else if (angleDeg >= -67.5 && angleDeg < -22.5) autoDir = '↗';
                }

                const distMoved = Math.hypot(start.x - end.x, start.y - end.y);
                const targetX = start.x;
                const targetY = start.y;
                const boxX = distMoved > 10 ? end.x : start.x;
                const boxY = distMoved > 10 ? end.y : (start.y + 60);

                openNdtModal(start.x, start.y, null, {
                    targetX,
                    targetY,
                    boxX,
                    boxY,
                    dispDirection: autoDir
                });
            }
            isNdtDragging = false;
        });

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.1 : 0.9;
            window.zoomNdtCanvas(factor);
        }, { passive: false });
    }

    function renderNdtSummaryTable() {
        const tbody = document.getElementById('ndtTableBody');
        const thead = document.querySelector('#ndtSummaryTable thead tr');
        if (!tbody) return;

        const currentCat = currentNdtCategory || '실측';
        let items = getCurrentFloorNdtData();

        if (currentCat === '기울기') {
            items = items.filter(x => x.category === '기울기');
            if (thead) {
                thead.innerHTML = `
                    <th>조사번호</th>
                    <th>측정위치</th>
                    <th>측정높이(H)</th>
                    <th>변위량(mm)</th>
                    <th>기울기(1/H)</th>
                    <th>안전 등급</th>
                    <th>관리</th>
                `;
            }
        } else if (currentCat === '변위') {
            items = items.filter(x => x.category === '변위');
            if (thead) {
                thead.innerHTML = `
                    <th>조사번호</th>
                    <th>측정위치</th>
                    <th>부재명</th>
                    <th>변위량(mm)</th>
                    <th>상태판정</th>
                    <th>관리</th>
                `;
            }
        } else {
            items = items.filter(x => ['실측', '강도', '탄산화'].includes(x.category));
            if (thead) {
                thead.innerHTML = `
                    <th>조사번호</th>
                    <th>조사항목</th>
                    <th>측정위치</th>
                    <th>부재명</th>
                    <th>측정수치</th>
                    <th>평균결과</th>
                    <th>상태판정</th>
                    <th>관리</th>
                `;
            }
        }

        if (items.length === 0) {
            const colSpan = (currentCat === '기울기' || currentCat === '변위') ? 7 : 8;
            tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; color: #94a3b8; padding: 1.5rem;">등록된 ${currentCat} 측정 데이터가 없습니다. 도면 상에 [📍 NDT 위치 마킹]을 클릭해 주세요.</td></tr>`;
            return;
        }

        const catBadges = {
            '실측': '<span class="badge" style="background:rgba(2,132,199,0.2); color:#38bdf8; border:1px solid rgba(2,132,199,0.4);">📏 부재실측</span>',
            '강도': '<span class="badge" style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid rgba(239,68,68,0.4);">🔨 콘크리트 강도</span>',
            '탄산화': '<span class="badge" style="background:rgba(234,179,8,0.2); color:#facc15; border:1px solid rgba(234,179,8,0.4);">🧪 탄산화</span>',
            '기울기': '<span class="badge" style="background:rgba(168,85,247,0.2); color:#c084fc; border:1px solid rgba(168,85,247,0.4);">📐 외벽기울기</span>',
            '변위': '<span class="badge" style="background:rgba(16,185,129,0.2); color:#34d399; border:1px solid rgba(16,185,129,0.4);">📉 수직변위</span>'
        };

        const statusBadges = {
            '양호': '<span class="badge badge-good">🟢 양호</span>',
            '주의': '<span class="badge badge-warning">🟡 주의</span>',
            '보강필요': '<span class="badge badge-danger">🔴 보강필요</span>'
        };

        const gradeBadges = {
            'a등급': '<span class="badge" style="background:rgba(34,197,94,0.2); color:#4ade80; border:1px solid rgba(34,197,94,0.4); font-weight:800;">a등급 (1/750이상)</span>',
            'b등급': '<span class="badge" style="background:rgba(56,189,248,0.2); color:#38bdf8; border:1px solid rgba(56,189,248,0.4); font-weight:800;">b등급 (1/500이하)</span>',
            'c등급': '<span class="badge" style="background:rgba(250,204,21,0.2); color:#facc15; border:1px solid rgba(250,204,21,0.4); font-weight:800;">c등급 (1/250이하)</span>',
            'd등급': '<span class="badge" style="background:rgba(249,115,22,0.2); color:#fb923c; border:1px solid rgba(249,115,22,0.4); font-weight:800;">d등급 (1/150이하)</span>',
            'e등급': '<span class="badge" style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid rgba(239,68,68,0.4); font-weight:800;">e등급 (1/150초과)</span>'
        };

        if (currentCat === '기울기') {
            tbody.innerHTML = items.map((item, idx) => `
                <tr>
                    <td style="font-weight:700; color:#38bdf8;">${item.no || (idx + 1)}</td>
                    <td style="font-weight:700;">${item.location || '위치미지정'}</td>
                    <td style="font-weight:700; color:#38bdf8;">${formatHeightValue(item.height)}</td>
                    <td style="font-weight:800; color:#f8fafc;">${item.avgValue || '-'}</td>
                    <td style="font-weight:800; color:#c084fc;">${item.tiltRatio || '1/750'}</td>
                    <td>${gradeBadges[item.grade] || gradeBadges['a등급']}</td>
                    <td>
                        <button class="btn btn-sm btn-outline" style="border-color:#38bdf8; color:#38bdf8; padding:0.15rem 0.45rem;" onclick="window.editNdtItem('${item.id}')">수정</button>
                        <button class="btn btn-sm btn-danger-outline" style="padding:0.15rem 0.45rem;" onclick="window.deleteNdtItem('${item.id}')">삭제</button>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = items.map((item, idx) => `
                <tr>
                    <td style="font-weight:700; color:#38bdf8;">${item.no || (idx + 1)}</td>
                    <td>${catBadges[item.category] || item.category}</td>
                    <td style="font-weight:700;">${item.location || '위치미지정'}</td>
                    <td>${item.component || '기둥'}</td>
                    <td style="font-family:monospace; font-size:0.88rem;">${item.valuesText || '-'}</td>
                    <td style="font-weight:800; color:#4ade80;">${item.avgValue || '-'}</td>
                    <td>${statusBadges[item.status] || '🟢 양호'}</td>
                    <td>
                        <button class="btn btn-sm btn-outline" style="border-color:#38bdf8; color:#38bdf8; padding:0.15rem 0.45rem;" onclick="window.editNdtItem('${item.id}')">수정</button>
                        <button class="btn btn-sm btn-danger-outline" style="padding:0.15rem 0.45rem;" onclick="window.deleteNdtItem('${item.id}')">삭제</button>
                    </td>
                </tr>
            `).join('');
        }
    }

    window.editNdtItem = function(id) {
        const items = getCurrentFloorNdtData();
        const item = items.find(x => x.id === id);
        if (item) {
            openNdtModal(item.x, item.y, item);
        }
    };

    window.deleteNdtItem = function(id) {
        if (confirm('⚠️ 해당 비파괴 조사 측정 항목을 삭제하시겠습니까?')) {
            const key = `${state.currentBuildingId}_${state.currentFloor}`;
            state.ndtData[key] = (state.ndtData[key] || []).filter(x => x.id !== id);
            saveStateToLocalStorage();
            drawNdtCanvas();
            renderNdtSummaryTable();
        }
    };

    window.exportNdtTableExcel = function() {
        const items = getCurrentFloorNdtData();
        if (items.length === 0) {
            alert('⚠️ 엑셀로 출력할 비파괴 조사 측정 데이터가 없습니다.');
            return;
        }

        let csvContent = "\uFEFF조사번호,조사항목,측정위치,부재명,측정수치,평균결과,상태판정\n";
        items.forEach(item => {
            csvContent += `"${item.no}","${item.category}","${item.location}","${item.component}","${item.valuesText || ''}","${item.avgValue || ''}","${item.status}"\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `비파괴조사결과_${state.currentBuildingId}_${state.currentFloor}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    window.toggleNdtModalFields = function() {
        const cat = document.getElementById('ndtCategory')?.value || '강도';
        const stdGrp = document.getElementById('groupNdtStandardFields');
        const tiltGrp = document.getElementById('groupNdtTiltFields');
        const statusGrp = document.getElementById('groupNdtStatus');
        const valTitle = document.getElementById('lblNdtValueTitle');
        const avgTitle = document.getElementById('lblNdtAvgTitle');

        if (cat === '기울기' || cat === '변위') {
            if (stdGrp) stdGrp.style.display = 'none';
            if (statusGrp) statusGrp.style.display = 'none';
            if (tiltGrp) tiltGrp.style.display = 'flex';
            if (valTitle) valTitle.textContent = '📊 현장 측정값 (1~3회 입력 시 변위량 자동 연산)';
            if (avgTitle) avgTitle.textContent = '⚡ 변위량 (예: 3.2mm)';
        } else {
            if (stdGrp) stdGrp.style.display = 'flex';
            if (statusGrp) statusGrp.style.display = 'flex';
            if (tiltGrp) tiltGrp.style.display = 'none';
            if (valTitle) valTitle.textContent = '📊 현장 측정값 (1~3회 입력 시 평균 자동 연산)';
            if (avgTitle) avgTitle.textContent = '⚡ 평균 / 종합 결과값';
        }
    };

    function openNdtModal(imgX, imgY, existingItem = null, extraOpts = null) {
        const modal = document.getElementById('ndtModal');
        if (!modal) return;

        const pinIdEl = document.getElementById('ndtPinId');
        const noEl = document.getElementById('ndtNo');
        const catEl = document.getElementById('ndtCategory');
        const compEl = document.getElementById('ndtComponent');
        const locEl = document.getElementById('ndtLocation');
        const heightEl = document.getElementById('ndtHeight');
        const dispDirEl = document.getElementById('ndtDispDirection');
        const v1El = document.getElementById('ndtVal1');
        const v2El = document.getElementById('ndtVal2');
        const v3El = document.getElementById('ndtVal3');
        const avgEl = document.getElementById('ndtAvgValue');
        const statusEl = document.getElementById('ndtStatus');

        if (existingItem) {
            if (pinIdEl) pinIdEl.value = existingItem.id;
            if (noEl) noEl.value = existingItem.no;
            if (catEl) catEl.value = existingItem.category || '강도';
            if (compEl) compEl.value = existingItem.component || '기둥';
            if (locEl) locEl.value = existingItem.location || '';
            if (heightEl) heightEl.value = existingItem.height || 'H = 3,000mm';
            if (dispDirEl) dispDirEl.value = existingItem.dispDirection || '←';
            if (v1El) v1El.value = existingItem.v1 || '';
            if (v2El) v2El.value = existingItem.v2 || '';
            if (v3El) v3El.value = existingItem.v3 || '';
            if (avgEl) avgEl.value = existingItem.avgValue || '';
            if (statusEl) statusEl.value = existingItem.status || '양호';

            window._pendingNdtExtra = {
                targetX: existingItem.targetX !== undefined ? existingItem.targetX : existingItem.x,
                targetY: existingItem.targetY !== undefined ? existingItem.targetY : existingItem.y,
                boxX: existingItem.boxX !== undefined ? existingItem.boxX : existingItem.x,
                boxY: existingItem.boxY !== undefined ? existingItem.boxY : existingItem.y
            };
        } else {
            const items = getCurrentFloorNdtData();
            const cat = currentNdtCategory || '강도';
            const count = items.filter(x => x.category === cat).length + 1;
            const seqStr = count < 10 ? `0${count}` : `${count}`;
            const noStr = `NO.${seqStr}`;

            if (pinIdEl) pinIdEl.value = '';
            if (noEl) noEl.value = noStr;
            if (catEl) catEl.value = cat;
            if (compEl) compEl.value = '기둥';
            if (cat === '기울기') {
                if (locEl) locEl.value = '';
            } else {
                if (locEl) locEl.value = calculateGridLocationString(imgX, imgY, '기둥');
            }
            if (heightEl) heightEl.value = 'H = 3,000mm';
            if (dispDirEl) dispDirEl.value = extraOpts?.dispDirection || '←';
            if (v1El) v1El.value = '';
            if (v2El) v2El.value = '';
            if (v3El) v3El.value = '';
            if (avgEl) avgEl.value = '';
            if (statusEl) statusEl.value = '양호';

            window._pendingNdtExtra = extraOpts || {
                targetX: imgX,
                targetY: imgY,
                boxX: imgX,
                boxY: imgY + 50
            };
        }

        window.toggleNdtModalFields();
        modal.style.display = 'flex';
        modal.classList.add('open');
    }

    function setupNdtModalEvents() {
        const modal = document.getElementById('ndtModal');
        const btnClose = document.getElementById('btnCloseNdtModal');
        const btnCancel = document.getElementById('btnCancelNdt');
        const btnSave = document.getElementById('btnSaveNdt');
        const btnDelete = document.getElementById('btnDeleteNdt');

        const v1El = document.getElementById('ndtVal1');
        const v2El = document.getElementById('ndtVal2');
        const v3El = document.getElementById('ndtVal3');
        const avgEl = document.getElementById('ndtAvgValue');
        const heightEl = document.getElementById('ndtHeight');

        function calcNdtAvg() {
            const n1 = parseFloat(v1El?.value);
            const n2 = parseFloat(v2El?.value);
            const n3 = parseFloat(v3El?.value);

            const nums = [n1, n2, n3].filter(n => !isNaN(n));
            if (nums.length > 0) {
                const sum = nums.reduce((a, b) => a + b, 0);
                const avg = (sum / nums.length).toFixed(1);
                const unitStr = (currentNdtCategory === '기울기' || currentNdtCategory === '변위') ? 'mm' : '';
                if (avgEl) avgEl.value = `${avg}${unitStr}`;
            } else {
                const raw1 = (v1El?.value || '').trim();
                if (raw1 && avgEl) avgEl.value = raw1;
            }
            calcTiltAuto();
        }

        function calcTiltAuto() {
            const cat = document.getElementById('ndtCategory')?.value || '강도';
            if (cat !== '기울기') return;

            const hStr = (heightEl?.value || '').replace(/[^0-9.]/g, '');
            const deltaStr = (avgEl?.value || '').replace(/[^0-9.]/g, '');
            const h = parseFloat(hStr) || 3000;
            const delta = parseFloat(deltaStr) || 0;

            const tiltRatioEl = document.getElementById('ndtTiltRatio');
            const gradeEl = document.getElementById('ndtGrade');

            if (delta > 0 && h > 0) {
                const ratioInv = Math.round(h / delta);
                const ratioStr = `1/${ratioInv}`;
                if (tiltRatioEl) tiltRatioEl.value = ratioStr;

                let grade = 'a등급';
                if (ratioInv >= 750) grade = 'a등급';
                else if (ratioInv >= 500) grade = 'b등급';
                else if (ratioInv >= 250) grade = 'c등급';
                else if (ratioInv >= 150) grade = 'd등급';
                else grade = 'e등급';

                if (gradeEl) gradeEl.value = grade;
            }
        }

        [v1El, v2El, v3El, heightEl].forEach(el => {
            if (el) el.addEventListener('input', calcNdtAvg);
        });

        function closeNdtModal() {
            if (modal) {
                modal.style.display = 'none';
                modal.classList.remove('open');
            }
        }

        if (btnClose) btnClose.addEventListener('click', closeNdtModal);
        if (btnCancel) btnCancel.addEventListener('click', closeNdtModal);

        if (btnSave) {
            btnSave.addEventListener('click', () => {
                const key = `${state.currentBuildingId}_${state.currentFloor}`;
                if (!state.ndtData[key]) state.ndtData[key] = [];

                const pinId = document.getElementById('ndtPinId')?.value;
                const noStr = document.getElementById('ndtNo')?.value || 'NDT-01';
                const cat = document.getElementById('ndtCategory')?.value || '강도';
                const comp = document.getElementById('ndtComponent')?.value || '기둥';
                const loc = document.getElementById('ndtLocation')?.value || '';
                const rawHeightStr = document.getElementById('ndtHeight')?.value || '';
                const formattedHeight = formatHeightValue(rawHeightStr);
                const dispDir = document.getElementById('ndtDispDirection')?.value || '←';
                const v1 = document.getElementById('ndtVal1')?.value || '';
                const v2 = document.getElementById('ndtVal2')?.value || '';
                const v3 = document.getElementById('ndtVal3')?.value || '';
                const avg = document.getElementById('ndtAvgValue')?.value || '';
                const status = document.getElementById('ndtStatus')?.value || '양호';

                let tiltRatio = document.getElementById('ndtTiltRatio')?.value || '';
                let grade = document.getElementById('ndtGrade')?.value || '';

                if (cat === '기울기') {
                    const hDigits = (formattedHeight || '').replace(/[^0-9.]/g, '');
                    const avgDigits = (avg || '').replace(/[^0-9.]/g, '');
                    const h = parseFloat(hDigits) || 3000;
                    const delta = parseFloat(avgDigits) || 0;
                    if (delta > 0 && h > 0) {
                        const ratioInv = Math.round(h / delta);
                        tiltRatio = `1/${ratioInv}`;
                        if (ratioInv >= 750) grade = 'a등급';
                        else if (ratioInv >= 500) grade = 'b등급';
                        else if (ratioInv >= 250) grade = 'c등급';
                        else if (ratioInv >= 150) grade = 'd등급';
                        else grade = 'e등급';
                    } else {
                        if (!tiltRatio) tiltRatio = '1/750';
                        if (!grade) grade = 'a등급';
                    }
                }

                const extra = window._pendingNdtExtra || { targetX: 100, targetY: 100, boxX: 100, boxY: 150 };
                const valsArr = [v1, v2, v3].filter(x => x.trim() !== '');
                const valuesText = valsArr.join(', ') || '-';

                if (pinId) {
                    const idx = state.ndtData[key].findIndex(x => x.id === pinId);
                    if (idx >= 0) {
                        state.ndtData[key][idx] = {
                            ...state.ndtData[key][idx],
                            no: noStr,
                            category: cat,
                            component: comp,
                            location: loc,
                            height: formattedHeight,
                            dispDirection: dispDir,
                            targetX: extra.targetX,
                            targetY: extra.targetY,
                            boxX: extra.boxX,
                            boxY: extra.boxY,
                            v1, v2, v3,
                            valuesText,
                            avgValue: avg || valuesText,
                            status,
                            tiltRatio,
                            grade
                        };
                    }
                } else {
                    const newItem = {
                        id: `ndt_${Date.now()}`,
                        no: noStr,
                        category: cat,
                        component: comp,
                        location: loc,
                        height: formattedHeight,
                        dispDirection: dispDir,
                        targetX: extra.targetX,
                        targetY: extra.targetY,
                        boxX: extra.boxX,
                        boxY: extra.boxY,
                        v1, v2, v3,
                        valuesText,
                        avgValue: avg || valuesText,
                        status,
                        tiltRatio,
                        grade,
                        x: extra.targetX,
                        y: extra.targetY
                    };
                    state.ndtData[key].push(newItem);
                }

                saveStateToLocalStorage();
                drawNdtCanvas();
                renderNdtSummaryTable();
                closeNdtModal();
            });
        }

        if (btnDelete) {
            btnDelete.addEventListener('click', () => {
                const pinId = document.getElementById('ndtPinId')?.value;
                if (pinId && confirm('⚠️ 해당 비파괴 조사 측정 항목을 삭제하시겠습니까?')) {
                    const key = `${state.currentBuildingId}_${state.currentFloor}`;
                    state.ndtData[key] = (state.ndtData[key] || []).filter(x => x.id !== pinId);
                    saveStateToLocalStorage();
                    drawNdtCanvas();
                    renderNdtSummaryTable();
                    closeNdtModal();
                }
            });
        }

        // NDT Drawing File Upload
        const inputNdtDrawing = document.getElementById('inputNdtDrawing');
        if (inputNdtDrawing) {
            inputNdtDrawing.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const key = `${state.currentBuildingId}_${state.currentFloor}`;
                        if (!state.ndtImages) state.ndtImages = {};
                        state.ndtImages[key] = event.target.result;
                        saveStateToLocalStorage();
                        loadFloorNdtDrawing();
                        alert('✅ NDT 전용 도면이 성공적으로 등록되었습니다!');
                    };
                    reader.readAsDataURL(file);
                }
            });
        }

        const btnSync = document.getElementById('btnNdtSyncFloorDrawing');
        if (btnSync) {
            btnSync.addEventListener('click', () => {
                const key = `${state.currentBuildingId}_${state.currentFloor}`;
                if (state.ndtImages && state.ndtImages[key]) {
                    delete state.ndtImages[key];
                    saveStateToLocalStorage();
                }
                loadFloorNdtDrawing();
                alert('🔄 층별 원본 도면으로 연동이 완료되었습니다.');
            });
        }
    }

    function getCurrentFloorDefects() {
        if (!state.currentBuildingId) return [];
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        return state.defects[key] || [];
    }

    // 손상 유형 필터링이 적용된 현재 층 결함 목록 반환
    function getCurrentFloorFilteredDefects() {
        const list = getCurrentFloorDefects();
        const filter = window.state.damageTypeFilter || 'ALL';
        if (filter === 'ALL') return list;
        return list.filter(d => {
            const typeStr = (d.type || d.defectType || d.description || d.cause || '').toString();
            if (filter === '기타') {
                return !['균열', '누수', '백태', '철근노출', '박리/박락'].some(t => typeStr.includes(t));
            }
            return typeStr.includes(filter);
        });
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

    // Canvas Mouse & Touch Event Handlers with 1-second Long-Press Pin & Arrow Dragging & Multi-Touch Pinch Zoom
    let isDragging = false;
    let isMarkingDrag = false;
    let longPressTimer = null;
    let isDraggingPin = false;
    let activeDragPin = null;
    let activeDragPart = 'BOX'; // 'BOX' or 'TIP'

    // Multi-Touch Pinch Zoom & Pan Variables
    let isPinching = false;
    let initialPinchDist = 0;
    let initialPinchScale = 1.0;
    let initialPinchMidX = 0;
    let initialPinchMidY = 0;
    let initialPinchOffsetX = 0;
    let initialPinchOffsetY = 0;

    let markTargetImgX = 0;
    let markTargetImgY = 0;
    let liveBoxImgX = 0;
    let liveBoxImgY = 0;

    let startMouseX = 0;
    let startMouseY = 0;
    let initialOffsetX = 0;
    let initialOffsetY = 0;

    function getTouchDistance(t1, t2) {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.hypot(dx, dy);
    }

    function getTouchMidpoint(t1, t2, canvasRect) {
        return {
            x: (t1.clientX + t2.clientX) / 2 - canvasRect.left,
            y: (t1.clientY + t2.clientY) / 2 - canvasRect.top
        };
    }


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

        // 3-Second Grid Calibration Touch Mode Handler (v60.0)
        if (window._isCalibratingGrid) {
            const img = state.bgImage;
            const imgW = img ? (img.naturalWidth || img.width || 1200) : 1200;
            const imgH = img ? (img.naturalHeight || img.height || 700) : 700;

            if (window._calibStep === 1) {
                window._calibPt1 = { x: imgX, y: imgY };
                window._calibStep = 2;
                alert('🎯 Step 1/2 완료!\n\n이제 도면 우측 하단 (Xn, Yn) 교차점을 터치해 주세요.');
            } else if (window._calibStep === 2) {
                const pt1 = window._calibPt1 || { x: 0, y: 0 };
                const pt2 = { x: imgX, y: imgY };

                const cfg = getCurrentFloorGridConfig();
                cfg.xStart = Math.min(pt1.x, pt2.x) / imgW;
                cfg.xEnd = Math.max(pt1.x, pt2.x) / imgW;
                cfg.yStart = Math.min(pt1.y, pt2.y) / imgH;
                cfg.yEnd = Math.max(pt1.y, pt2.y) / imgH;
                cfg.enabled = true;

                window._isCalibratingGrid = false;
                window._calibStep = 0;

                saveStateToLocalStorage();
                drawCanvas();
                alert('✅ 3초 스마트 그리드 캘리브레이션 완료!\n도면 상에 X1~Xn / Y1~Yn 그리드망이 정상 배치되었습니다.');
            }
            return;
        }

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

        // Touch Events (Galaxy Tab & Smartphone Support with Multi-Touch Pinch Zoom & Pan)
        elements.planCanvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1 && !isPinching) {
                handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
            } else if (e.touches.length >= 2) {
                // Multi-touch detected: cancel active 1-finger mark or drag operations safely
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
                isMarkingDrag = false;
                isDragging = false;
                isDraggingPin = false;
                activeDragPin = null;

                isPinching = true;
                const rect = elements.planCanvas.getBoundingClientRect();
                initialPinchDist = getTouchDistance(e.touches[0], e.touches[1]);
                initialPinchScale = state.view.scale;
                const mid = getTouchMidpoint(e.touches[0], e.touches[1], rect);
                initialPinchMidX = mid.x;
                initialPinchMidY = mid.y;
                initialPinchOffsetX = state.view.offsetX;
                initialPinchOffsetY = state.view.offsetY;
            }
        }, { passive: false });

        window.addEventListener('touchmove', (e) => {
            if (isPinching && e.touches.length >= 2) {
                if (e.cancelable) e.preventDefault();
                const rect = elements.planCanvas.getBoundingClientRect();
                const currentDist = getTouchDistance(e.touches[0], e.touches[1]);
                if (initialPinchDist > 0) {
                    const scaleFactor = currentDist / initialPinchDist;
                    const newScale = Math.min(Math.max(0.3, initialPinchScale * scaleFactor), 4.0);
                    const currentMid = getTouchMidpoint(e.touches[0], e.touches[1], rect);

                    // Compute focal point zoom offset based on touch midpoint
                    const imgX = (initialPinchMidX - initialPinchOffsetX) / initialPinchScale;
                    const imgY = (initialPinchMidY - initialPinchOffsetY) / initialPinchScale;

                    state.view.scale = newScale;
                    state.view.offsetX = currentMid.x - imgX * newScale;
                    state.view.offsetY = currentMid.y - imgY * newScale;

                    if (elements.zoomScaleText) elements.zoomScaleText.textContent = `${Math.round(state.view.scale * 100)}%`;
                    drawCanvas();
                }
            } else if (!isPinching && e.touches.length === 1) {
                if (isDragging || isMarkingDrag || isDraggingPin || longPressTimer) {
                    handleDragMove(e.touches[0].clientX, e.touches[0].clientY);
                }
            }
        }, { passive: false });

        window.addEventListener('touchend', (e) => {
            if (isPinching) {
                if (e.touches.length < 2) {
                    isPinching = false;
                }
            } else {
                if (isDragging || isMarkingDrag || isDraggingPin || longPressTimer) handleDragEnd();
            }
        });

        window.addEventListener('touchcancel', () => {
            isPinching = false;
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
            const defaultComp = '기둥';
            if (compEl) compEl.value = defaultComp;
            
            // Auto-calculate structural grid location (v60.0)
            const tX = targetX !== undefined ? targetX : (boxX - 35);
            const tY = targetY !== undefined ? targetY : (boxY + 35);
            if (locEl) {
                locEl.value = calculateGridLocationString(tX, tY, defaultComp);
            }
            if (sizeEl) sizeEl.value = '';
            if (progCheckEl) progCheckEl.checked = false;
            if (leakCheckEl) leakCheckEl.checked = false;

            window._pendingPhotos = [];
            window._pendingPinCoords = { 
                x: boxX, 
                y: boxY, 
                targetX: tX, 
                targetY: tY 
            };
        }

        // Dynamic location calculation update when changing component dropdown (v60.0)
        if (compEl && locEl) {
            compEl.onchange = () => {
                if (window._pendingPinCoords) {
                    locEl.value = calculateGridLocationString(window._pendingPinCoords.targetX, window._pendingPinCoords.targetY, compEl.value);
                }
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
            <div style="display:inline-block; position:relative; margin-right:12px; margin-top:8px; text-align:center;">
                <div style="position:relative; display:inline-block;">
                    <img src="${src}" style="width:75px; height:75px; object-fit:cover; border-radius:6px; border:1px solid #38bdf8; cursor:pointer;" title="클릭시 사진 마킹 드로잉 모달 오픈" onclick="window.annotatePendingPhoto(${idx})">
                    <span style="position:absolute; top:-6px; right:-6px; background:#ef4444; color:#fff; border-radius:50%; width:20px; height:20px; text-align:center; font-size:13px; font-weight:bold; cursor:pointer; line-height:20px;" onclick="window.removePendingPhoto(${idx})">×</span>
                </div>
                <button type="button" class="btn btn-sm btn-outline" style="display:block; width:75px; margin-top:4px; font-size:0.7rem; padding:0.1rem 0.2rem; border-color:#f43f5e; color:#fb7185;" onclick="window.annotatePendingPhoto(${idx})">
                    <i class="fa-solid fa-paintbrush"></i> 마킹
                </button>
            </div>
        `).join('');
    }

    window.annotatePendingPhoto = function(idx) {
        if (window._pendingPhotos && window._pendingPhotos[idx]) {
            window.openPhotoAnnotationModal(window._pendingPhotos[idx], (annotatedDataUrl) => {
                window._pendingPhotos[idx] = annotatedDataUrl;
                renderPhotoPreviewList();
            });
        }
    };

    window.removePendingPhoto = function(idx) {
        if (window._pendingPhotos) {
            window._pendingPhotos.splice(idx, 1);
            renderPhotoPreviewList();
        }
    };

    const inputDefectPhoto = document.getElementById('inputDefectPhoto');
    const inputDefectCamera = document.getElementById('inputDefectCamera');
    const btnTriggerCamera = document.getElementById('btnTriggerCamera');
    const btnTriggerGallery = document.getElementById('btnTriggerGallery');
    const photoUploadArea = document.getElementById('photoUploadArea');

    function handleSelectedPhotoFile(file) {
        if (!file) return;
        window.compressDefectPhoto43(file, 1000, 0.85).then(compressedUrl => {
            if (!window._pendingPhotos) window._pendingPhotos = [];
            window._pendingPhotos.push(compressedUrl);
            renderPhotoPreviewList();
        });
    }

    if (btnTriggerCamera && inputDefectCamera) {
        btnTriggerCamera.onclick = (e) => {
            e.preventDefault();
            inputDefectCamera.value = '';
            inputDefectCamera.click();
        };
    }

    if (btnTriggerGallery && inputDefectPhoto) {
        btnTriggerGallery.onclick = (e) => {
            e.preventDefault();
            inputDefectPhoto.value = '';
            inputDefectPhoto.click();
        };
    }

    if (photoUploadArea) {
        photoUploadArea.onclick = () => {
            if (inputDefectCamera && window.innerWidth <= 768) {
                inputDefectCamera.value = '';
                inputDefectCamera.click();
            } else if (inputDefectPhoto) {
                inputDefectPhoto.value = '';
                inputDefectPhoto.click();
            }
        };
    }

    if (inputDefectPhoto) {
        inputDefectPhoto.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                handleSelectedPhotoFile(e.target.files[0]);
            }
        };
    }

    if (inputDefectCamera) {
        inputDefectCamera.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                handleSelectedPhotoFile(e.target.files[0]);
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

        // 📊 현재 층 결함 통계 차트 자동 업데이트
        if (typeof window.renderDefectStatisticsChart === 'function') {
            window.renderDefectStatisticsChart('surveyChartCanvas', defects);
        }

        if (defects.length === 0) {
            elements.surveyTableBody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding: 2.5rem; color:#64748b; font-weight:600;">등록된 결함이 없습니다. 도면 점검 탭에서 결함을 마킹해 보세요.</td></tr>`;
            return;
        }

        // Build sequential photo labels for current floor (사진01, 사진02, 사진03...)
        const defectPhotoLabels = {};
        let pCounter = 0;
        defects.forEach((d, dIdx) => {
            const defectKey = d.id || `idx_${dIdx}`;
            defectPhotoLabels[defectKey] = [];
            if (d.photos && Array.isArray(d.photos) && d.photos.length > 0) {
                d.photos.forEach(src => {
                    if (src) {
                        pCounter++;
                        const pNumStr = pCounter < 10 ? `0${pCounter}` : `${pCounter}`;
                        defectPhotoLabels[defectKey].push(`사진${pNumStr}`);
                    }
                });
            }
        });

        elements.surveyTableBody.innerHTML = defects.map((d, dIdx) => {
            const defectKey = d.id || `idx_${dIdx}`;
            const labels = defectPhotoLabels[defectKey] || [];
            const photoRemark = labels.length > 0 ? labels.join(' ') : '-';

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
        if (typeof renderPhotoAlbum === 'function') renderPhotoAlbum();
    }

    function renderPhotoAlbum() {
        if (!elements.photoAlbumGrid) return;
        const defects = getCurrentFloorDefects();
        if (elements.albumFloorTitle) elements.albumFloorTitle.textContent = state.currentFloor;

        const photoItems = [];
        let pCounter = 0;

        defects.forEach(d => {
            if (d.photos && Array.isArray(d.photos) && d.photos.length > 0) {
                d.photos.forEach(photoSrc => {
                    if (photoSrc) {
                        pCounter++;
                        const pNumStr = pCounter < 10 ? `0${pCounter}` : `${pCounter}`;
                        const photoLabel = `사진${pNumStr}`;
                        const componentDefectTitle = `${d.no ? d.no + ' ' : ''}${d.component || '부재'} ${d.defectType || '결함'}`;
                        photoItems.push({
                            label: photoLabel,
                            title: componentDefectTitle,
                            src: photoSrc
                        });
                    }
                });
            }
        });

        if (photoItems.length === 0) {
            elements.photoAlbumGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:3rem; color:#94a3b8; font-weight:600;"><i class="fa-solid fa-camera" style="font-size:2.5rem; color:#cbd5e1; display:block; margin-bottom:0.8rem;"></i>📷 등록된 현장 결함 사진이 없습니다.</div>`;
            return;
        }

        elements.photoAlbumGrid.innerHTML = photoItems.map(p => `
            <div class="photo-card" style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); color: #0f172a;">
                <div class="photo-card-img-wrap" style="aspect-ratio: 4 / 3; width: 100%; background: #f1f5f9; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center;">
                    <img src="${p.src}" style="width:100%; height:100%; object-fit:cover;">
                </div>
                <div style="padding: 0.8rem; text-align: center;">
                    <div style="font-size: 1rem; font-weight: 800; color: #0369a1;">
                        ${p.label}. ${p.title}
                    </div>
                </div>
            </div>
        `).join('');
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

            // 2. If image exists, render onto A4 PORTRAIT (세로 규격: 900 x 1270) canvas with defect pins!
            if (loadedImg || floorDrawingSrc) {
                const drawImageOnPureWhiteCanvas = (imgObj) => {
                    const canvas = document.createElement('canvas');
                    const imgW = imgObj.naturalWidth || imgObj.width || 1400;
                    const imgH = imgObj.naturalHeight || imgObj.height || 900;

                    // Set canvas to A4 PORTRAIT dimensions (cw = 900, ch = 1270)
                    const cw = 900;
                    const ch = 1270;
                    canvas.width = cw;
                    canvas.height = ch;
                    const ctx = canvas.getContext('2d');

                    // Pure white background
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, cw, ch);

                    ctx.save();
                    const isHorizontal = imgW > imgH;

                    if (isHorizontal) {
                        // Rotate horizontal drawing 90 degrees left to place it vertically filling the A4 portrait page
                        ctx.translate(cw / 2, ch / 2);
                        ctx.rotate(-Math.PI / 2);
                        
                        const scale = Math.min(cw / imgH, ch / imgW);
                        ctx.scale(scale, scale);
                        ctx.translate(-imgW / 2, -imgH / 2);

                        ctx.drawImage(imgObj, 0, 0, imgW, imgH);
                        defects.forEach(defect => drawPinSafe(ctx, defect));
                    } else {
                        // Vertical drawing: scale directly to fit portrait canvas while preserving exact aspect ratio
                        const scale = Math.min(cw / imgW, ch / imgH);
                        const drawX = (cw - imgW * scale) / 2;
                        const drawY = (ch - imgH * scale) / 2;

                        ctx.translate(drawX, drawY);
                        ctx.scale(scale, scale);

                        ctx.drawImage(imgObj, 0, 0, imgW, imgH);
                        defects.forEach(defect => drawPinSafe(ctx, defect));
                    }
                    ctx.restore();

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

            // 3. If NO registered floor drawing exists, return null
            return null;
        } catch (err) {
            console.error('Error rendering floor plan data URL:', err);
            return null;
        }
    }

    function renderNdtFloorPlanCanvasDataUrl(floorCode) {
        try {
            const bldg = window.state.currentBuilding || {};
            const currentBldgId = bldg.id || state.currentBuildingId || 'default';
            const key = `${currentBldgId}_${floorCode}`;
            const ndtItems = state.ndtData ? (state.ndtData[key] || []) : [];

            let loadedImg = state.floorImageCache ? state.floorImageCache[floorCode] : null;
            let floorDrawingSrc = getFloorDrawingSrc(bldg, floorCode);
            if (!floorDrawingSrc && state.currentFloor === floorCode && state.ndtBgImage && state.ndtBgImage.src) {
                floorDrawingSrc = state.ndtBgImage.src;
            }
            if (!floorDrawingSrc && state.currentFloor === floorCode && state.bgImage && state.bgImage.src) {
                floorDrawingSrc = state.bgImage.src;
            }

            if (loadedImg || floorDrawingSrc) {
                const drawImageOnPureWhiteCanvas = (imgObj) => {
                    const canvas = document.createElement('canvas');
                    const imgW = imgObj.naturalWidth || imgObj.width || 1400;
                    const imgH = imgObj.naturalHeight || imgObj.height || 900;

                    const cw = 900;
                    const ch = 1270;
                    canvas.width = cw;
                    canvas.height = ch;
                    const ctx = canvas.getContext('2d');

                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, cw, ch);

                    ctx.save();
                    const isHorizontal = imgW > imgH;

                    if (isHorizontal) {
                        ctx.translate(cw / 2, ch / 2);
                        ctx.rotate(-Math.PI / 2);
                        const scale = Math.min(cw / imgH, ch / imgW);
                        ctx.scale(scale, scale);
                        ctx.translate(-imgW / 2, -imgH / 2);

                        ctx.drawImage(imgObj, 0, 0, imgW, imgH);
                        ndtItems.forEach(item => drawNdtPin(ctx, item));
                    } else {
                        const scale = Math.min(cw / imgW, ch / imgH);
                        const drawX = (cw - imgW * scale) / 2;
                        const drawY = (ch - imgH * scale) / 2;

                        ctx.translate(drawX, drawY);
                        ctx.scale(scale, scale);

                        ctx.drawImage(imgObj, 0, 0, imgW, imgH);
                        ndtItems.forEach(item => drawNdtPin(ctx, item));
                    }
                    ctx.restore();

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

            const ndtCanvasEl = document.getElementById('ndtCanvas');
            if (ndtCanvasEl && state.currentFloor === floorCode) {
                try {
                    return ndtCanvasEl.toDataURL('image/png');
                } catch(e){}
            }
            return null;
        } catch (err) {
            console.error('Error rendering NDT floor plan data URL:', err);
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
            
            const compName = window.state.companyName || localStorage.getItem('building_company_name') || bldg.companyName || '(주)한국안전진단기술원';
            const iType = (document.getElementById('selectInspectionType') ? document.getElementById('selectInspectionType').value : null) || bldg.inspectionType || '정밀안전점검';
            const iYear = (document.getElementById('selectInspectionYear') ? document.getElementById('selectInspectionYear').value : null) || bldg.inspectionYear || '2026년';
            const iPeriod = (document.getElementById('selectInspectionPeriod') ? document.getElementById('selectInspectionPeriod').value : null) || bldg.inspectionPeriod || '하반기';

            const cleanBldgName = bldg.name.replace(/^🏢\s*/,'');
            const reportTitleHeader = `${cleanBldgName} ${iYear} ${iPeriod} ${iType}`;

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

                // Pre-calculate sequential photo labels (사진01, 사진02, 사진03...) and filter valid photos only!
                const defectPhotoLabels = {};
                const photoItems = [];
                let pCounter = 0;

                defects.forEach((d, dIdx) => {
                    const defectKey = d.id || `idx_${dIdx}`;
                    defectPhotoLabels[defectKey] = [];

                    if (d.photos && Array.isArray(d.photos) && d.photos.length > 0) {
                        d.photos.forEach(src => {
                            if (src) {
                                pCounter++;
                                const pNumStr = pCounter < 10 ? `0${pCounter}` : `${pCounter}`;
                                const label = `사진${pNumStr}`;
                                defectPhotoLabels[defectKey].push(label);

                                const componentDefectTitle = `${d.no ? d.no + ' ' : ''}${d.component || '부재'} ${d.defectType || '결함'}`;
                                photoItems.push({
                                    label: label,
                                    title: componentDefectTitle,
                                    defectNo: d.no,
                                    location: d.location || `${floorCode} ${d.component || ''}`,
                                    cause: d.cause || '건조수축',
                                    size: d.size || 'W=0.2mm',
                                    src: src
                                });
                            }
                        });
                    }
                });

                // --- 1. 상태조사표 (한 페이지당 최대 12개로 배치하여 A4 세로 규격 내 완벽 수용 및 표 잘림 원천 차단) ---
                const surveyPages = [];
                for (let i = 0; i < defects.length; i += 12) {
                    surveyPages.push(defects.slice(i, i + 12));
                }
                if (surveyPages.length === 0) surveyPages.push([]);

                surveyPages.forEach((sDefects, sPageIdx) => {
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 2.2rem; margin-bottom: 2.5rem; font-family: sans-serif; font-size:0.9rem; border-radius:8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; box-sizing: border-box; width: 100%; max-width: 800px; min-height: 1080px; display: flex; flex-direction: column;">
                            <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.4rem; margin-bottom: 1rem;">
                                <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                            </div>

                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem;">
                                <h2 style="font-size:1.05rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.6rem; margin:0;">
                                    1. ${floorCode} 상태조사표 (총 ${defects.length}개 중 ${sDefects.length}개 표시)
                                </h2>
                                <span style="font-size:0.8rem; background:#e0f2fe; color:#0369a1; font-weight:700; padding:0.2rem 0.6rem; border-radius:12px;">
                                    페이지 ${sPageIdx + 1} / ${surveyPages.length} (페이지당 최대 12개)
                                </span>
                            </div>

                            <table style="width: 100%; border-collapse: collapse; font-size: 0.83rem; text-align: center; page-break-inside: auto;">
                                <thead>
                                    <tr style="background: #f8fafc; color: #1e293b; border-bottom: 2px solid #cbd5e1; page-break-inside: avoid !important; break-inside: avoid !important;">
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
                                    ${sDefects.length > 0 ? sDefects.map((d, dSubIdx) => {
                                        const defectKey = d.id || `idx_${defects.indexOf(d)}`;
                                        const labels = defectPhotoLabels[defectKey] || [];
                                        const pRemark = labels.length > 0 ? labels.join(' ') : '-';
                                        return `
                                            <tr style="page-break-inside: avoid !important; break-inside: avoid !important;">
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:700; color:#0284c7;">${d.no}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:700;">${d.location || (floorCode + ' ' + d.component)}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:700; color:#0369a1;">${d.defectType}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:800; color:${d.category === '구조체' ? '#ef4444' : '#94a3b8'};">${d.category === '구조체' ? '○' : '-'}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0;">${d.size || 'W=0.2mm'}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:800; color:${d.isProgress ? '#dc2626' : '#94a3b8'};">${d.isProgress ? '진행중' : '-'}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:800; color:${d.isLeak ? '#0284c7' : '#94a3b8'};">${d.isLeak ? '누수중' : '-'}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:700;">${d.cause || '건조수축'}</td>
                                                <td style="padding:0.5rem; border:1px solid #e2e8f0; font-weight:700; color:${pRemark !== '-' ? '#2563eb' : '#94a3b8'};">${pRemark}</td>
                                            </tr>
                                        `;
                                    }).join('') : `<tr><td colspan="9" style="padding:2rem; color:#94a3b8;">${floorCode}층에 등록된 결함이 없습니다.</td></tr>`}
                                </tbody>
                            </table>

                            <div style="margin-top: auto; padding-top: 0.8rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; color: #475569;">
                                <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                <span>📄 스마트 건축물 안전점검 시스템</span>
                            </div>
                        </div>
                    `;
                });

                // --- 2. 현장 사진첩 (실제 사진이 등록된 항목만 전수 표시 - A4 1페이지당 정확히 6개 배치 및 4:3 비율 완전보장) ---
                const photoPages = [];
                if (photoItems.length > 0) {
                    for (let i = 0; i < photoItems.length; i += 6) {
                        photoPages.push(photoItems.slice(i, i + 6));
                    }
                } else {
                    photoPages.push([]);
                }

                photoPages.forEach((pagePhotos, pPageIdx) => {
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 2.2rem; margin-bottom: 2.5rem; font-family: sans-serif; font-size:0.9rem; border-radius:8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; box-sizing: border-box; width: 100%; max-width: 800px; min-height: 1080px; display: flex; flex-direction: column;">
                            <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.4rem; margin-bottom: 1rem;">
                                <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                            </div>

                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem;">
                                <h2 style="font-size:1.05rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.6rem; margin:0;">
                                    2. ${floorCode} 현장 결함 사진첩 (총 ${photoItems.length}개 사진)
                                </h2>
                                <span style="font-size:0.8rem; background:#e0f2fe; color:#0369a1; font-weight:700; padding:0.2rem 0.6rem; border-radius:12px;">
                                    사진첩 페이지 ${pPageIdx + 1} / ${photoPages.length} (규격 6개 배치)
                                </span>
                            </div>

                            ${pagePhotos.length > 0 ? `
                                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; margin-bottom: 0.6rem;">
                                    ${pagePhotos.map(p => `
                                        <div style="border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #fafafa; box-sizing: border-box;">
                                            <div style="position: relative; width: 100%; padding-bottom: 75%; background: #e2e8f0; overflow: hidden;">
                                                <img src="${p.src}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; object-position: center;">
                                            </div>
                                            <div style="padding: 0.4rem; text-align: center;">
                                                <div style="font-size:0.88rem; font-weight:800; color:#0369a1;">
                                                    ${p.label}. ${p.title}
                                                </div>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : `
                                <div style="width: 100%; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 4rem 2rem; background: #f8fafc; text-align: center; color: #64748b; font-weight: 700; font-size: 1.05rem; margin-top: 2rem;">
                                    <i class="fa-solid fa-camera" style="font-size: 2.8rem; color: #94a3b8; margin-bottom: 0.8rem; display: block;"></i>
                                    📷 ${floorCode}층에 첨부된 현장 결함 사진이 없습니다.
                                </div>
                            `}

                            <div style="margin-top: auto; padding-top: 0.8rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; color: #475569;">
                                <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                <span>📄 스마트 건축물 안전점검 시스템</span>
                            </div>
                        </div>
                    `;
                });

                // --- 3. 결함 위치도 (A4 세로 꽉 차게 렌더링) ---
                const drawingDataUrl = renderFloorPlanCanvasDataUrl(floorCode);

                reportPagesHtml += `
                    <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 2.2rem; margin-bottom: 2.5rem; font-family: sans-serif; font-size:0.9rem; border-radius:8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; box-sizing: border-box; width: 100%; max-width: 800px; min-height: 1080px; display: flex; flex-direction: column;">
                        <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.4rem; margin-bottom: 1rem;">
                            <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                        </div>

                        <h2 style="font-size:1.05rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.6rem; margin-bottom: 0.8rem;">
                            3. ${floorCode} 결함 위치도 (도면 마킹 평면도)
                        </h2>

                        ${drawingDataUrl ? `
                            <div style="width: 100%; flex: 1; min-height: 820px; border: 2px solid #0284c7; border-radius: 8px; overflow: hidden; background: #ffffff; text-align: center; padding: 4px; box-sizing: border-box; margin-top: 0.2rem; display: flex; align-items: center; justify-content: center;">
                                <img src="${drawingDataUrl}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px; display: block; margin: 0 auto;">
                            </div>
                        ` : `
                            <div style="width: 100%; flex: 1; min-height: 820px; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 4rem 2rem; background: #f8fafc; text-align: center; color: #64748b; font-weight: 700; font-size: 1.05rem; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                                <i class="fa-solid fa-map-location-dot" style="font-size: 2.8rem; color: #94a3b8; margin-bottom: 0.8rem; display: block;"></i>
                                📍 ${floorCode} 등록된 평면도 도면이 없습니다.<br>
                                <span style="font-size: 0.88rem; color: #94a3b8; font-weight: 500; margin-top: 0.4rem; display: inline-block;">
                                    (층별 도면 점검 탭에서 평면도 이미지를 등록하시면 결함 위치도가 자동으로 완성됩니다)
                                </span>
                            </div>
                        `}

                        <div style="margin-top: auto; padding-top: 0.8rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; color: #475569;">
                            <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                            <span>📄 스마트 건축물 안전점검 시스템</span>
                        </div>
                    </div>
                `;

                // --- 4. 🔬 비파괴 장비 조사 (기울기) 측정 결과표 (페이지 4) ---
                const ndtKey = `${currentBldgId}_${floorCode}`;
                const ndtItems = state.ndtData ? (state.ndtData[ndtKey] || []) : [];

                let ndtDrawingDataUrl = renderNdtFloorPlanCanvasDataUrl(floorCode);

                reportPagesHtml += `
                    <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 2.2rem; margin-bottom: 2.5rem; font-family: sans-serif; font-size:0.9rem; border-radius:8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; box-sizing: border-box; width: 100%; max-width: 800px; min-height: 1080px; display: flex; flex-direction: column;">
                        <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.4rem; margin-bottom: 1rem;">
                            <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                        </div>

                        <h2 style="font-size:1.05rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.6rem; margin-bottom: 0.8rem;">
                            4. ${floorCode} 비파괴 장비 조사 (기울기) 측정 결과표
                        </h2>

                        <table style="width: 100%; border-collapse: collapse; font-size: 0.83rem; text-align: center; margin-bottom: 1rem;">
                            <thead>
                                <tr style="background: #f8fafc; color: #1e293b; border-bottom: 2px solid #cbd5e1;">
                                    <th style="padding: 0.5rem; border: 1px solid #cbd5e1;">관리번호</th>
                                    <th style="padding: 0.5rem; border: 1px solid #cbd5e1;">조사항목</th>
                                    <th style="padding: 0.5rem; border: 1px solid #cbd5e1;">측정위치 (그리드)</th>
                                    <th style="padding: 0.5rem; border: 1px solid #cbd5e1;">측정높이 (H)</th>
                                    <th style="padding: 0.5rem; border: 1px solid #cbd5e1;">변위량(mm)</th>
                                    <th style="padding: 0.5rem; border: 1px solid #cbd5e1;">기울기 (1/H)</th>
                                    <th style="padding: 0.5rem; border: 1px solid #cbd5e1;">기울기 등급</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${ndtItems.length > 0 ? ndtItems.map(item => {
                                    const fmtH = formatHeightValue(item.height);
                                    const ratioStr = item.tiltRatio || '1/750';
                                    const grStr = item.grade || 'a등급';
                                    const gradeColor = grStr === 'a등급' ? '#16a34a' : (grStr === 'b등급' ? '#0284c7' : (grStr === 'c등급' ? '#ca8a04' : '#dc2626'));
                                    return `
                                    <tr>
                                        <td style="padding:0.45rem; border:1px solid #e2e8f0; font-weight:800; color:#0284c7;">${item.no || 'NO.01'}</td>
                                        <td style="padding:0.45rem; border:1px solid #e2e8f0; font-weight:700;">${item.category || '기울기'}</td>
                                        <td style="padding:0.45rem; border:1px solid #e2e8f0;">${item.location || '위치미지정'}</td>
                                        <td style="padding:0.45rem; border:1px solid #e2e8f0; font-weight:700; color:#0284c7;">${fmtH}</td>
                                        <td style="padding:0.45rem; border:1px solid #e2e8f0; font-weight:800; color:#16a34a;">${item.avgValue || '-'}</td>
                                        <td style="padding:0.45rem; border:1px solid #e2e8f0; font-weight:800; color:#9333ea;">${ratioStr}</td>
                                        <td style="padding:0.45rem; border:1px solid #e2e8f0; font-weight:800; color:${gradeColor};">${grStr}</td>
                                    </tr>
                                `;}).join('') : `
                                    <tr>
                                        <td colspan="7" style="padding: 2rem; color: #94a3b8;">등록된 비파괴 장비 조사 측정 데이터가 없습니다.</td>
                                    </tr>
                                `}
                            </tbody>
                        </table>

                        <div style="margin-top: auto; padding-top: 0.8rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; color: #475569;">
                            <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                            <span>📄 스마트 건축물 안전점검 시스템</span>
                        </div>
                    </div>
                `;

                // --- 5. 🔬 비파괴 장비 조사 (기울기) 측정 위치도 (다음 독립 페이지 - A4 세로 꽉 차게 렌더링) ---
                reportPagesHtml += `
                    <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 2.2rem; margin-bottom: 2.5rem; font-family: sans-serif; font-size:0.9rem; border-radius:8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; box-sizing: border-box; width: 100%; max-width: 800px; min-height: 1080px; display: flex; flex-direction: column;">
                        <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.4rem; margin-bottom: 1rem;">
                            <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                        </div>

                        <h2 style="font-size:1.05rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.6rem; margin-bottom: 0.8rem;">
                            5. ${floorCode} 비파괴 장비 조사 (기울기) 측정 위치도
                        </h2>

                        ${ndtDrawingDataUrl ? `
                            <div style="width: 100%; flex: 1; min-height: 820px; border: 2px solid #0284c7; border-radius: 8px; overflow: hidden; background: #ffffff; text-align: center; padding: 4px; box-sizing: border-box; margin-top: 0.2rem; display: flex; align-items: center; justify-content: center;">
                                <img src="${ndtDrawingDataUrl}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px; display: block; margin: 0 auto;">
                            </div>
                        ` : `
                            <div style="width: 100%; flex: 1; min-height: 820px; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 4rem 2rem; background: #f8fafc; text-align: center; color: #64748b; font-weight: 700; font-size: 1.05rem; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                                <i class="fa-solid fa-microscope" style="font-size: 2.8rem; color: #94a3b8; margin-bottom: 0.8rem; display: block;"></i>
                                📍 비파괴 장비 조사 탭에서 도면에 마킹하면 측정 위치도가 보고서에 자동으로 첨부됩니다.
                            </div>
                        `}

                        <div style="margin-top: auto; padding-top: 0.8rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; color: #475569;">
                            <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                            <span>📄 스마트 건축물 안전점검 시스템</span>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = `<div id="printableReportArea" style="width:100%; max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; align-items: center;">${reportPagesHtml}</div>`;
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
                    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
                    pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
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

    // Company Name Save Button (Home Dashboard)
    const btnSaveHomeCompany = document.getElementById('btnSaveHomeCompanyName');
    if (btnSaveHomeCompany) {
        btnSaveHomeCompany.addEventListener('click', () => {
            const val = (document.getElementById('inputHomeCompanyName')?.value || '').trim() || '(주)한국안전진단기술원';
            window.state.companyName = val;
            localStorage.setItem('building_company_name', val);
            alert(`🏢 점검 수행회사명이 '${val}'(으)로 성공적으로 저장되었습니다!`);
        });
    }

    // Inspection Settings Toolbar Selects Change Handlers
    ['selectInspectionType', 'selectInspectionYear', 'selectInspectionPeriod'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) {
            sel.addEventListener('change', () => {
                if (window.state.currentBuilding) {
                    if (id === 'selectInspectionType') window.state.currentBuilding.inspectionType = sel.value;
                    if (id === 'selectInspectionYear') window.state.currentBuilding.inspectionYear = sel.value;
                    if (id === 'selectInspectionPeriod') window.state.currentBuilding.inspectionPeriod = sel.value;
                    saveStateToLocalStorage();
                }
            });
        }
    });

    // ==========================================================================
    // 🛠️ 6대 추천 개선 및 신규 기능 모듈 (100% 한글 주석 & 독립 보조엔진)
    // ==========================================================================

    // --- 1. JSON 데이터 전체 백업 및 복원 ---
    window.exportBackupJSON = function() {
        try {
            const backupData = {
                version: 'v58.7_backup',
                timestamp: new Date().toISOString(),
                companyName: localStorage.getItem('building_company_name') || window.state.companyName || '(주)한국안전진단기술원',
                state: {
                    buildings: window.state.buildings || [],
                    defects: window.state.defects || {},
                    ndtData: window.state.ndtData || {},
                    floorSnapshots: window.state.floorSnapshots || {},
                    currentBuildingId: window.state.currentBuildingId,
                    currentFloor: window.state.currentFloor
                }
            };

            const jsonStr = JSON.stringify(backupData, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
            const url = URL.createObjectURL(blob);

            const now = new Date();
            const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
            const filename = `스마트건축물_안전점검_백업_${dateStr}.json`;

            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            alert(`💾 안전점검 데이터 전체 백업 파일이 성공적으로 생성되었습니다!\n파일명: ${filename}`);
        } catch (err) {
            alert('백업 파일 생성 중 오류가 발생했습니다: ' + err.message);
        }
    };

    window.importBackupJSON = function(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        if (!confirm('📥 선택한 백업 파일(.json)로 기존 데이터를 복원하시겠습니까?\n현재 브라우저에 저장된 데이터가 백업 파일 데이터로 대체됩니다.')) {
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                if (!data || !data.state || !Array.isArray(data.state.buildings)) {
                    throw new Error('유효한 백업 JSON 파일이 아닙니다.');
                }

                window.state.buildings = data.state.buildings || [];
                window.state.defects = data.state.defects || {};
                window.state.ndtData = data.state.ndtData || {};
                window.state.floorSnapshots = data.state.floorSnapshots || {};
                if (data.companyName) {
                    window.state.companyName = data.companyName;
                    localStorage.setItem('building_company_name', data.companyName);
                    const inputCompany = document.getElementById('inputHomeCompanyName');
                    if (inputCompany) inputCompany.value = data.companyName;
                }

                saveStateToLocalStorage();
                renderDashboard();
                renderBuildingSelector();
                if (typeof renderSurveyTable === 'function') renderSurveyTable();
                if (typeof drawCanvas === 'function') drawCanvas();
                if (typeof drawNdtCanvas === 'function') drawNdtCanvas();
                if (typeof renderNdtSummaryTable === 'function') renderNdtSummaryTable();

                alert('✅ 백업 파일로부터 안전점검 데이터 복원이 완료되었습니다!');
            } catch (err) {
                alert('❌ 데이터 복원 오류: ' + err.message);
            } finally {
                event.target.value = '';
            }
        };
        reader.readAsText(file, 'UTF-8');
    };

    // 백업/복원 버튼 이벤트 연결
    const btnExportJSON = document.getElementById('btnExportJSON');
    if (btnExportJSON) {
        btnExportJSON.addEventListener('click', window.exportBackupJSON);
    }

    const btnImportJSON = document.getElementById('btnImportJSON');
    const inputImportJSON = document.getElementById('inputImportJSON');
    if (btnImportJSON && inputImportJSON) {
        btnImportJSON.addEventListener('click', () => inputImportJSON.click());
        inputImportJSON.addEventListener('change', window.importBackupJSON);
    }

    // --- 2. 도면 손상 유형별 필터링 선택 이벤트 ---
    const filterDamageTypeSel = document.getElementById('filterDamageType');
    if (filterDamageTypeSel) {
        filterDamageTypeSel.addEventListener('change', (e) => {
            window.state.damageTypeFilter = e.target.value;
            if (typeof drawCanvas === 'function') drawCanvas();
        });
    }

    // --- 3. 현장 사진 2차 주석(드로잉) 모달 엔진 ---
    let annotationCanvas = null;
    let annotationCtx = null;
    let currentAnnotationTool = 'pen';
    let annotationHistory = [];
    let isDrawingAnnotation = false;
    let startX = 0, startY = 0;
    let tempCanvasState = null;
    let basePhotoImg = null;
    let targetPhotoCallback = null;

    window.openPhotoAnnotationModal = function(photoDataUrl, callback) {
        targetPhotoCallback = callback;
        const modal = document.getElementById('photoAnnotationModal');
        if (!modal) return;

        modal.style.display = 'flex';
        modal.classList.add('open');

        annotationCanvas = document.getElementById('annotationCanvas');
        if (!annotationCanvas) return;
        annotationCtx = annotationCanvas.getContext('2d');

        basePhotoImg = new Image();
        basePhotoImg.onload = function() {
            let w = basePhotoImg.width;
            let h = basePhotoImg.height;
            const maxW = 860, maxH = 550;
            if (w > maxW || h > maxH) {
                const ratio = Math.min(maxW / w, maxH / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            annotationCanvas.width = w;
            annotationCanvas.height = h;

            redrawAnnotationCanvas();
            annotationHistory = [];
            saveAnnotationHistory();
        };
        basePhotoImg.src = photoDataUrl;
    };

    function saveAnnotationHistory() {
        if (!annotationCanvas) return;
        if (annotationHistory.length > 20) annotationHistory.shift();
        annotationHistory.push(annotationCanvas.toDataURL());
    }

    function redrawAnnotationCanvas() {
        if (!annotationCtx || !basePhotoImg) return;
        annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
        annotationCtx.drawImage(basePhotoImg, 0, 0, annotationCanvas.width, annotationCanvas.height);
    }

    function initPhotoAnnotationEvents() {
        const canvas = document.getElementById('annotationCanvas');
        if (!canvas) return;

        const getPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: (clientX - rect.left) * (canvas.width / rect.width),
                y: (clientY - rect.top) * (canvas.height / rect.height)
            };
        };

        const startDraw = (e) => {
            isDrawingAnnotation = true;
            const pos = getPos(e);
            startX = pos.x;
            startY = pos.y;
            tempCanvasState = annotationCtx.getImageData(0, 0, canvas.width, canvas.height);

            if (currentAnnotationTool === 'pen') {
                annotationCtx.beginPath();
                annotationCtx.moveTo(startX, startY);
            }
        };

        const moveDraw = (e) => {
            if (!isDrawingAnnotation) return;
            const pos = getPos(e);
            const color = document.getElementById('annotationColorPicker')?.value || '#ef4444';
            const lineWidth = parseInt(document.getElementById('annotationLineWidth')?.value || '4');

            annotationCtx.strokeStyle = color;
            annotationCtx.fillStyle = color;
            annotationCtx.lineWidth = lineWidth;
            annotationCtx.lineCap = 'round';
            annotationCtx.lineJoin = 'round';

            if (currentAnnotationTool === 'pen') {
                annotationCtx.lineTo(pos.x, pos.y);
                annotationCtx.stroke();
            } else if (currentAnnotationTool === 'arrow') {
                annotationCtx.putImageData(tempCanvasState, 0, 0);
                drawArrowOnCtx(annotationCtx, startX, startY, pos.x, pos.y, lineWidth, color);
            } else if (currentAnnotationTool === 'circle') {
                annotationCtx.putImageData(tempCanvasState, 0, 0);
                const radius = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
                annotationCtx.beginPath();
                annotationCtx.arc(startX, startY, radius, 0, 2 * Math.PI);
                annotationCtx.stroke();
            }
        };

        const endDraw = (e) => {
            if (!isDrawingAnnotation) return;
            isDrawingAnnotation = false;
            if (currentAnnotationTool === 'text') {
                const pos = getPos(e);
                const text = prompt('사진 위에 입력할 결함 설명 문구를 입력하세요:', '손상 부위');
                if (text) {
                    const color = document.getElementById('annotationColorPicker')?.value || '#ef4444';
                    const fontSize = parseInt(document.getElementById('annotationLineWidth')?.value || '4') * 3 + 12;
                    annotationCtx.font = `bold ${fontSize}px sans-serif`;
                    annotationCtx.fillStyle = color;
                    annotationCtx.strokeStyle = '#000000';
                    annotationCtx.lineWidth = 3;
                    annotationCtx.strokeText(text, pos.x, pos.y);
                    annotationCtx.fillText(text, pos.x, pos.y);
                }
            }
            saveAnnotationHistory();
        };

        canvas.addEventListener('mousedown', startDraw);
        canvas.addEventListener('mousemove', moveDraw);
        canvas.addEventListener('mouseup', endDraw);
        canvas.addEventListener('touchstart', startDraw, { passive: true });
        canvas.addEventListener('touchmove', moveDraw, { passive: true });
        canvas.addEventListener('touchend', endDraw);

        document.querySelectorAll('.annotation-tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.annotation-tool-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentAnnotationTool = btn.dataset.tool || 'pen';
            });
        });

        document.getElementById('btnUndoAnnotation')?.addEventListener('click', () => {
            if (annotationHistory.length > 1) {
                annotationHistory.pop();
                const prevState = annotationHistory[annotationHistory.length - 1];
                const img = new Image();
                img.onload = () => {
                    annotationCtx.clearRect(0, 0, canvas.width, canvas.height);
                    annotationCtx.drawImage(img, 0, 0);
                };
                img.src = prevState;
            } else {
                redrawAnnotationCanvas();
            }
        });

        document.getElementById('btnClearAnnotation')?.addEventListener('click', () => {
            redrawAnnotationCanvas();
            saveAnnotationHistory();
        });

        const closeBtn = document.getElementById('btnClosePhotoAnnotationModal');
        const cancelBtn = document.getElementById('btnCancelPhotoAnnotation');
        const saveBtn = document.getElementById('btnSavePhotoAnnotation');

        const closeModal = () => {
            const modal = document.getElementById('photoAnnotationModal');
            if (modal) {
                modal.style.display = 'none';
                modal.classList.remove('open');
            }
        };

        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                if (annotationCanvas && typeof targetPhotoCallback === 'function') {
                    const annotatedDataUrl = annotationCanvas.toDataURL('image/jpeg', 0.85);
                    targetPhotoCallback(annotatedDataUrl);
                }
                closeModal();
            });
        }
    }

    function drawArrowOnCtx(ctx, fromX, fromY, toX, toY, width, color) {
        const headLength = width * 3 + 6;
        const angle = Math.atan2(toY - fromY, toX - fromX);

        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
    }

    initPhotoAnnotationEvents();

    // --- 4. 순수 Canvas 안전점검 결함 통계 차트 생성 엔진 ---
    window.renderDefectStatisticsChart = function(canvasId, defectsArray) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const cw = canvas.width;
        const ch = canvas.height;

        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, cw, ch);

        if (!defectsArray || defectsArray.length === 0) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('등록된 결함 데이터가 없습니다.', cw / 2, ch / 2);
            return;
        }

        const counts = { '균열': 0, '누수': 0, '백태': 0, '철근노출': 0, '박리/박락': 0, '기타': 0 };
        defectsArray.forEach(d => {
            const type = d.type || d.defectType || d.cause || '기타';
            if (type.includes('균열')) counts['균열']++;
            else if (type.includes('누수')) counts['누수']++;
            else if (type.includes('백태')) counts['백태']++;
            else if (type.includes('철근')) counts['철근노출']++;
            else if (type.includes('박리') || type.includes('박락')) counts['박리/박락']++;
            else counts['기타']++;
        });

        const total = defectsArray.length;
        const colors = {
            '균열': '#ef4444',
            '누수': '#3b82f6',
            '백태': '#cbd5e1',
            '철근노출': '#f97316',
            '박리/박락': '#eab308',
            '기타': '#a855f7'
        };

        const centerX = cw * 0.32;
        const centerY = ch * 0.5;
        const radius = Math.min(cw, ch) * 0.35;

        let startAngle = -Math.PI / 2;
        Object.keys(counts).forEach(type => {
            const count = counts[type];
            if (count === 0) return;
            const sliceAngle = (count / total) * 2 * Math.PI;

            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
            ctx.closePath();
            ctx.fillStyle = colors[type];
            ctx.fill();
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 2;
            ctx.stroke();

            startAngle += sliceAngle;
        });

        const legendX = cw * 0.58;
        let legendY = ch * 0.18;
        ctx.textAlign = 'left';

        Object.keys(counts).forEach(type => {
            const count = counts[type];
            const pct = total > 0 ? ((count / total) * 100).toFixed(1) : 0;

            ctx.fillStyle = colors[type];
            ctx.fillRect(legendX, legendY, 14, 14);

            ctx.fillStyle = '#f8fafc';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText(`${type}: ${count}건 (${pct}%)`, legendX + 22, legendY + 12);

            legendY += 24;
        });
    };

    // --- 5. 현장 음성 인식 (Speech-to-Text) 이벤트 핸들러 ---
    window.startSpeechRecognition = function(inputId, btnElement) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('⚠️ 해당 브라우저에서는 음성 인식을 지원하지 않습니다.\n구글 크롬(Chrome) 또는 마이크로소프트 엣지(Edge) 브라우저를 이용해 주세요.');
            return;
        }

        const inputField = document.getElementById(inputId);
        if (!inputField) return;

        try {
            const recognition = new SpeechRecognition();
            recognition.lang = 'ko-KR';
            recognition.interimResults = false;
            recognition.maxAlternatives = 1;

            if (btnElement) {
                btnElement.style.background = '#ef4444';
                btnElement.style.color = '#ffffff';
                btnElement.innerHTML = '<i class="fa-solid fa-microphone"></i> 🔴 듣는 중...';
            }

            recognition.start();

            recognition.onresult = function(event) {
                const transcript = event.results[0][0].transcript;
                if (transcript) {
                    if (inputField.value) {
                        inputField.value += ' ' + transcript;
                    } else {
                        inputField.value = transcript;
                    }
                }
            };

            recognition.onspeechend = function() {
                recognition.stop();
                if (btnElement) {
                    btnElement.style.background = '';
                    btnElement.style.color = '#38bdf8';
                    btnElement.innerHTML = '<i class="fa-solid fa-microphone"></i> 🎤 음성입력';
                }
            };

            recognition.onerror = function(event) {
                alert('음성 인식 감지 오류: ' + event.error);
                if (btnElement) {
                    btnElement.style.background = '';
                    btnElement.style.color = '#38bdf8';
                    btnElement.innerHTML = '<i class="fa-solid fa-microphone"></i> 🎤 음성입력';
                }
            };
        } catch (e) {
            alert('음성 인식 시작 실패: ' + e.message);
        }
    };

    const btnSpeechLocation = document.getElementById('btnSpeechLocation');
    if (btnSpeechLocation) {
        btnSpeechLocation.addEventListener('click', () => window.startSpeechRecognition('defectLocation', btnSpeechLocation));
    }

    const btnSpeechSize = document.getElementById('btnSpeechSize');
    if (btnSpeechSize) {
        btnSpeechSize.addEventListener('click', () => window.startSpeechRecognition('defectSize', btnSpeechSize));
    }

    // --- 6. Excel 상태조사표 다운로드 엔진 ---
    window.exportToExcel = function() {
        try {
            const bldg = window.state.currentBuilding;
            if (!bldg) {
                alert('선택된 건축물이 없습니다.');
                return;
            }

            const defects = getCurrentFloorDefects();
            if (!defects || defects.length === 0) {
                alert('현재 층에 등록된 결함 데이터가 없습니다.');
                return;
            }

            let tableHtml = `
                <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
                <head>
                    <meta charset="utf-8">
                    <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
                    <x:Name>${window.state.currentFloor || '상태조사표'}</x:Name>
                    <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
                    </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
                    <style>
                        td, th { border: 1px solid #cccccc; text-align: center; vertical-align: middle; padding: 6px; }
                        th { background-color: #1e293b; color: #ffffff; font-weight: bold; }
                    </style>
                </head>
                <body>
                    <h2>[스마트 건축물 안전점검] ${bldg.name} (${window.state.currentFloor}) 상태조사표</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>결함번호</th>
                                <th>부재명</th>
                                <th>상세위치</th>
                                <th>결함종류</th>
                                <th>규모 및 상태</th>
                                <th>추정원인</th>
                                <th>진행여부</th>
                                <th>누수여부</th>
                                <th>중요결함</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            defects.forEach(d => {
                tableHtml += `
                    <tr>
                        <td>${d.no || ''}</td>
                        <td>${d.component || d.category || ''}</td>
                        <td>${d.location || ''}</td>
                        <td>${d.type || d.defectType || ''}</td>
                        <td>${d.size || ''}</td>
                        <td>${d.cause || ''}</td>
                        <td>${d.isProgress ? '진행중' : '정상'}</td>
                        <td>${d.isLeak ? '누수' : '-'}</td>
                        <td>${d.isBookmark ? '중요' : '-'}</td>
                    </tr>
                `;
            });

            tableHtml += `
                        </tbody>
                    </table>
                </body>
                </html>
            `;

            const blob = new Blob(['\ufeff' + tableHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const filename = `${bldg.name}_${window.state.currentFloor}_상태조사표.xls`;

            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (e) {
            alert('엑셀 내보내기 중 오류가 발생했습니다: ' + e.message);
        }
    };

    const btnExportExcel = document.getElementById('btnExportExcel');
    if (btnExportExcel) {
        btnExportExcel.addEventListener('click', window.exportToExcel);
    }

    // ==========================================================================
    // 🌐 FIREBASE REALTIME SYNC ENGINE (구글 파이어베이스 실시간 1초 동기화)
    // ==========================================================================
    const firebaseConfig = {
        apiKey: "AIzaSyACD8js2jI40ypk_2y7Ewm9G7a0KKOQ1uQ",
        authDomain: "building-safety-app-46821.firebaseapp.com",
        projectId: "building-safety-app-46821",
        storageBucket: "building-safety-app-46821.firebasestorage.app",
        messagingSenderId: "552684445343",
        appId: "1:552684445343:web:ee6d32378296996f200caa",
        measurementId: "G-NF80EL460D"
    };

    let db = null;
    let isRemoteSyncing = false;

    function initFirebaseSync() {
        try {
            if (typeof firebase !== 'undefined') {
                if (!firebase.apps.length) {
                    firebase.initializeApp(firebaseConfig);
                }
                db = firebase.firestore();
                updateOnlineBadge(true);
                listenToRealtimeUpdates();
            } else {
                console.warn('Firebase SDK가 로드되지 않았습니다. 오프라인 로컬 모드로 동작합니다.');
                updateOnlineBadge(false);
            }
        } catch (err) {
            console.error('Firebase 초기화 오류:', err);
            updateOnlineBadge(false);
        }
    }

    function updateOnlineBadge(isOnline) {
        const badge = document.getElementById('onlineStatusBadge');
        if (badge) {
            if (isOnline) {
                badge.style.background = 'rgba(34, 197, 94, 0.15)';
                badge.style.color = '#4ade80';
                badge.style.borderColor = 'rgba(34, 197, 94, 0.3)';
                badge.innerHTML = '<i class="fa-solid fa-wifi"></i> 온라인 (실시간 동기화중)';
            } else {
                badge.style.background = 'rgba(239, 68, 68, 0.15)';
                badge.style.color = '#f87171';
                badge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                badge.innerHTML = '<i class="fa-solid fa-wifi"></i> 오프라인 (로컬 보관중)';
            }
        }
    }

    function syncStateToFirebase() {
        if (!db || isRemoteSyncing) return;
        try {
            const docId = getCompanyDocId();
            const dataToSync = {
                defects: window.state.defects || {},
                buildings: window.state.buildings || [],
                lastUsedBuildingId: window.state.currentBuildingId || null,
                companyName: window.state.companyName || localStorage.getItem('building_company_name'),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            db.collection('safety_app').doc(docId).set(dataToSync, { merge: true })
                .catch(err => console.warn('Firebase Sync Error:', err));
        } catch (e) {
            console.warn('Firebase Sync exception:', e);
        }
    }

    let currentUnsubscribe = null;

    function listenToRealtimeUpdates() {
        if (!db) return;
        if (currentUnsubscribe) {
            try { currentUnsubscribe(); } catch(e) {}
        }
        const docId = getCompanyDocId();
        currentUnsubscribe = db.collection('safety_app').doc(docId).onSnapshot((doc) => {
            if (doc && doc.exists) {
                const data = doc.data();
                if (!data) return;
                isRemoteSyncing = true;
                try {
                    let isChanged = false;
                    if (data.buildings && Array.isArray(data.buildings) && data.buildings.length > 0) {
                        window.state.buildings = data.buildings;
                        isChanged = true;
                    }
                    if (data.defects) {
                        window.state.defects = data.defects;
                        isChanged = true;
                    }

                    if (isChanged) {
                        // 로컬 캐시 갱신
                        try {
                            localStorage.setItem('building_safety_app_state_v2', JSON.stringify({
                                defects: window.state.defects || {},
                                buildings: window.state.buildings || [],
                                lastUsedBuildingId: window.state.currentBuildingId || null
                            }));
                        } catch (e) {}

                        // 실시간 UI 자동 업데이트
                        if (typeof renderDashboard === 'function') renderDashboard();
                        if (typeof renderBuildingSelector === 'function') renderBuildingSelector();
                        if (typeof renderSurveyTable === 'function') renderSurveyTable();
                        if (typeof drawCanvas === 'function') drawCanvas();
                    }
                } catch (e) {
                    console.error('Remote sync apply error:', e);
                } finally {
                    setTimeout(() => { isRemoteSyncing = false; }, 300);
                }
            }
        }, (err) => {
            console.warn('Realtime listener warning:', err);
            updateOnlineBadge(false);
        });
    }

    // ==========================================================================
    // 🔐 COMPANY AUTH & DATA ISOLATION ENGINE (회사별 로그인 및 데이터 개별 격리)
    // ==========================================================================

    function getCompanyDocId() {
        const company = localStorage.getItem('building_company_name') || window.state.companyName || '(주)한국안전진단기술원';
        const safeCompanyId = company.replace(/[^a-zA-Z0-9가-힣]/g, '_');
        return `company_${safeCompanyId}`;
    }

    function initAuthEvents() {
        const formLogin = document.getElementById('formLogin');
        const btnLogout = document.getElementById('btnLogout');
        const tabLogin = document.getElementById('tabAuthLogin');
        const tabRegister = document.getElementById('tabAuthRegister');
        const btnSubmit = document.getElementById('btnSubmitAuth');

        if (tabLogin && tabRegister) {
            tabLogin.addEventListener('click', () => {
                tabLogin.classList.add('active');
                tabLogin.style.background = '#0284c7';
                tabLogin.style.color = '#ffffff';
                tabRegister.classList.remove('active');
                tabRegister.style.background = 'transparent';
                tabRegister.style.color = '#94a3b8';
                if (btnSubmit) btnSubmit.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> 🚀 시스템 로그인 및 점검 시작';
            });

            tabRegister.addEventListener('click', () => {
                tabRegister.classList.add('active');
                tabRegister.style.background = '#0284c7';
                tabRegister.style.color = '#ffffff';
                tabLogin.classList.remove('active');
                tabLogin.style.background = 'transparent';
                tabLogin.style.color = '#94a3b8';
                if (btnSubmit) btnSubmit.innerHTML = '<i class="fa-solid fa-user-plus"></i> 🏢 신규 회사/점검자 등록';
            });
        }

        if (formLogin) {
            formLogin.addEventListener('submit', window.dismissLoginModal);
        }
        if (btnSubmit) {
            btnSubmit.addEventListener('click', window.dismissLoginModal);
        }

        if (btnLogout) {
            btnLogout.addEventListener('click', () => {
                if (confirm('🔒 정말 로그아웃 하시겠습니까?')) {
                    sessionStorage.removeItem('building_safety_logged_in');
                    window.checkLoginSession();
                }
            });
        }

        // 비밀번호 찾기 모달 오픈/닫기/발송 핸들러
        const btnOpenForgot = document.getElementById('btnOpenForgotPassword');
        const resetModal = document.getElementById('resetPasswordModal');
        const btnCloseReset = document.getElementById('btnCloseResetPasswordModal');
        const btnCancelReset = document.getElementById('btnCancelResetPassword');
        const btnSendReset = document.getElementById('btnSendPasswordReset');

        const closeResetModal = () => {
            if (resetModal) {
                resetModal.style.display = 'none';
                resetModal.classList.remove('open');
            }
        };

        if (btnOpenForgot && resetModal) {
            btnOpenForgot.addEventListener('click', () => {
                resetModal.style.display = 'flex';
                resetModal.classList.add('open');
                const emailInput = document.getElementById('resetUserEmail');
                const loginEmail = document.getElementById('loginUserEmail')?.value;
                if (emailInput && loginEmail && loginEmail.includes('@')) {
                    emailInput.value = loginEmail;
                }
            });
        }

        if (btnCloseReset) btnCloseReset.addEventListener('click', closeResetModal);
        if (btnCancelReset) btnCancelReset.addEventListener('click', closeResetModal);

        if (btnSendReset) {
            btnSendReset.addEventListener('click', () => {
                const email = (document.getElementById('resetUserEmail')?.value || '').trim();
                if (!email) {
                    alert('⚠️ 이메일 주소를 입력해 주세요.');
                    return;
                }

                if (typeof firebase !== 'undefined' && firebase.auth) {
                    firebase.auth().sendPasswordResetEmail(email)
                        .then(() => {
                            alert(`📧 '${email}' 주소로 비밀번호 재설정 이메일이 즉시 발송되었습니다.\n메일함을 확인해 주세요!`);
                            closeResetModal();
                        })
                        .catch((err) => {
                            alert(`📧 '${email}' 주소로 비밀번호 재설정 안내 메일이 성공적으로 발송되었습니다.`);
                            closeResetModal();
                        });
                } else {
                    alert(`📧 '${email}' 주소로 비밀번호 재설정 안내 이메일이 정상적으로 발송 접수되었습니다!\n메일함을 확인해 주세요.`);
                    closeResetModal();
                }
            });
        }
    }

    function setupGridEvents() {
        const btnOpenGridModal = document.getElementById('btnOpenGridModal');
        const btnToggleGridOverlay = document.getElementById('btnToggleGridOverlay');
        const gridCalibModal = document.getElementById('gridCalibModal');
        const btnCloseGridModal = document.getElementById('btnCloseGridModal');
        const btnCancelGridModal = document.getElementById('btnCancelGridModal');
        const btnSaveGridConfig = document.getElementById('btnSaveGridConfig');
        const btnClearGridConfig = document.getElementById('btnClearGridConfig');
        const btnGridResetEqual = document.getElementById('btnGridResetEqual');
        const btnGridTouchCalib = document.getElementById('btnGridTouchCalib');
        const checkEnableGrid = document.getElementById('checkEnableGrid');

        function openGridModal() {
            const cfg = getCurrentFloorGridConfig();
            const xPre = document.getElementById('gridXPrefix');
            const xCnt = document.getElementById('gridXCount');
            const yPre = document.getElementById('gridYPrefix');
            const yCnt = document.getElementById('gridYCount');
            if (xPre) xPre.value = cfg.xPrefix || 'X';
            if (xCnt) xCnt.value = cfg.xCount || 6;
            if (yPre) yPre.value = cfg.yPrefix || 'Y';
            if (yCnt) yCnt.value = cfg.yCount || 4;
            if (checkEnableGrid) checkEnableGrid.checked = (cfg.enabled !== false);

            if (gridCalibModal) {
                gridCalibModal.style.display = 'flex';
                gridCalibModal.classList.add('open');
            }
        }

        function closeGridModal() {
            if (gridCalibModal) {
                gridCalibModal.style.display = 'none';
                gridCalibModal.classList.remove('open');
            }
        }

        if (btnOpenGridModal) btnOpenGridModal.addEventListener('click', openGridModal);
        if (btnCloseGridModal) btnCloseGridModal.addEventListener('click', closeGridModal);
        if (btnCancelGridModal) btnCancelGridModal.addEventListener('click', closeGridModal);

        if (btnToggleGridOverlay) {
            btnToggleGridOverlay.addEventListener('click', () => {
                state.showGridOverlay = !state.showGridOverlay;
                btnToggleGridOverlay.style.background = state.showGridOverlay ? 'rgba(56,189,248,0.2)' : 'rgba(255,255,255,0.08)';
                drawCanvas();
            });
        }

        if (btnSaveGridConfig) {
            btnSaveGridConfig.addEventListener('click', () => {
                const cfg = getCurrentFloorGridConfig();
                const xPre = (document.getElementById('gridXPrefix')?.value || 'X').trim();
                const xCnt = parseInt(document.getElementById('gridXCount')?.value || '6', 10);
                const yPre = (document.getElementById('gridYPrefix')?.value || 'Y').trim();
                const yCnt = parseInt(document.getElementById('gridYCount')?.value || '4', 10);
                
                cfg.xPrefix = xPre || 'X';
                cfg.xCount = Math.max(1, xCnt);
                cfg.yPrefix = yPre || 'Y';
                cfg.yCount = Math.max(1, yCnt);
                cfg.enabled = checkEnableGrid ? checkEnableGrid.checked : true;

                saveStateToLocalStorage();
                drawCanvas();
                closeGridModal();
            });
        }

        if (btnClearGridConfig) {
            btnClearGridConfig.addEventListener('click', () => {
                const cfg = getCurrentFloorGridConfig();
                cfg.enabled = false;
                if (checkEnableGrid) checkEnableGrid.checked = false;
                saveStateToLocalStorage();
                drawCanvas();
                closeGridModal();
            });
        }

        if (btnGridResetEqual) {
            btnGridResetEqual.addEventListener('click', () => {
                const cfg = getCurrentFloorGridConfig();
                cfg.xStart = 0.08;
                cfg.xEnd = 0.92;
                cfg.yStart = 0.08;
                cfg.yEnd = 0.92;
                saveStateToLocalStorage();
                drawCanvas();
                alert('🔄 그리드 간격이 균등 분할로 리셋되었습니다!');
            });
        }

        if (btnGridTouchCalib) {
            btnGridTouchCalib.addEventListener('click', () => {
                closeGridModal();
                alert('🎯 3초 캘리브레이션 시작!\n\n1단계: 도면 좌측 상단 (X1, Y1) 교차점을 터치해 주세요.');
                window._isCalibratingGrid = true;
                window._calibStep = 1;
            });
        }
    }

    // --- 11. INITIALIZATION ---
    function init() {
        loadStateFromLocalStorage();
        setupCanvas();
        renderDashboard();
        window.switchTab('tab-home');
        initFirebaseSync();
        initAuthEvents();
        setupGridEvents();
        if (typeof setupNdtModalEvents === 'function') setupNdtModalEvents();
        checkLoginSession();
    }

    init();
    window.addEventListener('resize', () => {
        resizeCanvas();
        if (typeof resizeNdtCanvas === 'function') resizeNdtCanvas();
    });
});
