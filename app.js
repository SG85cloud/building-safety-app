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
        grids: {},   // { 'bldg-id_1F': { enabled: true, xPrefix: 'X', xCount: 6, yPrefix: 'Y', yCount: 4, xStart: 0.08, xEnd: 0.92, yStart: 0.08, yEnd: 0.92 } } (구버전 백업 호환용, 더 이상 사용 안 함)
        view: { offsetX: 0, offsetY: 0, scale: 1.0 },
        mode: 'PAN', // 'PAN' | 'MARK'
        rotationAngle: 0,
        tipShape: 'arrow',  // 'arrow' | 'circle'
        styleColors: null, // 카테고리별 사용자 지정 색상 (미지정 시 DEFAULT_STYLE_COLORS 사용)
        styleSizes: null,  // 카테고리별 사용자 지정 핀/화살표 크기 (미지정 시 DEFAULT_STYLE_SIZES 사용)
        styleShapes: null, // 카테고리별 사용자 지정 박스 모양/채우기/번호형식 (미지정 시 DEFAULT_STYLE_SHAPES 사용)
        surveyColumns: null, // 상태조사표 컬럼 순서/이름 커스터마이징 (미지정 시 DEFAULT_SURVEY_COLUMNS 사용)
        defectSizeMode: 'combined', // 'combined' | 'split' - 결함크기(균열폭/균열길이) 표시 방식
        bgImage: null,
        canvas: null,
        ctx: null,
        floorSnapshots: {},
        // --- Auth / Company (승인제 로그인) ---
        uid: null,
        userName: null,
        companyId: null,
        companyName: null,
        companyJoinCode: null,
        role: null // 'admin' | 'member' | 'pending' | null
    };
}
window.appState = window.state;

// --- 2. IMAGE COMPRESSION & FLOOR PARSER HELPERS ---

// 사용자/외부 파일에서 온 문자열을 innerHTML에 넣기 전에 이스케이프 (HTML 인젝션 방지)
function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// pdf.js 워커 경로 설정 (CDN 스크립트가 로드된 경우에만)
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function isPdfFile(file) {
    return !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
}

// PDF 페이지를 지정 스케일로 캔버스에 렌더링 후 PNG dataURL로 변환
async function renderPdfPageToDataUrl(page, scale) {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    // PDF는 배경이 투명할 수 있어, 흰 배경을 먼저 채워 검게 나오는 것을 방지
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/png');
}

/**
 * 캐드(CAD)에서 내보낸 PDF 도면을 pdf.js로 첫 페이지 고해상도 렌더링 (벡터 원본 기반이라 글씨/선이 뭉개지지 않음)
 * Firestore 문서 용량(1MB) 여유를 위해 결과가 너무 크면 스케일을 낮춰 재시도
 */
window.renderPdfFileToImage = function(file, targetLongSide = 4200, maxDataUrlBytes = 950000) {
    return new Promise((resolve, reject) => {
        if (typeof pdfjsLib === 'undefined') {
            reject(new Error('PDF 렌더링 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'));
            return;
        }
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(e.target.result) }).promise;
                const page = await pdf.getPage(1);
                const baseViewport = page.getViewport({ scale: 1 });
                let scale = targetLongSide / Math.max(baseViewport.width, baseViewport.height);
                scale = Math.min(Math.max(scale, 1), 8); // 너무 작은 PDF는 과도확대, 너무 큰 PDF는 과도축소 방지

                let dataUrl = await renderPdfPageToDataUrl(page, scale);
                let attempts = 0;
                while (dataUrl && dataUrl.length > maxDataUrlBytes && attempts < 4) {
                    scale *= 0.75;
                    dataUrl = await renderPdfPageToDataUrl(page, scale);
                    attempts++;
                }
                resolve(dataUrl);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('PDF 파일을 읽는 중 오류가 발생했습니다.'));
        reader.readAsArrayBuffer(file);
    });
};

/**
 * HTML5 Canvas Image Compressor
 * Reduces 4K/8K drawing photos (5~20MB) to lightweight JPEG (~150KB)
 * PDF 파일이 들어오면 pdf.js로 고해상도 렌더링 (renderPdfFileToImage) 후 PNG로 반환
 */
window.compressDrawingImage = function(file, maxDim = 1400, quality = 0.8) {
    return new Promise((resolve) => {
        if (!file || !(file instanceof Blob)) {
            return resolve(null);
        }
        if (isPdfFile(file)) {
            window.renderPdfFileToImage(file)
                .then(resolve)
                .catch((err) => {
                    console.error('PDF 도면 렌더링 오류:', err);
                    if (typeof window.showToast === 'function') {
                        window.showToast(`'${file.name}' PDF 렌더링에 실패했습니다: ${err.message}`, 'error', 5000);
                    }
                    resolve(null);
                });
            return;
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

// 건축물 외부는 보통 동서남북 4장의 입면도로 나뉘므로, 파일명에 방향이 있으면
// 하나의 "건축물 외부"가 아니라 방향별로 별도 층(EXT_N/EXT_E/EXT_S/EXT_W)으로 인식한다.
// getFloorLabelFromCode/getFloorRankFromCode/parseFloorInfoFromFilename이 공통으로 사용.
window.EXT_DIRECTION_DEFS = [
    { code: 'EXT_N', label: '건축물 외부-북측 (EXT_N)', strongKeys: ['북측', '북면', '북쪽', 'NORTH'], soloChar: '북' },
    { code: 'EXT_E', label: '건축물 외부-동측 (EXT_E)', strongKeys: ['동측', '동면', '동쪽', 'EAST'], soloChar: '동' },
    { code: 'EXT_S', label: '건축물 외부-남측 (EXT_S)', strongKeys: ['남측', '남면', '남쪽', 'SOUTH'], soloChar: '남' },
    { code: 'EXT_W', label: '건축물 외부-서측 (EXT_W)', strongKeys: ['서측', '서면', '서쪽', 'WEST'], soloChar: '서' }
];

/**
 * Intelligent Floor Parser from File Names (e.g. B2.jpg -> 지하 2층)
 */
window.parseFloorInfoFromFilename = function(fileName) {
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
    const cleanName = nameWithoutExt.toUpperCase();

    // 옥상~옥탑(지붕)까지는 별도 층으로 나누지 않고 한 층("옥상/옥탑")으로 합쳐서 관리
    if (cleanName.includes('ROOF') || cleanName.includes('옥상') || cleanName.includes('옥탑') || cleanName.includes('PH')) {
        return { rank: 999, floorCode: 'ROOF', floorLabel: '옥상/옥탑 층 (ROOF)', matched: true };
    }

    if (cleanName.includes('외부') || cleanName.includes('외벽') || cleanName.includes('파사드') || cleanName.includes('입면') || cleanName.includes('FACADE') || cleanName.includes('ELEVATION') || cleanName.includes('EXTERIOR')) {
        // 방향이 뚜렷하게 적혀있으면(북측/NORTH 등) 그 방향 전용 층으로
        for (let i = 0; i < window.EXT_DIRECTION_DEFS.length; i++) {
            const d = window.EXT_DIRECTION_DEFS[i];
            if (d.strongKeys.some(k => cleanName.includes(k))) {
                return { rank: 1001 + i, floorCode: d.code, floorLabel: d.label, matched: true };
            }
        }
        // "외부_북.jpg"처럼 방위 한 글자만 있는 경우도 보조로 인식
        for (let i = 0; i < window.EXT_DIRECTION_DEFS.length; i++) {
            const d = window.EXT_DIRECTION_DEFS[i];
            if (cleanName.includes(d.soloChar)) {
                return { rank: 1001 + i, floorCode: d.code, floorLabel: d.label, matched: true };
            }
        }
        // 방향 표시가 없으면 통합 "건축물 외부" 한 층으로
        return { rank: 1000, floorCode: 'EXT', floorLabel: '건축물 외부 (EXT)', matched: true };
    }

    const bMatch = cleanName.match(/(?:B|지하)\s*([0-9]{1,2})(?![0-9])/i);
    if (bMatch) {
        const num = parseInt(bMatch[1], 10);
        if (num > 0 && num <= 99) {
            return { rank: -num, floorCode: `B${num}F`, floorLabel: `지하 ${num}층 (B${num}F)`, matched: true };
        }
    }

    // F/층/지상 접두·접미가 붙은 명확한 패턴만 "신뢰 가능한 인식"으로 처리
    const strongFMatch = cleanName.match(/(?:F|층|지상)\s*([0-9]{1,2})(?![0-9])/i) ||
                          cleanName.match(/([0-9]{1,2})\s*(?:F|층)(?![0-9])/i);
    if (strongFMatch) {
        const num = parseInt(strongFMatch[1], 10);
        if (num > 0 && num <= 99) {
            return { rank: num, floorCode: `${num}F`, floorLabel: `지상 ${num}층 (${num}F)`, matched: true };
        }
    }

    // 마지막 수단: 파일명 속 숫자를 추정치로만 사용 (카메라 자동 생성 파일명 등은 신뢰도 낮음 -> matched:false 로 표시)
    const looseMatch = cleanName.match(/(?<![0-9])([0-9]{1,2})(?![0-9])/);
    if (looseMatch) {
        const num = parseInt(looseMatch[1], 10);
        if (num > 0 && num <= 99) {
            return { rank: num, floorCode: `${num}F`, floorLabel: `지상 ${num}층 (${num}F)`, matched: false };
        }
    }

    return { rank: 1, floorCode: '1F', floorLabel: '지상 1층 (1F)', matched: false };
};

// 층 코드 수동 선택용 옵션 목록 (지하10층 ~ 지상30층 + 옥상/옥탑 + 건축물 외부)
window.FLOOR_CODE_OPTION_LIST = (function() {
    const list = [];
    for (let i = 10; i >= 1; i--) list.push(`B${i}F`);
    for (let i = 1; i <= 30; i++) list.push(`${i}F`);
    list.push('ROOF');
    list.push('EXT');
    window.EXT_DIRECTION_DEFS.forEach(d => list.push(d.code));
    return list;
})();

window.getFloorRankFromCode = function(code) {
    if (!code) return 0;
    const c = String(code).toUpperCase().trim();
    if (c.includes('EXT') || c.includes('외부')) return 10000;
    if (c.includes('ROOF') || c.includes('옥상') || c.includes('옥탑') || c.includes('PH')) return 9999;
    const bMatch = c.match(/B\s*([0-9]+)/);
    if (bMatch) return -parseInt(bMatch[1], 10);
    const fMatch = c.match(/([0-9]+)\s*F/);
    if (fMatch) return parseInt(fMatch[1], 10);
    const numMatch = c.match(/([0-9]+)/);
    if (numMatch) return parseInt(numMatch[1], 10);
    return 0;
};

window.buildFloorCodeOptionsHtml = function(selectedCode) {
    // 선택된 층이 정해진 목록(B10F~30F, ROOF, EXT)에 없는 사용자 직접입력 값이면,
    // 그 값도 목록에 끼워넣어 계속 선택된 상태로 보이게 한다 (필로티/기계실/중2층 등 자유 이름)
    const isCustomSelected = selectedCode && !window.FLOOR_CODE_OPTION_LIST.includes(selectedCode);
    let html = window.FLOOR_CODE_OPTION_LIST.map(code => {
        const label = (typeof window.getFloorLabelFromCode === 'function') ? window.getFloorLabelFromCode(code) : code;
        const sel = code === selectedCode ? 'selected' : '';
        return `<option value="${code}" ${sel}>${label}</option>`;
    }).join('');
    if (isCustomSelected) {
        html += `<option value="${selectedCode}" selected>✏️ ${selectedCode} (직접 입력함)</option>`;
    }
    html += `<option value="__CUSTOM_FLOOR__">➕ [층 이름 직접 입력...]</option>`;
    return html;
};

window.selectedUploadedDrawings = [];
window.selectedEditUploadedDrawings = [];

// --- 3. DOM CONTENT LOADED MAIN MODULE ---
document.addEventListener('DOMContentLoaded', () => {
    
    // UI Elements Map
    const elements = {
        appTitle: document.getElementById('navBuildingName'),
        headerSelectorGroup: document.getElementById('headerSelectorGroup'),
        headerReportActions: document.getElementById('headerReportActions'),
        mainNavTabs: document.getElementById('mainNavTabs'),
        navBuildingTabs: document.getElementById('navBuildingTabs'),
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

        // Tables & Albums
        surveyTableBody: document.getElementById('surveyTableBody'),
        photoAlbumGrid: document.getElementById('photoAlbumGrid'),
        surveyFloorTitle: document.getElementById('surveyFloorTitle'),
        albumFloorTitle: document.getElementById('albumFloorTitle')
    };

    // --- 3.5 UI 알림 / 로딩 유틸 (토스트 & 전역 로딩 오버레이) ---
    function ensureToastContainer() {
        let box = document.getElementById('toastContainer');
        if (!box) {
            box = document.createElement('div');
            box.id = 'toastContainer';
            box.className = 'toast-container';
            document.body.appendChild(box);
        }
        return box;
    }

    // type: 'success' | 'error' | 'warning' | 'info'
    window.showToast = function(message, type = 'info', duration = 3500) {
        const box = ensureToastContainer();
        const icons = {
            success: 'fa-circle-check',
            error: 'fa-circle-exclamation',
            warning: 'fa-triangle-exclamation',
            info: 'fa-circle-info'
        };
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const icon = document.createElement('i');
        icon.className = `fa-solid ${icons[type] || icons.info}`;
        const text = document.createElement('span');
        text.textContent = message; // XSS 방지: innerHTML 대신 textContent로 삽입
        toast.appendChild(icon);
        toast.appendChild(text);
        box.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, duration);
        return toast;
    };

    let _loadingDepth = 0;
    window.showLoading = function(text = '처리 중입니다...') {
        _loadingDepth++;
        let overlay = document.getElementById('globalLoadingOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'globalLoadingOverlay';
            overlay.className = 'loading-overlay';
            overlay.innerHTML = '<div class="loading-box"><div class="loading-spinner"></div><div class="loading-text"></div></div>';
            document.body.appendChild(overlay);
        }
        overlay.querySelector('.loading-text').textContent = text;
        overlay.style.display = 'flex';
    };
    window.hideLoading = function() {
        _loadingDepth = Math.max(0, _loadingDepth - 1);
        if (_loadingDepth > 0) return;
        const overlay = document.getElementById('globalLoadingOverlay');
        if (overlay) overlay.style.display = 'none';
    };

    // --- 3.6 오프라인 상태 배지 ---
    function ensureOfflineBadge() {
        let badge = document.getElementById('offlineBadge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'offlineBadge';
            badge.className = 'offline-badge';
            badge.innerHTML = '<i class="fa-solid fa-wifi-slash"></i> <span>오프라인 상태 · 기기에 저장 중</span>';
            document.body.appendChild(badge);
        }
        return badge;
    }

    function updateOfflineBadge() {
        const badge = ensureOfflineBadge();
        badge.style.display = navigator.onLine ? 'none' : 'flex';
    }

    updateOfflineBadge();
    window.addEventListener('online', () => {
        updateOfflineBadge();
        window.showToast('온라인 상태로 전환되었습니다. 동기화를 진행합니다.', 'success');
        if (typeof syncStateToFirebase === 'function') syncStateToFirebase();
    });
    window.addEventListener('offline', () => {
        updateOfflineBadge();
        window.showToast('오프라인 상태입니다. 변경사항은 이 기기에 저장되며, 인터넷 연결 시 자동 동기화됩니다.', 'warning', 5000);
    });

    // --- 4. PERSISTENCE ENGINE (LOCAL STORAGE) ---
    let _localStorageSaveFailedNotified = false;
    function saveStateToLocalStorage() {
        try {
            const dataToSave = {
                defects: window.state.defects || {},
                ndtData: window.state.ndtData || {},
                ndtDisplacementGroups: window.state.ndtDisplacementGroups || {},
                buildings: window.state.buildings || [],
                lastUsedBuildingId: window.state.currentBuildingId || null,
                customDefectTypes: window.state.customDefectTypes || {},
                customDefectCauses: window.state.customDefectCauses || {},
                customDefectComponents: window.state.customDefectComponents || [],
                hiddenDefectComponents: window.state.hiddenDefectComponents || [],
                hiddenDefectTypes: window.state.hiddenDefectTypes || {},
                hiddenDefectCauses: window.state.hiddenDefectCauses || {},
                styleColors: window.state.styleColors || null,
                styleSizes: window.state.styleSizes || null,
                styleShapes: window.state.styleShapes || null,
                surveyColumns: window.state.surveyColumns || null,
                defectSizeMode: window.state.defectSizeMode || 'combined',
                tipShape: window.state.tipShape || 'arrow'
            };
            localStorage.setItem('building_safety_app_state_v2', JSON.stringify(dataToSave));
            _localStorageSaveFailedNotified = false;
            if (typeof syncStateToFirebase === 'function') {
                syncStateToFirebase();
            }
        } catch (e) {
            console.warn('LocalStorage save warning:', e);
            if (!_localStorageSaveFailedNotified) {
                _localStorageSaveFailedNotified = true;
                const isQuotaError = e && (e.name === 'QuotaExceededError' || e.code === 22);
                window.showToast(
                    isQuotaError
                        ? '저장 공간이 가득 차서 최근 변경사항이 저장되지 못했습니다. 오래된 도면/사진을 정리해 주세요.'
                        : '변경사항을 기기에 저장하지 못했습니다. 앱을 다시 시작하거나 관리자에게 문의해 주세요.',
                    'error',
                    6000
                );
            }
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
                        if (typeof window.getBuildingAvailableFloors === 'function') {
                            bldg.floorsList = window.getBuildingAvailableFloors(bldg);
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
                if (parsed.ndtDisplacementGroups) {
                    window.state.ndtDisplacementGroups = parsed.ndtDisplacementGroups;
                }
                if (parsed.customDefectTypes) {
                    window.state.customDefectTypes = parsed.customDefectTypes;
                }
                if (parsed.customDefectCauses) {
                    window.state.customDefectCauses = parsed.customDefectCauses;
                }
                if (parsed.customDefectComponents) {
                    window.state.customDefectComponents = parsed.customDefectComponents;
                }
                if (parsed.hiddenDefectComponents) {
                    window.state.hiddenDefectComponents = parsed.hiddenDefectComponents;
                }
                if (parsed.hiddenDefectTypes) {
                    window.state.hiddenDefectTypes = parsed.hiddenDefectTypes;
                }
                if (parsed.hiddenDefectCauses) {
                    window.state.hiddenDefectCauses = parsed.hiddenDefectCauses;
                }
                if (parsed.styleColors) {
                    window.state.styleColors = parsed.styleColors;
                }
                if (parsed.styleSizes) {
                    window.state.styleSizes = parsed.styleSizes;
                }
                if (parsed.styleShapes) {
                    window.state.styleShapes = parsed.styleShapes;
                }
                if (parsed.surveyColumns) {
                    window.state.surveyColumns = parsed.surveyColumns;
                }
                if (parsed.defectSizeMode) {
                    window.state.defectSizeMode = parsed.defectSizeMode;
                }
                if (parsed.tipShape) {
                    window.state.tipShape = parsed.tipShape;
                }
            }

            if (!window.state.buildings || !Array.isArray(window.state.buildings) || window.state.buildings.length === 0) {
                window.state.buildings = getDefaultBuildings();
            }

            const compInput = document.getElementById('inputHomeCompanyName');
            if (compInput && window.state.companyName) compInput.value = window.state.companyName;
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
            if (elements.navBuildingTabs) elements.navBuildingTabs.style.display = 'none';
            if (elements.appTitle) elements.appTitle.style.display = 'none';

            window.renderDashboard();
        } else {
            if (elements.headerSelectorGroup) elements.headerSelectorGroup.style.display = 'flex';
            if (elements.headerReportActions) elements.headerReportActions.style.display = 'flex';
            if (elements.navBuildingTabs) elements.navBuildingTabs.style.display = 'flex';
            if (elements.appTitle) elements.appTitle.style.display = 'inline-flex';

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

        const allBldgs = window.state.buildings || [];
        const term = (window.state.buildingSearchTerm || '').trim().toLowerCase();
        const bldgs = term
            ? allBldgs.filter(b => (b.name || '').toLowerCase().includes(term) || (b.address || '').toLowerCase().includes(term))
            : allBldgs;

        if (bldgs.length === 0) {
            grid.innerHTML = `<div class="building-list-empty">${term ? '🔍 검색 결과가 없습니다.' : '등록된 건축물이 없습니다. 우측 상단 "신규 건축물 등록" 버튼을 눌러 시작하세요.'}</div>`;
            return;
        }

        grid.innerHTML = bldgs.map(bldg => {
            const floorCount = (bldg.floorsList && bldg.floorsList.length > 0) ? `📐 도면 ${bldg.floorsList.length}개 층` : '📐 도면 미등록';
            return `
                <div class="building-row" data-id="${bldg.id}">
                    <div class="building-row-info" onclick="window.selectBuildingAndInspect('${bldg.id}')">
                        <span class="building-row-name">${bldg.name}</span>
                        <span class="building-row-meta">${bldg.address || '주소 미등록'} · ${floorCount}</span>
                    </div>
                    <div class="building-row-actions">
                        <button type="button" class="icon-btn icon-btn-start" title="현장 점검 시작" onclick="window.selectBuildingAndInspect('${bldg.id}')">
                            <i class="fa-solid fa-map-location-dot"></i>
                        </button>
                        <button type="button" class="icon-btn icon-btn-edit" title="건축물 개요 수정" onclick="window.openEditBuildingModalFunc('${bldg.id}', 'info')">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button type="button" class="icon-btn icon-btn-drawing" title="도면 수정" onclick="window.openEditBuildingModalFunc('${bldg.id}', 'drawing')">
                            <i class="fa-solid fa-images"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    };

    const buildingSearchInput = document.getElementById('buildingSearchInput');
    if (buildingSearchInput) {
        buildingSearchInput.addEventListener('input', (e) => {
            window.state.buildingSearchTerm = e.target.value;
            window.renderDashboard();
        });
    }

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

        // Nav 건물명 표시 업데이트
        const cleanName = bldg.name ? bldg.name.replace(/^🏢\s*/, '') : '건축물';
        if (elements.appTitle) elements.appTitle.textContent = cleanName;

        if (bldg.inspectionType && document.getElementById('selectInspectionType')) document.getElementById('selectInspectionType').value = bldg.inspectionType;
        if (bldg.inspectionYear && document.getElementById('selectInspectionYear')) document.getElementById('selectInspectionYear').value = bldg.inspectionYear;
        if (bldg.inspectionPeriod && document.getElementById('selectInspectionPeriod')) document.getElementById('selectInspectionPeriod').value = bldg.inspectionPeriod;

        // Populate Header Selectors
        populateFloorSelectDropdown(bldg);

        // Switch to Map Tab & Load Drawing
        loadFloorDrawing(window.state.currentFloor || '1F');
        window.switchTab('tab-map');
    };

    window.getFloorLabelFromCode = function(code) {
        if (!code) return '1F';
        const c = String(code).toUpperCase().trim();
        const dirDef = window.EXT_DIRECTION_DEFS.find(d => d.code === c);
        if (dirDef) return dirDef.label;
        if (c === 'EXT' || c.includes('외부')) return '건축물 외부 (EXT)';
        if (c === 'ROOF' || c.includes('옥상') || c.includes('옥탑') || c.includes('PH')) return '옥상/옥탑 층 (ROOF)';
        const bMatch = c.match(/B\s*([0-9]+)/);
        if (bMatch) return `지하 ${bMatch[1]}층 (${c})`;
        const fMatch = c.match(/([0-9]+)\s*F/);
        if (fMatch) return `지상 ${fMatch[1]}층 (${c})`;
        return `${c}층 (${c})`;
    };

    window.getBuildingAvailableFloors = function(bldg) {
        if (!bldg) return [];
        const floorMap = {};

        // 1. Collect from bldg.floorsList
        if (bldg.floorsList && Array.isArray(bldg.floorsList)) {
            bldg.floorsList.forEach(f => {
                if (f && f.floorCode) {
                    floorMap[f.floorCode] = f.floorLabel || window.getFloorLabelFromCode(f.floorCode);
                }
            });
        }

        // 2. Collect from bldg.floorDrawings (전수 자동 수집)
        if (bldg.floorDrawings && typeof bldg.floorDrawings === 'object') {
            Object.keys(bldg.floorDrawings).forEach(code => {
                if (code && !floorMap[code]) {
                    floorMap[code] = window.getFloorLabelFromCode(code);
                }
            });
        }

        const list = Object.entries(floorMap).map(([code, label]) => ({
            floorCode: code,
            floorLabel: label
        }));

        // 3. Always sort low to high (B2F -> B1F -> 1F -> 2F -> 3F -> ROOF)
        if (typeof window.sortFloorsLowToHigh === 'function') {
            return window.sortFloorsLowToHigh(list);
        }
        return list;
    };

    function populateFloorSelectDropdown(bldg) {
        if (!elements.floorSelect) return;
        
        const availableFloors = window.getBuildingAvailableFloors(bldg);
        
        if (bldg) {
            bldg.floorsList = availableFloors;
        }

        if (availableFloors.length > 0) {
            elements.floorSelect.innerHTML = availableFloors.map(f => 
                `<option value="${f.floorCode}">${f.floorLabel}</option>`
            ).join('');

            const hasCurrent = availableFloors.some(f => f.floorCode === window.state.currentFloor);
            if (!hasCurrent) {
                window.state.currentFloor = availableFloors[0].floorCode;
            }
            elements.floorSelect.value = window.state.currentFloor;
        } else {
            elements.floorSelect.innerHTML = `
                <option value="B2F">지하 2층 (B2F)</option>
                <option value="B1F">지하 1층 (B1F)</option>
                <option value="1F" selected>지상 1층 (1F)</option>
                <option value="2F">지상 2층 (2F)</option>
                <option value="ROOF">옥상/옥탑 층 (ROOF)</option>
                <option value="EXT">건축물 외부 (EXT)</option>
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

    // "지상 3층 (3F)" 같은 라벨에서 뒤에 붙은 층 코드 괄호만 떼어낸다.
    // "필로티층"처럼 사용자가 직접 입력해 괄호/공백이 없는 라벨도 그대로 안전하게 통과시키기 위함
    function stripFloorCodeSuffix(label) {
        const cleaned = (label || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
        return cleaned || label || '';
    }

    // Listening for Add Modal Multi-Drawing Uploads
    function updateNewBuildingFloorsSummary() {
        const floorsInput = document.getElementById('inputBuildingFloors');
        const items = window.selectedUploadedDrawings || [];
        if (floorsInput && items.length > 0) {
            const sorted = [...items].sort((a, b) => a.rank - b.rank);
            const lowest = sorted[0];
            const highest = sorted[sorted.length - 1];
            floorsInput.value = `${stripFloorCodeSuffix(highest.floorLabel)} ~ ${stripFloorCodeSuffix(lowest.floorLabel)}`;
        }
    }

    // 도면 파일에 지정할 층을 드롭다운에서 고를 때 호출. "➕ 직접 입력"을 고르면 사용자가 입력한
    // 이름을 그대로 floorCode/floorLabel로 써서, 필로티·기계실·중2층처럼 정해진 목록에 없는
    // 층 이름도 자유롭게 등록할 수 있게 한다. 취소/빈 입력이면 이전 값 그대로 둔다.
    function applyFloorSelectValue(item, code) {
        if (code === '__CUSTOM_FLOOR__') {
            const typed = prompt('층 이름을 직접 입력하세요 (예: 필로티층, 기계실, 중2층):', item.floorLabel || '');
            if (!typed || !typed.trim()) return false;
            const trimmed = typed.trim();
            item.floorCode = trimmed;
            item.floorLabel = trimmed;
            item.rank = window.getFloorRankFromCode(trimmed);
            item.matched = true;
            return true;
        }
        item.floorCode = code;
        item.floorLabel = window.getFloorLabelFromCode(code);
        item.rank = window.getFloorRankFromCode(code);
        item.matched = true; // 사용자가 직접 지정했으므로 신뢰 가능
        return true;
    }

    // 업로드된 파일들을 인식된 층(floorCode)별로 묶어서 [{floorCode, entries:[{item, idx}]}] 형태로 반환.
    // 같은 층으로 인식된 파일이 여러 개면 미리보기에서 "따로따로 놓인 층"이 아니라 "한 층 안에 묶인 후보 파일들"로 보이게 하기 위함
    function groupDrawingItemsByFloor(items) {
        const order = [];
        const map = {};
        items.forEach((item, idx) => {
            if (!map[item.floorCode]) {
                map[item.floorCode] = [];
                order.push(item.floorCode);
            }
            map[item.floorCode].push({ item, idx });
        });
        order.sort((a, b) => window.getFloorRankFromCode(a) - window.getFloorRankFromCode(b));
        return order.map(code => ({ floorCode: code, entries: map[code] }));
    }

    function renderNewBuildingDrawingPreview() {
        const preview = document.getElementById('drawingSortPreview');
        if (!preview) return;
        const items = window.selectedUploadedDrawings || [];

        const hasUnmatched = items.some(it => it.matched === false);
        const groups = groupDrawingItemsByFloor(items);
        const hasDuplicate = groups.some(g => g.entries.length > 1);

        let warningHtml = '';
        if (hasUnmatched || hasDuplicate) {
            warningHtml = `<div style="font-size:0.78rem; color:#d97706; background:rgba(217,119,6,0.12); border:1px solid #d97706; border-radius:6px; padding:0.5rem 0.7rem; margin-bottom:0.4rem;">
                ⚠️ 파일명만으로는 층을 정확히 인식하지 못한 파일이 있습니다 (촬영 사진은 파일명이 자동 생성되어 흔한 경우입니다). 아래에서 각 파일의 층을 직접 확인/선택해 주세요.
                ${hasDuplicate ? '<br>같은 층으로 묶인 파일은 "이 파일 저장" 버튼으로 고른 파일 하나만 실제로 저장됩니다.' : ''}
            </div>`;
        }

        const singleRowHtml = (item, idx) => `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; background:${item.matched === false ? 'rgba(217,119,6,0.1)' : 'rgba(255,255,255,0.06)'}; border:1px solid ${item.matched === false ? '#d97706' : 'transparent'}; padding:0.4rem 0.7rem; border-radius:6px; font-size:0.8rem;">
                <span style="color:#94a3b8; font-size:0.75rem; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</span>
                <select class="form-control drawing-floor-select" data-idx="${idx}" style="width:auto; font-size:0.78rem; padding:0.2rem 0.4rem;">
                    ${window.buildFloorCodeOptionsHtml(item.floorCode)}
                </select>
            </div>`;

        const groupHtml = (g) => {
            if (g.entries.length === 1) return singleRowHtml(g.entries[0].item, g.entries[0].idx);
            const floorLabel = window.getFloorLabelFromCode(g.floorCode);
            return `
                <div style="border:1px solid #d97706; background:rgba(217,119,6,0.08); border-radius:8px; padding:0.5rem 0.6rem;">
                    <div style="font-size:0.78rem; font-weight:800; color:#d97706; margin-bottom:0.3rem;">
                        🏢 ${floorLabel} — 파일 ${g.entries.length}개가 같은 층으로 인식됨. 저장할 파일 하나를 골라주세요.
                    </div>
                    <div style="display:flex; flex-direction:column; gap:0.25rem;">
                        ${g.entries.map(({ item, idx }, i) => {
                            const isFinal = i === g.entries.length - 1;
                            return `
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.4rem; padding:0.3rem 0.5rem; ${isFinal ? 'background:rgba(22,163,74,0.12); border-radius:6px;' : ''}">
                                <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.76rem; color:${isFinal ? '#16a34a' : '#94a3b8'};" title="${escapeHtml(item.fileName)}">
                                    ${isFinal ? '✅' : '⬜'} ${escapeHtml(item.fileName)}${isFinal ? ' <b>(저장됨)</b>' : ''}
                                </span>
                                ${!isFinal ? `<button type="button" class="btn btn-sm btn-outline pick-final-drawing" data-idx="${idx}" style="font-size:0.68rem; padding:0.1rem 0.5rem; flex-shrink:0;">이 파일 저장</button>` : ''}
                                <select class="form-control drawing-floor-select" data-idx="${idx}" style="width:auto; font-size:0.72rem; padding:0.15rem 0.3rem; flex-shrink:0;">
                                    ${window.buildFloorCodeOptionsHtml(item.floorCode)}
                                </select>
                            </div>`;
                        }).join('')}
                    </div>
                </div>`;
        };

        preview.innerHTML = `
            <div style="font-size:0.82rem; font-weight:700; color:#38bdf8; margin-bottom:0.2rem;">
                ✅ 총 ${items.length}개 도면 파일이 선택되었습니다. 층을 확인해 주세요:
            </div>
            ${warningHtml}
            <div style="display:flex; flex-direction:column; gap:0.4rem;">
                ${groups.map(groupHtml).join('')}
            </div>
        `;

        preview.querySelectorAll('.drawing-floor-select').forEach(sel => {
            sel.addEventListener('change', (ev) => {
                const idx = parseInt(ev.target.dataset.idx, 10);
                const item = (window.selectedUploadedDrawings || [])[idx];
                if (!item) return;
                applyFloorSelectValue(item, ev.target.value);
                updateNewBuildingFloorsSummary();
                renderNewBuildingDrawingPreview();
            });
        });
        preview.querySelectorAll('.pick-final-drawing').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                const idx = parseInt(ev.currentTarget.dataset.idx, 10);
                const arr = window.selectedUploadedDrawings || [];
                const item = arr[idx];
                if (!item) return;
                arr.splice(idx, 1);
                arr.push(item); // 배열 맨 뒤로 보내면 저장 루프에서 이 파일이 마지막으로 처리되어 실제로 저장됨
                renderNewBuildingDrawingPreview();
            });
        });
    }

    // 이미지 입력과 PDF 입력, 두 개의 <input type=file>에서 선택한 파일을 같은 목록에 누적
    function handleNewBuildingFilesSelected(files) {
        if (files.length === 0) return;

        const newItems = files.map(file => {
            const info = window.parseFloorInfoFromFilename(file.name);
            return {
                file: file,
                fileName: file.name,
                rank: info.rank,
                floorCode: info.floorCode,
                floorLabel: info.floorLabel,
                matched: info.matched
            };
        });

        window.selectedUploadedDrawings = (window.selectedUploadedDrawings || [])
            .concat(newItems)
            .sort((a, b) => a.rank - b.rank);

        renderNewBuildingDrawingPreview();
        updateNewBuildingFloorsSummary();

        const unmatchedCount = newItems.filter(it => it.matched === false).length;
        if (unmatchedCount > 0) {
            window.showToast(`${unmatchedCount}개 파일의 층을 파일명에서 자동으로 인식하지 못했습니다. 목록에서 직접 층을 선택해 주세요.`, 'warning', 5500);
        }
    }

    const inputDrawings = document.getElementById('inputBuildingDrawings');
    if (inputDrawings) {
        inputDrawings.addEventListener('change', (e) => {
            handleNewBuildingFilesSelected(Array.from(e.target.files || []));
            e.target.value = ''; // 같은 파일 재선택도 인식되도록 초기화
        });
    }

    const inputDrawingsPdf = document.getElementById('inputBuildingDrawingsPdf');
    if (inputDrawingsPdf) {
        inputDrawingsPdf.addEventListener('change', (e) => {
            handleNewBuildingFilesSelected(Array.from(e.target.files || []));
            e.target.value = '';
        });
    }

    // Save New Building Action
    const btnSaveBuilding = document.getElementById('btnSaveBuilding');
    if (btnSaveBuilding) {
        btnSaveBuilding.addEventListener('click', async () => {
            const nameInput = document.getElementById('inputBuildingName');
            const name = (nameInput ? nameInput.value : '').trim();
            if (!name) {
                window.showToast('건축물 명칭을 입력해 주세요.', 'warning');
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

            const newBuildingId = 'bldg-' + Date.now();
            const safeUploadedDrawings = Array.isArray(window.selectedUploadedDrawings) ? window.selectedUploadedDrawings : [];

            // 같은 층으로 지정된 파일이 여러 개면 저장 시 마지막 파일만 남고 나머지는 사라지므로 사전 확인
            const dupCounts = {};
            safeUploadedDrawings.forEach(it => { dupCounts[it.floorCode] = (dupCounts[it.floorCode] || 0) + 1; });
            const dupCodes = Object.keys(dupCounts).filter(c => dupCounts[c] > 1);
            if (dupCodes.length > 0) {
                const proceed = confirm(`⚠️ 같은 층으로 지정된 도면이 있습니다 (${dupCodes.join(', ')}).\n계속 저장하면 같은 층끼리는 마지막 파일만 남고 나머지는 사라집니다.\n계속하시겠습니까?`);
                if (!proceed) return;
            }

            const floorDrawingsMap = {};
            const floorsList = [];

            if (safeUploadedDrawings.length > 0) {
                window.showLoading(`도면 ${safeUploadedDrawings.length}개 처리 중입니다... (PDF는 시간이 더 걸릴 수 있습니다)`);
                try {
                    for (const item of safeUploadedDrawings) {
                        if (!floorsList.some(f => f.floorCode === item.floorCode)) {
                            floorsList.push({
                                floorCode: item.floorCode,
                                floorLabel: item.floorLabel
                            });
                        }
                        if (item.file) {
                            try {
                                const compressedDataUrl = await window.compressDrawingImage(item.file);
                                if (compressedDataUrl) {
                                    floorDrawingsMap[item.floorCode] = compressedDataUrl;
                                    await uploadFloorDrawing(newBuildingId, item.floorCode, compressedDataUrl);
                                }
                            } catch (err) {
                                console.error('Drawing compression error:', err);
                            }
                        }
                    }
                } finally {
                    window.hideLoading();
                }
            }

            const newBldg = {
                id: newBuildingId,
                name: name.startsWith('🏢') ? name : '🏢 ' + name,
                address: address,
                inspector: window.state.userName || '점검자',
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
            window.showToast(`'${name}' 건축물이 등록되었습니다.`, 'success');
        });
    }

    // --- 7-B. BUILDING EDIT & ADDITIONAL DRAWING INSERTION ENGINE (저층->고층 자동 정렬) ---

    // Low-to-High Floor Sort Helper (B3F -> B2F -> B1F -> 1F -> 2F -> 3F -> ROOF)
    window.sortFloorsLowToHigh = function(floorsList) {
        if (!Array.isArray(floorsList)) return [];
        const getRank = (code) => {
            if (!code) return 0;
            const c = String(code).toUpperCase().trim();
            if (c.includes('EXT') || c.includes('외부')) return 10000;
            if (c.includes('ROOF') || c.includes('옥상') || c.includes('옥탑') || c.includes('PH')) return 9999;
            const bMatch = c.match(/B\s*([0-9]+)/);
            if (bMatch) return -parseInt(bMatch[1], 10);
            const fMatch = c.match(/([0-9]+)\s*F/);
            if (fMatch) return parseInt(fMatch[1], 10);
            const numMatch = c.match(/([0-9]+)/);
            if (numMatch) return parseInt(numMatch[1], 10);
            return 0;
        };
        return [...floorsList].sort((a, b) => getRank(a.floorCode) - getRank(b.floorCode));
    };

    window.openEditBuildingModalFunc = function(bldgId, focusSection = 'info') {
        const modal = document.getElementById('editBuildingModal');
        if (!modal) return;

        const bldgs = window.state.buildings || [];
        const bldg = bldgs.find(b => b.id === bldgId);
        if (!bldg) {
            window.showToast('해당 건축물 정보를 찾을 수 없습니다.', 'error');
            return;
        }

        window.currentEditingBuilding = bldg;
        window.selectedEditUploadedDrawings = [];

        // Bind building info to edit modal form inputs
        document.getElementById('inputEditBuildingId').value = bldg.id;
        document.getElementById('inputEditBuildingName').value = (bldg.name || '').replace(/^🏢\s*/, '');
        document.getElementById('inputEditBuildingAddress').value = bldg.address || '';
        document.getElementById('inputEditBuildingFloors').value = bldg.floors || '';
        document.getElementById('inputEditBuildingDate').value = bldg.date || new Date().toISOString().split('T')[0];
        
        if (document.getElementById('inputEditBuildingInspectionType')) document.getElementById('inputEditBuildingInspectionType').value = bldg.inspectionType || '정밀안전점검';
        if (document.getElementById('inputEditBuildingInspectionYear')) document.getElementById('inputEditBuildingInspectionYear').value = bldg.inspectionYear || '2026년';
        if (document.getElementById('inputEditBuildingInspectionPeriod')) document.getElementById('inputEditBuildingInspectionPeriod').value = bldg.inspectionPeriod || '하반기';
        if (document.getElementById('inputEditBuildingNotes')) document.getElementById('inputEditBuildingNotes').value = bldg.notes || '';

        const fileInput = document.getElementById('inputEditBuildingDrawings');
        if (fileInput) fileInput.value = '';

        // Render current drawings list preview in low-to-high order
        renderEditDrawingPreview();

        modal.style.display = 'flex';
        modal.classList.add('open');

        const modalBody = modal.querySelector('.modal-body');
        if (modalBody) modalBody.scrollTop = 0;

        if (focusSection === 'drawing') {
            setTimeout(() => {
                const drawingInput = document.getElementById('inputEditBuildingDrawings');
                const drawingSection = drawingInput ? drawingInput.closest('.form-group') : null;
                if (drawingSection) drawingSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 150);
        }
    };

    window.closeEditBuildingModalFunc = function() {
        const modal = document.getElementById('editBuildingModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('open');
        }
    };

    function renderEditDrawingPreview() {
        const preview = document.getElementById('editDrawingSortPreview');
        if (!preview) return;

        const bldg = window.currentEditingBuilding;
        if (!bldg) return;

        let existingFloors = [];
        if (bldg.floorsList && bldg.floorsList.length > 0) {
            existingFloors = bldg.floorsList;
        } else if (bldg.floorDrawings) {
            existingFloors = Object.keys(bldg.floorDrawings).map(code => ({ floorCode: code, floorLabel: code }));
        }

        // Sort existing floors in low-to-high order (B2F -> B1F -> 1F -> 2F -> ROOF)
        existingFloors = window.sortFloorsLowToHigh(existingFloors);

        const newFiles = Array.isArray(window.selectedEditUploadedDrawings) ? window.selectedEditUploadedDrawings : [];

        let html = `
            <div style="font-size:0.85rem; font-weight:800; color:#0284c7; margin-bottom:0.4rem; display:flex; justify-content:space-between; align-items:center;">
                <span>🖼️ 층별 도면 목록 (저층 ➡️ 고층 순서 정렬):</span>
                <span style="font-size:0.78rem; color:#64748b;">(기존 ${existingFloors.length}개 + 신규추가 ${newFiles.length}개)</span>
            </div>
        `;

        if (existingFloors.length === 0 && newFiles.length === 0) {
            html += `<div style="font-size:0.8rem; color:#94a3b8; padding:0.6rem; text-align:center; border:1px dashed #cbd5e1; border-radius:6px;">등록된 층별 도면이 없습니다. 아래에서 파일들을 선택하여 추가해 주세요.</div>`;
        } else {
            html += `<div style="display:flex; flex-direction:column; gap:0.4rem; max-height:220px; overflow-y:auto; padding-right:4px;">`;
            
            // Render Existing Registered Drawings
            existingFloors.forEach((f, idx) => {
                const hasImg = bldg.floorDrawings && bldg.floorDrawings[f.floorCode];
                html += `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:#ffffff; border:1px solid #cbd5e1; padding:0.4rem 0.8rem; border-radius:6px; font-size:0.82rem;">
                        <span>
                            <strong style="color:#0284c7;">[기존 ${idx + 1}]</strong> 🏢 ${f.floorLabel} (${f.floorCode})
                            ${hasImg ? '<span style="color:#16a34a; font-size:0.75rem; margin-left:0.4rem;">✓ 도면이미지 보유</span>' : ''}
                        </span>
                        <button type="button" class="btn btn-sm btn-outline" style="border-color:#ef4444; color:#ef4444; font-size:0.72rem; padding:0.1rem 0.4rem;" onclick="window.deleteExistingFloorDrawing('${f.floorCode}')">
                            <i class="fa-solid fa-trash"></i> 도면 삭제
                        </button>
                    </div>
                `;
            });

            // 신규추가 파일 중 같은 층으로 지정된 파일 검사 (저장 시 나중 파일이 이전 파일을 덮어씀)
            const editGroups = groupDrawingItemsByFloor(newFiles);
            const hasUnmatched = newFiles.some(it => it.matched === false);
            const hasDuplicate = editGroups.some(g => g.entries.length > 1);
            if (hasUnmatched || hasDuplicate) {
                html += `<div style="font-size:0.78rem; color:#d97706; background:rgba(217,119,6,0.12); border:1px solid #d97706; border-radius:6px; padding:0.5rem 0.7rem; margin-bottom:0.4rem;">
                    ⚠️ 파일명만으로는 층을 정확히 인식하지 못한 파일이 있습니다. 아래 [신규추가] 항목에서 층을 직접 확인/선택해 주세요.
                    ${hasDuplicate ? '<br>같은 층으로 묶인 파일은 "이 파일 저장" 버튼으로 고른 파일 하나만 실제로 저장됩니다.' : ''}
                </div>`;
            }

            // Render Newly Added Drawings — 같은 층으로 인식된 파일은 한 그룹으로 묶어서 표시
            editGroups.forEach(g => {
                if (g.entries.length === 1) {
                    const { item, idx } = g.entries[0];
                    const flagged = item.matched === false;
                    html += `
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; background:${flagged ? 'rgba(217,119,6,0.1)' : '#e0f2fe'}; border:1px solid ${flagged ? '#d97706' : '#0284c7'}; padding:0.4rem 0.8rem; border-radius:6px; font-size:0.82rem;">
                            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                <strong style="color:#0369a1;">[신규추가]</strong>
                                <span style="color:#64748b; font-size:0.75rem; margin-left:0.4rem;">${escapeHtml(item.fileName)}</span>
                            </span>
                            <select class="form-control edit-drawing-floor-select" data-idx="${idx}" style="width:auto; font-size:0.78rem; padding:0.2rem 0.4rem; flex-shrink:0;">
                                ${window.buildFloorCodeOptionsHtml(item.floorCode)}
                            </select>
                        </div>
                    `;
                } else {
                    const floorLabel = window.getFloorLabelFromCode(g.floorCode);
                    html += `
                        <div style="border:1px solid #d97706; background:rgba(217,119,6,0.08); border-radius:8px; padding:0.5rem 0.6rem;">
                            <div style="font-size:0.78rem; font-weight:800; color:#d97706; margin-bottom:0.3rem;">
                                🏢 [신규추가] ${floorLabel} — 파일 ${g.entries.length}개가 같은 층으로 인식됨. 저장할 파일 하나를 골라주세요.
                            </div>
                            <div style="display:flex; flex-direction:column; gap:0.25rem;">
                                ${g.entries.map(({ item, idx }, i) => {
                                    const isFinal = i === g.entries.length - 1;
                                    return `
                                    <div style="display:flex; justify-content:space-between; align-items:center; gap:0.4rem; padding:0.3rem 0.5rem; ${isFinal ? 'background:rgba(22,163,74,0.12); border-radius:6px;' : ''}">
                                        <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.76rem; color:${isFinal ? '#16a34a' : '#94a3b8'};" title="${escapeHtml(item.fileName)}">
                                            ${isFinal ? '✅' : '⬜'} ${escapeHtml(item.fileName)}${isFinal ? ' <b>(저장됨)</b>' : ''}
                                        </span>
                                        ${!isFinal ? `<button type="button" class="btn btn-sm btn-outline pick-final-edit-drawing" data-idx="${idx}" style="font-size:0.68rem; padding:0.1rem 0.5rem; flex-shrink:0;">이 파일 저장</button>` : ''}
                                        <select class="form-control edit-drawing-floor-select" data-idx="${idx}" style="width:auto; font-size:0.72rem; padding:0.15rem 0.3rem; flex-shrink:0;">
                                            ${window.buildFloorCodeOptionsHtml(item.floorCode)}
                                        </select>
                                    </div>`;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }
            });

            html += `</div>`;
        }

        preview.innerHTML = html;

        preview.querySelectorAll('.edit-drawing-floor-select').forEach(sel => {
            sel.addEventListener('change', (ev) => {
                const idx = parseInt(ev.target.dataset.idx, 10);
                const item = (window.selectedEditUploadedDrawings || [])[idx];
                if (!item) return;
                applyFloorSelectValue(item, ev.target.value);
                renderEditDrawingPreview();
            });
        });
        preview.querySelectorAll('.pick-final-edit-drawing').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                const idx = parseInt(ev.currentTarget.dataset.idx, 10);
                const arr = window.selectedEditUploadedDrawings || [];
                const item = arr[idx];
                if (!item) return;
                arr.splice(idx, 1);
                arr.push(item); // 배열 맨 뒤로 보내면 저장 루프에서 이 파일이 마지막으로 처리되어 실제로 저장됨
                renderEditDrawingPreview();
            });
        });
    }

    window.deleteExistingFloorDrawing = function(floorCode) {
        const bldg = window.currentEditingBuilding;
        if (!bldg) return;

        if (confirm(`🗑️ 정말 ${floorCode} 층 도면을 삭제하시겠습니까?`)) {
            if (bldg.floorDrawings && bldg.floorDrawings[floorCode]) {
                delete bldg.floorDrawings[floorCode];
            }
            if (bldg.floorsList) {
                bldg.floorsList = bldg.floorsList.filter(f => f.floorCode !== floorCode);
            }
            renderEditDrawingPreview();
        }
    };

    // Handling Additional Drawing File Selection
    // 이미지 입력과 PDF 입력, 두 개의 <input type=file>에서 선택한 파일을 같은 목록에 누적
    function handleEditBuildingFilesSelected(files) {
        if (files.length === 0) return;

        const parsedItems = files.map(file => {
            const info = window.parseFloorInfoFromFilename(file.name);
            return {
                file: file,
                fileName: file.name,
                rank: info.rank,
                floorCode: info.floorCode,
                floorLabel: info.floorLabel,
                matched: info.matched
            };
        });

        window.selectedEditUploadedDrawings = window.sortFloorsLowToHigh(
            (window.selectedEditUploadedDrawings || []).concat(parsedItems)
        );
        renderEditDrawingPreview();

        const unmatchedCount = parsedItems.filter(it => it.matched === false).length;
        if (unmatchedCount > 0) {
            window.showToast(`${unmatchedCount}개 파일의 층을 파일명에서 자동으로 인식하지 못했습니다. 목록에서 직접 층을 선택해 주세요.`, 'warning', 5500);
        }
    }

    const inputEditDrawings = document.getElementById('inputEditBuildingDrawings');
    if (inputEditDrawings) {
        inputEditDrawings.addEventListener('change', (e) => {
            handleEditBuildingFilesSelected(Array.from(e.target.files || []));
            e.target.value = '';
        });
    }

    const inputEditDrawingsPdf = document.getElementById('inputEditBuildingDrawingsPdf');
    if (inputEditDrawingsPdf) {
        inputEditDrawingsPdf.addEventListener('change', (e) => {
            handleEditBuildingFilesSelected(Array.from(e.target.files || []));
            e.target.value = '';
        });
    }

    // Save Edit Building & Merge New Drawings Action
    const btnSaveEditBuilding = document.getElementById('btnSaveEditBuilding');
    if (btnSaveEditBuilding) {
        btnSaveEditBuilding.addEventListener('click', async () => {
            const bldg = window.currentEditingBuilding;
            if (!bldg) return;

            const nameInput = document.getElementById('inputEditBuildingName');
            const name = (nameInput ? nameInput.value : '').trim();
            if (!name) {
                window.showToast('건축물 명칭을 입력해 주세요.', 'warning');
                if (nameInput) nameInput.focus();
                return;
            }

            const address = (document.getElementById('inputEditBuildingAddress')?.value || '').trim() || bldg.address;
            const floors = (document.getElementById('inputEditBuildingFloors')?.value || '').trim() || bldg.floors;
            const date = document.getElementById('inputEditBuildingDate')?.value || bldg.date;
            const inspectionType = document.getElementById('inputEditBuildingInspectionType')?.value || bldg.inspectionType || '정밀안전점검';
            const inspectionYear = document.getElementById('inputEditBuildingInspectionYear')?.value || bldg.inspectionYear || '2026년';
            const inspectionPeriod = document.getElementById('inputEditBuildingInspectionPeriod')?.value || bldg.inspectionPeriod || '하반기';
            const notes = document.getElementById('inputEditBuildingNotes')?.value || '';

            // Process newly added drawings and merge into existing bldg
            if (!bldg.floorDrawings) bldg.floorDrawings = {};
            if (!bldg.floorsList) bldg.floorsList = [];

            const newFiles = Array.isArray(window.selectedEditUploadedDrawings) ? window.selectedEditUploadedDrawings : [];

            // 신규추가 파일 중 같은 층으로 지정된 것이 있으면 저장 전 확인 (마지막 파일만 남고 나머지는 사라짐)
            if (newFiles.length > 0) {
                const dupCounts = {};
                newFiles.forEach(it => { dupCounts[it.floorCode] = (dupCounts[it.floorCode] || 0) + 1; });
                const dupCodes = Object.keys(dupCounts).filter(c => dupCounts[c] > 1);
                if (dupCodes.length > 0) {
                    const proceed = confirm(`⚠️ 같은 층으로 지정된 도면이 있습니다 (${dupCodes.join(', ')}).\n계속 저장하면 같은 층끼리는 마지막 파일만 남고 나머지는 사라집니다.\n계속하시겠습니까?`);
                    if (!proceed) return;
                }
            }

            if (newFiles.length > 0) {
                window.showLoading(`도면 ${newFiles.length}개 처리 중입니다... (PDF는 시간이 더 걸릴 수 있습니다)`);
                try {
                    for (const item of newFiles) {
                        // Check if floor already exists in floorsList, if not add it
                        const existingIdx = bldg.floorsList.findIndex(f => f.floorCode === item.floorCode);
                        if (existingIdx < 0) {
                            bldg.floorsList.push({
                                floorCode: item.floorCode,
                                floorLabel: item.floorLabel
                            });
                        }
                        if (item.file) {
                            try {
                                const compressedDataUrl = await window.compressDrawingImage(item.file);
                                if (compressedDataUrl) {
                                    bldg.floorDrawings[item.floorCode] = compressedDataUrl;
                                    await uploadFloorDrawing(bldg.id, item.floorCode, compressedDataUrl);
                                }
                            } catch (err) {
                                console.error('Edit drawing compression error:', err);
                            }
                        }
                    }
                } finally {
                    window.hideLoading();
                }
            }

            // Always rebuild and sort floorsList in LOW-TO-HIGH order (B2F -> B1F -> 1F -> 2F -> ROOF)
            bldg.floorsList = window.getBuildingAvailableFloors(bldg);

            // Update building metadata
            bldg.name = name.startsWith('🏢') ? name : '🏢 ' + name;
            bldg.address = address;
            bldg.floors = floors;
            bldg.date = date;
            bldg.inspectionType = inspectionType;
            bldg.inspectionYear = inspectionYear;
            bldg.inspectionPeriod = inspectionPeriod;
            bldg.notes = notes;

            // Save state & sync
            saveStateToLocalStorage();
            if (typeof syncStateToFirebase === 'function') syncStateToFirebase();

            window.closeEditBuildingModalFunc();

            renderDashboard();
            populateFloorSelectDropdown(bldg);

            if (window.state.currentBuildingId === bldg.id) {
                window.selectBuildingAndInspect(bldg);
            }

            window.showToast(`'${bldg.name}' 명칭 및 도면 저장이 완료되었습니다. (총 ${bldg.floorsList.length}개 층)`, 'success');
        });
    }

    // Delete Building Action
    const btnDeleteBuilding = document.getElementById('btnDeleteBuilding');
    if (btnDeleteBuilding) {
        btnDeleteBuilding.addEventListener('click', () => {
            const bldg = window.currentEditingBuilding;
            if (!bldg) return;

            if (!confirm(`🗑️ 정말 건축물 '${bldg.name}' 및 등록된 모든 층별 도면과 결함 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;

            window.state.buildings = (window.state.buildings || []).filter(b => b.id !== bldg.id);

            // Clear defects and ndtData for this building
            const photoDeleteJobs = [];
            Object.keys(window.state.defects || {}).forEach(k => {
                if (k.startsWith(bldg.id + '_')) {
                    (window.state.defects[k] || []).forEach(d => {
                        if (d.photos && d.photos.length > 0) photoDeleteJobs.push(deletePhotosForDefect(d.id, d.photos.length));
                    });
                    delete window.state.defects[k];
                }
            });
            Object.keys(window.state.ndtData || {}).forEach(k => {
                if (k.startsWith(bldg.id + '_')) delete window.state.ndtData[k];
            });
            Object.keys(window.state.ndtDisplacementGroups || {}).forEach(k => {
                if (k.startsWith(bldg.id + '_')) delete window.state.ndtDisplacementGroups[k];
            });

            saveStateToLocalStorage();
            if (typeof syncStateToFirebase === 'function') syncStateToFirebase();

            window.closeEditBuildingModalFunc();

            if (window.state.currentBuildingId === bldg.id) {
                window.state.currentBuilding = null;
                window.state.currentBuildingId = null;
                window.switchTab('tab-home');
            }

            renderDashboard();
            window.showToast(`'${bldg.name}' 건축물이 삭제되었습니다.`, 'success');

            // 클라우드 첨부파일(도면/사진) 삭제는 백그라운드에서 진행하고, 실패 건이 있으면 사후 안내
            Promise.all([deleteFloorDrawingsForBuilding(bldg), ...photoDeleteJobs]).then(results => {
                const totalFail = results.reduce((sum, n) => sum + (n || 0), 0);
                if (totalFail > 0) {
                    window.showToast(`클라우드에서 일부 첨부파일(${totalFail}건) 삭제에 실패했습니다. 네트워크 상태를 확인해 주세요.`, 'warning', 5000);
                }
            });
        });
    }

    const btnCloseEditBuildingModal = document.getElementById('btnCloseEditBuildingModal');
    if (btnCloseEditBuildingModal) {
        btnCloseEditBuildingModal.addEventListener('click', window.closeEditBuildingModalFunc);
    }

    const btnCancelEditBuilding = document.getElementById('btnCancelEditBuilding');
    if (btnCancelEditBuilding) {
        btnCancelEditBuilding.addEventListener('click', window.closeEditBuildingModalFunc);
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

        const hasFloorRegistered = bldg && bldg.floorsList && bldg.floorsList.some(f => f.floorCode === floorCode);

        if (!dataUrl && hasFloorRegistered && db && window.state.companyId) {
            // 로컬 캐시엔 없지만 이 건물에 등록된 층 도면 -> Firestore에서 1회 조회 후 캐싱
            db.collection('safety_app').doc(getCompanyDocId())
                .collection('floorDrawings').doc(`${bldg.id}_${floorCode}`).get()
                .then(doc => {
                    const fetchedUrl = doc.exists ? doc.data().dataUrl : null;
                    if (fetchedUrl) {
                        if (!bldg.floorDrawings) bldg.floorDrawings = {};
                        bldg.floorDrawings[floorCode] = fetchedUrl;
                    }
                    if (state.currentFloor === floorCode) {
                        tryLoadImage(fetchedUrl || getDefaultBlueprintSvgDataUrl(floorCode || '1F'), !fetchedUrl);
                    }
                })
                .catch(() => {
                    if (state.currentFloor === floorCode) {
                        tryLoadImage(getDefaultBlueprintSvgDataUrl(floorCode || '1F'), true);
                    }
                });
        } else if (!dataUrl || (isLocalFileUrl && window.location.protocol !== 'file:')) {
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

    // viewToImgCoords()의 역변환: 이미지 좌표 -> 회전 반영된 view 좌표
    function imgToViewCoords(imgX, imgY) {
        const angle = state.rotationAngle || 0;
        const img = state.bgImage;
        const imgW = img ? (img.naturalWidth || img.width || 1200) : 1200;
        const imgH = img ? (img.naturalHeight || img.height || 700) : 700;

        if (angle === 90) {
            return { x: imgH - imgY, y: imgX };
        } else if (angle === 180) {
            return { x: imgW - imgX, y: imgH - imgY };
        } else if (angle === 270) {
            return { x: imgY, y: imgW - imgX };
        }
        return { x: imgX, y: imgY };
    }

    // 좌측 결함 목록에서 특정 결함을 클릭했을 때 캔버스를 그 위치로 이동/확대하고 잠깐 강조 표시
    window.focusDefectOnCanvas = function(defectId) {
        const defects = getCurrentFloorDefects();
        const defect = defects.find(d => d.id === defectId);
        if (!defect || !state.canvas) return;

        const centerImgX = defect.shapeType === 'area'
            ? (defect.areaX1 + defect.areaX2) / 2
            : (defect.x || 100);
        const centerImgY = defect.shapeType === 'area'
            ? (defect.areaY1 + defect.areaY2) / 2
            : (defect.y || 100);

        const targetScale = 1.6;
        const v = imgToViewCoords(centerImgX, centerImgY);
        state.view.scale = targetScale;
        state.view.offsetX = state.canvas.width / 2 - v.x * targetScale;
        state.view.offsetY = state.canvas.height / 2 - v.y * targetScale;
        if (elements.zoomScaleText) elements.zoomScaleText.textContent = `${Math.round(targetScale * 100)}%`;

        activeDragPin = defect;
        drawCanvas();
        setTimeout(() => {
            if (activeDragPin === defect) activeDragPin = null;
            drawCanvas();
        }, 900);
    };

    function drawCanvas() {
        if (!state.ctx || !state.canvas) return;
        const ctx = state.ctx;
        const cw = state.canvas.width;
        const ch = state.canvas.height;

        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#e2e8f0';
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
        const currentDefects = getCurrentFloorFilteredDefects();
        renderDefectsGrouped(ctx, currentDefects, drawPin);

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

        // Draw Live Area(면적) Marking Drag Preview
        if (isAreaDrag) {
            drawAreaRect(ctx, {
                areaX1: areaStartImgX,
                areaY1: areaStartImgY,
                areaX2: areaCurImgX,
                areaY2: areaCurImgY,
                category: document.getElementById('defectCategory')?.value || '구조체',
                no: ''
            }, true);
        }

        // CAD(DXF) 좌표 → 도면 이미지 좌표 변환이 실제로 맞는지 확인하기 위한 임시 미리보기 점
        // (저장되는 결함 데이터가 아니라 화면 확인용. window._dxfCalibrationPreviewPoints가 있을 때만 그려짐)
        if (window._dxfCalibrationPreviewPoints && window._dxfCalibrationPreviewPoints.length) {
            window._dxfCalibrationPreviewPoints.forEach((p) => {
                ctx.beginPath();
                ctx.arc(p.imgX, p.imgY, 14, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(168,85,247,0.35)';
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#a855f7';
                ctx.stroke();
                if (p.label) {
                    ctx.fillStyle = '#a855f7';
                    ctx.font = 'bold 12px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(p.label, p.imgX, p.imgY - 20);
                }
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

        // 드래그/패닝 중이 아닐 때만 좌측 결함 목록을 갱신 (매 프레임 DOM 재생성 방지)
        if (!isDragging && !isMarkingDrag && !isDraggingPin && !isAreaDrag && typeof renderDefectListPanel === 'function') {
            renderDefectListPanel();
        }
    }

    // --- 8-B. NON-DESTRUCTIVE TESTING (NDT) FIELD SURVEY ENGINE (v60.0) ---
    if (!state.ndtData) state.ndtData = {};
    if (!state.ndtImages) state.ndtImages = {};
    if (!state.ndtDisplacementGroups) state.ndtDisplacementGroups = {};
    let ndtMode = 'PAN';
    let currentNdtCategory = '실측';
    let ndtView = { offsetX: 0, offsetY: 0, scale: 1.0 };
    let ndtRotationAngle = 0;
    let ndtBgImage = null;
    let isNdtDragging = false;
    let isNdtMarkingDrag = false;
    let isDraggingNdtDisplacement = false;
    let activeDragNdtDisplacementGroup = null;
    let activeDragNdtDisplacementPoint = null;
    let pendingNdtDispHit = null;
    let isNdtDisplacementMarking = false;
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
        if (currentCat === '기울기' || currentCat === '부재변위') {
            filtered = items.filter(item => item.category === currentCat);
        } else if (currentCat === '변위') {
            filtered = items.filter(item => item.category === '변위');
        } else {
            filtered = items.filter(item => ['실측', '강도', '탄산화'].includes(item.category));
        }

        for (let i = filtered.length - 1; i >= 0; i--) {
            const item = filtered[i];
            const itemSize = getStyleSize(getNdtStyleKey(item.category || '강도'));
            const pinScale = itemSize.pin;
            const arrowScale = itemSize.arrow;
            const boxX = item.boxX !== undefined ? item.boxX : (item.x || 100);
            const boxY = item.boxY !== undefined ? item.boxY : (item.y || 100);
            const targetX = item.targetX !== undefined ? item.targetX : (item.x || boxX);
            const targetY = item.targetY !== undefined ? item.targetY : (item.y || boxY);

            if (Math.hypot(vx - targetX, vy - targetY) < 30 * arrowScale) {
                return { item, part: 'target' };
            }
            if (Math.hypot(vx - boxX, vy - boxY) < 50 * pinScale) {
                return { item, part: 'box' };
            }
            if (Math.hypot(vx - (item.x || 100), vy - (item.y || 100)) < 40 * pinScale) {
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

    // --- 카테고리별 핀/박스 색상 커스터마이징 ---
    const DEFAULT_STYLE_COLORS = {
        defectStructural: '#ef4444',    // 결함위치도 - 구조체
        defectNonStructural: '#3b82f6', // 결함위치도 - 비구조체
        defectFinish: '#f97316',        // 결함위치도 - 마감재
        defectStructuralGood: '#22c55e',    // 결함위치도 - 구조체 상태양호
        defectNonStructuralGood: '#22c55e', // 결함위치도 - 비구조체 상태양호
        defectFinishGood: '#22c55e',        // 결함위치도 - 마감재 상태양호
        ndtMeasure: '#0284c7',          // 부재 실측
        ndtStrength: '#ef4444',         // 강도
        ndtCarbonation: '#eab308',      // 탄산화
        ndtTilt: '#ef4444',             // 기울기
        ndtSettlement: '#a855f7',       // 부동침하 기울기
        ndtMemberDisp: '#22c55e'        // 부재변위
    };

    function getStyleColor(key) {
        return (state.styleColors && state.styleColors[key]) || DEFAULT_STYLE_COLORS[key];
    }

    // 결함(구조체/비구조체/마감재) 카테고리 → 스타일 설정 키 매핑 (색상/크기 공용)
    function getDefectStyleKey(category, defectType) {
        const isGood = defectType === '상태양호';
        if (category === '비구조체') return isGood ? 'defectNonStructuralGood' : 'defectNonStructural';
        if (category === '마감재') return isGood ? 'defectFinishGood' : 'defectFinish';
        return isGood ? 'defectStructuralGood' : 'defectStructural';
    }

    function getDefectColor(category, defectType) {
        return getStyleColor(getDefectStyleKey(category, defectType));
    }

    // --- 카테고리별 핀/화살표 크기 커스터마이징 ---
    const DEFAULT_STYLE_SIZES = {
        defectStructural: { pin: 1.0, arrow: 1.0 },
        defectNonStructural: { pin: 1.0, arrow: 1.0 },
        defectFinish: { pin: 1.0, arrow: 1.0 },
        defectStructuralGood: { pin: 1.0, arrow: 1.0 },
        defectNonStructuralGood: { pin: 1.0, arrow: 1.0 },
        defectFinishGood: { pin: 1.0, arrow: 1.0 },
        ndtMeasure: { pin: 1.0, arrow: 1.0 },
        ndtStrength: { pin: 1.0, arrow: 1.0 },
        ndtCarbonation: { pin: 1.0, arrow: 1.0 },
        ndtTilt: { pin: 1.0, arrow: 1.0 },
        ndtSettlement: { pin: 1.0, arrow: 1.0 },
        ndtMemberDisp: { pin: 1.0, arrow: 1.0 }
    };

    function getStyleSize(key) {
        const custom = state.styleSizes && state.styleSizes[key];
        const def = DEFAULT_STYLE_SIZES[key] || { pin: 1.0, arrow: 1.0 };
        return {
            pin: (custom && custom.pin) || def.pin,
            arrow: (custom && custom.arrow) || def.arrow
        };
    }

    // --- 카테고리별 박스 모양(직사각형/둥근사각형/원형) · 채우기 유무 · 번호 표시형식(NO.접두어 유무) ---
    const DEFAULT_STYLE_SHAPES = {
        defectStructural: { shape: 'rect', fill: false, numberFormat: 'no' },
        defectNonStructural: { shape: 'rect', fill: false, numberFormat: 'no' },
        defectFinish: { shape: 'rect', fill: false, numberFormat: 'no' },
        defectStructuralGood: { shape: 'rect', fill: false, numberFormat: 'no' },
        defectNonStructuralGood: { shape: 'rect', fill: false, numberFormat: 'no' },
        defectFinishGood: { shape: 'rect', fill: false, numberFormat: 'no' },
        ndtMeasure: { shape: 'rounded', fill: true, numberFormat: 'no' },
        ndtStrength: { shape: 'rounded', fill: true, numberFormat: 'no' },
        ndtCarbonation: { shape: 'rounded', fill: true, numberFormat: 'no' },
        ndtTilt: { shape: 'rect', fill: false, numberFormat: 'no' },
        ndtSettlement: { shape: 'rect', fill: false, numberFormat: 'no' },
        ndtMemberDisp: { shape: 'rect', fill: false, numberFormat: 'no' }
    };

    function getStyleShape(key) {
        const custom = state.styleShapes && state.styleShapes[key];
        const def = DEFAULT_STYLE_SHAPES[key] || { shape: 'rect', fill: false, numberFormat: 'no' };
        return {
            shape: (custom && custom.shape) || def.shape,
            fill: (custom && custom.fill !== undefined) ? custom.fill : def.fill,
            numberFormat: (custom && custom.numberFormat) || def.numberFormat
        };
    }

    // 박스 테두리 경로 생성(직사각형/둥근사각형/원형 공용) — fill()/stroke() 호출 전에 사용
    function traceStyledBoxPath(ctx, w, h, shape, cornerRadius) {
        ctx.beginPath();
        if (shape === 'circle') {
            ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
        } else if (shape === 'rounded') {
            ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(cornerRadius, w / 2, h / 2));
        } else {
            ctx.rect(-w / 2, -h / 2, w, h);
        }
    }

    // 카테고리 설정에 따라 "NO.01" ↔ "01" 형식으로 번호 라벨 텍스트 변환
    function formatPinNumberLabel(rawText, styleKey) {
        if (getStyleShape(styleKey).numberFormat !== 'plain') return rawText;
        const m = String(rawText || '').match(/(\d+)/);
        return m ? m[1] : (rawText || '');
    }

    // NDT 카테고리 → 스타일 설정 키 매핑 (색상/크기 공용)
    function getNdtStyleKey(cat) {
        if (cat === '부재변위') return 'ndtMemberDisp';
        if (cat === '변위') return 'ndtSettlement';
        if (cat === '기울기') return 'ndtTilt';
        if (cat === '실측') return 'ndtMeasure';
        if (cat === '탄산화') return 'ndtCarbonation';
        return 'ndtStrength';
    }

    // --- 바닥 수직변위: 그룹(NO.박스) + 다중 레벨 포인트 데이터 ---
    const NDT_DISPLACEMENT_COLORS = ['#ef4444', '#3b82f6', '#f97316', '#22c55e', '#a855f7', '#eab308', '#06b6d4', '#ec4899'];
    const NDT_GRADE_BADGES = {
        'a등급': '<span class="badge" style="background:rgba(34,197,94,0.2); color:#4ade80; border:1px solid rgba(34,197,94,0.4); font-weight:800;">a등급 (1/750이상)</span>',
        'b등급': '<span class="badge" style="background:rgba(56,189,248,0.2); color:#38bdf8; border:1px solid rgba(56,189,248,0.4); font-weight:800;">b등급 (1/500이하)</span>',
        'c등급': '<span class="badge" style="background:rgba(250,204,21,0.2); color:#facc15; border:1px solid rgba(250,204,21,0.4); font-weight:800;">c등급 (1/250이하)</span>',
        'd등급': '<span class="badge" style="background:rgba(249,115,22,0.2); color:#fb923c; border:1px solid rgba(249,115,22,0.4); font-weight:800;">d등급 (1/150이하)</span>',
        'e등급': '<span class="badge" style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid rgba(239,68,68,0.4); font-weight:800;">e등급 (1/150초과)</span>'
    };

    function getCurrentFloorDisplacementGroups(cat = null) {
        if (!state.currentBuildingId) return [];
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        if (!state.ndtDisplacementGroups) state.ndtDisplacementGroups = {};
        if (!state.ndtDisplacementGroups[key]) state.ndtDisplacementGroups[key] = [];
        const groups = state.ndtDisplacementGroups[key];
        const targetCat = cat || currentNdtCategory || '변위';
        if (targetCat === '부재변위') {
            return groups.filter(g => g.category === '부재변위');
        } else if (targetCat === '변위') {
            return groups.filter(g => !g.category || g.category === '변위');
        }
        return groups;
    }

    function nextDisplacementGroupNo(cat = null) {
        const groups = getCurrentFloorDisplacementGroups(cat);
        return `NO.${String(groups.length + 1).padStart(2, '0')}`;
    }

    // 외벽 기울기: 높이 H(mm) 대비 변위량(mm)으로 1/H 기울기 비율과 기울기 안전등급 산정
    function calcTiltGrade(lengthMm, deltaMm) {
        const h = lengthMm || 3000;
        const delta = Math.abs(deltaMm) || 0;
        if (delta <= 0 || h <= 0) return { tiltRatio: '1/750', grade: 'a등급' };
        const ratioInv = Math.round(h / delta);
        let grade = 'e등급';
        if (ratioInv >= 750) grade = 'a등급';
        else if (ratioInv >= 500) grade = 'b등급';
        else if (ratioInv >= 250) grade = 'c등급';
        else if (ratioInv >= 150) grade = 'd등급';
        return { tiltRatio: `1/${ratioInv}`, grade };
    }

    // 부재변위(처짐): 시설물의 안전 및 유지관리 실시 세부지침(건축물편) [표 6.34] 부재의 변위·변형에 대한 상태평가기준
    // 보/슬래브 처짐 δ, 경간길이 L → a·b: L/480 이하(육안상 경미한 손상 동반 시 b), c: L/240 이하, d: L/150 이하, e: L/150 초과
    // 기울기(calcTiltGrade)와 달리 등급 구간이 480/240/150 3단계뿐이며 360 구간이 없음
    // hasMinorDamage: 균열 등 경미한 손상 동반 여부(육안 확인, 체크박스 입력) — 처짐비가 L/480 이내여도 손상이 있으면 a 대신 b등급
    function calcMemberDispGrade(lengthMm, deltaMm, hasMinorDamage = false) {
        const l = lengthMm || 5000;
        const delta = Math.abs(deltaMm) || 0;
        const bestGrade = hasMinorDamage ? 'b등급' : 'a등급';
        if (delta <= 0 || l <= 0) return { tiltRatio: '1/480', grade: bestGrade };
        const ratioInv = Math.round(l / delta);
        let grade = 'e등급';
        if (ratioInv >= 480) grade = bestGrade;
        else if (ratioInv >= 240) grade = 'c등급';
        else if (ratioInv >= 150) grade = 'd등급';
        return { tiltRatio: `1/${ratioInv}`, grade };
    }

    // 그룹(부동침하 또는 부재처짐) 변위량/처짐량 및 안전등급 연산
    function calcGroupDisplacement(group) {
        const points = group.points || [];
        if (points.length === 0) return { delta: 0, absDelta: 0, tiltRatio: '1/750', grade: 'a등급' };

        const isMemberDisp = group.category === '부재변위';
        const lengthMm = (group.measureLength || 0) * 1000;

        if (isMemberDisp) {
            let delta = 0;
            if (points.length >= 3) {
                const first = points[0].level;
                const last = points[points.length - 1].level;
                const midIdx = Math.floor(points.length / 2);
                const mid = points[midIdx].level;
                const endAvg = (first + last) / 2.0;
                delta = endAvg - mid;
            } else if (points.length === 2) {
                delta = points[0].level - points[1].level;
            } else {
                delta = points[0].level;
            }
            const absDelta = Math.abs(delta);
            const calc = calcMemberDispGrade(lengthMm, absDelta, group.hasMinorDamage);
            return { delta, absDelta, tiltRatio: calc.tiltRatio, grade: calc.grade };
        } else {
            const first = points[0];
            const last = points[points.length - 1];
            const delta = (first && last) ? (first.level - last.level) : 0;
            const absDelta = Math.abs(delta);
            const calc = calcTiltGrade(lengthMm, absDelta);
            return { delta, absDelta, tiltRatio: calc.tiltRatio, grade: calc.grade };
        }
    }

    // 수직변위/부재변위 그룹의 라벨 박스/포인트 원 히트테스트
    function findNdtDisplacementHit(vx, vy) {
        const groups = getCurrentFloorDisplacementGroups(currentNdtCategory);
        for (let i = groups.length - 1; i >= 0; i--) {
            const group = groups[i];
            const groupSize = getStyleSize(group.category === '부재변위' ? 'ndtMemberDisp' : 'ndtSettlement');
            for (let j = group.points.length - 1; j >= 0; j--) {
                const p = group.points[j];
                if (Math.hypot(vx - p.x, vy - p.y) < 22 * groupSize.pin) {
                    return { type: 'point', group, point: p };
                }
            }
            const bx = group.boxX !== undefined ? group.boxX : (group.points[0] ? group.points[0].x : 100);
            const by = group.boxY !== undefined ? group.boxY : (group.points[0] ? group.points[0].y : 100);
            if (Math.hypot(vx - bx, vy - by) < 34 * groupSize.pin) {
                return { type: 'box', group };
            }
        }
        return null;
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
        const catMap = { '실측': 'Dim', '강도': 'Strength', '탄산화': 'Carb', '기울기': 'Tilt', '변위': 'Vert', '부재변위': 'MemberDisp' };
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

        // Filter NDT pins by current active category tab
        let ndtItems = getCurrentFloorNdtData();
        const currentCat = currentNdtCategory || '실측';
        if (currentCat === '기울기') {
            ndtItems = ndtItems.filter(item => item.category === currentCat);
        } else if (currentCat === '변위' || currentCat === '부재변위') {
            ndtItems = [];
        } else if (currentCat === '실측') {
            ndtItems = ndtItems.filter(item => item.category === '실측');
        } else {
            // 강도 / 탄산화 탭: 같은 도면에 함께 표시 (부재 실측은 별도 도면)
            ndtItems = ndtItems.filter(item => ['강도', '탄산화'].includes(item.category));
        }
        ndtItems.forEach(item => drawNdtPin(ctx, item));
        if (currentCat === '변위' || currentCat === '부재변위') {
            getCurrentFloorDisplacementGroups(currentCat).forEach(g => drawNdtDisplacementGroup(ctx, g));
        }

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
        const ndtStyleKey = getNdtStyleKey(cat);
        const ndtSize = getStyleSize(ndtStyleKey);
        const ndtShapeCfg = getStyleShape(ndtStyleKey);
        const pinScale = ndtSize.pin;
        const arrowScale = ndtSize.arrow;

        let noStr = item.no || 'NO.01';
        if (noStr.startsWith('기울기-') || noStr.startsWith('NDT-') || noStr.startsWith('변위-')) {
            const numPart = noStr.replace(/^[^\d]+/, '');
            noStr = `NO.${numPart.length === 1 ? '0' + numPart : numPart}`;
        }
        noStr = formatPinNumberLabel(noStr, ndtStyleKey);

        if (cat === '기울기' || cat === '변위' || cat === '부재변위') {
            // CAD Callout Style rendering (100% matching user reference photo & draggable!)
            const tiltVal = item.avgValue || (item.v1 ? `${item.v1}mm` : '3mm');
            const dispDir = item.dispDirection || '←';
            const calloutColor = getStyleColor(ndtStyleKey);

            ctx.save();

            // 1. Draw Arrow pointing from Box to Target Point
            ctx.strokeStyle = isBeingDragged ? '#facc15' : calloutColor;
            ctx.fillStyle = isBeingDragged ? '#facc15' : calloutColor;
            ctx.lineWidth = (isBeingDragged ? 4.5 : 3.5) * arrowScale;

            const dx = targetX - x;
            const dy = targetY - y;
            const dist = Math.hypot(dx, dy);

            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(targetX, targetY);
            if (isBeingDragged) ctx.setLineDash([5, 3]);
            ctx.stroke();
            ctx.setLineDash([]);

            // 지시선 끝 모양(state.tipShape) 설정에 따라 화살표머리 또는 원 중 하나만 표시 (동시에 둘 다 그리지 않음)
            if (state.tipShape === 'circle') {
                ctx.beginPath();
                ctx.arc(targetX, targetY, (isBeingDragged ? 6 : 4) * arrowScale, 0, Math.PI * 2);
                ctx.fill();
            } else if (dist > 5) {
                const angle = Math.atan2(dy, dx);
                const headLen = (isBeingDragged ? 16 : 14) * arrowScale;
                ctx.beginPath();
                ctx.moveTo(targetX, targetY);
                ctx.lineTo(targetX - headLen * Math.cos(angle - Math.PI / 6), targetY - headLen * Math.sin(angle - Math.PI / 6));
                ctx.lineTo(targetX - headLen * Math.cos(angle + Math.PI / 6), targetY - headLen * Math.sin(angle + Math.PI / 6));
                ctx.closePath();
                ctx.fill();
            }

            // 2. Draw 3-Column CAD Table Box at (x, y) - Un-rotated to stay 100% horizontal on user screen!
            ctx.translate(x, y);
            if (ndtRotationAngle === 90) {
                ctx.rotate((-90 * Math.PI) / 180);
            } else if (ndtRotationAngle === 180) {
                ctx.rotate((-180 * Math.PI) / 180);
            } else if (ndtRotationAngle === 270) {
                ctx.rotate((-270 * Math.PI) / 180);
            }

            const boxW = 190 * pinScale;
            const boxH = 50 * pinScale;
            const col1W = 60 * pinScale;
            const col2W = 65 * pinScale;
            const col3W = 65 * pinScale;

            // Box Background & Outer Border (채우기 유무/모양은 카테고리 설정을 따름)
            const calloutBgColor = ndtShapeCfg.fill ? calloutColor : '#ffffff';
            const calloutTextColor = ndtShapeCfg.fill ? '#ffffff' : (isBeingDragged ? '#d97706' : calloutColor);
            ctx.fillStyle = calloutBgColor;
            ctx.strokeStyle = isBeingDragged ? '#facc15' : calloutColor;
            ctx.lineWidth = (isBeingDragged ? 3.5 : 2.5) * pinScale;
            if (isBeingDragged) {
                ctx.shadowColor = '#facc15';
                ctx.shadowBlur = 12 * pinScale;
            }
            traceStyledBoxPath(ctx, boxW, boxH, ndtShapeCfg.shape, 8 * pinScale);
            ctx.fill();
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Vertical & Horizontal Grid Dividers
            ctx.strokeStyle = isBeingDragged ? '#facc15' : calloutTextColor;
            ctx.lineWidth = 1.5 * pinScale;
            ctx.beginPath();
            ctx.moveTo(-boxW / 2 + col1W, -boxH / 2);
            ctx.lineTo(-boxW / 2 + col1W, boxH / 2);

            ctx.moveTo(-boxW / 2 + col1W + col2W, -boxH / 2);
            ctx.lineTo(-boxW / 2 + col1W + col2W, boxH / 2);

            ctx.moveTo(-boxW / 2 + col1W, 0);
            ctx.lineTo(boxW / 2, 0);
            ctx.stroke();

            // Cell Text Formatting
            ctx.fillStyle = calloutTextColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Column 1: NO.01
            ctx.font = `bold ${Math.round(13 * pinScale)}px monospace`;
            ctx.fillText(noStr, -boxW / 2 + col1W / 2, 0);

            // Column 2: Top "변 위 량" / "처 짐 량", Bottom "변위방향"
            const labelTop = (cat === '부재변위') ? '처 짐 량' : '변 위 량';
            ctx.font = `bold ${Math.round(11 * pinScale)}px sans-serif`;
            ctx.fillText(labelTop, -boxW / 2 + col1W + col2W / 2, -boxH / 4);
            ctx.fillText('변위방향', -boxW / 2 + col1W + col2W / 2, boxH / 4);

            // Column 3: Top tiltVal (e.g. 3mm), Bottom dispDir (e.g. ←)
            ctx.font = `bold ${Math.round(12 * pinScale)}px sans-serif`;
            ctx.fillText(tiltVal, -boxW / 2 + col1W + col2W + col3W / 2, -boxH / 4);

            ctx.font = `bold ${Math.round(16 * pinScale)}px sans-serif`;
            ctx.fillText(dispDir, -boxW / 2 + col1W + col2W + col3W / 2, boxH / 4);

            ctx.restore();
            return;
        }

        // Standard Pin for other NDT items
        const catColors = {
            '실측': getStyleColor('ndtMeasure'),
            '강도': getStyleColor('ndtStrength'),
            '탄산화': getStyleColor('ndtCarbonation')
        };
        const color = isBeingDragged ? '#facc15' : (catColors[cat] || '#38bdf8');

        // 리더라인(화살표): 번호 박스(x,y) -> 실제 측정 지점(targetX,targetY)
        const stdDx = targetX - x;
        const stdDy = targetY - y;
        const stdDist = Math.hypot(stdDx, stdDy);
        if (stdDist > 3) {
            ctx.save();
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = (isBeingDragged ? 4 : 3) * arrowScale;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(targetX, targetY);
            if (isBeingDragged) ctx.setLineDash([5, 3]);
            ctx.stroke();
            ctx.setLineDash([]);

            const stdAngle = Math.atan2(stdDy, stdDx);
            const stdHeadLen = (isBeingDragged ? 14 : 12) * arrowScale;
            ctx.beginPath();
            ctx.moveTo(targetX, targetY);
            ctx.lineTo(targetX - stdHeadLen * Math.cos(stdAngle - Math.PI / 6), targetY - stdHeadLen * Math.sin(stdAngle - Math.PI / 6));
            ctx.lineTo(targetX - stdHeadLen * Math.cos(stdAngle + Math.PI / 6), targetY - stdHeadLen * Math.sin(stdAngle + Math.PI / 6));
            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.arc(targetX, targetY, (isBeingDragged ? 5 : 3.5) * arrowScale, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        ctx.save();
        ctx.translate(x, y);
        // 보는 방향(도면 회전)과 무관하게 번호 박스는 항상 똑바로 보이도록 역회전
        if (ndtRotationAngle === 90) {
            ctx.rotate((-90 * Math.PI) / 180);
        } else if (ndtRotationAngle === 180) {
            ctx.rotate((-180 * Math.PI) / 180);
        } else if (ndtRotationAngle === 270) {
            ctx.rotate((-270 * Math.PI) / 180);
        }

        const stdBgColor = ndtShapeCfg.fill ? color : '#ffffff';
        const stdTextColor = ndtShapeCfg.fill ? '#ffffff' : color;
        ctx.fillStyle = stdBgColor;
        ctx.strokeStyle = color;
        ctx.lineWidth = (isBeingDragged ? 3.5 : 2.5) * pinScale;
        ctx.shadowColor = color;
        ctx.shadowBlur = (isBeingDragged ? 16 : 8) * pinScale;

        const w = 78 * pinScale;
        const h = 26 * pinScale;
        traceStyledBoxPath(ctx, w, h, ndtShapeCfg.shape, 6 * pinScale);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.fillStyle = stdTextColor;
        ctx.font = `bold ${Math.round(11 * pinScale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(noStr, 0, 0);

        ctx.restore();
    }

    // 바닥 수직변위: 그룹 라벨 박스(측정위치) 1개 + 각 레벨 포인트로 뻗는 리더라인 + 포인트 원(순번/레벨값)
    function drawNdtDisplacementGroup(ctx, group) {
        const groupStyleKey = group.category === '부재변위' ? 'ndtMemberDisp' : 'ndtSettlement';
        const groupSize = getStyleSize(groupStyleKey);
        const pinScale = groupSize.pin;
        const arrowScale = groupSize.arrow;
        const color = group.color || getStyleColor(groupStyleKey);
        const boxX = group.boxX !== undefined ? group.boxX : (group.points[0] ? group.points[0].x : 100);
        const boxY = group.boxY !== undefined ? group.boxY : (group.points[0] ? group.points[0].y : 100);
        const isGroupDragged = activeDragNdtDisplacementGroup === group && !activeDragNdtDisplacementPoint;

        // 리더라인: 박스 -> 각 포인트 (선은 그대로 그리되 투명 처리하여 화면에는 보이지 않음)
        group.points.forEach(p => {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(boxX, boxY);
            ctx.lineTo(p.x, p.y);
            ctx.strokeStyle = 'transparent';
            ctx.lineWidth = 1.5 * arrowScale;
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.restore();
        });

        // 포인트 원 (순번 + 레벨값)
        const groupCounterRotate = ndtRotationAngle === 90 ? -90 : (ndtRotationAngle === 180 ? -180 : (ndtRotationAngle === 270 ? -270 : 0));
        group.points.forEach((p, idx) => {
            const isPtDragged = activeDragNdtDisplacementGroup === group && activeDragNdtDisplacementPoint === p;
            const r = (isPtDragged ? 15 : 12) * pinScale;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.fillStyle = isPtDragged ? '#facc15' : color;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5 * pinScale;
            ctx.stroke();

            // 보는 방향(도면 회전)과 무관하게 순번 숫자는 항상 똑바로 보이도록 역회전, 측정값은 표시하지 않음
            if (groupCounterRotate) ctx.rotate((groupCounterRotate * Math.PI) / 180);
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${Math.round(10 * pinScale)}px sans-serif`;
            ctx.fillText(`${idx + 1}`, 0, 0);
            ctx.restore();
        });

        // 그룹 라벨 박스 (측정 구역 번호만 표시) — 보는 방향과 무관하게 항상 똑바로 보이도록 역회전
        const groupShapeCfg = getStyleShape(groupStyleKey);
        ctx.save();
        ctx.translate(boxX, boxY);
        if (groupCounterRotate) ctx.rotate((groupCounterRotate * Math.PI) / 180);
        ctx.fillStyle = groupShapeCfg.fill ? color : '#ffffff';
        ctx.strokeStyle = isGroupDragged ? '#facc15' : color;
        ctx.lineWidth = (isGroupDragged ? 3 : 2) * pinScale;
        const w = 56 * pinScale;
        const h = 22 * pinScale;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 5 * pinScale;
        traceStyledBoxPath(ctx, w, h, groupShapeCfg.shape, 6 * pinScale);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = groupShapeCfg.fill ? '#ffffff' : color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.round(12 * pinScale)}px sans-serif`;
        ctx.fillText(formatPinNumberLabel(group.groupNo, groupStyleKey), 0, 0);
        ctx.restore();
    }

    // 긴 한 줄 텍스트를 지정된 폭에 맞춰 여러 줄로 나눠 그림 (공백 기준)
    function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
        const words = text.split(' ');
        let line = '';
        let curY = y;
        words.forEach(word => {
            const testLine = line ? `${line} ${word}` : word;
            if (ctx.measureText(testLine).width > maxWidth && line) {
                ctx.fillText(line, x, curY);
                line = word;
                curY += lineHeight;
            } else {
                line = testLine;
            }
        });
        if (line) ctx.fillText(line, x, curY);
    }

    // 바닥 수직변위 그룹 하나의 꺾은선 그래프를 캔버스로 그려 PNG dataURL로 반환
    function renderNdtDisplacementChartDataUrl(group, floorCode) {
        try {
            const canvas = document.createElement('canvas');
            const cw = 900;
            const ch = 620;
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, cw, ch);

            const floorLabel = (typeof window.getFloorLabelFromCode === 'function') ? window.getFloorLabelFromCode(floorCode) : (floorCode || '');
            const chartColor = group.color || getStyleColor(group.category === '부재변위' ? 'ndtMemberDisp' : 'ndtSettlement');
            const catLabel = group.category === '부재변위' ? '부재변위(처짐)' : '부동침하 기울기';
            const title = `${floorLabel} ${group.locationType} ${catLabel} (${group.groupNo})`;

            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 24px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(title, cw / 2, 45);

            const points = group.points || [];
            const marginL = 80, marginR = 60, marginT = 90, marginB = 140;
            const plotW = cw - marginL - marginR;
            const plotH = ch - marginT - marginB;

            if (points.length === 0) {
                ctx.font = '16px sans-serif';
                ctx.fillStyle = '#94a3b8';
                ctx.fillText('측정 지점이 없습니다.', cw / 2, ch / 2);
                return canvas.toDataURL('image/png');
            }

            const levels = points.map(p => p.level);
            let minL = Math.min(...levels, 0);
            let maxL = Math.max(...levels, 0);
            if (minL === maxL) { minL -= 1; maxL += 1; }
            const pad = (maxL - minL) * 0.15;
            minL -= pad;
            maxL += pad;

            const xFor = (idx) => marginL + (points.length === 1 ? plotW / 2 : (idx / (points.length - 1)) * plotW);
            const yFor = (level) => marginT + plotH - ((level - minL) / (maxL - minL)) * plotH;

            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(marginL, marginT);
            ctx.lineTo(marginL, marginT + plotH);
            ctx.lineTo(marginL + plotW, marginT + plotH);
            ctx.stroke();

            if (minL < 0 && maxL > 0) {
                const zeroY = yFor(0);
                ctx.strokeStyle = '#e2e8f0';
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(marginL, zeroY);
                ctx.lineTo(marginL + plotW, zeroY);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            ctx.strokeStyle = chartColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            points.forEach((p, idx) => {
                const x = xFor(idx);
                const y = yFor(p.level);
                if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();

            points.forEach((p, idx) => {
                const x = xFor(idx);
                const y = yFor(p.level);
                ctx.fillStyle = chartColor;
                ctx.beginPath();
                ctx.arc(x, y, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.fillStyle = '#0f172a';
                ctx.font = 'bold 13px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`${p.level}mm`, x, y - 14);

                ctx.fillStyle = '#64748b';
                ctx.font = '12px sans-serif';
                ctx.fillText(`${idx + 1}`, x, marginT + plotH + 20);
            });

            ctx.fillStyle = '#64748b';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(`${maxL.toFixed(1)}`, marginL - 10, marginT + 4);
            ctx.fillText(`${minL.toFixed(1)}`, marginL - 10, marginT + plotH + 4);

            ctx.textAlign = 'left';
            ctx.fillStyle = '#334155';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText('측정값', marginL, marginT + plotH + 55);
            ctx.font = '13px sans-serif';
            const listText = points.map((p, idx) => `${idx + 1}번: ${p.level}mm`).join('    ');
            wrapCanvasText(ctx, listText, marginL, marginT + plotH + 78, plotW + marginR - 10, 20);

            return canvas.toDataURL('image/png');
        } catch (e) {
            console.warn('renderNdtDisplacementChartDataUrl error:', e);
            return null;
        }
    }

    window.showNdtDisplacementChart = function(groupId) {
        const group = getCurrentFloorDisplacementGroups().find(g => g.id === groupId);
        if (!group) return;
        const dataUrl = renderNdtDisplacementChartDataUrl(group, state.currentFloor);
        if (!dataUrl) {
            window.showToast('그래프를 생성할 수 없습니다.', 'error');
            return;
        }
        const img = document.getElementById('ndtDispChartImage');
        if (img) img.src = dataUrl;
        const modal = document.getElementById('ndtDisplacementChartModal');
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('open');
        }
    };

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

            // 바닥 수직변위 및 부재변위: 그룹 박스/포인트 원 히트 시 드래그 대기, 빈 곳 클릭 시 새 지점 등록
            if (currentNdtCategory === '변위' || currentNdtCategory === '부재변위') {
                const hitDisp = findNdtDisplacementHit(vx, vy);
                if (hitDisp) {
                    pendingNdtDispHit = { hit: hitDisp };
                    return;
                }
                if (ndtMode === 'MARK') {
                    isNdtDisplacementMarking = true;
                    window._ndtDispMarkCoords = { x: vx, y: vy };
                    return;
                }
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

            if (pendingNdtDispHit && !isDraggingNdtDisplacement) {
                const dx = e.clientX - ndtStartMouseX;
                const dy = e.clientY - ndtStartMouseY;
                if (Math.hypot(dx, dy) > 6) {
                    isDraggingNdtDisplacement = true;
                    activeDragNdtDisplacementGroup = pendingNdtDispHit.hit.group;
                    activeDragNdtDisplacementPoint = pendingNdtDispHit.hit.type === 'point' ? pendingNdtDispHit.hit.point : null;
                    pendingNdtDispHit = null;
                    canvas.style.cursor = 'move';
                } else {
                    return;
                }
            }

            if (isDraggingNdtDisplacement && activeDragNdtDisplacementGroup) {
                if (activeDragNdtDisplacementPoint) {
                    activeDragNdtDisplacementPoint.x = vx;
                    activeDragNdtDisplacementPoint.y = vy;
                } else {
                    activeDragNdtDisplacementGroup.boxX = vx;
                    activeDragNdtDisplacementGroup.boxY = vy;
                }
                drawNdtCanvas();
            } else if (isDraggingNdtPin && activeDragNdtPin) {
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
            if (pendingNdtDispHit && !isDraggingNdtDisplacement) {
                const hit = pendingNdtDispHit.hit;
                pendingNdtDispHit = null;
                if (hit.type === 'point') {
                    openNdtDisplacementModal(hit.point.x, hit.point.y, hit.group, hit.point);
                } else {
                    openNdtDisplacementGroupEditModal(hit.group);
                }
                return;
            }
            pendingNdtDispHit = null;
            if (isDraggingNdtDisplacement) {
                isDraggingNdtDisplacement = false;
                activeDragNdtDisplacementGroup = null;
                activeDragNdtDisplacementPoint = null;
                saveStateToLocalStorage();
                const canvas = document.getElementById('ndtCanvas');
                if (canvas) canvas.style.cursor = ndtMode === 'MARK' ? 'crosshair' : 'grab';
                drawNdtCanvas();
            }
            if (isNdtDisplacementMarking) {
                isNdtDisplacementMarking = false;
                const coords = window._ndtDispMarkCoords || { x: 100, y: 100 };
                openNdtDisplacementModal(coords.x, coords.y);
            }
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

                if (currentNdtCategory === '변위' || currentNdtCategory === '부재변위') {
                    const hitDisp = findNdtDisplacementHit(vx, vy);
                    if (hitDisp) {
                        pendingNdtDispHit = { hit: hitDisp };
                        return;
                    }
                    if (ndtMode === 'MARK') {
                        isNdtDisplacementMarking = true;
                        window._ndtDispMarkCoords = { x: vx, y: vy };
                        return;
                    }
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
            } else if (!isNdtPinching && (pendingNdtDispHit || isDraggingNdtDisplacement) && e.touches.length === 1) {
                const canvas = document.getElementById('ndtCanvas');
                if (!canvas) return;
                const touch = e.touches[0];

                if (pendingNdtDispHit && !isDraggingNdtDisplacement) {
                    const dx = touch.clientX - ndtStartMouseX;
                    const dy = touch.clientY - ndtStartMouseY;
                    if (Math.hypot(dx, dy) > 6) {
                        isDraggingNdtDisplacement = true;
                        activeDragNdtDisplacementGroup = pendingNdtDispHit.hit.group;
                        activeDragNdtDisplacementPoint = pendingNdtDispHit.hit.type === 'point' ? pendingNdtDispHit.hit.point : null;
                        pendingNdtDispHit = null;
                    } else {
                        return;
                    }
                }

                const rect = canvas.getBoundingClientRect();
                const mouseX = touch.clientX - rect.left;
                const mouseY = touch.clientY - rect.top;
                const rawVx = (mouseX - ndtView.offsetX) / ndtView.scale;
                const rawVy = (mouseY - ndtView.offsetY) / ndtView.scale;
                const pt = viewToNdtImgCoords(rawVx, rawVy);
                const vx = pt.x;
                const vy = pt.y;

                if (activeDragNdtDisplacementPoint) {
                    activeDragNdtDisplacementPoint.x = vx;
                    activeDragNdtDisplacementPoint.y = vy;
                } else if (activeDragNdtDisplacementGroup) {
                    activeDragNdtDisplacementGroup.boxX = vx;
                    activeDragNdtDisplacementGroup.boxY = vy;
                }
                drawNdtCanvas();
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
            if (pendingNdtDispHit && !isDraggingNdtDisplacement) {
                const hit = pendingNdtDispHit.hit;
                pendingNdtDispHit = null;
                if (hit.type === 'point') {
                    openNdtDisplacementModal(hit.point.x, hit.point.y, hit.group, hit.point);
                } else {
                    openNdtDisplacementGroupEditModal(hit.group);
                }
                return;
            }
            pendingNdtDispHit = null;
            if (isDraggingNdtDisplacement) {
                isDraggingNdtDisplacement = false;
                activeDragNdtDisplacementGroup = null;
                activeDragNdtDisplacementPoint = null;
                saveStateToLocalStorage();
                drawNdtCanvas();
            }
            if (isNdtDisplacementMarking) {
                isNdtDisplacementMarking = false;
                const coords = window._ndtDispMarkCoords || { x: 100, y: 100 };
                openNdtDisplacementModal(coords.x, coords.y);
            }
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

        if (currentCat === '변위' || currentCat === '부재변위') {
            renderNdtDisplacementSummaryTable(tbody, thead);
            return;
        }

        if (currentCat === '기울기') {
            items = items.filter(x => x.category === currentCat);
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
            const colSpan = (currentCat === '기울기' || currentCat === '변위' || currentCat === '부재변위') ? 7 : 8;
            tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; color: #94a3b8; padding: 1.5rem;">등록된 ${currentCat} 측정 데이터가 없습니다. 도면 상에 [📍 NDT 위치 마킹]을 클릭해 주세요.</td></tr>`;
            return;
        }

        const catBadges = {
            '실측': '<span class="badge" style="background:rgba(2,132,199,0.2); color:#38bdf8; border:1px solid rgba(2,132,199,0.4);">📏 부재실측</span>',
            '강도': '<span class="badge" style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid rgba(239,68,68,0.4);">🔨 콘크리트 강도</span>',
            '탄산화': '<span class="badge" style="background:rgba(234,179,8,0.2); color:#facc15; border:1px solid rgba(234,179,8,0.4);">🧪 탄산화</span>',
            '기울기': '<span class="badge" style="background:rgba(168,85,247,0.2); color:#c084fc; border:1px solid rgba(168,85,247,0.4);">📐 외벽기울기</span>',
            '변위': '<span class="badge" style="background:rgba(16,185,129,0.2); color:#34d399; border:1px solid rgba(16,185,129,0.4);">📉 부동침하 기울기</span>',
            '부재변위': '<span class="badge" style="background:rgba(20,184,166,0.2); color:#2dd4bf; border:1px solid rgba(20,184,166,0.4);">🏗️ 부재변위</span>'
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

        if (currentCat === '기울기' || currentCat === '부재변위') {
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

    // 수직변위/부재변위: 그룹 단위(측정 구역 하나 = 행 하나) 결과표
    function renderNdtDisplacementSummaryTable(tbody, thead) {
        const groups = getCurrentFloorDisplacementGroups();
        const isMemberDisp = currentNdtCategory === '부재변위';

        if (thead) {
            const col4Name = isMemberDisp ? '처짐량(mm)' : '변위량(mm)';
            const col5Name = isMemberDisp ? '처짐비(1/L)' : '기울기(1/L)';
            const col6Name = isMemberDisp ? '처짐 등급' : '안전 등급';
            thead.innerHTML = `
                <th>조사번호</th>
                <th>측정위치</th>
                <th>측정길이(m)</th>
                <th>${col4Name}</th>
                <th>${col5Name}</th>
                <th>${col6Name}</th>
                <th>관리</th>
            `;
        }

        if (groups.length === 0) {
            const labelStr = isMemberDisp ? '부재변위(부재처짐)' : '부동침하 기울기';
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 1.5rem;">등록된 ${labelStr} 측정 데이터가 없습니다. 도면 상에 [📍 NDT 위치 마킹]을 클릭해 주세요.</td></tr>`;
            return;
        }

        tbody.innerHTML = groups.map(group => {
            const calc = calcGroupDisplacement(group);
            return `
                <tr>
                    <td style="font-weight:800; color:${group.color || getStyleColor(isMemberDisp ? 'ndtMemberDisp' : 'ndtSettlement')};">${group.groupNo}</td>
                    <td style="font-weight:700;">${group.locationType} (${group.points.length}개 지점)</td>
                    <td style="font-weight:700; color:#38bdf8;">${group.measureLength}</td>
                    <td style="font-weight:800; color:#f8fafc;">${calc.delta.toFixed(1)}</td>
                    <td style="font-weight:800; color:#c084fc;">${calc.tiltRatio}</td>
                    <td>${NDT_GRADE_BADGES[calc.grade] || NDT_GRADE_BADGES['a등급']}</td>
                    <td>
                        <button class="btn btn-sm btn-outline" style="border-color:#38bdf8; color:#38bdf8; padding:0.15rem 0.45rem;" onclick="window.showNdtDisplacementChart('${group.id}')">그래프</button>
                        <button class="btn btn-sm btn-outline" style="border-color:#38bdf8; color:#38bdf8; padding:0.15rem 0.45rem;" onclick="window.editNdtDisplacementGroup('${group.id}')">수정</button>
                        <button class="btn btn-sm btn-danger-outline" style="padding:0.15rem 0.45rem;" onclick="window.deleteNdtDisplacementGroup('${group.id}')">삭제</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    window.editNdtDisplacementGroup = function(groupId) {
        const group = getCurrentFloorDisplacementGroups().find(g => g.id === groupId);
        if (group) openNdtDisplacementGroupEditModal(group);
    };

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
        const dispGroups = getCurrentFloorDisplacementGroups();
        if (items.length === 0 && dispGroups.length === 0) {
            window.showToast('엑셀로 출력할 비파괴 조사 측정 데이터가 없습니다.', 'warning');
            return;
        }

        let csvContent = "\ufeff";
        const standardItems = items.filter(x => ['실측', '강도', '탄산화'].includes(x.category));
        const tiltItems = items.filter(x => ['기울기', '부재변위'].includes(x.category));

        if (standardItems.length > 0) {
            csvContent += "조사번호,조사항목,측정위치,부재명,측정수치,평균결과,상태판정\n";
            standardItems.forEach(item => {
                csvContent += `"${item.no}","${item.category}","${item.location}","${item.component}","${item.valuesText || ''}","${item.avgValue || ''}","${item.status}"\n`;
            });
        }
        if (tiltItems.length > 0) {
            if (standardItems.length > 0) csvContent += "\n";
            csvContent += "조사번호,조사항목,측정위치,높이/길이(H/L),변위/처짐량(mm),비율(1/N),안전등급\n";
            tiltItems.forEach(item => {
                const fmtH = formatHeightValue(item.height);
                const isMemberDisp = item.category === '부재변위';
                const hDigits = (fmtH || '').replace(/[^0-9.]/g, '');
                const avgDigits = (item.avgValue || '').replace(/[^0-9.-]/g, '');
                const h = parseFloat(hDigits) || (isMemberDisp ? 5000 : 3000);
                const delta = Math.abs(parseFloat(avgDigits) || 0);
                const calc = isMemberDisp ? calcMemberDispGrade(h, delta) : calcTiltGrade(h, delta);
                const ratioStr = item.tiltRatio || calc.tiltRatio;
                const gradeStr = item.grade || calc.grade;
                csvContent += `"${item.no}","${item.category}","${item.location}","${fmtH}","${item.avgValue || ''}","${ratioStr}","${gradeStr}"\n`;
            });
        }
        if (dispGroups.length > 0) {
            if (items.length > 0) csvContent += "\n";
            csvContent += "조사번호,조사항목,측정위치,측정길이(m),변위/처짐량(mm),비율(1/L),안전등급\n";
            dispGroups.forEach(group => {
                const calc = calcGroupDisplacement(group);
                const catLabel = group.category === '부재변위' ? '부재처짐' : '부동침하 기울기';
                csvContent += `"${group.groupNo}","${catLabel}","${group.locationType}","${group.measureLength}","${calc.delta.toFixed(1)}","${calc.tiltRatio}","${calc.grade}"\n`;
            });
        }

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

        const lblHeight = document.getElementById('lblNdtHeight');
        const lblTiltRatio = document.getElementById('lblNdtTiltRatio');
        const lblGrade = document.getElementById('lblNdtGrade');
        const v1El = document.getElementById('ndtVal1');
        const v2El = document.getElementById('ndtVal2');
        const v3El = document.getElementById('ndtVal3');

        if (cat === '부재변위') {
            if (stdGrp) stdGrp.style.display = 'none';
            if (statusGrp) statusGrp.style.display = 'none';
            if (tiltGrp) tiltGrp.style.display = 'flex';
            if (valTitle) valTitle.textContent = '📊 세점 측정값 (양 단부 평균 - 중앙부 = 처짐량 연산)';
            if (avgTitle) avgTitle.textContent = '⚡ 처짐량 (예: 3.2mm)';
            if (lblHeight) lblHeight.textContent = '📏 부재 길이 (L) *';
            if (lblTiltRatio) lblTiltRatio.textContent = '📐 처짐비 (1/L)';
            if (lblGrade) lblGrade.textContent = '🏷️ 처짐 안전등급';
            if (v1El) v1El.placeholder = '단부 1 (예: 5.0mm)';
            if (v2El) v2El.placeholder = '중앙부 (예: 2.0mm)';
            if (v3El) v3El.placeholder = '단부 2 (예: 5.0mm)';
        } else if (cat === '기울기') {
            if (stdGrp) stdGrp.style.display = 'none';
            if (statusGrp) statusGrp.style.display = 'none';
            if (tiltGrp) tiltGrp.style.display = 'flex';
            if (valTitle) valTitle.textContent = '📊 현장 측정값 (1~3회 입력 시 변위량 자동 연산)';
            if (avgTitle) avgTitle.textContent = '⚡ 변위량 (예: 3.2mm)';
            if (lblHeight) lblHeight.textContent = '📏 측정 높이 (H) *';
            if (lblTiltRatio) lblTiltRatio.textContent = '📐 기울기 비율 (1/H)';
            if (lblGrade) lblGrade.textContent = '🏷️ 기울기 안전등급';
            if (v1El) v1El.placeholder = '1회 (예: 3.0mm)';
            if (v2El) v2El.placeholder = '2회 (예: 3.5mm)';
            if (v3El) v3El.placeholder = '3회 (예: 3.0mm)';
        } else {
            if (stdGrp) stdGrp.style.display = 'flex';
            if (statusGrp) statusGrp.style.display = 'flex';
            if (tiltGrp) tiltGrp.style.display = 'none';
            if (valTitle) valTitle.textContent = '📊 현장 측정값 (1~3회 입력 시 평균 자동 연산)';
            if (avgTitle) avgTitle.textContent = '⚡ 평균 / 종합 결과값';
            if (v1El) v1El.placeholder = '1회 측정값';
            if (v2El) v2El.placeholder = '2회 측정값';
            if (v3El) v3El.placeholder = '3회 측정값';
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
            if (heightEl) heightEl.value = existingItem.height || (existingItem.category === '부재변위' ? 'L = 5,000mm' : 'H = 3,000mm');
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
            if (locEl) locEl.value = '';
            if (heightEl) heightEl.value = (cat === '부재변위' ? 'L = 5,000mm' : 'H = 3,000mm');
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
            const cat = document.getElementById('ndtCategory')?.value || '강도';
            const n1 = parseFloat(v1El?.value);
            const n2 = parseFloat(v2El?.value);
            const n3 = parseFloat(v3El?.value);

            if (cat === '부재변위') {
                if (!isNaN(n1) && !isNaN(n2) && !isNaN(n3)) {
                    // 세 점 측정: (단부 1 + 단부 2) / 2 - 중앙부 = 처짐량
                    const endAvg = (n1 + n3) / 2.0;
                    const delta = (endAvg - n2).toFixed(1);
                    if (avgEl) avgEl.value = `${delta}mm`;
                } else if (!isNaN(n1) && !isNaN(n2)) {
                    const delta = (n1 - n2).toFixed(1);
                    if (avgEl) avgEl.value = `${delta}mm`;
                } else {
                    const raw1 = (v1El?.value || '').trim();
                    if (raw1 && avgEl) avgEl.value = raw1;
                }
            } else {
                const nums = [n1, n2, n3].filter(n => !isNaN(n));
                if (nums.length > 0) {
                    const sum = nums.reduce((a, b) => a + b, 0);
                    const avg = (sum / nums.length).toFixed(1);
                    const unitStr = (cat === '기울기') ? 'mm' : '';
                    if (avgEl) avgEl.value = `${avg}${unitStr}`;
                } else {
                    const raw1 = (v1El?.value || '').trim();
                    if (raw1 && avgEl) avgEl.value = raw1;
                }
            }
            calcTiltAuto();
        }

        function calcTiltAuto() {
            const cat = document.getElementById('ndtCategory')?.value || '강도';
            if (cat !== '기울기' && cat !== '부재변위') return;

            const hStr = (heightEl?.value || '').replace(/[^0-9.]/g, '');
            const deltaStr = (avgEl?.value || '').replace(/[^0-9.-]/g, '');
            const h = parseFloat(hStr) || (cat === '부재변위' ? 5000 : 3000);
            const delta = Math.abs(parseFloat(deltaStr) || 0);

            const tiltRatioEl = document.getElementById('ndtTiltRatio');
            const gradeEl = document.getElementById('ndtGrade');

            if (delta > 0 && h > 0) {
                const calc = (cat === '부재변위') ? calcMemberDispGrade(h, delta) : calcTiltGrade(h, delta);
                if (tiltRatioEl) tiltRatioEl.value = calc.tiltRatio;
                if (gradeEl) gradeEl.value = calc.grade;
            } else {
                if (tiltRatioEl) tiltRatioEl.value = (cat === '부재변위' ? '1/480' : '1/750');
                if (gradeEl) gradeEl.value = 'a등급';
            }
        }

        const catEl = document.getElementById('ndtCategory');
        if (catEl) {
            catEl.addEventListener('change', () => {
                const cat = catEl.value;
                const pinId = document.getElementById('ndtPinId')?.value;
                if (!pinId) {
                    const items = getCurrentFloorNdtData();
                    const count = items.filter(x => x.category === cat).length + 1;
                    const seqStr = count < 10 ? `0${count}` : `${count}`;
                    const noEl = document.getElementById('ndtNo');
                    if (noEl) noEl.value = `NO.${seqStr}`;
                }
                window.toggleNdtModalFields();
                calcNdtAvg();
            });
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

                if (cat === '기울기' || cat === '부재변위') {
                    const hDigits = (formattedHeight || '').replace(/[^0-9.]/g, '');
                    const avgDigits = (avg || '').replace(/[^0-9.-]/g, '');
                    const h = parseFloat(hDigits) || (cat === '부재변위' ? 5000 : 3000);
                    const delta = Math.abs(parseFloat(avgDigits) || 0);
                    const calc = (cat === '부재변위') ? calcMemberDispGrade(h, delta) : calcTiltGrade(h, delta);
                    tiltRatio = calc.tiltRatio;
                    grade = calc.grade;
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
                            grade,
                            inspectorName: state.ndtData[key][idx].inspectorName || window.state.userName || ''
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
                        inspectorName: window.state.userName || '',
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
                        window.showToast('NDT 전용 도면이 등록되었습니다.', 'success');
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
                window.showToast('층별 원본 도면으로 연동이 완료되었습니다.', 'success');
            });
        }
    }

    // --- 수직변위 / 부재변위: 그룹/포인트 등록·수정 모달 ---

    function openNdtDisplacementModal(imgX, imgY, existingGroup, existingPoint) {
        const modal = document.getElementById('ndtDisplacementModal');
        if (!modal) return;
        window._pendingNdtDispCoords = { x: imgX, y: imgY };

        const groupIdEl = document.getElementById('ndtDispGroupId');
        const pointIdEl = document.getElementById('ndtDispPointId');
        const hintEl = document.getElementById('ndtDispModalHint');
        const infoBlock = document.getElementById('groupNdtDispInfo');
        const locEl = document.getElementById('ndtDispLocationType');
        const lenEl = document.getElementById('ndtDispMeasureLength');
        const damageRow = document.getElementById('ndtDispMinorDamageRow');
        const damageEl = document.getElementById('ndtDispHasMinorDamage');
        const levelEl = document.getElementById('ndtDispLevel');
        const modalTitleEl = modal.querySelector('.modal-header h3');
        const btnDelete = document.getElementById('btnDeleteNdtDispPoint');
        const btnAddAnother = document.getElementById('btnAddAnotherNdtPoint');

        const cat = (existingGroup ? existingGroup.category : currentNdtCategory) || '변위';
        const isMemberDisp = cat === '부재변위';

        if (modalTitleEl) {
            if (isMemberDisp) {
                modalTitleEl.innerHTML = `<i class="fa-solid fa-arrows-up-down" style="color: #38bdf8;"></i> 🏗️ 부재처짐 (부재변위) 측정`;
            } else {
                modalTitleEl.innerHTML = `<i class="fa-solid fa-arrows-up-down" style="color: #38bdf8;"></i> 📉 부동침하 기울기 측정`;
            }
        }

        const tmpl = window._ndtDisplacementTemplate;

        if (existingGroup && existingPoint) {
            const idx = existingGroup.points.indexOf(existingPoint);
            groupIdEl.value = existingGroup.id;
            pointIdEl.value = existingPoint.id;
            const ptRole = isMemberDisp ? (idx === 0 ? ' [단부 1]' : (idx === existingGroup.points.length - 1 ? ' [단부 2]' : ' [중앙부]')) : '';
            hintEl.textContent = `${existingGroup.groupNo} 그룹 - ${idx + 1}번 지점${ptRole} 수정`;
            infoBlock.style.display = 'none';
            if (damageRow) damageRow.style.display = 'none';
            levelEl.value = existingPoint.level;
            btnDelete.style.display = '';
            btnAddAnother.style.display = 'none';
        } else if (tmpl) {
            groupIdEl.value = tmpl.groupId;
            pointIdEl.value = '';
            const ptSeq = tmpl.nextPointNo;
            const ptRole = isMemberDisp ? (ptSeq === 1 ? ' (단부 1)' : (ptSeq === 2 ? ' (중앙부)' : ' (단부 2)')) : '';
            hintEl.textContent = `${tmpl.groupNo} 그룹에 ${tmpl.locationType} 측정 지점 추가 (${ptSeq}번째${ptRole})`;
            infoBlock.style.display = 'none';
            if (damageRow) damageRow.style.display = 'none';
            levelEl.value = '';
            btnDelete.style.display = 'none';
            btnAddAnother.style.display = '';
        } else {
            groupIdEl.value = '';
            pointIdEl.value = '';
            const ptRole = isMemberDisp ? ' (단부 1)' : '';
            hintEl.textContent = `새 측정 구역 (${nextDisplacementGroupNo(cat)}) - 1번째 지점${ptRole}`;
            infoBlock.style.display = 'flex';
            if (damageRow) damageRow.style.display = isMemberDisp ? 'block' : 'none';
            if (damageEl) damageEl.checked = false;
            locEl.value = '보';
            lenEl.value = '';
            levelEl.value = '';
            btnDelete.style.display = 'none';
            btnAddAnother.style.display = '';
        }

        modal.style.display = 'flex';
        modal.classList.add('open');
        levelEl.focus();
    }

    function closeNdtDisplacementModal() {
        window._ndtDisplacementTemplate = null;
        const modal = document.getElementById('ndtDisplacementModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('open');
        }
    }

    // 모달 입력값을 저장하고 {group, point}를 반환 (검증 실패 시 null)
    function commitNdtDisplacement() {
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        if (!state.ndtDisplacementGroups[key]) state.ndtDisplacementGroups[key] = [];
        const groups = state.ndtDisplacementGroups[key];

        const groupId = document.getElementById('ndtDispGroupId').value;
        const pointId = document.getElementById('ndtDispPointId').value;
        const level = parseFloat(document.getElementById('ndtDispLevel').value);
        if (isNaN(level)) {
            window.showToast('레벨값을 입력해 주세요.', 'warning');
            return null;
        }
        const coords = window._pendingNdtDispCoords || { x: 100, y: 100 };

        if (pointId) {
            const group = groups.find(g => g.points.some(p => p.id === pointId));
            if (!group) return null;
            const point = group.points.find(p => p.id === pointId);
            point.level = level;
            saveStateToLocalStorage();
            return { group, point };
        }

        if (groupId) {
            const group = groups.find(g => g.id === groupId);
            if (!group) return null;
            const point = { id: `ndtp_${Date.now()}`, x: coords.x, y: coords.y, level };
            group.points.push(point);
            saveStateToLocalStorage();
            return { group, point };
        }

        const locationType = document.getElementById('ndtDispLocationType').value || '보';
        const measureLength = parseFloat(document.getElementById('ndtDispMeasureLength').value);
        if (!measureLength || measureLength <= 0) {
            window.showToast('측정길이를 입력해 주세요.', 'warning');
            return null;
        }
        const cat = currentNdtCategory === '부재변위' ? '부재변위' : '변위';
        const hasMinorDamage = cat === '부재변위' && !!document.getElementById('ndtDispHasMinorDamage')?.checked;
        const color = NDT_DISPLACEMENT_COLORS[groups.length % NDT_DISPLACEMENT_COLORS.length];
        const point = { id: `ndtp_${Date.now()}`, x: coords.x, y: coords.y, level };
        const group = {
            id: `ndtg_${Date.now()}`,
            category: cat,
            groupNo: nextDisplacementGroupNo(cat),
            locationType,
            measureLength,
            hasMinorDamage,
            color,
            boxX: coords.x - 40,
            boxY: coords.y - 50,
            points: [point]
        };
        groups.push(group);
        saveStateToLocalStorage();
        return { group, point };
    }

    function openNdtDisplacementGroupEditModal(group) {
        document.getElementById('ndtDispEditGroupId').value = group.id;
        document.getElementById('ndtDispGroupEditTitle').textContent = `${group.groupNo} 측정 구역 정보`;
        document.getElementById('ndtDispEditLocationType').value = group.locationType;
        document.getElementById('ndtDispEditMeasureLength').value = group.measureLength;
        const colorEl = document.getElementById('ndtDispEditColor');
        if (colorEl) colorEl.value = group.color || getStyleColor(group.category === '부재변위' ? 'ndtMemberDisp' : 'ndtSettlement');
        const damageRow = document.getElementById('ndtDispEditMinorDamageRow');
        const damageEl = document.getElementById('ndtDispEditHasMinorDamage');
        const isMemberDisp = group.category === '부재변위';
        if (damageRow) damageRow.style.display = isMemberDisp ? 'block' : 'none';
        if (damageEl) damageEl.checked = !!group.hasMinorDamage;
        renderNdtDispGroupPointList(group);
        const modal = document.getElementById('ndtDisplacementGroupEditModal');
        modal.style.display = 'flex';
        modal.classList.add('open');
    }

    function closeNdtDisplacementGroupEditModal() {
        const modal = document.getElementById('ndtDisplacementGroupEditModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('open');
        }
    }

    function renderNdtDispGroupPointList(group) {
        const container = document.getElementById('ndtDispEditPointList');
        if (!container) return;
        container.innerHTML = group.points.map((p, idx) => `
            <div class="option-manager-item">
                <span>${idx + 1}번: ${p.level}mm</span>
                <button type="button" class="option-manager-item-delete" onclick="window.deleteNdtDisplacementPoint('${group.id}','${p.id}')"><i class="fa-solid fa-trash"></i></button>
            </div>
        `).join('') || '<div style="color:#94a3b8; font-size:0.85rem; padding:0.5rem;">측정 지점이 없습니다.</div>';
    }

    window.deleteNdtDisplacementPoint = function(groupId, pointId) {
        if (!confirm('⚠️ 해당 측정 지점을 삭제하시겠습니까?')) return;
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        const groups = state.ndtDisplacementGroups[key] || [];
        const group = groups.find(g => g.id === groupId);
        if (!group) return;
        group.points = group.points.filter(p => p.id !== pointId);
        if (group.points.length === 0) {
            state.ndtDisplacementGroups[key] = groups.filter(g => g.id !== groupId);
            closeNdtDisplacementGroupEditModal();
        } else {
            renderNdtDispGroupPointList(group);
        }
        saveStateToLocalStorage();
        drawNdtCanvas();
        renderNdtSummaryTable();
    };

    window.deleteNdtDisplacementGroup = function(groupId) {
        if (!confirm('⚠️ 해당 측정 구역과 포함된 모든 지점을 삭제하시겠습니까?')) return;
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        state.ndtDisplacementGroups[key] = (state.ndtDisplacementGroups[key] || []).filter(g => g.id !== groupId);
        saveStateToLocalStorage();
        drawNdtCanvas();
        renderNdtSummaryTable();
        closeNdtDisplacementGroupEditModal();
    };

    function setupNdtDisplacementModalEvents() {
        const btnSave = document.getElementById('btnSaveNdtDisp');
        if (btnSave) {
            btnSave.addEventListener('click', () => {
                const saved = commitNdtDisplacement();
                closeNdtDisplacementModal();
                if (saved) {
                    drawNdtCanvas();
                    renderNdtSummaryTable();
                }
            });
        }

        const btnAddAnother = document.getElementById('btnAddAnotherNdtPoint');
        if (btnAddAnother) {
            btnAddAnother.addEventListener('click', () => {
                const saved = commitNdtDisplacement();
                closeNdtDisplacementModal();
                if (saved) {
                    drawNdtCanvas();
                    renderNdtSummaryTable();
                    window._ndtDisplacementTemplate = {
                        groupId: saved.group.id,
                        groupNo: saved.group.groupNo,
                        locationType: saved.group.locationType,
                        nextPointNo: saved.group.points.length + 1
                    };
                    window.showToast(`${saved.group.groupNo} 구역에 이어서 측정합니다. 도면에서 다음 지점을 클릭하세요.`, 'info', 3500);
                }
            });
        }

        const btnDeletePoint = document.getElementById('btnDeleteNdtDispPoint');
        if (btnDeletePoint) {
            btnDeletePoint.addEventListener('click', () => {
                const pointId = document.getElementById('ndtDispPointId').value;
                if (!pointId || !confirm('⚠️ 해당 측정 지점을 삭제하시겠습니까?')) return;
                const key = `${state.currentBuildingId}_${state.currentFloor}`;
                const groups = state.ndtDisplacementGroups[key] || [];
                const group = groups.find(g => g.points.some(p => p.id === pointId));
                if (group) {
                    group.points = group.points.filter(p => p.id !== pointId);
                    if (group.points.length === 0) {
                        state.ndtDisplacementGroups[key] = groups.filter(g => g.id !== group.id);
                    }
                    saveStateToLocalStorage();
                }
                closeNdtDisplacementModal();
                drawNdtCanvas();
                renderNdtSummaryTable();
            });
        }

        const btnCancel = document.getElementById('btnCancelNdtDisp');
        if (btnCancel) btnCancel.addEventListener('click', closeNdtDisplacementModal);
        const btnClose = document.getElementById('btnCloseNdtDisplacementModal');
        if (btnClose) btnClose.addEventListener('click', closeNdtDisplacementModal);

        const btnSaveGroupEdit = document.getElementById('btnSaveNdtDispGroupEdit');
        if (btnSaveGroupEdit) {
            btnSaveGroupEdit.addEventListener('click', () => {
                const groupId = document.getElementById('ndtDispEditGroupId').value;
                const key = `${state.currentBuildingId}_${state.currentFloor}`;
                const group = (state.ndtDisplacementGroups[key] || []).find(g => g.id === groupId);
                if (!group) return;
                const len = parseFloat(document.getElementById('ndtDispEditMeasureLength').value);
                if (!len || len <= 0) {
                    window.showToast('측정길이를 입력해 주세요.', 'warning');
                    return;
                }
                group.locationType = document.getElementById('ndtDispEditLocationType').value || '보';
                group.measureLength = len;
                const colorVal = document.getElementById('ndtDispEditColor')?.value;
                if (colorVal) group.color = colorVal;
                if (group.category === '부재변위') {
                    group.hasMinorDamage = !!document.getElementById('ndtDispEditHasMinorDamage')?.checked;
                }
                saveStateToLocalStorage();
                drawNdtCanvas();
                renderNdtSummaryTable();
                closeNdtDisplacementGroupEditModal();
            });
        }

        const btnDeleteGroup = document.getElementById('btnDeleteNdtDispGroup');
        if (btnDeleteGroup) {
            btnDeleteGroup.addEventListener('click', () => {
                const groupId = document.getElementById('ndtDispEditGroupId').value;
                window.deleteNdtDisplacementGroup(groupId);
            });
        }

        const btnCloseGroupEdit1 = document.getElementById('btnCloseNdtDispGroupEditModal');
        if (btnCloseGroupEdit1) btnCloseGroupEdit1.addEventListener('click', closeNdtDisplacementGroupEditModal);
        const btnCloseGroupEdit2 = document.getElementById('btnCloseNdtDispGroupEdit');
        if (btnCloseGroupEdit2) btnCloseGroupEdit2.addEventListener('click', closeNdtDisplacementGroupEditModal);

        const btnCloseChart1 = document.getElementById('btnCloseNdtDispChartModal');
        if (btnCloseChart1) btnCloseChart1.addEventListener('click', closeNdtDisplacementChartModal);
        const btnCloseChart2 = document.getElementById('btnCloseNdtDispChart2');
        if (btnCloseChart2) btnCloseChart2.addEventListener('click', closeNdtDisplacementChartModal);
    }

    function closeNdtDisplacementChartModal() {
        const modal = document.getElementById('ndtDisplacementChartModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('open');
        }
    }

    function getCurrentFloorDefects() {
        if (!state.currentBuildingId) return [];
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        return state.defects[key] || [];
    }

    // 현재 선택된 조사 회차(연도_기간) 키 — 결함 등록 시점의 회차를 기록하는 데 사용
    function getCurrentSurveyRoundKey() {
        const year = document.getElementById('selectInspectionYear')?.value
            || (state.currentBuilding && state.currentBuilding.inspectionYear) || '2026년';
        const period = document.getElementById('selectInspectionPeriod')?.value
            || (state.currentBuilding && state.currentBuilding.inspectionPeriod) || '하반기';
        return `${year}_${period}`;
    }

    // 결함이 "전회차(과거 조사)" 항목인지 판정 — 수동 체크(isCarriedOver) 우선, 없으면 등록 당시 회차와 현재 회차 비교
    function isPreviousRoundDefect(defect) {
        if (defect.isCarriedOver) return true;
        if (!defect.surveyRound) return false; // 회차 정보 없는 과거 데이터는 금회차로 취급
        return defect.surveyRound !== getCurrentSurveyRoundKey();
    }

    // "마킹 추가"로 같은 결함을 여러 위치에 표시한 그룹(groupId 공유)을 목록/보고서용으로 한 행으로 합친다.
    // 위치는 지점별 위치를 ' / '로 이어붙이고, 진행/누수/전회차 여부는 멤버 중 하나라도 해당되면 true로 간주.
    function consolidateDefectGroups(defects) {
        const seen = new Set();
        const result = [];
        defects.forEach(d => {
            if (d.groupId) {
                if (seen.has(d.groupId)) return;
                seen.add(d.groupId);
                const members = defects.filter(m => m.groupId === d.groupId);
                const locations = members.map(m => m.location).filter(Boolean);
                result.push({
                    ...d,
                    no: d.groupNo || d.no,
                    location: locations.length > 0 ? locations.join(' / ') : d.location,
                    isProgress: members.some(m => m.isProgress),
                    isLeak: members.some(m => m.isLeak),
                    isCarriedOver: members.some(m => m.isCarriedOver),
                    _groupMemberIds: members.map(m => m.id),
                    _representative: d
                });
            } else {
                result.push(d);
            }
        });
        // 결함번호(no) 기준 오름차순 정렬 — 좌측 결함목록/상태조사표/PDF/보고서 미리보기가 모두 이 함수를 거치므로 한 번에 정렬됨
        result.sort((a, b) => {
            const na = getDefectSortNo(a);
            const nb = getDefectSortNo(b);
            if (na !== nb) return na - nb;
            return (a.no || '').localeCompare(b.no || '');
        });
        return result;
    }

    // #rrggbb 색상을 amount(0~1)만큼 어둡게 만들어 전회차 결함 강조에 사용
    function darkenHexColor(hex, amount) {
        const clean = (hex || '#ef4444').replace('#', '');
        const num = parseInt(clean, 16);
        const dec = Math.round(255 * amount);
        const r = Math.max(0, (num >> 16) - dec);
        const g = Math.max(0, ((num >> 8) & 0xff) - dec);
        const b = Math.max(0, (num & 0xff) - dec);
        return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
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

    // --- 결함 되돌리기/다시실행 히스토리 엔진 ---
    // 새로고침 시 초기화되어도 무방한 세션 한정 상태라 state가 아닌 클로저 변수로 관리
    const defectHistory = {};

    function getDefectHistoryKey() {
        return `${state.currentBuildingId}_${state.currentFloor}`;
    }

    // 결함이 바뀌기 직전에 호출해서 현재 상태를 되돌리기 스택에 저장
    function pushDefectHistory() {
        if (!state.currentBuildingId) return;
        const key = getDefectHistoryKey();
        if (!defectHistory[key]) defectHistory[key] = { undo: [], redo: [] };
        const h = defectHistory[key];
        h.undo.push(JSON.stringify(state.defects[key] || []));
        if (h.undo.length > 30) h.undo.shift();
        h.redo = [];
        updateUndoRedoButtons();
    }

    function undoDefectChange() {
        const key = getDefectHistoryKey();
        const h = defectHistory[key];
        if (!h || h.undo.length === 0) return;
        const prevSnapshot = h.undo.pop();
        h.redo.push(JSON.stringify(state.defects[key] || []));
        state.defects[key] = JSON.parse(prevSnapshot);
        saveStateToLocalStorage();
        renderSurveyTable();
        drawCanvas();
        window.showToast('되돌리기 완료', 'info', 1500);
    }

    function redoDefectChange() {
        const key = getDefectHistoryKey();
        const h = defectHistory[key];
        if (!h || h.redo.length === 0) return;
        const nextSnapshot = h.redo.pop();
        h.undo.push(JSON.stringify(state.defects[key] || []));
        state.defects[key] = JSON.parse(nextSnapshot);
        saveStateToLocalStorage();
        renderSurveyTable();
        drawCanvas();
        window.showToast('다시 실행 완료', 'info', 1500);
    }

    function updateUndoRedoButtons() {
        const h = state.currentBuildingId ? defectHistory[getDefectHistoryKey()] : null;
        const btnUndoEl = document.getElementById('btnUndo');
        const btnRedoEl = document.getElementById('btnRedo');
        if (btnUndoEl) btnUndoEl.disabled = !h || h.undo.length === 0;
        if (btnRedoEl) btnRedoEl.disabled = !h || h.redo.length === 0;
    }

    // 좌측 사이드바에 표시되는 "현재 층에 등록된 결함" 간단 목록 렌더링
    function renderDefectListPanel() {
        const panel = document.getElementById('defectListPanel');
        const summaryEl = document.getElementById('defectListSummary');
        if (!panel) return;

        if (!state.currentBuildingId) {
            panel.innerHTML = '';
            if (summaryEl) summaryEl.innerHTML = '';
            return;
        }

        const defects = consolidateDefectGroups(getCurrentFloorFilteredDefects());

        if (summaryEl) {
            if (defects.length === 0) {
                summaryEl.innerHTML = '';
            } else {
                const counts = { '구조체': 0, '비구조체': 0, '마감재': 0 };
                defects.forEach(d => {
                    const cat = Object.prototype.hasOwnProperty.call(counts, d.category) ? d.category : '구조체';
                    counts[cat]++;
                });
                const catClassMap = { '구조체': '', '비구조체': 'cat-nonstructural', '마감재': 'cat-finishing' };
                let html = `<span>결함 ${defects.length}건</span>`;
                Object.keys(counts).forEach(cat => {
                    if (counts[cat] > 0) {
                        html += `<span class="defect-summary-badge ${catClassMap[cat]}">${counts[cat]}건</span>`;
                    }
                });
                summaryEl.innerHTML = html;
            }
        }

        if (defects.length === 0) {
            panel.innerHTML = '<div class="defect-list-empty">아직 등록된 결함이 없습니다.<br>도면에서 핀을 찍어보세요.</div>';
            return;
        }

        panel.innerHTML = '';
        const previousItems = defects.filter(d => isPreviousRoundDefect(d));
        const currentItems = defects.filter(d => !isPreviousRoundDefect(d));

        const prevSection = renderDefectListSection('🕐 전회차 조사항목', previousItems);
        if (prevSection) panel.appendChild(prevSection);
        const curSection = renderDefectListSection('🆕 금회차 조사항목', currentItems);
        if (curSection) panel.appendChild(curSection);

        updateUndoRedoButtons();
    }
    window.renderDefectListPanel = renderDefectListPanel;

    // 결함번호(d.no, 예: "NO.01", "NO.01-1")에서 정렬용 숫자를 추출. 번호가 없으면 맨 뒤로 보낸다
    function getDefectSortNo(d) {
        const m = (d.no || '').match(/\d+/);
        return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
    }

    // 결함 1건의 목록 카드(DOM row) 생성 — renderDefectListSection에서 재사용
    function buildDefectRow(d) {
        const catClass = d.category === '비구조체' ? 'cat-nonstructural' : (d.category === '마감재' ? 'cat-finishing' : '');
        const numMatch = (d.no || '').match(/\d+/);
        const badgeNo = numMatch ? numMatch[0] : '?';
        const shapeIcon = d.shapeType === 'area' ? '🟧 ' : '';

        const row = document.createElement('div');
        row.className = `defect-list-item ${catClass}`.trim();
        row.title = d.location || '';

        const badge = document.createElement('span');
        badge.className = 'defect-badge-no';
        if (d.defectType === '상태양호') badge.classList.add('badge-good');
        badge.textContent = badgeNo;
        row.appendChild(badge);

        const lines = document.createElement('div');
        lines.className = 'defect-list-item-lines';

        const compLine = document.createElement('span');
        compLine.className = 'defect-list-item-component';
        compLine.textContent = `${shapeIcon}${d.component || ''}`.trim();
        lines.appendChild(compLine);

        const typeLine = document.createElement('span');
        typeLine.className = 'defect-list-item-type';
        typeLine.textContent = d.defectType || '';
        lines.appendChild(typeLine);

        row.appendChild(lines);

        const actions = document.createElement('div');
        actions.className = 'defect-list-item-actions';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'defect-list-item-edit';
        editBtn.title = '수정';
        editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
        actions.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'defect-list-item-delete';
        deleteBtn.title = '삭제';
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        actions.appendChild(deleteBtn);

        row.appendChild(actions);

        row.addEventListener('click', (e) => {
            if (actions.contains(e.target)) return;
            window.focusDefectOnCanvas(d.id);
        });
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openAddDefectModal(d.x, d.y, d.targetX, d.targetY, d._representative || d);
        });
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isGroup = d._groupMemberIds && d._groupMemberIds.length > 1;
            const label = `'${d.component || ''} ${d.defectType || ''}'`;
            const confirmMsg = isGroup ? `${label} 결함(${d._groupMemberIds.length}개 위치)을 모두 삭제할까요?` : `${label} 결함을 삭제할까요?`;
            if (confirm(confirmMsg)) {
                if (isGroup) window.deleteDefectGroup(d.groupId);
                else window.deleteDefectById(d.id);
            }
        });

        return row;
    }

    // 전회차/금회차 구역 하나(제목 + 스크롤 가능한 카드 목록)를 만들어 반환 — 항목이 없으면 null
    function renderDefectListSection(title, items) {
        if (items.length === 0) return null;
        const section = document.createElement('div');
        section.className = 'defect-list-section';

        const header = document.createElement('div');
        header.className = 'defect-list-section-title';
        header.textContent = `${title} (${items.length})`;
        section.appendChild(header);

        const scrollBox = document.createElement('div');
        scrollBox.className = 'defect-list-section-scroll';
        items.forEach(d => scrollBox.appendChild(buildDefectRow(d)));
        section.appendChild(scrollBox);

        return section;
    }

    // 영역(면적) 형태 결함 렌더링 — 화면 캔버스와 보고서 캔버스(drawPinSafe) 양쪽에서 공용으로 사용
    function drawAreaRect(ctx, defect, isPreview, forReport) {
        const x1 = Math.min(defect.areaX1, defect.areaX2);
        const y1 = Math.min(defect.areaY1, defect.areaY2);
        const x2 = Math.max(defect.areaX1, defect.areaX2);
        const y2 = Math.max(defect.areaY1, defect.areaY2);
        const scale = getStyleSize(getDefectStyleKey(defect.category, defect.defectType)).pin;
        const isBeingDragged = (!isPreview && typeof activeDragPin !== 'undefined' && activeDragPin && activeDragPin.id === defect.id);

        // 전회차(과거 조사) 결함은 도면에서 더 두껍고 진하게 표시 — 보고서(forReport)는 구분 없이 그대로 둠
        const isPrevRoundDefect = !forReport && isPreviousRoundDefect(defect);
        const roundLineMul = isPrevRoundDefect ? 1.6 : 1.0;
        const mainColor = getDefectColor(defect.category, defect.defectType);
        const activeColor = isBeingDragged ? '#facc15' : (isPrevRoundDefect ? darkenHexColor(mainColor, 0.25) : mainColor);

        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = activeColor;
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = (isBeingDragged ? 3 : 2.5) * roundLineMul;
        if (isPreview) ctx.setLineDash([6, 4]);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.restore();

        if (!isPreview) {
            // 좌상단 모서리에 결함번호 라벨 박스 표시 (핀 박스와 동일한 스타일)
            // 도면 회전 상태와 무관하게 박스/글자는 항상 화면 기준 수평으로 보이도록 역회전
            ctx.save();
            ctx.translate(x1, y1);
            const boxRot = state.rotationAngle || 0;
            if (boxRot === 90) {
                ctx.rotate((-90 * Math.PI) / 180);
            } else if (boxRot === 180) {
                ctx.rotate((-180 * Math.PI) / 180);
            } else if (boxRot === 270) {
                ctx.rotate((-270 * Math.PI) / 180);
            }
            const areaStyleKey = getDefectStyleKey(defect.category, defect.defectType);
            const areaShapeCfg = getStyleShape(areaStyleKey);
            ctx.shadowColor = isBeingDragged ? '#facc15' : 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = (isBeingDragged ? 16 : 6) * scale;
            const w = 38 * scale;
            const h = 26 * scale;
            ctx.translate(w / 2, -h / 2); // 박스 중심으로 원점 이동(모양 경로가 중심 기준이므로)
            ctx.fillStyle = isBeingDragged ? '#facc15' : (areaShapeCfg.fill ? activeColor : '#ffffff');
            ctx.strokeStyle = activeColor;
            ctx.lineWidth = (isBeingDragged ? 3 : 2) * scale * roundLineMul;
            traceStyledBoxPath(ctx, w, h, areaShapeCfg.shape, 6 * scale);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = isBeingDragged ? '#7c2d12' : (areaShapeCfg.fill ? '#ffffff' : activeColor);
            ctx.font = `bold ${Math.round(13 * scale)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(formatPinNumberLabel(defect.no || 'NO.01', areaStyleKey), 0, 0);
            ctx.restore();
        }
    }

    // defects를 groupId 기준으로 묶어서 그룹당 한 번만 drawFn(ctx, 대표결함, arrows)을 호출한다.
    // (drawPin/drawPinSafe 양쪽에서 재사용 — 화면 캔버스와 보고서 캔버스 모두 동일하게 "박스 하나 + 화살표 여러 개"로 그리기 위함)
    function renderDefectsGrouped(ctx, defects, drawFn) {
        const renderedGroups = new Set();
        defects.forEach(defect => {
            if (defect.groupId) {
                if (renderedGroups.has(defect.groupId)) return;
                const groupMembers = defects.filter(d => d.groupId === defect.groupId);
                if (groupMembers.length > 1) {
                    renderedGroups.add(defect.groupId);
                    const arrows = groupMembers
                        .filter(m => m.targetX !== undefined && m.targetY !== undefined)
                        .map(m => ({ targetX: m.targetX, targetY: m.targetY }));
                    drawFn(ctx, defect, arrows);
                    return;
                }
            }
            drawFn(ctx, defect);
        });
    }

    // arrows: "마킹 추가"로 묶인 그룹을 하나의 박스+여러 화살표로 그릴 때 전달하는 {targetX,targetY}[] (없으면 defect 자신의 화살표 1개만 그림, 기존과 동일)
    function drawPin(ctx, defect, arrows) {
        if (defect.shapeType === 'area' && defect.areaX1 !== undefined) {
            drawAreaRect(ctx, defect, false);
            return;
        }
        const boxX = defect.x || 100;
        const boxY = defect.y || 100;
        const defectSize = getStyleSize(getDefectStyleKey(defect.category, defect.defectType));
        const scale = defectSize.pin;
        const arrowScale = defectSize.arrow;
        const isBeingDragged = (typeof activeDragPin !== 'undefined' && activeDragPin &&
            (activeDragPin.id === defect.id || (defect.groupId && activeDragPin.groupId === defect.groupId)));

        // Category Theme Color: 사용자 지정 색상(styleColors) 우선, 없으면 기본값
        const defectStyleKey = getDefectStyleKey(defect.category, defect.defectType);
        const mainColor = getDefectColor(defect.category, defect.defectType);
        const shapeCfg = getStyleShape(defectStyleKey);

        // 전회차(과거 조사) 결함은 도면에서 더 두껍고 진하게 표시 — 보고서(drawPinSafe)는 구분 없이 그대로 둠
        const isPrevRoundDefect = isPreviousRoundDefect(defect);
        const roundLineMul = isPrevRoundDefect ? 1.6 : 1.0;
        const activeColor = isBeingDragged ? '#facc15' : (isPrevRoundDefect ? darkenHexColor(mainColor, 0.25) : mainColor);

        const targets = (arrows && arrows.length > 0)
            ? arrows
            : (defect.targetX !== undefined && defect.targetY !== undefined ? [{ targetX: defect.targetX, targetY: defect.targetY }] : []);

        // Leader Line & Arrow Tip Rendering (Color matched to Red/Blue/Orange) — 그룹이면 화살표를 여러 개 반복해서 그림
        targets.forEach(t => {
            if (t.targetX === undefined || t.targetY === undefined) return;
            const targetX = t.targetX;
            const targetY = t.targetY;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(boxX, boxY);
            ctx.lineTo(targetX, targetY);
            ctx.strokeStyle = activeColor;
            ctx.lineWidth = (isBeingDragged ? 3 : 2) * arrowScale * roundLineMul;
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
        });

        // Pin Box & Text Label Rendering (Transparent Background + Red/Blue/Orange Border & Text)
        // 도면 회전 상태와 무관하게 박스/글자는 항상 화면 기준 수평으로 보이도록 역회전
        ctx.save();
        ctx.translate(boxX, boxY);
        const boxRot = state.rotationAngle || 0;
        if (boxRot === 90) {
            ctx.rotate((-90 * Math.PI) / 180);
        } else if (boxRot === 180) {
            ctx.rotate((-180 * Math.PI) / 180);
        } else if (boxRot === 270) {
            ctx.rotate((-270 * Math.PI) / 180);
        }

        ctx.shadowColor = isBeingDragged ? '#facc15' : 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = (isBeingDragged ? 16 : 6) * scale;

        // 채우기 유무에 따라 배경/글자 색이 뒤바뀜(채우기: 카테고리색 배경+흰글자, 미채우기: 흰 배경+카테고리색 글자)
        const boxFillColor = (isBeingDragged ? '#facc15' : (shapeCfg.fill ? activeColor : '#ffffff'));
        const boxTextColor = (isBeingDragged ? '#7c2d12' : (shapeCfg.fill ? '#ffffff' : activeColor));
        ctx.fillStyle = boxFillColor;
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = (isBeingDragged ? 3 : 2) * scale * roundLineMul;

        const w = 38 * scale;
        const h = 26 * scale;

        traceStyledBoxPath(ctx, w, h, shapeCfg.shape, 6 * scale);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = boxTextColor;
        ctx.font = `bold ${Math.round(13 * scale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatPinNumberLabel(defect.groupNo || defect.no || 'NO.01', defectStyleKey), 0, 0);

        ctx.restore();
    }

    // --- Dynamic Defect Component(부재 명칭) Presets & Custom Adding/Removing (카테고리별로 완전히 분리) ---
    const DEFECT_COMPONENT_PRESET = {
        '구조체': ['기둥', '큰보', '작은보', '슬래브', '벽체', '계단', '기타'],
        '비구조체': ['조적벽체', '기타'],
        '마감재': ['기타']
    };

    // 예전 버전(카테고리 구분 없는 배열)으로 저장된 부재 명칭 커스텀/숨김 목록을 카테고리별 객체로 변환
    function migrateDefectComponentStateShape() {
        if (Array.isArray(window.state.customDefectComponents)) {
            const legacy = window.state.customDefectComponents;
            window.state.customDefectComponents = { '구조체': [...legacy], '비구조체': [...legacy], '마감재': [...legacy] };
        }
        if (Array.isArray(window.state.hiddenDefectComponents)) {
            const legacy = window.state.hiddenDefectComponents;
            window.state.hiddenDefectComponents = { '구조체': [...legacy], '비구조체': [...legacy], '마감재': [...legacy] };
        }
    }

    function populateDefectComponentDropdown(category, currentVal = null) {
        const select = document.getElementById('defectComponent');
        if (!select) return;
        const cat = category || document.getElementById('defectCategory')?.value || '구조체';

        migrateDefectComponentStateShape();
        if (!window.state.customDefectComponents) window.state.customDefectComponents = { '구조체': [], '비구조체': [], '마감재': [] };
        if (!window.state.hiddenDefectComponents) window.state.hiddenDefectComponents = { '구조체': [], '비구조체': [], '마감재': [] };
        if (!window.state.customDefectComponents[cat]) window.state.customDefectComponents[cat] = [];
        if (!window.state.hiddenDefectComponents[cat]) window.state.hiddenDefectComponents[cat] = [];

        const hidden = window.state.hiddenDefectComponents[cat];
        const presetList = (DEFECT_COMPONENT_PRESET[cat] || DEFECT_COMPONENT_PRESET['구조체']).filter(c => !hidden.includes(c));
        const customList = window.state.customDefectComponents[cat];

        let html = '';
        presetList.forEach(item => {
            const label = item === '기타' ? '기타 부재' : item;
            const sel = (currentVal && currentVal === item) ? 'selected' : '';
            html += `<option value="${item}" ${sel}>${label}</option>`;
        });

        customList.forEach(item => {
            if (!presetList.includes(item)) {
                const sel = (currentVal && currentVal === item) ? 'selected' : '';
                html += `<option value="${item}" ${sel}>${item}</option>`;
            }
        });

        html += `<option value="__ADD_CUSTOM_COMPONENT__">➕ [부재 직접 추가...]</option>`;
        select.innerHTML = html;

        if (currentVal && !presetList.includes(currentVal) && !customList.includes(currentVal)) {
            const customOpt = document.createElement('option');
            customOpt.value = currentVal;
            customOpt.textContent = currentVal;
            customOpt.selected = true;
            select.insertBefore(customOpt, select.lastElementChild);
        }
    }

    // --- Dynamic Defect Type Presets & Custom Adding ---
    const categoryDefectPreset = {
        '구조체': [
            '상태양호',
            '균열',
            '누수',
            '철근노출',
            '백태/유출',
            '박리/박락',
            '신축이음/재료분리 손상',
            '기타'
        ],
        '비구조체': [
            '상태양호',
            '조적벽체 균열',
            '조인트 이격/파손',
            '천장재 들뜸/탈락',
            '설비 배관 누수/손상',
            '창호/유리 이격',
            '기타'
        ],
        '마감재': [
            '상태양호',
            '타일 들뜸/탈락',
            '몰탈 균열',
            '도장 페인트 변색/탈락',
            '방수층 손상/들뜸',
            '석재 팟칭',
            '기타'
        ]
    };

    function updateDefectTypeDropdown(category, currentVal = null) {
        const select = document.getElementById('defectType');
        if (!select) return;

        if (!window.state.customDefectTypes) {
            window.state.customDefectTypes = { '구조체': [], '비구조체': [], '마감재': [] };
        }
        if (!window.state.hiddenDefectTypes) window.state.hiddenDefectTypes = {};

        const hidden = window.state.hiddenDefectTypes[category] || [];
        const presetList = (categoryDefectPreset[category] || categoryDefectPreset['구조체']).filter(t => !hidden.includes(t));
        const customList = window.state.customDefectTypes[category] || [];

        let html = '';
        presetList.forEach(item => {
            const sel = (currentVal && currentVal === item) ? 'selected' : '';
            html += `<option value="${item}" ${sel}>${item}</option>`;
        });

        customList.forEach(item => {
            if (!presetList.includes(item)) {
                const sel = (currentVal && currentVal === item) ? 'selected' : '';
                html += `<option value="${item}" ${sel}>${item}</option>`;
            }
        });

        html += `<option value="__ADD_CUSTOM__">➕ [결함 종류 직접 추가...]</option>`;
        select.innerHTML = html;

        if (currentVal && !presetList.includes(currentVal) && !customList.includes(currentVal)) {
            const customOpt = document.createElement('option');
            customOpt.value = currentVal;
            customOpt.textContent = currentVal;
            customOpt.selected = true;
            select.insertBefore(customOpt, select.lastElementChild);
        }

        // Trigger cause update for current defect type
        updateDefectCauseDropdown(select.value);
        toggleDefectSizeInputMode();
    }

    // 자유텍스트(규모 및 상태) 입력칸은 결함 종류와 상관없이 항상 보이고,
    // 결함 종류가 '균열'이면 균열폭/균열길이 숫자 입력 2칸을 추가로 보여줘서 둘 중 편한 방식으로 입력 가능.
    // 결함 종류가 '상태양호'면 규모/원인 입력이 의미가 없으므로 두 칸 모두 숨긴다.
    function toggleDefectSizeInputMode() {
        const dType = document.getElementById('defectType')?.value;
        const isCrack = dType === '균열';
        const isGood = dType === '상태양호';
        const crackGroup = document.getElementById('defectCrackSizeGroup');
        const freeLabel = document.getElementById('defectSizeFreeLabel');
        const sizeGroup = document.getElementById('defectSizeFreeGroup');
        const causeGroup = document.getElementById('defectCauseGroup');
        if (crackGroup) crackGroup.style.display = (isCrack && !isGood) ? '' : 'none';
        if (freeLabel) {
            freeLabel.textContent = isCrack
                ? '규모 및 상태 (직접 입력 — 아래 균열폭/길이 칸을 대신 써도 됩니다)'
                : '규모 및 상태 (수치 입력) *';
        }
        if (sizeGroup) sizeGroup.style.display = isGood ? 'none' : '';
        if (causeGroup) causeGroup.style.display = isGood ? 'none' : '';
    }

    // --- Dynamic Defect Cause Presets & Custom Adding ---
    const defectCausePreset = {
        '균열': ['건조수축', '내력부족', '건축물 부등침하', '시공불량', '신축이음 불량', '온도변화/열응력', '기타'],
        '누수': ['상부 방수층 파손', '수분침투', '배관 파손/연결부 누수', '지하수 유입', '균열부 틈새 유입', '기타'],
        '철근노출': ['피복두께 부족', '콘크리트 중성화', '염해 손상', '시공 다짐불량', '기타'],
        '백태': ['수분 유입 및 찌꺼기 용해', '방수 손상', '백태 현상', '기타'],
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
        if (!window.state.hiddenDefectCauses) window.state.hiddenDefectCauses = {};

        const key = getCauseKey(defectType);
        const hidden = window.state.hiddenDefectCauses[key] || [];
        const presetList = (defectCausePreset[key] || ['건조수축', '내력부족', '건축물 부등침하', '시공불량', '방수층 파손', '자연 노후화', '기타']).filter(c => !hidden.includes(c));
        const customList = window.state.customDefectCauses[key] || [];

        let html = '';
        presetList.forEach(item => {
            const sel = (currentVal && currentVal === item) ? 'selected' : '';
            html += `<option value="${item}" ${sel}>${item}</option>`;
        });

        customList.forEach(item => {
            if (!presetList.includes(item)) {
                const sel = (currentVal && currentVal === item) ? 'selected' : '';
                html += `<option value="${item}" ${sel}>${item}</option>`;
            }
        });

        html += `<option value="__ADD_CUSTOM_CAUSE__">➕ [결함 원인 직접 추가...]</option>`;
        select.innerHTML = html;

        if (currentVal && !presetList.includes(currentVal) && !customList.includes(currentVal)) {
            const customOpt = document.createElement('option');
            customOpt.value = currentVal;
            customOpt.textContent = currentVal;
            customOpt.selected = true;
            select.insertBefore(customOpt, select.lastElementChild);
        }
    }

    // Category Change Listener & Custom Option Click
    const defectCategorySelect = document.getElementById('defectCategory');
    if (defectCategorySelect) {
        defectCategorySelect.addEventListener('change', (e) => {
            updateDefectTypeDropdown(e.target.value);
            populateDefectComponentDropdown(e.target.value);
        });
    }

    const defectComponentSelect = document.getElementById('defectComponent');
    if (defectComponentSelect) {
        defectComponentSelect.addEventListener('change', (e) => {
            if (e.target.value === '__ADD_CUSTOM_COMPONENT__') {
                const newComp = prompt('추가하실 부재 명칭을 입력하세요 (예: 옹벽):');
                const cat = document.getElementById('defectCategory')?.value || '구조체';
                if (newComp && newComp.trim()) {
                    const trimmed = newComp.trim();
                    migrateDefectComponentStateShape();
                    if (!window.state.customDefectComponents) window.state.customDefectComponents = { '구조체': [], '비구조체': [], '마감재': [] };
                    if (!window.state.customDefectComponents[cat]) window.state.customDefectComponents[cat] = [];
                    if (!window.state.customDefectComponents[cat].includes(trimmed)) {
                        window.state.customDefectComponents[cat].push(trimmed);
                        saveStateToLocalStorage();
                    }
                    populateDefectComponentDropdown(cat, trimmed);
                } else {
                    populateDefectComponentDropdown(cat);
                }
            }
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
                toggleDefectSizeInputMode();
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

    // --- 부재 명칭 / 결함 종류 / 결함 원인 항목 관리(추가·삭제) 모달 ---
    function getOptionManagerContext() {
        const field = window._optionManagerField;

        if (field === 'component') {
            const compCat = document.getElementById('defectCategory')?.value || '구조체';
            migrateDefectComponentStateShape();
            if (!window.state.customDefectComponents) window.state.customDefectComponents = { '구조체': [], '비구조체': [], '마감재': [] };
            if (!window.state.hiddenDefectComponents) window.state.hiddenDefectComponents = { '구조체': [], '비구조체': [], '마감재': [] };
            if (!window.state.customDefectComponents[compCat]) window.state.customDefectComponents[compCat] = [];
            if (!window.state.hiddenDefectComponents[compCat]) window.state.hiddenDefectComponents[compCat] = [];
            return {
                title: `부재 명칭 관리 (${compCat})`,
                presetList: DEFECT_COMPONENT_PRESET[compCat] || DEFECT_COMPONENT_PRESET['구조체'],
                hiddenList: window.state.hiddenDefectComponents[compCat],
                customList: window.state.customDefectComponents[compCat],
                labelFor: (item) => (item === '기타' ? '기타 부재' : item),
                refresh: () => populateDefectComponentDropdown(compCat, document.getElementById('defectComponent')?.value)
            };
        }

        if (field === 'type') {
            const cat = document.getElementById('defectCategory')?.value || '구조체';
            if (!window.state.customDefectTypes) window.state.customDefectTypes = { '구조체': [], '비구조체': [], '마감재': [] };
            if (!window.state.hiddenDefectTypes) window.state.hiddenDefectTypes = {};
            if (!window.state.hiddenDefectTypes[cat]) window.state.hiddenDefectTypes[cat] = [];
            if (!window.state.customDefectTypes[cat]) window.state.customDefectTypes[cat] = [];
            return {
                title: `결함 종류 관리 (${cat})`,
                presetList: categoryDefectPreset[cat] || categoryDefectPreset['구조체'],
                hiddenList: window.state.hiddenDefectTypes[cat],
                customList: window.state.customDefectTypes[cat],
                labelFor: (item) => item,
                refresh: () => updateDefectTypeDropdown(cat, document.getElementById('defectType')?.value)
            };
        }

        if (field === 'cause') {
            const dType = document.getElementById('defectType')?.value || '균열';
            const key = getCauseKey(dType);
            if (!window.state.customDefectCauses) window.state.customDefectCauses = {};
            if (!window.state.hiddenDefectCauses) window.state.hiddenDefectCauses = {};
            if (!window.state.hiddenDefectCauses[key]) window.state.hiddenDefectCauses[key] = [];
            if (!window.state.customDefectCauses[key]) window.state.customDefectCauses[key] = [];
            return {
                title: `결함 원인 관리 (${key})`,
                presetList: defectCausePreset[key] || [],
                hiddenList: window.state.hiddenDefectCauses[key],
                customList: window.state.customDefectCauses[key],
                labelFor: (item) => item,
                refresh: () => updateDefectCauseDropdown(dType, document.getElementById('defectCause')?.value)
            };
        }

        return null;
    }

    function renderOptionManagerList() {
        const ctx = getOptionManagerContext();
        const titleEl = document.getElementById('optionManagerTitle');
        const listEl = document.getElementById('optionManagerList');
        if (!ctx || !listEl) return;

        if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-list-check"></i> ${ctx.title}`;

        const visiblePreset = ctx.presetList.filter(item => !ctx.hiddenList.includes(item));
        const visibleItems = visiblePreset.map(item => ({ text: item, isPreset: true }))
            .concat(ctx.customList.map(item => ({ text: item, isPreset: false })));

        listEl.innerHTML = '';
        if (visibleItems.length === 0) {
            listEl.innerHTML = '<div class="defect-list-empty">표시할 항목이 없습니다.</div>';
            return;
        }

        visibleItems.forEach(({ text, isPreset }) => {
            const row = document.createElement('div');
            row.className = 'option-manager-item';

            const label = document.createElement('span');
            label.textContent = ctx.labelFor(text);
            row.appendChild(label);

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'option-manager-item-delete';
            delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            delBtn.disabled = visibleItems.length <= 1;
            delBtn.title = delBtn.disabled ? '최소 1개는 남아있어야 합니다' : '삭제';
            delBtn.addEventListener('click', () => deleteOptionItem(text, isPreset));
            row.appendChild(delBtn);

            listEl.appendChild(row);
        });
    }

    function deleteOptionItem(item, isPreset) {
        const ctx = getOptionManagerContext();
        if (!ctx) return;

        const visibleCount = ctx.presetList.filter(p => !ctx.hiddenList.includes(p)).length + ctx.customList.length;
        if (visibleCount <= 1) {
            window.showToast('최소 1개는 남아있어야 합니다.', 'warning');
            return;
        }

        if (isPreset) {
            if (!ctx.hiddenList.includes(item)) ctx.hiddenList.push(item);
        } else {
            const idx = ctx.customList.indexOf(item);
            if (idx !== -1) ctx.customList.splice(idx, 1);
        }

        saveStateToLocalStorage();
        renderOptionManagerList();
        ctx.refresh();
    }

    window.openOptionManagerModal = function(fieldType) {
        window._optionManagerField = fieldType;
        const modal = document.getElementById('optionManagerModal');
        const input = document.getElementById('optionManagerNewInput');
        if (input) input.value = '';
        renderOptionManagerList();
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('open');
        }
    };

    function closeOptionManagerModal() {
        const modal = document.getElementById('optionManagerModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('open');
        }
    }

    // --- 카테고리별 핀/박스 색상 설정 모달 ---
    const STYLE_COLOR_FIELDS = [
        ['styleColorDefectStructural', 'defectStructural'],
        ['styleColorDefectNonStructural', 'defectNonStructural'],
        ['styleColorDefectFinish', 'defectFinish'],
        ['styleColorDefectStructuralGood', 'defectStructuralGood'],
        ['styleColorDefectNonStructuralGood', 'defectNonStructuralGood'],
        ['styleColorDefectFinishGood', 'defectFinishGood'],
        ['styleColorNdtMeasure', 'ndtMeasure'],
        ['styleColorNdtStrength', 'ndtStrength'],
        ['styleColorNdtCarbonation', 'ndtCarbonation'],
        ['styleColorNdtTilt', 'ndtTilt'],
        ['styleColorNdtSettlement', 'ndtSettlement'],
        ['styleColorNdtMemberDisp', 'ndtMemberDisp']
    ];

    // [ID 접미사, styleSizes 키] — stylePinSize{suffix}/styleArrowSize{suffix} 슬라이더에 사용
    const STYLE_SIZE_FIELDS = [
        ['DefectStructural', 'defectStructural'],
        ['DefectNonStructural', 'defectNonStructural'],
        ['DefectFinish', 'defectFinish'],
        ['DefectStructuralGood', 'defectStructuralGood'],
        ['DefectNonStructuralGood', 'defectNonStructuralGood'],
        ['DefectFinishGood', 'defectFinishGood'],
        ['NdtMeasure', 'ndtMeasure'],
        ['NdtStrength', 'ndtStrength'],
        ['NdtCarbonation', 'ndtCarbonation'],
        ['NdtTilt', 'ndtTilt'],
        ['NdtSettlement', 'ndtSettlement'],
        ['NdtMemberDisp', 'ndtMemberDisp']
    ];

    // [ID 접미사, styleShapes 키] — styleShape{suffix}/styleFill{suffix}/styleNumFmt{suffix} 컨트롤에 사용
    const STYLE_SHAPE_FIELDS = STYLE_SIZE_FIELDS;

    function refreshAllStyleColoredCanvases() {
        if (typeof drawCanvas === 'function') drawCanvas();
        if (typeof drawNdtCanvas === 'function') drawNdtCanvas();
        if (typeof renderNdtSummaryTable === 'function') renderNdtSummaryTable();
        if (typeof renderDefectListPanel === 'function') renderDefectListPanel();
    }

    window.openStyleColorModal = function() {
        STYLE_COLOR_FIELDS.forEach(([inputId, key]) => {
            const input = document.getElementById(inputId);
            if (input) input.value = getStyleColor(key);
        });
        STYLE_SIZE_FIELDS.forEach(([suffix, key]) => {
            const sz = getStyleSize(key);
            const pinInput = document.getElementById(`stylePinSize${suffix}`);
            const pinLabel = document.getElementById(`stylePinSize${suffix}Label`);
            const arrowInput = document.getElementById(`styleArrowSize${suffix}`);
            const arrowLabel = document.getElementById(`styleArrowSize${suffix}Label`);
            if (pinInput) pinInput.value = sz.pin;
            if (pinLabel) pinLabel.textContent = `${Math.round(sz.pin * 100)}%`;
            if (arrowInput) arrowInput.value = sz.arrow;
            if (arrowLabel) arrowLabel.textContent = `${Math.round(sz.arrow * 100)}%`;
        });
        STYLE_SHAPE_FIELDS.forEach(([suffix, key]) => {
            const sh = getStyleShape(key);
            const shapeInput = document.getElementById(`styleShape${suffix}`);
            const fillInput = document.getElementById(`styleFill${suffix}`);
            const numFmtInput = document.getElementById(`styleNumFmt${suffix}`);
            if (shapeInput) shapeInput.value = sh.shape;
            if (fillInput) fillInput.checked = sh.fill;
            if (numFmtInput) numFmtInput.value = sh.numberFormat;
        });
        const modal = document.getElementById('styleColorModal');
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('open');
        }
    };

    function closeStyleColorModal() {
        const modal = document.getElementById('styleColorModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('open');
        }
    }

    function setupStyleColorModalEvents() {
        const btnOpen1 = document.getElementById('btnOpenStyleColorModal');
        if (btnOpen1) btnOpen1.addEventListener('click', window.openStyleColorModal);
        const btnOpen2 = document.getElementById('btnOpenStyleColorModalNdt');
        if (btnOpen2) btnOpen2.addEventListener('click', window.openStyleColorModal);

        const btnClose1 = document.getElementById('btnCloseStyleColorModal');
        if (btnClose1) btnClose1.addEventListener('click', closeStyleColorModal);
        const btnClose2 = document.getElementById('btnCloseStyleColorModal2');
        if (btnClose2) btnClose2.addEventListener('click', closeStyleColorModal);

        STYLE_COLOR_FIELDS.forEach(([inputId, key]) => {
            const input = document.getElementById(inputId);
            if (!input) return;
            input.addEventListener('input', () => {
                if (!state.styleColors) state.styleColors = {};
                state.styleColors[key] = input.value;
                refreshAllStyleColoredCanvases();
            });
            input.addEventListener('change', () => {
                saveStateToLocalStorage();
            });
        });

        STYLE_SIZE_FIELDS.forEach(([suffix, key]) => {
            const pinInput = document.getElementById(`stylePinSize${suffix}`);
            const pinLabel = document.getElementById(`stylePinSize${suffix}Label`);
            const arrowInput = document.getElementById(`styleArrowSize${suffix}`);
            const arrowLabel = document.getElementById(`styleArrowSize${suffix}Label`);

            if (pinInput) {
                pinInput.addEventListener('input', () => {
                    if (!state.styleSizes) state.styleSizes = {};
                    if (!state.styleSizes[key]) state.styleSizes[key] = {};
                    state.styleSizes[key].pin = parseFloat(pinInput.value);
                    if (pinLabel) pinLabel.textContent = `${Math.round(state.styleSizes[key].pin * 100)}%`;
                    refreshAllStyleColoredCanvases();
                });
                pinInput.addEventListener('change', () => saveStateToLocalStorage());
            }
            if (arrowInput) {
                arrowInput.addEventListener('input', () => {
                    if (!state.styleSizes) state.styleSizes = {};
                    if (!state.styleSizes[key]) state.styleSizes[key] = {};
                    state.styleSizes[key].arrow = parseFloat(arrowInput.value);
                    if (arrowLabel) arrowLabel.textContent = `${Math.round(state.styleSizes[key].arrow * 100)}%`;
                    refreshAllStyleColoredCanvases();
                });
                arrowInput.addEventListener('change', () => saveStateToLocalStorage());
            }
        });

        STYLE_SHAPE_FIELDS.forEach(([suffix, key]) => {
            const shapeInput = document.getElementById(`styleShape${suffix}`);
            const fillInput = document.getElementById(`styleFill${suffix}`);
            const numFmtInput = document.getElementById(`styleNumFmt${suffix}`);

            if (shapeInput) {
                shapeInput.addEventListener('change', () => {
                    if (!state.styleShapes) state.styleShapes = {};
                    if (!state.styleShapes[key]) state.styleShapes[key] = {};
                    state.styleShapes[key].shape = shapeInput.value;
                    refreshAllStyleColoredCanvases();
                    saveStateToLocalStorage();
                });
            }
            if (fillInput) {
                fillInput.addEventListener('change', () => {
                    if (!state.styleShapes) state.styleShapes = {};
                    if (!state.styleShapes[key]) state.styleShapes[key] = {};
                    state.styleShapes[key].fill = fillInput.checked;
                    refreshAllStyleColoredCanvases();
                    saveStateToLocalStorage();
                });
            }
            if (numFmtInput) {
                numFmtInput.addEventListener('change', () => {
                    if (!state.styleShapes) state.styleShapes = {};
                    if (!state.styleShapes[key]) state.styleShapes[key] = {};
                    state.styleShapes[key].numberFormat = numFmtInput.value;
                    refreshAllStyleColoredCanvases();
                    saveStateToLocalStorage();
                });
            }
        });

        const btnReset = document.getElementById('btnResetStyleColors');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                if (!confirm('모든 색상/크기/모양 설정을 기본값으로 초기화하시겠습니까?')) return;
                state.styleColors = {};
                state.styleSizes = {};
                state.styleShapes = {};
                STYLE_COLOR_FIELDS.forEach(([inputId, key]) => {
                    const input = document.getElementById(inputId);
                    if (input) input.value = DEFAULT_STYLE_COLORS[key];
                });
                STYLE_SIZE_FIELDS.forEach(([suffix, key]) => {
                    const def = DEFAULT_STYLE_SIZES[key];
                    const pinInput = document.getElementById(`stylePinSize${suffix}`);
                    const pinLabel = document.getElementById(`stylePinSize${suffix}Label`);
                    const arrowInput = document.getElementById(`styleArrowSize${suffix}`);
                    const arrowLabel = document.getElementById(`styleArrowSize${suffix}Label`);
                    if (pinInput) pinInput.value = def.pin;
                    if (pinLabel) pinLabel.textContent = `${Math.round(def.pin * 100)}%`;
                    if (arrowInput) arrowInput.value = def.arrow;
                    if (arrowLabel) arrowLabel.textContent = `${Math.round(def.arrow * 100)}%`;
                });
                STYLE_SHAPE_FIELDS.forEach(([suffix, key]) => {
                    const def = DEFAULT_STYLE_SHAPES[key];
                    const shapeInput = document.getElementById(`styleShape${suffix}`);
                    const fillInput = document.getElementById(`styleFill${suffix}`);
                    const numFmtInput = document.getElementById(`styleNumFmt${suffix}`);
                    if (shapeInput) shapeInput.value = def.shape;
                    if (fillInput) fillInput.checked = def.fill;
                    if (numFmtInput) numFmtInput.value = def.numberFormat;
                });
                refreshAllStyleColoredCanvases();
                saveStateToLocalStorage();
            });
        }
    }

    function setupTipShapeEvents() {
        const btnArrow = document.getElementById('btnTipShapeArrow');
        const btnCircle = document.getElementById('btnTipShapeCircle');

        const applyTipShape = (shape) => {
            state.tipShape = shape;
            if (btnArrow) btnArrow.classList.toggle('active', shape === 'arrow');
            if (btnCircle) btnCircle.classList.toggle('active', shape === 'circle');
            refreshAllStyleColoredCanvases();
            saveStateToLocalStorage();
        };

        if (btnArrow) btnArrow.addEventListener('click', () => applyTipShape('arrow'));
        if (btnCircle) btnCircle.addEventListener('click', () => applyTipShape('circle'));

        if (btnArrow) btnArrow.classList.toggle('active', state.tipShape !== 'circle');
        if (btnCircle) btnCircle.classList.toggle('active', state.tipShape === 'circle');
    }

    const btnManageComponent = document.getElementById('btnManageComponent');
    if (btnManageComponent) btnManageComponent.addEventListener('click', () => window.openOptionManagerModal('component'));

    const btnManageDefectType = document.getElementById('btnManageDefectType');
    if (btnManageDefectType) btnManageDefectType.addEventListener('click', () => window.openOptionManagerModal('type'));

    const btnManageCause = document.getElementById('btnManageCause');
    if (btnManageCause) btnManageCause.addEventListener('click', () => window.openOptionManagerModal('cause'));

    const btnCloseOptionManager = document.getElementById('btnCloseOptionManager');
    if (btnCloseOptionManager) btnCloseOptionManager.addEventListener('click', closeOptionManagerModal);

    const btnOptionManagerAdd = document.getElementById('btnOptionManagerAdd');
    if (btnOptionManagerAdd) {
        btnOptionManagerAdd.addEventListener('click', () => {
            const input = document.getElementById('optionManagerNewInput');
            const val = (input?.value || '').trim();
            if (!val) return;

            const ctx = getOptionManagerContext();
            if (!ctx) return;

            const isVisiblePreset = ctx.presetList.includes(val) && !ctx.hiddenList.includes(val);
            if (isVisiblePreset || ctx.customList.includes(val)) {
                window.showToast('이미 있는 항목입니다.', 'info');
                return;
            }

            const hiddenIdx = ctx.hiddenList.indexOf(val);
            if (hiddenIdx !== -1) {
                // 숨겨뒀던 기본 항목을 다시 추가하는 경우 -> 숨김 해제
                ctx.hiddenList.splice(hiddenIdx, 1);
            } else {
                ctx.customList.push(val);
            }

            saveStateToLocalStorage();
            if (input) input.value = '';
            renderOptionManagerList();
            ctx.refresh();
        });
    }

    // Canvas Mouse & Touch Event Handlers with Threshold-Based Pin & Arrow Dragging & Multi-Touch Pinch Zoom
    let isDragging = false;
    let isMarkingDrag = false;
    let pendingDragHit = null; // 눌렀지만 아직 이동임계값을 넘지 않아 드래그 시작을 보류 중인 히트 정보
    let isDraggingPin = false;
    let activeDragPin = null;
    let activeDragPart = 'BOX'; // 'BOX', 'TIP', 'AREA_MOVE', or 'AREA_RESIZE'
    let activeResizeXField = null; // 'areaX1' | 'areaX2' | null
    let activeResizeYField = null; // 'areaY1' | 'areaY2' | null

    // Area(면적) Marking Mode State
    let isAreaDrag = false;
    let areaStartImgX = 0;
    let areaStartImgY = 0;
    let areaCurImgX = 0;
    let areaCurImgY = 0;
    let areaMoveLastImgX = 0;
    let areaMoveLastImgY = 0;

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

        for (let i = defects.length - 1; i >= 0; i--) {
            const d = defects[i];
            const dSize = getStyleSize(getDefectStyleKey(d.category, d.defectType));
            const scale = dSize.pin;
            const arrowScale = dSize.arrow;

            // 0. Area(면적) 결함: 모서리/변(리사이즈) → 사각형 내부·번호 라벨(이동) 순으로 판정
            if (d.shapeType === 'area' && d.areaX1 !== undefined) {
                const pad = 10;
                const x1 = Math.min(d.areaX1, d.areaX2);
                const x2 = Math.max(d.areaX1, d.areaX2);
                const y1 = Math.min(d.areaY1, d.areaY2);
                const y2 = Math.max(d.areaY1, d.areaY2);
                // areaX1/areaX2 중 실제로 어느 필드가 최소/최대값을 담고 있는지는 드래그 방향에 따라 바뀌므로 매번 다시 계산
                const minXField = d.areaX1 <= d.areaX2 ? 'areaX1' : 'areaX2';
                const maxXField = d.areaX1 <= d.areaX2 ? 'areaX2' : 'areaX1';
                const minYField = d.areaY1 <= d.areaY2 ? 'areaY1' : 'areaY2';
                const maxYField = d.areaY1 <= d.areaY2 ? 'areaY2' : 'areaY1';

                // 모서리 4곳: 대각선(가로+세로 동시) 리사이즈
                const cornerR = 14;
                const corners = [
                    { x: x1, y: y1, xField: minXField, yField: minYField },
                    { x: x2, y: y1, xField: maxXField, yField: minYField },
                    { x: x1, y: y2, xField: minXField, yField: maxYField },
                    { x: x2, y: y2, xField: maxXField, yField: maxYField }
                ];
                const hitCorner = corners.find(c => Math.hypot(imgX - c.x, imgY - c.y) <= cornerR);
                if (hitCorner) {
                    return { defect: d, part: 'AREA_RESIZE', resizeXField: hitCorner.xField, resizeYField: hitCorner.yField };
                }

                // 변 4곳(모서리 구간 제외): 가로 또는 세로 한쪽만 리사이즈
                const edgeTol = 10;
                if (Math.abs(imgY - y1) <= edgeTol && imgX >= x1 + cornerR && imgX <= x2 - cornerR) {
                    return { defect: d, part: 'AREA_RESIZE', resizeXField: null, resizeYField: minYField }; // TOP
                }
                if (Math.abs(imgY - y2) <= edgeTol && imgX >= x1 + cornerR && imgX <= x2 - cornerR) {
                    return { defect: d, part: 'AREA_RESIZE', resizeXField: null, resizeYField: maxYField }; // BOTTOM
                }
                if (Math.abs(imgX - x1) <= edgeTol && imgY >= y1 + cornerR && imgY <= y2 - cornerR) {
                    return { defect: d, part: 'AREA_RESIZE', resizeXField: minXField, resizeYField: null }; // LEFT
                }
                if (Math.abs(imgX - x2) <= edgeTol && imgY >= y1 + cornerR && imgY <= y2 - cornerR) {
                    return { defect: d, part: 'AREA_RESIZE', resizeXField: maxXField, resizeYField: null }; // RIGHT
                }

                // 사각형 내부 또는 번호 라벨 박스 클릭이면 전체 이동 대상으로 인식
                const rx1 = x1 - pad;
                const rx2 = x2 + pad;
                const ry1 = y1 - pad;
                const ry2 = y2 + pad;
                const inRect = imgX >= rx1 && imgX <= rx2 && imgY >= ry1 && imgY <= ry2;

                // 번호 라벨 박스는 좌상단 모서리 "바깥쪽"(위)에 그려지므로(drawAreaRect 참고)
                // 사각형 히트 영역만으로는 라벨을 눌러서 드래그를 시작할 수 없었음 — 라벨 영역도 별도로 포함
                const labelW = 38 * scale;
                const labelH = 26 * scale;
                const inLabel = imgX >= x1 - pad && imgX <= x1 + labelW + pad && imgY >= y1 - labelH - pad && imgY <= y1 + pad;

                if (inRect || inLabel) {
                    return { defect: d, part: 'AREA_MOVE' };
                }
                continue;
            }

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

        // CAD(DXF) 캘리브레이션 기준점을 도면에서 클릭으로 지정하는 중이면,
        // 이번 클릭은 결함 마킹이 아니라 좌표 캡처로만 처리하고 즉시 종료한다.
        if (window._calibrationCaptureCallback) {
            const cb = window._calibrationCaptureCallback;
            window._calibrationCaptureCallback = null;
            cb(imgX, imgY);
            return;
        }

        startMouseX = clientX;
        startMouseY = clientY;
        initialOffsetX = state.view.offsetX;
        initialOffsetY = state.view.offsetY;

        // Check if existing pin box, arrowhead tip, or area handle was clicked.
        // 실제 이동 시작 여부는 handleDragMove에서 이동임계값을 넘는 순간 판정한다(길게 누를 필요 없음).
        const hitInfo = findHitPinPart(imgX, imgY);
        if (hitInfo) {
            pendingDragHit = { hitInfo, imgX, imgY };
            return;
        }

        if (state.mode === 'MARK') {
            isMarkingDrag = true;
            markTargetImgX = imgX;
            markTargetImgY = imgY;
            liveBoxImgX = markTargetImgX + 35;
            liveBoxImgY = markTargetImgY - 35;
            drawCanvas();
        } else if (state.mode === 'AREA') {
            isAreaDrag = true;
            areaStartImgX = imgX;
            areaStartImgY = imgY;
            areaCurImgX = imgX;
            areaCurImgY = imgY;
            drawCanvas();
        } else {
            isDragging = true;
            elements.planCanvas.style.cursor = 'grabbing';
        }
    }

    function handleDragMove(clientX, clientY) {
        if (!elements.planCanvas) return;
        const rect = elements.planCanvas.getBoundingClientRect();

        if (pendingDragHit && !isDraggingPin) {
            const dx = clientX - startMouseX;
            const dy = clientY - startMouseY;
            if (Math.hypot(dx, dy) > 6) {
                // 이동임계값을 넘는 순간 바로 드래그 시작(더 이상 길게 누르고 기다릴 필요 없음)
                pushDefectHistory();
                isDraggingPin = true;
                activeDragPin = pendingDragHit.hitInfo.defect;
                activeDragPart = pendingDragHit.hitInfo.part;
                activeResizeXField = pendingDragHit.hitInfo.resizeXField || null;
                activeResizeYField = pendingDragHit.hitInfo.resizeYField || null;
                if (activeDragPart === 'AREA_MOVE') {
                    areaMoveLastImgX = pendingDragHit.imgX;
                    areaMoveLastImgY = pendingDragHit.imgY;
                }
                pendingDragHit = null;
                if (elements.planCanvas) elements.planCanvas.style.cursor = 'move';
            } else {
                return;
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
            } else if (activeDragPart === 'AREA_MOVE') {
                const dx = currentImgX - areaMoveLastImgX;
                const dy = currentImgY - areaMoveLastImgY;
                activeDragPin.areaX1 += dx;
                activeDragPin.areaY1 += dy;
                activeDragPin.areaX2 += dx;
                activeDragPin.areaY2 += dy;
                activeDragPin.x = activeDragPin.areaX1;
                activeDragPin.y = activeDragPin.areaY1;
                areaMoveLastImgX = currentImgX;
                areaMoveLastImgY = currentImgY;
            } else if (activeDragPart === 'AREA_RESIZE') {
                if (activeResizeXField) activeDragPin[activeResizeXField] = currentImgX;
                if (activeResizeYField) activeDragPin[activeResizeYField] = currentImgY;
            } else {
                activeDragPin.x = currentImgX;
                activeDragPin.y = currentImgY;
                // "마킹 추가"로 묶인 그룹은 박스 위치를 공유하므로 하나를 옮기면 전부 같이 이동
                if (activeDragPin.groupId) {
                    getCurrentFloorDefects().forEach(d => {
                        if (d.groupId === activeDragPin.groupId && d.id !== activeDragPin.id) {
                            d.x = currentImgX;
                            d.y = currentImgY;
                        }
                    });
                }
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
        } else if (isAreaDrag) {
            const mouseX = clientX - rect.left;
            const mouseY = clientY - rect.top;
            const vx = (mouseX - state.view.offsetX) / state.view.scale;
            const vy = (mouseY - state.view.offsetY) / state.view.scale;
            const coords = viewToImgCoords(vx, vy);
            areaCurImgX = coords.x;
            areaCurImgY = coords.y;
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
        if (pendingDragHit && !isDraggingPin) {
            // 이동임계값을 넘지 않고 그냥 뗐음 = 클릭으로 간주 → 수정 모달 오픈
            const d = pendingDragHit.hitInfo.defect;
            pendingDragHit = null;
            openAddDefectModal(d.x, d.y, d.targetX, d.targetY, d);
            return;
        }
        pendingDragHit = null;

        if (isDraggingPin) {
            isDraggingPin = false;
            activeDragPin = null;
            activeResizeXField = null;
            activeResizeYField = null;
            saveStateToLocalStorage();
            drawCanvas();
        }

        if (isMarkingDrag) {
            isMarkingDrag = false;
            openAddDefectModal(liveBoxImgX, liveBoxImgY, markTargetImgX, markTargetImgY);
        }

        if (isAreaDrag) {
            isAreaDrag = false;
            const x1 = Math.min(areaStartImgX, areaCurImgX);
            const y1 = Math.min(areaStartImgY, areaCurImgY);
            const x2 = Math.max(areaStartImgX, areaCurImgX);
            const y2 = Math.max(areaStartImgY, areaCurImgY);
            if (Math.hypot(x2 - x1, y2 - y1) < 15) {
                // 너무 작게 그려짐(단순 클릭) - 무시하고 취소
                drawCanvas();
            } else {
                openAddDefectModal(x1, y1, undefined, undefined, null, { x1, y1, x2, y2 });
            }
        }

        isDragging = false;
        if (elements.planCanvas) {
            elements.planCanvas.style.cursor = state.mode === 'MARK' ? 'crosshair' : (state.mode === 'AREA' ? 'crosshair' : 'grab');
        }
    }

    if (elements.planCanvas) {
        // Mouse Events
        elements.planCanvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) handleDragStart(e.clientX, e.clientY);
        });

        window.addEventListener('mousemove', (e) => {
            if (isDragging || isMarkingDrag || isAreaDrag || isDraggingPin || pendingDragHit) handleDragMove(e.clientX, e.clientY);
        });

        window.addEventListener('mouseup', () => {
            if (isDragging || isMarkingDrag || isAreaDrag || isDraggingPin || pendingDragHit) handleDragEnd();
        });

        // Touch Events (Galaxy Tab & Smartphone Support with Multi-Touch Pinch Zoom & Pan)
        elements.planCanvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1 && !isPinching) {
                handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
            } else if (e.touches.length >= 2) {
                // Multi-touch detected: cancel active 1-finger mark or drag operations safely
                pendingDragHit = null;
                isMarkingDrag = false;
                isDragging = false;
                isDraggingPin = false;
                isAreaDrag = false;
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
                if (isDragging || isMarkingDrag || isAreaDrag || isDraggingPin || pendingDragHit) {
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
                if (isDragging || isMarkingDrag || isAreaDrag || isDraggingPin || pendingDragHit) handleDragEnd();
            }
        });

        window.addEventListener('touchcancel', () => {
            isPinching = false;
            if (isDragging || isMarkingDrag || isAreaDrag || isDraggingPin || pendingDragHit) handleDragEnd();
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
        window._defectMarkingTemplate = null;
        if (elements.defectModal) {
            elements.defectModal.style.display = 'none';
            elements.defectModal.classList.remove('open');
        }
    }

    function openAddDefectModal(boxX, boxY, targetX, targetY, existingPin = null, areaRect = null) {
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
        const carriedOverEl = document.getElementById('defectCarriedOver');

        if (existingPin) {
            if (pinIdEl) pinIdEl.value = existingPin.id;
            if (noEl) noEl.value = existingPin.no || 'NO.01';
            if (catEl) catEl.value = existingPin.category || '구조체';
            updateDefectTypeDropdown(existingPin.category || '구조체', existingPin.defectType);
            updateDefectCauseDropdown(existingPin.defectType || '균열', existingPin.cause);
            const compCatExisting = existingPin.category || '구조체';
            const compDefaultExisting = (DEFECT_COMPONENT_PRESET[compCatExisting] || DEFECT_COMPONENT_PRESET['구조체'])[0];
            populateDefectComponentDropdown(compCatExisting, existingPin.component || compDefaultExisting);
            if (carriedOverEl) carriedOverEl.checked = !!existingPin.isCarriedOver;
            if (locEl) locEl.value = existingPin.location || `${state.currentFloor} ${existingPin.component || '기둥'}`;
            if (sizeEl) sizeEl.value = existingPin.size || 'W=0.2mm';
            const crackWidthElExisting = document.getElementById('defectCrackWidth');
            const crackLengthElExisting = document.getElementById('defectCrackLength');
            if (crackWidthElExisting) crackWidthElExisting.value = (existingPin.crackWidth !== undefined && existingPin.crackWidth !== null) ? existingPin.crackWidth : '';
            if (crackLengthElExisting) crackLengthElExisting.value = (existingPin.crackLength !== undefined && existingPin.crackLength !== null) ? existingPin.crackLength : '';
            if (progCheckEl) progCheckEl.checked = !!existingPin.isProgress;
            if (leakCheckEl) leakCheckEl.checked = !!existingPin.isLeak;

            window._pendingPhotos = existingPin.photos || [];
            if (existingPin.shapeType === 'area' && existingPin.areaX1 !== undefined) {
                window._pendingAreaRect = { x1: existingPin.areaX1, y1: existingPin.areaY1, x2: existingPin.areaX2, y2: existingPin.areaY2 };
                window._pendingPinCoords = { x: existingPin.x, y: existingPin.y, targetX: undefined, targetY: undefined };
            } else {
                window._pendingAreaRect = null;
                window._pendingPinCoords = { x: existingPin.x, y: existingPin.y, targetX: existingPin.targetX, targetY: existingPin.targetY };
            }
        } else {
            const seq = defects.length + 1;
            const seqStr = seq < 10 ? `0${seq}` : `${seq}`;
            const defectNoStr = `NO.${seqStr}`;

            // "마킹 추가"로 이어서 등록하는 경우, 직전 결함의 부재/종류/원인/규모를 그대로 이어받는다
            const tmpl = window._defectMarkingTemplate;

            if (pinIdEl) pinIdEl.value = '';
            if (noEl) noEl.value = (tmpl && tmpl.groupId) ? `${tmpl.groupNo}-${tmpl.chainIndex}` : defectNoStr;
            const defaultCat = (tmpl && tmpl.category) || '구조체';
            if (catEl) catEl.value = defaultCat;
            updateDefectTypeDropdown(defaultCat, (tmpl && tmpl.defectType) || null);
            updateDefectCauseDropdown((tmpl && tmpl.defectType) || '균열', (tmpl && tmpl.cause) || null);
            const defaultComp = (tmpl && tmpl.component) || (DEFECT_COMPONENT_PRESET[defaultCat] || DEFECT_COMPONENT_PRESET['구조체'])[0];
            populateDefectComponentDropdown(defaultCat, defaultComp);
            if (carriedOverEl) carriedOverEl.checked = false;
            if (sizeEl) sizeEl.value = (tmpl && tmpl.size) || '';
            const crackWidthElNew = document.getElementById('defectCrackWidth');
            const crackLengthElNew = document.getElementById('defectCrackLength');
            if (crackWidthElNew) crackWidthElNew.value = (tmpl && tmpl.crackWidth) || '';
            if (crackLengthElNew) crackLengthElNew.value = (tmpl && tmpl.crackLength) || '';
            if (progCheckEl) progCheckEl.checked = false;
            if (leakCheckEl) leakCheckEl.checked = false;
            window._pendingPhotos = [];

            if (areaRect) {
                // 영역(면적)으로 새로 등록하는 경우
                if (locEl) {
                    locEl.value = '';
                }
                window._pendingAreaRect = { x1: areaRect.x1, y1: areaRect.y1, x2: areaRect.x2, y2: areaRect.y2 };
                window._pendingPinCoords = { x: areaRect.x1, y: areaRect.y1, targetX: undefined, targetY: undefined };
            } else {
                const tX = targetX !== undefined ? targetX : (boxX - 35);
                const tY = targetY !== undefined ? targetY : (boxY + 35);
                if (locEl) {
                    locEl.value = '';
                }
                window._pendingAreaRect = null;
                // 마킹 추가 체인이면 박스 위치는 그룹의 공유 위치로 고정하고, 클릭한 지점은 화살표 끝(target)으로만 사용
                const useGroupBox = !!(tmpl && tmpl.groupId);
                window._pendingPinCoords = {
                    x: useGroupBox ? tmpl.boxX : boxX,
                    y: useGroupBox ? tmpl.boxY : boxY,
                    targetX: tX,
                    targetY: tY
                };
            }
        }

        // 결함 등록화면이 닫혀있는 동안 휴대폰에서 미리 찍어둔 사진(대기함)을 지금 여는 결함에 자동으로 붙임
        if (window._phoneRelayInbox && window._phoneRelayInbox.length) {
            window._pendingPhotos = (window._pendingPhotos || []).concat(window._phoneRelayInbox);
            window._phoneRelayInbox = [];
        }
        if (typeof updatePhoneRelayButtonLabel === 'function') updatePhoneRelayButtonLabel();
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

    // --- 📱 휴대폰 카메라 연동 (QR 한 번만 스캔 → 로그인 없이 촬영 → 작업 세션 내내 계속 연동) ---
    // 결함 등록화면이 열려있으면 사진이 바로 그 결함에 추가되고, 닫혀있으면 대기함(_phoneRelayInbox)에
    // 쌓였다가 다음에 여는 결함 등록화면에 자동으로 붙는다. 결함마다 QR을 다시 찍을 필요 없음.
    let phoneRelayUnsubscribe = null;
    window._phoneRelayInbox = window._phoneRelayInbox || [];

    function isDefectModalOpen() {
        return !!(elements.defectModal && elements.defectModal.classList.contains('open'));
    }

    function updatePhoneRelayButtonLabel() {
        const waiting = (window._phoneRelayInbox || []).length;
        const btn = document.getElementById('btnTriggerPhoneRelay');
        if (btn) {
            if (phoneRelayUnsubscribe) {
                btn.innerHTML = `<i class="fa-solid fa-mobile-screen-button"></i> 📱 휴대폰 연동됨${waiting ? ` (대기중 사진 ${waiting}장)` : ''}`;
            } else {
                btn.innerHTML = '<i class="fa-solid fa-mobile-screen-button"></i> 📱 휴대폰으로 촬영해서 바로 받기';
            }
        }

        // 결함 등록화면 안의 상태 배지: 연동 중일 때만 표시
        const badge = document.getElementById('phoneRelayStatusBadge');
        const badgeText = document.getElementById('phoneRelayStatusText');
        if (badge) {
            badge.style.display = phoneRelayUnsubscribe ? 'flex' : 'none';
        }
        if (badgeText && phoneRelayUnsubscribe) {
            badgeText.textContent = waiting
                ? `휴대폰 연동됨 — 대기중인 사진 ${waiting}장이 자동으로 추가됩니다`
                : '휴대폰 연동됨 — 휴대폰에서 촬영하면 자동으로 여기에 추가됩니다';
        }
    }

    function receivePhoneRelayPhoto(dataUrl) {
        if (isDefectModalOpen()) {
            if (!window._pendingPhotos) window._pendingPhotos = [];
            window._pendingPhotos.push(dataUrl);
            renderPhotoPreviewList();
            window.showToast('휴대폰에서 사진을 받아 결함에 추가했습니다.', 'success');
        } else {
            window._phoneRelayInbox.push(dataUrl);
            window.showToast(`휴대폰에서 사진을 받았습니다. 다음 결함 등록 시 자동으로 추가됩니다. (대기 ${window._phoneRelayInbox.length}장)`, 'info');
        }
        updatePhoneRelayButtonLabel();
    }

    function hidePhoneRelayModal() {
        if (elements.mobileQrModal) {
            elements.mobileQrModal.style.display = 'none';
            elements.mobileQrModal.classList.remove('open');
        }
    }

    function disconnectPhoneRelay() {
        if (phoneRelayUnsubscribe) { phoneRelayUnsubscribe(); phoneRelayUnsubscribe = null; }
        window._phoneRelayInbox = [];
        updatePhoneRelayButtonLabel();
        window.showToast('휴대폰 연동이 해제되었습니다.', 'info');
    }

    function startPhoneRelaySession() {
        const sessionId = `rel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const captureUrl = new URL('photo-capture.html', window.location.href);
        captureUrl.searchParams.set('s', sessionId);

        const qrContainer = document.getElementById('mobileQrCanvas');
        const statusEl = document.getElementById('mobileQrStatus');
        if (qrContainer) {
            qrContainer.innerHTML = '';
            new QRCode(qrContainer, { text: captureUrl.href, width: 200, height: 200 });
        }
        if (statusEl) {
            statusEl.textContent = '휴대폰으로 QR을 스캔해 주세요. 한 번 연결하면 계속 유지됩니다.';
            statusEl.style.color = '';
        }

        phoneRelayUnsubscribe = db.collection('photoRelay').doc(sessionId).collection('photos')
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === 'added') {
                        const data = change.doc.data();
                        if (data && data.dataUrl) {
                            receivePhoneRelayPhoto(data.dataUrl);
                            if (statusEl) {
                                statusEl.textContent = '휴대폰과 연결되어 있습니다. 계속 촬영하셔도 됩니다.';
                                statusEl.style.color = '#4ade80';
                            }
                        }
                    }
                });
            }, (err) => {
                console.error('휴대폰 연동 사진 수신 오류:', err);
            });

        updatePhoneRelayButtonLabel();
    }

    function openPhoneRelayModal() {
        if (!db) {
            window.showToast('네트워크(Firebase) 연결이 필요한 기능입니다. 오프라인 상태에서는 사용할 수 없습니다.', 'warning');
            return;
        }
        if (typeof QRCode === 'undefined') {
            window.showToast('QR 코드 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.', 'error');
            return;
        }

        if (elements.mobileQrModal) {
            elements.mobileQrModal.style.display = 'flex';
            elements.mobileQrModal.classList.add('open');
        }

        if (phoneRelayUnsubscribe) {
            // 이미 연동되어 있으면 QR을 새로 만들지 않고 연결 상태만 보여줌
            const qrContainer = document.getElementById('mobileQrCanvas');
            const statusEl = document.getElementById('mobileQrStatus');
            if (qrContainer) qrContainer.innerHTML = '<div style="padding:2.5rem 1rem; color:#4ade80; font-weight:700;"><i class="fa-solid fa-circle-check"></i><br>이미 휴대폰과 연동되어 있습니다</div>';
            if (statusEl) {
                statusEl.textContent = '다른 휴대폰으로 다시 연결하려면 "연동 해제" 후 다시 열어주세요.';
                statusEl.style.color = '#4ade80';
            }
            return;
        }

        startPhoneRelaySession();
    }

    const btnTriggerPhoneRelay = document.getElementById('btnTriggerPhoneRelay');
    if (btnTriggerPhoneRelay) {
        btnTriggerPhoneRelay.onclick = (e) => {
            e.preventDefault();
            openPhoneRelayModal();
        };
    }

    const btnCloseQrModal = document.getElementById('btnCloseQrModal');
    if (btnCloseQrModal) btnCloseQrModal.addEventListener('click', hidePhoneRelayModal);
    const btnCloseQrConfirm = document.getElementById('btnCloseQrConfirm');
    if (btnCloseQrConfirm) btnCloseQrConfirm.addEventListener('click', hidePhoneRelayModal);
    const btnDisconnectPhoneRelay = document.getElementById('btnDisconnectPhoneRelay');
    if (btnDisconnectPhoneRelay) {
        btnDisconnectPhoneRelay.addEventListener('click', () => {
            disconnectPhoneRelay();
            hidePhoneRelayModal();
        });
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

    // 결함 모달의 현재 입력값을 저장(신규 생성 또는 기존 결함 수정)하고 저장된 결함 객체를 반환
    async function commitDefectFromForm() {
        if (!state.currentBuildingId) return null;
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        if (!state.defects[key]) state.defects[key] = [];
        pushDefectHistory();

        const pinId = document.getElementById('defectPinId').value;
        const coords = window._pendingPinCoords || { x: 200, y: 200, targetX: 165, targetY: 235 };

        const locVal = document.getElementById('defectLocation')?.value || `${state.currentFloor} ${document.getElementById('defectComponent')?.value || '기둥'}`;
        const isProgress = document.getElementById('defectProgressCheck')?.checked || false;
        const isLeak = document.getElementById('defectLeakCheck')?.checked || false;
        const isCarriedOver = document.getElementById('defectCarriedOver')?.checked || false;
        const photosVal = window._pendingPhotos || [];
        const dTypeVal = document.getElementById('defectType')?.value || '균열';
        const isCrackType = dTypeVal === '균열';
        const crackWidthVal = isCrackType ? (document.getElementById('defectCrackWidth')?.value || '') : '';
        const crackLengthVal = isCrackType ? (document.getElementById('defectCrackLength')?.value || '') : '';

        let savedDefect = null;

        if (pinId) {
            // Update existing defect
            const idx = state.defects[key].findIndex(d => d.id === pinId);
            if (idx !== -1) {
                state.defects[key][idx].no = document.getElementById('defectNo')?.value || 'NO.01';
                state.defects[key][idx].category = document.getElementById('defectCategory')?.value || '구조체';
                state.defects[key][idx].component = document.getElementById('defectComponent')?.value || '기둥';
                state.defects[key][idx].location = locVal;
                state.defects[key][idx].defectType = dTypeVal;
                state.defects[key][idx].cause = document.getElementById('defectCause')?.value || '건조수축';
                state.defects[key][idx].size = document.getElementById('defectSize')?.value || 'W=0.2mm';
                state.defects[key][idx].crackWidth = crackWidthVal;
                state.defects[key][idx].crackLength = crackLengthVal;
                state.defects[key][idx].isProgress = isProgress;
                state.defects[key][idx].isLeak = isLeak;
                state.defects[key][idx].isCarriedOver = isCarriedOver;
                state.defects[key][idx].photos = photosVal;
                if (!state.defects[key][idx].inspectorName) {
                    state.defects[key][idx].inspectorName = window.state.userName || '';
                }
                savedDefect = state.defects[key][idx];
            }
        } else {
            // Add new defect
            const newDefect = {
                id: 'pin-' + Date.now(),
                no: document.getElementById('defectNo')?.value || 'NO.01',
                category: document.getElementById('defectCategory')?.value || '구조체',
                component: document.getElementById('defectComponent')?.value || '기둥',
                location: locVal,
                defectType: dTypeVal,
                cause: document.getElementById('defectCause')?.value || '건조수축',
                size: document.getElementById('defectSize')?.value || 'W=0.2mm',
                crackWidth: crackWidthVal,
                crackLength: crackLengthVal,
                isProgress: isProgress,
                isLeak: isLeak,
                isCarriedOver: isCarriedOver,
                surveyRound: getCurrentSurveyRoundKey(),
                photos: photosVal,
                inspectorName: window.state.userName || '',
                x: coords.x,
                y: coords.y,
                targetX: coords.targetX,
                targetY: coords.targetY
            };
            if (window._pendingAreaRect) {
                newDefect.shapeType = 'area';
                newDefect.areaX1 = window._pendingAreaRect.x1;
                newDefect.areaY1 = window._pendingAreaRect.y1;
                newDefect.areaX2 = window._pendingAreaRect.x2;
                newDefect.areaY2 = window._pendingAreaRect.y2;
            } else if (window._defectMarkingTemplate && window._defectMarkingTemplate.groupId) {
                // "마킹 추가" 체인의 연속 마킹 — 같은 그룹으로 묶어서 도면에는 화살표만 늘어나도록 표시
                newDefect.groupId = window._defectMarkingTemplate.groupId;
                newDefect.groupNo = window._defectMarkingTemplate.groupNo;
            }
            state.defects[key].push(newDefect);
            savedDefect = newDefect;
        }

        if (savedDefect && photosVal.length > 0) {
            await uploadDefectPhotos(savedDefect.id, photosVal);
        }

        saveStateToLocalStorage();
        return savedDefect;
    }

    const btnSaveDefect = document.getElementById('btnSaveDefect');
    if (btnSaveDefect) {
        btnSaveDefect.addEventListener('click', async () => {
            await commitDefectFromForm();
            closeDefectModal(); // 일반 저장은 연속 마킹 종료로 간주 (closeDefectModal이 템플릿을 정리함)
            drawCanvas();
        });
    }

    // 같은 결함 정보(부재/종류/원인/규모)를 유지한 채 위치만 바꿔서 여러 곳에 반복 마킹
    const btnAddAnotherMarking = document.getElementById('btnAddAnotherMarking');
    if (btnAddAnotherMarking) {
        btnAddAnotherMarking.addEventListener('click', async () => {
            const saved = await commitDefectFromForm();
            closeDefectModal();
            if (saved) {
                const isArea = saved.shapeType === 'area';
                let nextChainIndex = 2;
                if (!isArea) {
                    // 이 결함이 체인의 첫 시작이면(아직 groupId가 없으면) 대표번호를 부여하고
                    // 자기 자신의 결함번호를 "NO.03-1" 형태의 첫 서브번호로 바꾼다.
                    if (!saved.groupId) {
                        saved.groupId = saved.id;
                        saved.groupNo = saved.no;
                        saved.no = `${saved.no}-1`;
                        nextChainIndex = 2;
                    } else {
                        const key = `${state.currentBuildingId}_${state.currentFloor}`;
                        const memberCount = (state.defects[key] || []).filter(d => d.groupId === saved.groupId).length;
                        nextChainIndex = memberCount + 1;
                    }
                    saveStateToLocalStorage();
                }
                drawCanvas();

                window._defectMarkingTemplate = {
                    category: saved.category,
                    component: saved.component,
                    defectType: saved.defectType,
                    cause: saved.cause,
                    size: saved.size,
                    crackWidth: saved.crackWidth,
                    crackLength: saved.crackLength,
                    groupId: isArea ? null : saved.groupId,
                    groupNo: isArea ? null : saved.groupNo,
                    boxX: saved.x,
                    boxY: saved.y,
                    chainIndex: nextChainIndex
                };
                setDrawMode(isArea ? 'AREA' : 'MARK');
                window.showToast('같은 결함 정보를 유지했습니다. 도면에서 다음 위치를 클릭해 표시하세요.', 'info', 3500);
            } else {
                drawCanvas();
            }
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

    // Open Add Building Modal CTA
    const btnOpenAddBuildingModal = document.getElementById('btnOpenAddBuildingModal');
    if (btnOpenAddBuildingModal) btnOpenAddBuildingModal.addEventListener('click', () => window.openAddBuildingModalFunc());

    const btnCloseAddBuildingModal = document.getElementById('btnCloseAddBuildingModal');
    if (btnCloseAddBuildingModal) btnCloseAddBuildingModal.addEventListener('click', () => window.closeAddBuildingModalFunc());

    const btnCancelAddBuilding = document.getElementById('btnCancelAddBuilding');
    if (btnCancelAddBuilding) btnCancelAddBuilding.addEventListener('click', () => window.closeAddBuildingModalFunc());

    // Floor Select Change
    if (elements.floorSelect) {
        elements.floorSelect.addEventListener('change', (e) => {
            window.state.currentFloor = e.target.value;
            loadFloorDrawing(e.target.value);
        });
    }

    // Mode Toggle (PAN vs MARK vs AREA)
    function setDrawMode(mode) {
        state.mode = mode;
        const pan = document.getElementById('btnModePan');
        const mark = document.getElementById('btnModeMark');
        const area = document.getElementById('btnModeArea');
        if (pan) pan.classList.toggle('active', mode === 'PAN');
        if (mark) mark.classList.toggle('active', mode === 'MARK');
        if (area) area.classList.toggle('active', mode === 'AREA');
    }

    const btnModePan = document.getElementById('btnModePan');
    const btnModeMark = document.getElementById('btnModeMark');
    const btnModeArea = document.getElementById('btnModeArea');
    if (btnModePan && btnModeMark) {
        btnModePan.addEventListener('click', () => setDrawMode('PAN'));
        btnModeMark.addEventListener('click', () => setDrawMode('MARK'));
        if (btnModeArea) btnModeArea.addEventListener('click', () => setDrawMode('AREA'));
    }

    // 되돌리기 / 다시실행 / 전체초기화 (하단 아이콘 툴바)
    const btnUndoEl = document.getElementById('btnUndo');
    if (btnUndoEl) btnUndoEl.addEventListener('click', () => undoDefectChange());

    const btnRedoEl = document.getElementById('btnRedo');
    if (btnRedoEl) btnRedoEl.addEventListener('click', () => redoDefectChange());

    const btnClearPinsEl = document.getElementById('btnClearPins');
    if (btnClearPinsEl) {
        btnClearPinsEl.addEventListener('click', () => {
            if (!state.currentBuildingId) return;
            const key = `${state.currentBuildingId}_${state.currentFloor}`;
            const defects = state.defects[key] || [];
            if (defects.length === 0) {
                window.showToast('현재 층에 등록된 결함이 없습니다.', 'info');
                return;
            }
            if (!confirm(`현재 층의 결함 ${defects.length}건을 모두 삭제할까요? (되돌리기로 복원 가능)`)) return;

            pushDefectHistory();
            defects.forEach(d => {
                if (d.photos && d.photos.length > 0) {
                    deletePhotosForDefect(d.id, d.photos.length);
                }
            });
            state.defects[key] = [];
            saveStateToLocalStorage();
            renderSurveyTable();
            drawCanvas();
            window.showToast('현재 층 결함을 모두 초기화했습니다.', 'success');
        });
    }

    // Ctrl+Z / Ctrl+Y 키보드 단축키 (입력 필드에 포커스가 있을 때는 무시)
    window.addEventListener('keydown', (e) => {
        const tag = (e.target && e.target.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
        if (!document.getElementById('tab-map')?.classList.contains('active')) return;
        if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undoDefectChange();
        } else if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
            e.preventDefault();
            redoDefectChange();
        }
    });

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

    // --- 10. SURVEY TABLE & ALBUM RENDERING ---

    // 상태조사표 컬럼 기본 정의 (화면/PDF/엑셀 공통). size와 crackWidth/crackLength는 상호 배타적으로
    // defectSizeMode에 따라 필터링되어 노출된다.
    const DEFAULT_SURVEY_COLUMNS = [
        { key: 'no', label: '결함번호' },
        { key: 'location', label: '위치' },
        { key: 'defectType', label: '조사내용' },
        { key: 'category', label: '구조체여부' },
        { key: 'size', label: '결함크기' },
        { key: 'crackWidth', label: '균열폭' },
        { key: 'crackLength', label: '균열길이' },
        { key: 'progress', label: '진행여부' },
        { key: 'leak', label: '누수여부' },
        { key: 'cause', label: '결함원인추정' },
        { key: 'remark', label: '비고' }
    ];

    function getActiveSurveyColumns() {
        const cols = (state.surveyColumns && state.surveyColumns.length) ? state.surveyColumns : DEFAULT_SURVEY_COLUMNS;
        const mode = state.defectSizeMode || 'combined';
        return cols.filter(c => {
            if (mode === 'combined' && (c.key === 'crackWidth' || c.key === 'crackLength')) return false;
            if (mode === 'split' && c.key === 'size') return false;
            return true;
        });
    }

    // 컬럼 키별 표시 텍스트를 계산하는 단일 소스. 화면/PDF/엑셀 3곳이 모두 이 함수를 사용해 값을 동기화한다.
    function getSurveyCellText(colKey, d, ctx) {
        ctx = ctx || {};
        const isCrack = d.defectType === '균열';
        const isGood = d.defectType === '상태양호';
        switch (colKey) {
            case 'no': return d.no || '';
            case 'location': return d.location || ((ctx.floorCode || state.currentFloor) + ' ' + (d.component || '기둥'));
            case 'defectType': return d.defectType || '';
            case 'category': return d.category === '구조체' ? '○' : '-';
            case 'size': {
                if (isCrack && (d.crackWidth !== undefined && d.crackWidth !== '' || d.crackLength !== undefined && d.crackLength !== '')) {
                    const w = (d.crackWidth !== undefined && d.crackWidth !== '') ? d.crackWidth : '-';
                    const l = (d.crackLength !== undefined && d.crackLength !== '') ? d.crackLength : '-';
                    return `${w}/${l}`;
                }
                return d.size || 'W=0.2mm';
            }
            case 'crackWidth': {
                if (!isCrack) return '-';
                if (d.crackWidth !== undefined && d.crackWidth !== '') return `${d.crackWidth}mm`;
                // 균열폭/길이 분리 입력 이전에 자유텍스트(size)로 저장된 구버전 데이터: 값이 사라지지 않도록 그대로 표시
                return d.size || '-';
            }
            case 'crackLength': {
                if (isCrack) return (d.crackLength !== undefined && d.crackLength !== '') ? `${d.crackLength}m` : '-';
                return '-';
            }
            case 'progress': return d.isProgress ? '진행중' : '-';
            case 'leak': return d.isLeak ? '누수중' : '-';
            case 'cause': return isGood ? '-' : (d.cause || '건조수축');
            case 'remark': return ctx.photoRemark || '-';
            default: return '';
        }
    }

    // 화면(스크린) 상태조사표 한 셀의 스타일 있는 HTML을 만든다 (renderSurveyTable에서 사용)
    function renderScreenSurveyCellHtml(colKey, d, ctx) {
        const text = getSurveyCellText(colKey, d, ctx);
        switch (colKey) {
            case 'no': return `<strong style="color:#0284c7; font-size:0.95rem;">${text}</strong>`;
            case 'location': return `<span style="font-weight:700; color:#1e293b;">${text}</span>`;
            case 'defectType': return `<span style="font-weight:700; color:#0369a1;">${text}</span>`;
            case 'category': return `<span style="font-weight:800; font-size:1.15rem; color:${text === '○' ? '#ef4444' : '#94a3b8'};">${text}</span>`;
            case 'size': case 'crackWidth': case 'crackLength': return text;
            case 'progress': return `<span style="font-weight:800; font-size:0.92rem; color:${text === '진행중' ? '#dc2626' : '#94a3b8'};">${text}</span>`;
            case 'leak': return `<span style="font-weight:800; font-size:0.92rem; color:${text === '누수중' ? '#0284c7' : '#94a3b8'};">${text}</span>`;
            case 'cause': return `<span style="font-weight:700; color:#334155;">🔍 ${text}</span>`;
            case 'remark': return `<span style="font-weight:700; color:${text !== '-' ? '#2563eb' : '#94a3b8'};">${text}</span>`;
            default: return text;
        }
    }

    // PDF/엑셀 상태조사표 셀의 인라인 색상/굵기 스타일 (텍스트는 getSurveyCellText로 통일, 테두리/여백은 각 출력물에서 처리)
    function getSurveyCellColorStyle(colKey, d, ctx) {
        const text = getSurveyCellText(colKey, d, ctx);
        switch (colKey) {
            case 'no': return 'font-weight:700; color:#0284c7;';
            case 'location': return 'font-weight:700;';
            case 'defectType': return 'font-weight:700; color:#0369a1;';
            case 'category': return `font-weight:800; color:${text === '○' ? '#ef4444' : '#94a3b8'};`;
            case 'progress': return `font-weight:800; color:${text === '진행중' ? '#dc2626' : '#94a3b8'};`;
            case 'leak': return `font-weight:800; color:${text === '누수중' ? '#0284c7' : '#94a3b8'};`;
            case 'cause': return 'font-weight:700;';
            case 'remark': return `font-weight:700; color:${text !== '-' ? '#2563eb' : '#94a3b8'};`;
            default: return '';
        }
    }

    function renderSurveyTableHeader() {
        const theadEl = document.getElementById('surveyTableHead');
        if (!theadEl) return;
        const columns = getActiveSurveyColumns();
        theadEl.innerHTML = `<tr>${columns.map(c => `<th>${c.label}</th>`).join('')}<th>등록자</th><th>관리</th></tr>`;
    }

    function renderSurveyTable() {
        if (!elements.surveyTableBody) return;
        const rawDefects = getCurrentFloorDefects();
        const defects = consolidateDefectGroups(rawDefects);
        if (elements.surveyFloorTitle) elements.surveyFloorTitle.textContent = state.currentFloor;

        renderSurveyTableHeader();
        const columns = getActiveSurveyColumns();

        // 📊 현재 층 결함 통계 차트 자동 업데이트 (그룹은 하나로 합쳐서 집계)
        if (typeof window.renderDefectStatisticsChart === 'function') {
            window.renderDefectStatisticsChart('surveyChartCanvas', defects);
        }

        if (defects.length === 0) {
            elements.surveyTableBody.innerHTML = `<tr><td colspan="${columns.length + 2}" style="text-align:center; padding: 2.5rem; color:#64748b; font-weight:600;">등록된 결함이 없습니다. 도면 점검 탭에서 결함을 마킹해 보세요.</td></tr>`;
            return;
        }

        // Build sequential photo labels for current floor (사진01, 사진02, 사진03...) — raw(합치기 전) 결함 기준으로
        // 매겨서 사진첩(renderPhotoAlbum)의 번호와 어긋나지 않게 함
        const defectPhotoLabels = {};
        let pCounter = 0;
        rawDefects.forEach((d, dIdx) => {
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
            const memberIds = d._groupMemberIds || [d.id || `idx_${dIdx}`];
            const labels = memberIds.flatMap(mid => defectPhotoLabels[mid] || []);
            const photoRemark = labels.length > 0 ? labels.join(' ') : '-';
            const ctx = { floorCode: state.currentFloor, photoRemark };
            const isGroup = d._groupMemberIds && d._groupMemberIds.length > 1;
            const deleteAction = isGroup ? `window.deleteDefectGroup('${d.groupId}')` : `deleteDefectById('${d.id}')`;

            return `
                <tr>
                    ${columns.map(c => `<td>${renderScreenSurveyCellHtml(c.key, d, ctx)}</td>`).join('')}
                    <td><span class="badge badge-info">${d.inspectorName || '-'}</span></td>
                    <td><button type="button" class="btn btn-sm btn-danger-outline" onclick="${deleteAction}">삭제</button></td>
                </tr>
            `;
        }).join('');
        if (typeof renderPhotoAlbum === 'function') renderPhotoAlbum();
    }

    // --- 상태조사표 컬럼 설정 모달 ---
    function ensureSurveyColumnsInitialized() {
        if (!state.surveyColumns || !state.surveyColumns.length) {
            state.surveyColumns = DEFAULT_SURVEY_COLUMNS.map(c => ({ key: c.key, label: c.label }));
        }
        return state.surveyColumns;
    }

    function renderSurveyColumnModalList() {
        const listEl = document.getElementById('surveyColumnListBody');
        if (!listEl) return;

        const modeCombinedEl = document.getElementById('defectSizeModeCombined');
        const modeSplitEl = document.getElementById('defectSizeModeSplit');
        const mode = state.defectSizeMode || 'combined';
        if (modeCombinedEl) modeCombinedEl.checked = (mode === 'combined');
        if (modeSplitEl) modeSplitEl.checked = (mode === 'split');

        const columns = getActiveSurveyColumns();
        const defaultLabelByKey = {};
        DEFAULT_SURVEY_COLUMNS.forEach(c => { defaultLabelByKey[c.key] = c.label; });

        listEl.innerHTML = columns.map((c, idx) => `
            <div class="style-cat-card" style="display:flex; align-items:center; gap:0.5rem;">
                <div style="display:flex; flex-direction:column; gap:0.15rem;">
                    <button type="button" class="btn btn-sm btn-outline" style="padding:0.1rem 0.4rem;" ${idx === 0 ? 'disabled' : ''} onclick="window.moveSurveyColumnOrder('${c.key}', -1)"><i class="fa-solid fa-chevron-up"></i></button>
                    <button type="button" class="btn btn-sm btn-outline" style="padding:0.1rem 0.4rem;" ${idx === columns.length - 1 ? 'disabled' : ''} onclick="window.moveSurveyColumnOrder('${c.key}', 1)"><i class="fa-solid fa-chevron-down"></i></button>
                </div>
                <input type="text" class="form-control" value="${c.label}" style="flex:1;" onchange="window.renameSurveyColumn('${c.key}', this.value)" placeholder="${defaultLabelByKey[c.key] || ''}">
            </div>
        `).join('');
    }

    window.openSurveyColumnModal = function() {
        ensureSurveyColumnsInitialized();
        renderSurveyColumnModalList();
        const modal = document.getElementById('surveyColumnModal');
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('open');
        }
    };

    function closeSurveyColumnModal() {
        const modal = document.getElementById('surveyColumnModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('open');
        }
    }

    window.moveSurveyColumnOrder = function(key, direction) {
        const cols = ensureSurveyColumnsInitialized();
        // 현재 모드에서 실제로 보이는 컬럼들 기준으로 이동 대상을 찾는다 (숨겨진 size/crackWidth/crackLength는 건너뜀)
        const activeKeys = getActiveSurveyColumns().map(c => c.key);
        const curPos = activeKeys.indexOf(key);
        const targetPos = curPos + direction;
        if (curPos === -1 || targetPos < 0 || targetPos >= activeKeys.length) return;
        const swapKey = activeKeys[targetPos];

        const idxA = cols.findIndex(c => c.key === key);
        const idxB = cols.findIndex(c => c.key === swapKey);
        if (idxA === -1 || idxB === -1) return;
        const tmp = cols[idxA];
        cols[idxA] = cols[idxB];
        cols[idxB] = tmp;

        renderSurveyColumnModalList();
        renderSurveyTable();
        saveStateToLocalStorage();
    };

    window.renameSurveyColumn = function(key, newLabel) {
        const cols = ensureSurveyColumnsInitialized();
        const trimmed = (newLabel || '').trim();
        if (!trimmed) { renderSurveyColumnModalList(); return; }
        const col = cols.find(c => c.key === key);
        if (col) col.label = trimmed;
        renderSurveyTable();
        saveStateToLocalStorage();
    };

    function setDefectSizeMode(mode) {
        state.defectSizeMode = mode;
        renderSurveyColumnModalList();
        renderSurveyTable();
        saveStateToLocalStorage();
    }

    function resetSurveyColumns() {
        state.surveyColumns = null;
        renderSurveyColumnModalList();
        renderSurveyTable();
        saveStateToLocalStorage();
    }

    function setupSurveyColumnModalEvents() {
        const btnOpen = document.getElementById('btnOpenSurveyColumnModal');
        if (btnOpen) btnOpen.addEventListener('click', window.openSurveyColumnModal);

        const btnClose1 = document.getElementById('btnCloseSurveyColumnModal');
        if (btnClose1) btnClose1.addEventListener('click', closeSurveyColumnModal);
        const btnClose2 = document.getElementById('btnCloseSurveyColumnModal2');
        if (btnClose2) btnClose2.addEventListener('click', closeSurveyColumnModal);

        const modeCombinedEl = document.getElementById('defectSizeModeCombined');
        if (modeCombinedEl) modeCombinedEl.addEventListener('change', () => { if (modeCombinedEl.checked) setDefectSizeMode('combined'); });
        const modeSplitEl = document.getElementById('defectSizeModeSplit');
        if (modeSplitEl) modeSplitEl.addEventListener('change', () => { if (modeSplitEl.checked) setDefectSizeMode('split'); });

        const btnReset = document.getElementById('btnResetSurveyColumns');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                if (!confirm('컬럼 순서와 이름을 기본값으로 초기화하시겠습니까?')) return;
                resetSurveyColumns();
            });
        }
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

    // arrows: 그룹(마킹 추가로 묶인 결함들)을 한 박스+여러 화살표로 그릴 때 전달하는 {targetX,targetY}[]
    function drawPinSafe(ctx, defect, arrows, counterRotateDeg) {
        try {
            if (defect.shapeType === 'area' && defect.areaX1 !== undefined) {
                drawAreaRect(ctx, defect, false, true);
                return;
            }
            const boxX = defect.x || 100;
            const boxY = defect.y || 100;

            const safeStyleKey = getDefectStyleKey(defect.category, defect.defectType);
            const color = getDefectColor(defect.category, defect.defectType);
            const safeShapeCfg = getStyleShape(safeStyleKey);

            const targets = (arrows && arrows.length > 0)
                ? arrows
                : (defect.targetX !== undefined && defect.targetY !== undefined ? [{ targetX: defect.targetX, targetY: defect.targetY }] : []);

            // Draw Leader Line & Arrowhead/Tip (그룹이면 화살표를 여러 개 반복해서 그림)
            targets.forEach(t => {
                if (t.targetX === undefined || t.targetY === undefined) return;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(boxX, boxY);
                ctx.lineTo(t.targetX, t.targetY);
                ctx.strokeStyle = color;
                ctx.lineWidth = 2.5;
                ctx.setLineDash([4, 3]);
                ctx.stroke();

                ctx.fillStyle = color;
                const dx = t.targetX - boxX;
                const dy = t.targetY - boxY;
                const angle = Math.atan2(dy, dx);
                const arrowLen = 11;

                ctx.beginPath();
                ctx.moveTo(t.targetX, t.targetY);
                ctx.lineTo(t.targetX - arrowLen * Math.cos(angle - Math.PI / 6), t.targetY - arrowLen * Math.sin(angle - Math.PI / 6));
                ctx.lineTo(t.targetX - arrowLen * Math.cos(angle + Math.PI / 6), t.targetY - arrowLen * Math.sin(angle + Math.PI / 6));
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            });

            // Draw Pure White Box with Category-colored Border & Text Label
            // 리포트 상에서도 도면 회전 방향과 무관하게 박스/글자는 항상 수평으로 보이도록 역회전
            ctx.save();
            ctx.translate(boxX, boxY);
            if (counterRotateDeg) {
                ctx.rotate((counterRotateDeg * Math.PI) / 180);
            }
            ctx.fillStyle = safeShapeCfg.fill ? color : '#ffffff';
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            traceStyledBoxPath(ctx, 44, 30, safeShapeCfg.shape, 6);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = safeShapeCfg.fill ? '#ffffff' : color;
            ctx.font = 'bold 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(formatPinNumberLabel(defect.groupNo || defect.no || 'NO.01', safeStyleKey), 0, 0);
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

        // 로컬에 없는 도면은 보고서 생성 전에 Firestore에서 미리 일괄 조회
        if (db && window.state.companyId) {
            if (!bldg.floorDrawings) bldg.floorDrawings = {};
            const missingFloors = availableFloors.filter(fc => !bldg.floorDrawings[fc]);
            if (missingFloors.length > 0) {
                const companyDrawings = db.collection('safety_app').doc(getCompanyDocId()).collection('floorDrawings');
                await Promise.all(missingFloors.map(async fc => {
                    try {
                        const doc = await companyDrawings.doc(`${bldg.id}_${fc}`).get();
                        if (doc.exists && doc.data().dataUrl) bldg.floorDrawings[fc] = doc.data().dataUrl;
                    } catch (e) { /* 도면 없음 -> 기본 플레이스홀더로 폴백 */ }
                }));
            }
        }

        const promises = availableFloors.map((floorCode) => {
            return new Promise((resolve) => {
                const cacheKey = `${bldg.id}_${floorCode}`;
                const src = getFloorDrawingSrc(bldg, floorCode);
                if (!src) return resolve();
                if (state.floorImageCache[cacheKey] && state.floorImageCache[cacheKey].complete && state.floorImageCache[cacheKey].naturalWidth > 0) {
                    return resolve();
                }
                const img = new Image();
                img.onload = () => {
                    state.floorImageCache[cacheKey] = img;
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

            // 1. Check preloaded image cache or image source for this floor (건물별로 구분된 캐시 키 사용)
            let loadedImg = state.floorImageCache ? state.floorImageCache[`${currentBldgId}_${floorCode}`] : null;
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
                        renderDefectsGrouped(ctx, defects, (c, d, arr) => drawPinSafe(c, d, arr, 90));
                    } else {
                        // Vertical drawing: scale directly to fit portrait canvas while preserving exact aspect ratio
                        const scale = Math.min(cw / imgW, ch / imgH);
                        const drawX = (cw - imgW * scale) / 2;
                        const drawY = (ch - imgH * scale) / 2;

                        ctx.translate(drawX, drawY);
                        ctx.scale(scale, scale);

                        ctx.drawImage(imgObj, 0, 0, imgW, imgH);
                        renderDefectsGrouped(ctx, defects, drawPinSafe);
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

    function renderNdtFloorPlanCanvasDataUrl(floorCode, categoryFilter = null) {
        try {
            const bldg = window.state.currentBuilding || {};
            const currentBldgId = bldg.id || state.currentBuildingId || 'default';
            const key = `${currentBldgId}_${floorCode}`;
            let ndtItems = state.ndtData ? (state.ndtData[key] || []) : [];
            let displacementGroups = state.ndtDisplacementGroups ? (state.ndtDisplacementGroups[key] || []) : [];

            if (categoryFilter) {
                if (categoryFilter === '기울기') {
                    ndtItems = ndtItems.filter(item => item.category === '기울기');
                    displacementGroups = [];
                } else if (categoryFilter === '변위') {
                    ndtItems = [];
                    displacementGroups = displacementGroups.filter(g => !g.category || g.category === '변위');
                } else if (categoryFilter === '부재변위') {
                    ndtItems = [];
                    displacementGroups = displacementGroups.filter(g => g.category === '부재변위');
                } else if (categoryFilter === '실측') {
                    ndtItems = ndtItems.filter(item => item.category === '실측');
                    displacementGroups = [];
                } else if (categoryFilter === '일반비파괴') {
                    ndtItems = ndtItems.filter(item => ['강도', '탄산화'].includes(item.category));
                    displacementGroups = [];
                }
            }

            let loadedImg = state.floorImageCache ? state.floorImageCache[`${currentBldgId}_${floorCode}`] : null;
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
                        displacementGroups.forEach(g => drawNdtDisplacementGroup(ctx, g));
                    } else {
                        const scale = Math.min(cw / imgW, ch / imgH);
                        const drawX = (cw - imgW * scale) / 2;
                        const drawY = (ch - imgH * scale) / 2;

                        ctx.translate(drawX, drawY);
                        ctx.scale(scale, scale);

                        ctx.drawImage(imgObj, 0, 0, imgW, imgH);
                        ndtItems.forEach(item => drawNdtPin(ctx, item));
                        displacementGroups.forEach(g => drawNdtDisplacementGroup(ctx, g));
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
                // 보고서에는 "B1F" 같은 코드 대신 "지하 1층"처럼 사람이 읽는 층 이름을 표시
                const floorDisplayLabel = stripFloorCodeSuffix(window.getFloorLabelFromCode(floorCode));
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
                                    location: d.location || `${floorDisplayLabel} ${d.component || ''}`,
                                    cause: d.defectType === '상태양호' ? '-' : (d.cause || '건조수축'),
                                    size: d.size || 'W=0.2mm',
                                    src: src
                                });
                            }
                        });
                    }
                });

                // --- 1. 상태조사표 (한 페이지당 20개씩 배치 — A4 세로 한 장을 거의 꽉 채우면서도
                //     표 잘림 없이 들어가는 실측값. 모든 페이지에 동일한 개수를 적용해 페이지마다
                //     밀도가 들쭉날쭉하지 않도록 한다) ---
                // "마킹 추가" 그룹은 한 행으로 합쳐서 표시 (위치도는 이미 groupId 기준 하나로 그려짐)
                const SURVEY_ROWS_PER_PAGE = 20;
                const surveyDefects = consolidateDefectGroups(defects);
                const surveyPages = [];
                for (let i = 0; i < surveyDefects.length; i += SURVEY_ROWS_PER_PAGE) {
                    surveyPages.push(surveyDefects.slice(i, i + SURVEY_ROWS_PER_PAGE));
                }
                if (surveyPages.length === 0) surveyPages.push([]);

                surveyPages.forEach((sDefects, sPageIdx) => {
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                            <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                                <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                            </div>

                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem;">
                                <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin:0;">
                                    1. ${floorDisplayLabel} 상태조사표
                                </h2>
                            </div>

                            <table style="width: 100%; border-collapse: collapse; font-size: 0.81rem; text-align: center; margin-bottom: 0.4rem;">
                                <thead>
                                    <tr style="background: #f8fafc; color: #1e293b; border-bottom: 2px solid #cbd5e1;">
                                        ${getActiveSurveyColumns().map(c => `<th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">${c.label}</th>`).join('')}
                                    </tr>
                                </thead>
                                <tbody>
                                    ${sDefects.length > 0 ? sDefects.map((d, dSubIdx) => {
                                        const memberIds = d._groupMemberIds || [d.id || `idx_${dSubIdx}`];
                                        const labels = memberIds.flatMap(mid => defectPhotoLabels[mid] || []);
                                        const pRemark = labels.length > 0 ? labels.join(' ') : '-';
                                        const cellCtx = { floorCode, photoRemark: pRemark };
                                        return `
                                            <tr>
                                                ${getActiveSurveyColumns().map(c => `<td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; ${getSurveyCellColorStyle(c.key, d, cellCtx)}">${getSurveyCellText(c.key, d, cellCtx)}</td>`).join('')}
                                            </tr>
                                        `;
                                    }).join('') : `<tr><td colspan="${getActiveSurveyColumns().length}" style="padding:2rem; color:#94a3b8;">${floorDisplayLabel}에 등록된 결함이 없습니다.</td></tr>`}
                                </tbody>
                            </table>

                            <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                                <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                <span>📄 스마트 건축물 안전점검 시스템</span>
                            </div>
                        </div>
                    `;
                });

                // --- 2. 현장 사진첩 (A4 1페이지당 정확히 6개 배치 및 4:3 비율 규격) ---
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
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                            <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                                <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                            </div>

                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem;">
                                <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin:0;">
                                    2. ${floorDisplayLabel} 현장 결함 사진첩 (총 ${photoItems.length}개 사진)
                                </h2>
                                <span style="font-size:0.78rem; background:#e0f2fe; color:#0369a1; font-weight:700; padding:0.15rem 0.5rem; border-radius:12px;">
                                    사진첩 페이지 ${pPageIdx + 1} / ${photoPages.length} (규격 6개 배치)
                                </span>
                            </div>

                            ${pagePhotos.length > 0 ? `
                                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; margin-bottom: 0.4rem;">
                                    ${pagePhotos.map(p => `
                                        <div style="border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; background: #fafafa; box-sizing: border-box;">
                                            <div style="position: relative; width: 100%; padding-bottom: 64%; background: #e2e8f0; overflow: hidden;">
                                                <img src="${p.src}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; object-position: center;">
                                            </div>
                                            <div style="padding: 0.3rem; text-align: center;">
                                                <div style="font-size:0.84rem; font-weight:800; color:#0369a1;">
                                                    ${p.label}. ${p.title}
                                                </div>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : `
                                <div style="width: 100%; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 4rem 2rem; background: #f8fafc; text-align: center; color: #64748b; font-weight: 700; font-size: 1.05rem; margin-top: 2rem;">
                                    <i class="fa-solid fa-camera" style="font-size: 2.8rem; color: #94a3b8; margin-bottom: 0.8rem; display: block;"></i>
                                    📷 ${floorDisplayLabel}에 첨부된 현장 결함 사진이 없습니다.
                                </div>
                            `}

                            <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                                <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                <span>📄 스마트 건축물 안전점검 시스템</span>
                            </div>
                        </div>
                    `;
                });

                // --- 3. 결함 위치도 (A4 세로 222mm 딱 맞게 렌더링) ---
                const drawingDataUrl = renderFloorPlanCanvasDataUrl(floorCode);

                reportPagesHtml += `
                    <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                        <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                            <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                        </div>

                        <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin-bottom: 0.5rem;">
                            3. ${floorDisplayLabel} 결함 위치도 (도면 마킹 평면도)
                        </h2>

                        ${drawingDataUrl ? `
                            <div style="width: 100%; height: 222mm; max-height: 222mm; border: 2px solid #0284c7; border-radius: 6px; overflow: hidden; background: #ffffff; text-align: center; padding: 2px; box-sizing: border-box; display: flex; align-items: center; justify-content: center;">
                                <img src="${drawingDataUrl}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px; display: block; margin: 0 auto;">
                            </div>
                        ` : `
                            <div style="width: 100%; height: 222mm; max-height: 222mm; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 4rem 2rem; background: #f8fafc; text-align: center; color: #64748b; font-weight: 700; font-size: 1.05rem; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                                <i class="fa-solid fa-map-location-dot" style="font-size: 2.8rem; color: #94a3b8; margin-bottom: 0.8rem; display: block;"></i>
                                📍 ${floorDisplayLabel} 등록된 평면도 도면이 없습니다.<br>
                                <span style="font-size: 0.88rem; color: #94a3b8; font-weight: 500; margin-top: 0.4rem; display: inline-block;">
                                    (층별 도면 점검 탭에서 평면도 이미지를 등록하시면 결함 위치도가 자동으로 완성됩니다)
                                </span>
                            </div>
                        `}

                        <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                            <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                            <span>📄 스마트 건축물 안전점검 시스템</span>
                        </div>
                    </div>
                `;

                // --- 비파괴 및 변위/기울기 보고서 섹션 번호 관리 ---
                const ndtKey = `${currentBldgId}_${floorCode}`;
                const allNdtItems = state.ndtData ? (state.ndtData[ndtKey] || []) : [];
                const allDispGroups = state.ndtDisplacementGroups ? (state.ndtDisplacementGroups[ndtKey] || []) : [];

                const measureNdtItems = allNdtItems.filter(item => item.category === '실측');
                const strengthCarbNdtItems = allNdtItems.filter(item => ['강도', '탄산화'].includes(item.category));
                const tiltNdtItems = allNdtItems.filter(item => item.category === '기울기');
                const settlementGroups = allDispGroups.filter(g => !g.category || g.category === '변위');
                const memberDispGroups = allDispGroups.filter(g => g.category === '부재변위');

                let sectionNo = 4;

                // --- 4. 📏 부재 실측 결과표 및 측정 위치도 (강도·탄산화와 별도 도면) ---
                if (measureNdtItems.length > 0 || (strengthCarbNdtItems.length === 0 && tiltNdtItems.length === 0 && settlementGroups.length === 0 && memberDispGroups.length === 0)) {
                    const measureDrawingUrl = renderNdtFloorPlanCanvasDataUrl(floorCode, '실측');
                    const curSecNo1 = sectionNo++;
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                            <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                                <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                            </div>

                            <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin-bottom: 0.5rem;">
                                ${curSecNo1}. ${floorDisplayLabel} 비파괴 장비 조사 (부재 실측) 결과표
                            </h2>

                            <table style="width: 100%; border-collapse: collapse; font-size: 0.81rem; text-align: center; margin-bottom: 0.4rem;">
                                <thead>
                                    <tr style="background: #f8fafc; color: #1e293b; border-bottom: 2px solid #cbd5e1;">
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">관리번호</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">조사항목</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">측정위치</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">부재명</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">측정수치</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">평균결과</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">상태판정</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${measureNdtItems.length > 0 ? measureNdtItems.map(item => `
                                        <tr>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:#0284c7;">${item.no || 'NO.01'}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:700;">${item.category}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0;">${item.location || '위치미지정'}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0;">${item.component || '기둥'}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-family:monospace;">${item.valuesText || '-'}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:#16a34a;">${item.avgValue || '-'}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:700;">${item.status || '양호'}</td>
                                        </tr>
                                    `).join('') : `
                                        <tr><td colspan="7" style="padding: 2rem; color: #94a3b8;">등록된 비파괴 조사 측정 데이터가 없습니다.</td></tr>
                                    `}
                                </tbody>
                            </table>

                            <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                                <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                <span>📄 스마트 건축물 안전점검 시스템</span>
                            </div>
                        </div>
                    `;

                    const curSecNo2 = sectionNo++;
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                            <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                                <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                            </div>

                            <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin-bottom: 0.5rem;">
                                ${curSecNo2}. ${floorDisplayLabel} 비파괴 장비 조사 (부재 실측) 위치도
                            </h2>

                            ${measureDrawingUrl ? `
                                <div style="width: 100%; height: 222mm; max-height: 222mm; border: 2px solid #0284c7; border-radius: 6px; overflow: hidden; background: #ffffff; text-align: center; padding: 2px; box-sizing: border-box; display: flex; align-items: center; justify-content: center;">
                                    <img src="${measureDrawingUrl}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px; display: block; margin: 0 auto;">
                                </div>
                            ` : `
                                <div style="width: 100%; height: 222mm; max-height: 222mm; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 4rem 2rem; background: #f8fafc; text-align: center; color: #64748b; font-weight: 700; font-size: 1.05rem; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                                    <i class="fa-solid fa-ruler" style="font-size: 2.8rem; color: #94a3b8; margin-bottom: 0.8rem; display: block;"></i>
                                    📍 부재 실측 마킹 데이터가 첨부되지 않았습니다.
                                </div>
                            `}

                            <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                                <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                <span>📄 스마트 건축물 안전점검 시스템</span>
                            </div>
                        </div>
                    `;
                }

                // --- 4-1. 🔬 콘크리트 강도·탄산화 결과표 및 측정 위치도 (부재 실측과 별도 도면) ---
                if (strengthCarbNdtItems.length > 0) {
                    const stdDrawingUrl = renderNdtFloorPlanCanvasDataUrl(floorCode, '일반비파괴');
                    const curSecNo1 = sectionNo++;
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                            <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                                <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                            </div>

                            <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin-bottom: 0.5rem;">
                                ${curSecNo1}. ${floorDisplayLabel} 비파괴 장비 조사 (강도·탄산화) 결과표
                            </h2>

                            <table style="width: 100%; border-collapse: collapse; font-size: 0.81rem; text-align: center; margin-bottom: 0.4rem;">
                                <thead>
                                    <tr style="background: #f8fafc; color: #1e293b; border-bottom: 2px solid #cbd5e1;">
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">관리번호</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">조사항목</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">측정위치</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">부재명</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">측정수치</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">평균결과</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">상태판정</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${strengthCarbNdtItems.length > 0 ? strengthCarbNdtItems.map(item => `
                                        <tr>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:#0284c7;">${item.no || 'NO.01'}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:700;">${item.category}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0;">${item.location || '위치미지정'}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0;">${item.component || '기둥'}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-family:monospace;">${item.valuesText || '-'}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:#16a34a;">${item.avgValue || '-'}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:700;">${item.status || '양호'}</td>
                                        </tr>
                                    `).join('') : `
                                        <tr><td colspan="7" style="padding: 2rem; color: #94a3b8;">등록된 비파괴 조사 측정 데이터가 없습니다.</td></tr>
                                    `}
                                </tbody>
                            </table>

                            <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                                <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                <span>📄 스마트 건축물 안전점검 시스템</span>
                            </div>
                        </div>
                    `;

                    const curSecNo2 = sectionNo++;
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                            <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                                <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                            </div>

                            <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin-bottom: 0.5rem;">
                                ${curSecNo2}. ${floorDisplayLabel} 비파괴 장비 조사 (강도·탄산화) 위치도
                            </h2>

                            ${stdDrawingUrl ? `
                                <div style="width: 100%; height: 222mm; max-height: 222mm; border: 2px solid #0284c7; border-radius: 6px; overflow: hidden; background: #ffffff; text-align: center; padding: 2px; box-sizing: border-box; display: flex; align-items: center; justify-content: center;">
                                    <img src="${stdDrawingUrl}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px; display: block; margin: 0 auto;">
                                </div>
                            ` : `
                                <div style="width: 100%; height: 222mm; max-height: 222mm; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 4rem 2rem; background: #f8fafc; text-align: center; color: #64748b; font-weight: 700; font-size: 1.05rem; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                                    <i class="fa-solid fa-microscope" style="font-size: 2.8rem; color: #94a3b8; margin-bottom: 0.8rem; display: block;"></i>
                                    📍 강도/탄산화 마킹 데이터가 첨부되지 않았습니다.
                                </div>
                            `}

                            <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                                <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                <span>📄 스마트 건축물 안전점검 시스템</span>
                            </div>
                        </div>
                    `;
                }

                // --- 5. 📐 외벽 기울기 전용 결과표 및 독립 위치도 ---
                if (tiltNdtItems.length > 0) {
                    const tiltDrawingUrl = renderNdtFloorPlanCanvasDataUrl(floorCode, '기울기');
                    const curSecNo1 = sectionNo++;
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                            <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                                <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                            </div>

                            <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin-bottom: 0.5rem;">
                                ${curSecNo1}. ${floorDisplayLabel} 외벽 기울기 측정 결과표
                            </h2>

                            <table style="width: 100%; border-collapse: collapse; font-size: 0.81rem; text-align: center; margin-bottom: 0.4rem;">
                                <thead>
                                    <tr style="background: #f8fafc; color: #1e293b; border-bottom: 2px solid #cbd5e1;">
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">관리번호</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">측정위치</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">측정높이(H)</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">변위량(mm)</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">기울기(1/H)</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">기울기 등급</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tiltNdtItems.map(item => {
                                        const fmtH = formatHeightValue(item.height);
                                        const hDigits = (fmtH || '').replace(/[^0-9.]/g, '');
                                        const avgDigits = (item.avgValue || '').replace(/[^0-9.-]/g, '');
                                        const h = parseFloat(hDigits) || 3000;
                                        const delta = Math.abs(parseFloat(avgDigits) || 0);
                                        const calc = calcTiltGrade(h, delta);
                                        const gradeColor = calc.grade === 'a등급' ? '#16a34a' : (calc.grade === 'b등급' ? '#0284c7' : (calc.grade === 'c등급' ? '#ca8a04' : '#dc2626'));
                                        return `
                                        <tr>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:#0284c7;">${item.no || 'NO.01'}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0;">${item.location || '위치미지정'}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:700; color:#0284c7;">${fmtH}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:#16a34a;">${item.avgValue || '-'}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:#9333ea;">${item.tiltRatio || calc.tiltRatio}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:${gradeColor};">${item.grade || calc.grade}</td>
                                        </tr>
                                    `;}).join('')}
                                </tbody>
                            </table>

                            <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                                <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                <span>📄 스마트 건축물 안전점검 시스템</span>
                            </div>
                        </div>
                    `;

                    const curSecNo2 = sectionNo++;
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                            <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                                <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                            </div>

                            <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin-bottom: 0.5rem;">
                                ${curSecNo2}. ${floorDisplayLabel} 외벽 기울기 측정 위치도
                            </h2>

                            ${tiltDrawingUrl ? `
                                <div style="width: 100%; height: 222mm; max-height: 222mm; border: 2px solid #0284c7; border-radius: 6px; overflow: hidden; background: #ffffff; text-align: center; padding: 2px; box-sizing: border-box; display: flex; align-items: center; justify-content: center;">
                                    <img src="${tiltDrawingUrl}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px; display: block; margin: 0 auto;">
                                </div>
                            ` : `
                                <div style="width: 100%; height: 222mm; max-height: 222mm; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 4rem 2rem; background: #f8fafc; text-align: center; color: #64748b; font-weight: 700; font-size: 1.05rem; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                                    <i class="fa-solid fa-compass-drafting" style="font-size: 2.8rem; color: #94a3b8; margin-bottom: 0.8rem; display: block;"></i>
                                    📍 외벽 기울기 마킹 데이터가 첨부되지 않았습니다.
                                </div>
                            `}

                            <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                                <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                <span>📄 스마트 건축물 안전점검 시스템</span>
                            </div>
                        </div>
                    `;
                }

                // --- 6. 📉 부동침하 기울기 전용 결과표 + 위치도 + 꺾은선 그래프 ---
                if (settlementGroups.length > 0) {
                    const settlementDrawingUrl = renderNdtFloorPlanCanvasDataUrl(floorCode, '변위');
                    const curSecNo1 = sectionNo++;
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                            <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                                <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                            </div>

                            <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin-bottom: 0.5rem;">
                                ${curSecNo1}. ${floorDisplayLabel} 부동침하 기울기 측정 결과표
                            </h2>

                            <table style="width: 100%; border-collapse: collapse; font-size: 0.81rem; text-align: center; margin-bottom: 0.4rem;">
                                <thead>
                                    <tr style="background: #f8fafc; color: #1e293b; border-bottom: 2px solid #cbd5e1;">
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">조사번호</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">측정위치</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">측정길이(m)</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">변위량(mm)</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">기울기(1/L)</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">안전 등급</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${settlementGroups.map(group => {
                                        const calc = calcGroupDisplacement(group);
                                        const gradeColor = calc.grade === 'a등급' ? '#16a34a' : (calc.grade === 'b등급' ? '#0284c7' : (calc.grade === 'c등급' ? '#ca8a04' : '#dc2626'));
                                        return `
                                        <tr>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:#0284c7;">${group.groupNo}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:700;">${group.locationType} (${group.points.length}개 지점)</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:700; color:#0284c7;">${group.measureLength}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:#16a34a;">${calc.delta.toFixed(1)}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:#9333ea;">${calc.tiltRatio}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:${gradeColor};">${calc.grade}</td>
                                        </tr>
                                    `;}).join('')}
                                </tbody>
                            </table>

                            <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                                <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                <span>📄 스마트 건축물 안전점검 시스템</span>
                            </div>
                        </div>
                    `;

                    const curSecNo2 = sectionNo++;
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                            <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                                <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                            </div>

                            <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin-bottom: 0.5rem;">
                                ${curSecNo2}. ${floorDisplayLabel} 부동침하 기울기 측정 위치도
                            </h2>

                            ${settlementDrawingUrl ? `
                                <div style="width: 100%; height: 222mm; max-height: 222mm; border: 2px solid #0284c7; border-radius: 6px; overflow: hidden; background: #ffffff; text-align: center; padding: 2px; box-sizing: border-box; display: flex; align-items: center; justify-content: center;">
                                    <img src="${settlementDrawingUrl}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px; display: block; margin: 0 auto;">
                                </div>
                            ` : ''}

                            <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                                <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                <span>📄 스마트 건축물 안전점검 시스템</span>
                            </div>
                        </div>
                    `;

                    settlementGroups.forEach(group => {
                        const chartDataUrl = renderNdtDisplacementChartDataUrl(group, floorCode);
                        const curGraphNo = sectionNo++;
                        reportPagesHtml += `
                            <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                                <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                                    <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                                </div>

                                <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin-bottom: 0.5rem;">
                                    ${curGraphNo}. ${floorDisplayLabel} 부동침하 기울기 그래프 (${group.groupNo})
                                </h2>

                                ${chartDataUrl ? `
                                    <div style="width: 100%; height: 222mm; max-height: 222mm; border: 2px solid #0284c7; border-radius: 6px; overflow: hidden; background: #ffffff; text-align: center; padding: 2px; box-sizing: border-box; display: flex; align-items: center; justify-content: center;">
                                        <img src="${chartDataUrl}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px; display: block; margin: 0 auto;">
                                    </div>
                                ` : ''}

                                <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                                    <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                    <span>📄 스마트 건축물 안전점검 시스템</span>
                                </div>
                            </div>
                        `;
                    });
                }

                // --- 7. 🏗️ 부재처짐 (부재변위) 전용 결과표 + 위치도 + 꺾은선 그래프 ---
                if (memberDispGroups.length > 0) {
                    const memberDispDrawingUrl = renderNdtFloorPlanCanvasDataUrl(floorCode, '부재변위');
                    const curSecNo1 = sectionNo++;
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                            <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                                <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                            </div>

                            <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin-bottom: 0.5rem;">
                                ${curSecNo1}. ${floorDisplayLabel} 부재처짐 (부재변위) 측정 결과표
                            </h2>

                            <table style="width: 100%; border-collapse: collapse; font-size: 0.81rem; text-align: center; margin-bottom: 0.4rem;">
                                <thead>
                                    <tr style="background: #f8fafc; color: #1e293b; border-bottom: 2px solid #cbd5e1;">
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">조사번호</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">측정위치</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">부재길이(m)</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">처짐량(mm)</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">처짐비(1/L)</th>
                                        <th style="padding: 0.45rem 0.3rem; border: 1px solid #cbd5e1;">처짐 등급</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${memberDispGroups.map(group => {
                                        const calc = calcGroupDisplacement(group);
                                        const gradeColor = calc.grade === 'a등급' ? '#16a34a' : (calc.grade === 'b등급' ? '#0284c7' : (calc.grade === 'c등급' ? '#ca8a04' : '#dc2626'));
                                        return `
                                        <tr>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:#0284c7;">${group.groupNo}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:700;">${group.locationType} (${group.points.length}개 지점)</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:700; color:#0284c7;">${group.measureLength}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:#16a34a;">${calc.delta.toFixed(1)}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:#9333ea;">${calc.tiltRatio}</td>
                                            <td style="padding:0.4rem 0.3rem; border:1px solid #e2e8f0; font-weight:800; color:${gradeColor};">${calc.grade}</td>
                                        </tr>
                                    `;}).join('')}
                                </tbody>
                            </table>

                            <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                                <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                <span>📄 스마트 건축물 안전점검 시스템</span>
                            </div>
                        </div>
                    `;

                    const curSecNo2 = sectionNo++;
                    reportPagesHtml += `
                        <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                            <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                                <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                            </div>

                            <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin-bottom: 0.5rem;">
                                ${curSecNo2}. ${floorDisplayLabel} 부재처짐 (부재변위) 측정 위치도
                            </h2>

                            ${memberDispDrawingUrl ? `
                                <div style="width: 100%; height: 222mm; max-height: 222mm; border: 2px solid #0284c7; border-radius: 6px; overflow: hidden; background: #ffffff; text-align: center; padding: 2px; box-sizing: border-box; display: flex; align-items: center; justify-content: center;">
                                    <img src="${memberDispDrawingUrl}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px; display: block; margin: 0 auto;">
                                </div>
                            ` : ''}

                            <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                                <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                <span>📄 스마트 건축물 안전점검 시스템</span>
                            </div>
                        </div>
                    `;

                    memberDispGroups.forEach(group => {
                        const chartDataUrl = renderNdtDisplacementChartDataUrl(group, floorCode);
                        const curGraphNo = sectionNo++;
                        reportPagesHtml += `
                            <div class="report-page-block" style="background:#ffffff; color:#0f172a; padding: 10mm 14mm 10mm 14mm; margin-bottom: 2rem; font-family: sans-serif; font-size:0.9rem; border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; break-after: page; page-break-inside: avoid !important; break-inside: avoid !important; box-sizing: border-box; width: 210mm; height: 295mm; max-height: 295mm; overflow: hidden; display: flex; flex-direction: column; position: relative;">
                                <div style="text-align:center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.3rem; margin-bottom: 0.6rem;">
                                    <h1 style="font-size:0.75rem; font-weight:700; color:#000000; margin:0;">${reportTitleHeader}</h1>
                                </div>

                                <h2 style="font-size:1.02rem; font-weight:800; color:#0f172a; border-left: 4px solid #0284c7; padding-left: 0.5rem; margin-bottom: 0.5rem;">
                                    ${curGraphNo}. ${floorDisplayLabel} 부재처짐 그래프 (${group.groupNo})
                                </h2>

                                ${chartDataUrl ? `
                                    <div style="width: 100%; height: 222mm; max-height: 222mm; border: 2px solid #0284c7; border-radius: 6px; overflow: hidden; background: #ffffff; text-align: center; padding: 2px; box-sizing: border-box; display: flex; align-items: center; justify-content: center;">
                                        <img src="${chartDataUrl}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px; display: block; margin: 0 auto;">
                                    </div>
                                ` : ''}

                                <div style="margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #475569;">
                                    <span>🏢 점검수행기관: <strong style="color: #0369a1; font-weight: 800;">${compName}</strong></span>
                                    <span>📄 스마트 건축물 안전점검 시스템</span>
                                </div>
                            </div>
                        `;
                    });
                }
            });

            container.innerHTML = `<div id="printableReportArea" style="width:100%; max-width: 210mm; margin: 0 auto; display: flex; flex-direction: column; align-items: center;">${reportPagesHtml}</div>`;
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
        window.showLoading('PDF 보고서를 생성하는 중입니다...');
        try {
            // 1. Ensure report preview content is fully generated and preloaded
            await window.openReportPreviewModalFunc();
            await new Promise(r => setTimeout(r, 250));

            const bldg = window.state.currentBuilding || { name: '건축물_점검보고서' };
            const bldgName = (bldg.name || '건축물').replace(/^🏢\s*/, '').replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
            const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const filename = `${bldgName}_정밀안전점검_보고서_${dateStr}.pdf`;

            const element = document.getElementById('printableReportArea') || document.getElementById('modalReportPreviewBody');
            if (!element) {
                window.print();
                return;
            }

            // Temporarily set margin-bottom to 0 for strict 1:1 A4 PDF rendering
            const pageBlocks = Array.from(element.querySelectorAll('.report-page-block'));
            pageBlocks.forEach(b => {
                b.style.marginBottom = '0';
                b.style.boxShadow = 'none';
            });

            try {
                if (pageBlocks.length > 0 && typeof html2canvas !== 'undefined' && typeof window.jspdf !== 'undefined') {
                    // 보고서 전체를 한 장의 거대한 캔버스로 렌더링하면(예전 html2pdf 한방 방식) 페이지가
                    // 많을 때(수십 페이지) 캔버스 높이가 브라우저 한계를 넘어서서 전부 빈 종이로 나오는
                    // 문제가 있었다. 페이지(.report-page-block) 하나씩 따로 캡처해서 jsPDF에 이어붙이면
                    // 캔버스 크기가 항상 A4 한 장 크기로 작게 유지되어 페이지 수와 무관하게 안전하다.
                    const { jsPDF } = window.jspdf;
                    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
                    const pageW = pdf.internal.pageSize.getWidth();
                    const pageH = pdf.internal.pageSize.getHeight();

                    const loadingTextEl = document.querySelector('#globalLoadingOverlay .loading-text');
                    for (let i = 0; i < pageBlocks.length; i++) {
                        // showLoading()을 반복 호출하면 내부 카운터(_loadingDepth)가 계속 올라가
                        // 끝나고 hideLoading()을 한 번만 불러선 로딩창이 영영 안 사라지므로,
                        // 진행률 텍스트만 직접 갱신한다.
                        if (loadingTextEl) loadingTextEl.textContent = `PDF 보고서를 생성하는 중입니다... (${i + 1}/${pageBlocks.length} 페이지)`;
                        const block = pageBlocks[i];
                        try {
                            const canvas = await html2canvas(block, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' });
                            const imgData = canvas.toDataURL('image/jpeg', 0.95);
                            const imgHeight = Math.min(pageH, (canvas.height * pageW) / canvas.width);
                            if (i > 0) pdf.addPage();
                            pdf.addImage(imgData, 'JPEG', 0, 0, pageW, imgHeight);
                        } catch (pageErr) {
                            console.error(`PDF page ${i + 1} render error:`, pageErr);
                        }
                    }

                    pdf.save(filename);
                } else {
                    window.print();
                }
            } finally {
                // Restore screen preview margins
                pageBlocks.forEach(b => {
                    b.style.marginBottom = '2rem';
                    b.style.boxShadow = '0 4px 20px rgba(0,0,0,0.1)';
                });
            }
        } catch(err) {
            console.error('PDF export error:', err);
            window.showToast('PDF 생성 중 오류가 발생하여 인쇄 화면으로 대신 전환합니다.', 'warning', 4500);
            window.print();
        } finally {
            window.hideLoading();
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

    // Theme Toggle Handler (Default Pure Light White Theme)
    const btnThemeToggle = document.getElementById('btnThemeToggle');
    if (btnThemeToggle) {
        btnThemeToggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
        btnThemeToggle.title = "다크/라이트 모드 전환 (현재: 화이트 톤)";
        btnThemeToggle.addEventListener('click', () => {
            const isLight = document.body.classList.contains('theme-light');
            if (isLight) {
                document.body.classList.remove('theme-light');
                document.body.classList.add('theme-dark');
                btnThemeToggle.innerHTML = '<i class="fa-solid fa-moon"></i>';
                localStorage.setItem('building_theme', 'dark');
            } else {
                document.body.classList.remove('theme-dark');
                document.body.classList.add('theme-light');
                btnThemeToggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
                localStorage.setItem('building_theme', 'light');
            }
        });
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

    // 결함 레코드 1건을 사진 삭제 포함해서 제거 (저장/재렌더링은 호출부 책임 — 그룹 일괄삭제 시 중복 저장 방지)
    function removeSingleDefectRecord(key, id) {
        const target = state.defects[key].find(d => d.id === id);
        if (target && target.photos && target.photos.length > 0) {
            deletePhotosForDefect(id, target.photos.length).then(failCount => {
                if (failCount > 0) {
                    window.showToast(`사진 ${failCount}건 삭제에 실패했습니다. 네트워크 상태를 확인해 주세요.`, 'warning', 5000);
                }
            });
        }
        state.defects[key] = state.defects[key].filter(d => d.id !== id);
    }

    window.deleteDefectById = function(id) {
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        if (state.defects[key]) {
            pushDefectHistory();
            removeSingleDefectRecord(key, id);
            saveStateToLocalStorage();
            renderSurveyTable();
            drawCanvas();
        }
    };

    // "마킹 추가"로 여러 위치에 묶인 결함 그룹 전체를 삭제
    window.deleteDefectGroup = function(groupId) {
        const key = `${state.currentBuildingId}_${state.currentFloor}`;
        if (state.defects[key]) {
            pushDefectHistory();
            const memberIds = state.defects[key].filter(d => d.groupId === groupId).map(d => d.id);
            memberIds.forEach(id => removeSingleDefectRecord(key, id));
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
            window.showToast(`점검 수행회사명이 '${val}'(으)로 저장되었습니다.`, 'success');
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
    window.exportBackupJSON = async function() {
        window.showLoading('백업 파일 생성 중입니다...');
        try {
            // 내보내기 전, 아직 로컬 캐시에 없는 층 도면을 전부 미리 가져와 채워서 완전한 백업 보장
            if (db && window.state.companyId) {
                const companyDrawings = db.collection('safety_app').doc(getCompanyDocId()).collection('floorDrawings');
                for (const bldg of (window.state.buildings || [])) {
                    if (!bldg.floorDrawings) bldg.floorDrawings = {};
                    const floors = (bldg.floorsList || []).map(f => f.floorCode);
                    await Promise.all(floors.filter(fc => !bldg.floorDrawings[fc]).map(async fc => {
                        try {
                            const doc = await companyDrawings.doc(`${bldg.id}_${fc}`).get();
                            if (doc.exists && doc.data().dataUrl) bldg.floorDrawings[fc] = doc.data().dataUrl;
                        } catch (e) { /* 해당 층 도면 없음 */ }
                    }));
                }
            }

            const backupData = {
                version: 'v60.0_pwa_backup',
                timestamp: new Date().toISOString(),
                companyName: localStorage.getItem('building_company_name') || window.state.companyName || '(주)한국안전진단기술원',
                userName: localStorage.getItem('building_user_name') || window.state.userName || '홍길동 수석점검자',
                state: {
                    buildings: window.state.buildings || [],
                    defects: window.state.defects || {},
                    ndtData: window.state.ndtData || {},
                    ndtDisplacementGroups: window.state.ndtDisplacementGroups || {},
                    grids: window.state.grids || {},
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
            const timeStr = now.toTimeString().slice(0, 5).replace(/:/g, '');
            const filename = `스마트건축물_안전점검_백업_${dateStr}_${timeStr}.json`;

            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            window.showToast(`백업 파일이 생성되었습니다. (파일명: ${filename})`, 'success', 4500);
        } catch (err) {
            window.showToast('백업 파일 생성 중 오류가 발생했습니다: ' + err.message, 'error', 5000);
        } finally {
            window.hideLoading();
        }
    };

    window.importBackupJSON = function(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        if (!confirm('📥 선택한 백업 파일(.json)로 기존 데이터를 복원하시겠습니까?\n현재 브라우저에 저장된 데이터가 백업 파일 데이터로 대체 및 통합됩니다.')) {
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = async function(e) {
            window.showLoading('백업 데이터를 복원하는 중입니다...');
            try {
                const data = JSON.parse(e.target.result);
                if (!data || !data.state || !Array.isArray(data.state.buildings)) {
                    throw new Error('유효한 백업 JSON 파일이 아닙니다.');
                }

                window.state.buildings = data.state.buildings || [];
                window.state.defects = data.state.defects || {};
                window.state.ndtData = data.state.ndtData || {};
                window.state.ndtDisplacementGroups = data.state.ndtDisplacementGroups || {};
                window.state.grids = data.state.grids || {};
                window.state.floorSnapshots = data.state.floorSnapshots || {};

                // 백업 파일 안의 도면/사진을 개별 문서 구조로 업로드
                if (db && window.state.companyId) {
                    for (const bldg of window.state.buildings) {
                        if (bldg.floorDrawings) {
                            for (const [floorCode, dataUrl] of Object.entries(bldg.floorDrawings)) {
                                if (dataUrl) await uploadFloorDrawing(bldg.id, floorCode, dataUrl);
                            }
                        }
                    }
                    for (const arr of Object.values(window.state.defects)) {
                        for (const d of (arr || [])) {
                            if (d.photos && d.photos.length > 0) await uploadDefectPhotos(d.id, d.photos);
                        }
                    }
                }

                if (data.companyName) {
                    window.state.companyName = data.companyName;
                    localStorage.setItem('building_company_name', data.companyName);
                    const inputCompany = document.getElementById('inputHomeCompanyName');
                    if (inputCompany) inputCompany.value = data.companyName;
                }
                if (data.userName) {
                    window.state.userName = data.userName;
                    localStorage.setItem('building_user_name', data.userName);
                }

                saveStateToLocalStorage();
                if (typeof syncStateToFirebase === 'function') syncStateToFirebase();

                renderDashboard();
                renderBuildingSelector();
                if (typeof renderSurveyTable === 'function') renderSurveyTable();
                if (typeof drawCanvas === 'function') drawCanvas();
                if (typeof drawNdtCanvas === 'function') drawNdtCanvas();
                if (typeof renderNdtSummaryTable === 'function') renderNdtSummaryTable();

                window.showToast('백업 파일로부터 데이터 복원 및 클라우드 동기화가 완료되었습니다.', 'success', 4500);
            } catch (err) {
                window.showToast('데이터 복원 오류: ' + err.message, 'error', 5000);
            } finally {
                window.hideLoading();
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
            window.showToast('해당 브라우저에서는 음성 인식을 지원하지 않습니다. 구글 크롬(Chrome) 또는 마이크로소프트 엣지(Edge) 브라우저를 이용해 주세요.', 'warning', 5000);
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
                window.showToast('음성 인식 감지 오류: ' + event.error, 'error');
                if (btnElement) {
                    btnElement.style.background = '';
                    btnElement.style.color = '#38bdf8';
                    btnElement.innerHTML = '<i class="fa-solid fa-microphone"></i> 🎤 음성입력';
                }
            };
        } catch (e) {
            window.showToast('음성 인식 시작 실패: ' + e.message, 'error');
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
                window.showToast('선택된 건축물이 없습니다.', 'warning');
                return;
            }

            const rawDefects = getCurrentFloorDefects();
            if (!rawDefects || rawDefects.length === 0) {
                window.showToast('현재 층에 등록된 결함 데이터가 없습니다.', 'warning');
                return;
            }
            // "마킹 추가" 그룹은 한 행으로 합쳐서 표시 (화면 표/PDF와 동일)
            const defects = consolidateDefectGroups(rawDefects);

            const floorCode = window.state.currentFloor;
            const activeColumns = getActiveSurveyColumns();

            // 화면 표와 동일한 사진 라벨(비고) 계산 — raw(합치기 전) 결함 기준
            const defectPhotoLabels = {};
            let pCounter = 0;
            rawDefects.forEach((d, dIdx) => {
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
                                ${activeColumns.map(c => `<th>${c.label}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
            `;

            defects.forEach((d, dIdx) => {
                const memberIds = d._groupMemberIds || [d.id || `idx_${dIdx}`];
                const labels = memberIds.flatMap(mid => defectPhotoLabels[mid] || []);
                const pRemark = labels.length > 0 ? labels.join(' ') : '-';
                const cellCtx = { floorCode, photoRemark: pRemark };
                tableHtml += `
                    <tr>
                        ${activeColumns.map(c => `<td style="${getSurveyCellColorStyle(c.key, d, cellCtx)}">${getSurveyCellText(c.key, d, cellCtx)}</td>`).join('')}
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
            window.showToast('엑셀 내보내기 중 오류가 발생했습니다: ' + e.message, 'error', 5000);
        }
    };

    const btnExportExcel = document.getElementById('btnExportExcel');
    if (btnExportExcel) {
        btnExportExcel.addEventListener('click', window.exportToExcel);
    }

    // --- 7. 외부(엑셀) 결함표 가져오기 엔진 ---
    // 이미 엑셀로 결함조사표를 작성해오던 점검자들이 그대로 파일만 올리면 되도록,
    // 엑셀/CSV의 헤더를 자동 인식해 매칭해주고 사용자가 확인/보정할 수 있는 화면을 띄운다.
    // 엑셀에는 도면상 위치(x,y) 정보가 없으므로, 가져온 결함은 도면 좌측 상단부터 격자로
    // 임시 배치하고 사용자가 직접 도면 위 정확한 위치로 드래그하도록 안내한다.
    const IMPORT_DEFECT_FIELD_DEFS = [
        { key: 'no', label: '결함번호', aliases: ['결함번호', '번호', 'no', 'no.'] },
        { key: 'component', label: '부재명칭', aliases: ['부재명칭', '부재', '부재명'] },
        { key: 'category', label: '구분(구조체/비구조체/마감재)', aliases: ['구분', '구조체여부', '대분류', '카테고리'] },
        { key: 'defectType', label: '결함종류(조사내용)', aliases: ['조사내용', '결함종류', '결함유형', '종류'] },
        { key: 'location', label: '위치', aliases: ['위치', '상세위치'] },
        { key: 'size', label: '결함크기(규모)', aliases: ['결함크기', '규모', '크기', '규모 및 상태'] },
        { key: 'crackWidth', label: '균열폭', aliases: ['균열폭'] },
        { key: 'crackLength', label: '균열길이', aliases: ['균열길이'] },
        { key: 'progress', label: '진행여부', aliases: ['진행여부', '진행중'] },
        { key: 'leak', label: '누수여부', aliases: ['누수여부', '누수중'] },
        { key: 'cause', label: '결함원인추정', aliases: ['결함원인추정', '결함원인', '원인'] }
    ];

    const IMPORT_NEGATIVE_FLAG_VALUES = ['-', 'x', '아니오', '아니요', 'no', 'n', '0', '없음', ''];

    function guessImportColumnForField(headers, aliases) {
        const norm = (s) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, '');
        for (const alias of aliases) {
            const idx = headers.findIndex(h => norm(h) === norm(alias));
            if (idx !== -1) return idx;
        }
        for (const alias of aliases) {
            const idx = headers.findIndex(h => norm(h).includes(norm(alias)));
            if (idx !== -1) return idx;
        }
        return -1;
    }

    // 엑셀 시트 이름 ↔ 건축물의 실제 층(floorCode/floorLabel) 자동 매칭
    function guessFloorForSheetName(sheetName, floors) {
        const norm = (s) => (s || '').toString().trim().toLowerCase().replace(/[\s()]/g, '');
        const n = norm(sheetName);
        if (!n) return null;
        let match = floors.find(f => norm(f.floorLabel) === n || norm(f.floorCode) === n);
        if (match) return match.floorCode;
        match = floors.find(f => n.includes(norm(f.floorCode)) && norm(f.floorCode).length > 0);
        if (match) return match.floorCode;
        match = floors.find(f => n.includes(norm(f.floorLabel)) || norm(f.floorLabel).includes(n));
        return match ? match.floorCode : null;
    }

    window.handleImportDefectExcelFile = function(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        if (typeof XLSX === 'undefined') {
            window.showToast('엑셀 파싱 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인 후 다시 시도해주세요.', 'error', 5000);
            event.target.value = '';
            return;
        }
        if (!state.currentBuildingId) {
            window.showToast('가져올 건축물이 선택되지 않았습니다.', 'warning');
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const floors = state.currentBuilding ? window.getBuildingAvailableFloors(state.currentBuilding) : [];

                const sheetInfos = workbook.SheetNames.map(sheetName => {
                    const sheet = workbook.Sheets[sheetName];
                    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
                    if (!rows || rows.length < 1) return null;
                    const headers = (rows[0] || []).map(h => (h || '').toString().trim());
                    const dataRows = rows.slice(1).filter(r => r.some(cell => cell !== '' && cell !== null && cell !== undefined));
                    if (dataRows.length === 0) return null;
                    return {
                        sheetName,
                        headers,
                        rows: dataRows,
                        guessedFloorCode: guessFloorForSheetName(sheetName, floors)
                    };
                }).filter(Boolean);

                if (sheetInfos.length === 0) {
                    window.showToast('엑셀 파일에서 가져올 데이터를 찾지 못했습니다. 각 시트의 첫 행은 헤더, 둘째 행부터 데이터여야 합니다.', 'warning', 5000);
                    event.target.value = '';
                    return;
                }

                window._importExcelSheets = sheetInfos;
                window._importExcelFloors = floors;
                openImportDefectExcelModal();
            } catch (err) {
                window.showToast('엑셀 파일을 읽는 중 오류가 발생했습니다: ' + err.message, 'error', 5000);
            } finally {
                event.target.value = '';
            }
        };
        reader.readAsArrayBuffer(file);
    };

    function openImportDefectExcelModal() {
        const sheets = window._importExcelSheets || [];
        const floors = window._importExcelFloors || [];
        const refHeaders = (sheets[0] && sheets[0].headers) || [];
        const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);

        const summaryEl = document.getElementById('importDefectExcelSummary');
        if (summaryEl) summaryEl.textContent = `시트 ${sheets.length}개, 데이터 ${totalRows}행 감지됨.`;

        const sheetMapBody = document.getElementById('importDefectExcelSheetMapBody');
        if (sheetMapBody) {
            if (floors.length === 0) {
                sheetMapBody.innerHTML = `<div style="font-size:0.82rem; color:var(--text-muted);">선택된 건축물의 층 정보를 찾지 못해 모든 시트를 현재 층(${state.currentFloor || ''})으로 가져옵니다.</div>`;
            } else {
                sheetMapBody.innerHTML = sheets.map(s => {
                    const options = ['<option value="">(가져오지 않음)</option>']
                        .concat(floors.map(f => `<option value="${escapeHtml(f.floorCode)}" ${f.floorCode === s.guessedFloorCode ? 'selected' : ''}>${escapeHtml(f.floorLabel)}</option>`));
                    return `
                        <div style="display:flex; align-items:center; gap:0.6rem;">
                            <span style="flex:1; min-width:0; font-size:0.82rem; font-weight:700; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(s.sheetName)}">
                                ${escapeHtml(s.sheetName)} <span style="color:var(--text-muted); font-weight:400;">(${s.rows.length}행)</span>
                            </span>
                            <select class="form-select import-defect-sheet-floor-map" data-sheet="${escapeHtml(s.sheetName)}" style="width:200px; flex-shrink:0;">${options.join('')}</select>
                        </div>
                    `;
                }).join('');
            }
        }

        const mappingBody = document.getElementById('importDefectExcelMappingBody');
        if (mappingBody) {
            mappingBody.innerHTML = IMPORT_DEFECT_FIELD_DEFS.map(field => {
                const guessIdx = guessImportColumnForField(refHeaders, field.aliases);
                const options = ['<option value="-1">(사용 안 함)</option>']
                    .concat(refHeaders.map((h, i) => `<option value="${i}" ${i === guessIdx ? 'selected' : ''}>${h ? escapeHtml(h) : `(이름없음 컬럼 ${i + 1})`}</option>`));
                return `
                    <div style="display:flex; align-items:center; gap:0.6rem;">
                        <span style="width:190px; flex-shrink:0; font-size:0.82rem; font-weight:700; color:var(--text-secondary);">${field.label}</span>
                        <select class="form-select import-defect-field-map" data-field="${field.key}" style="flex:1;">${options.join('')}</select>
                    </div>
                `;
            }).join('');
        }

        const previewTable = document.getElementById('importDefectExcelPreviewTable');
        if (previewTable) {
            const previewRows = ((sheets[0] && sheets[0].rows) || []).slice(0, 5);
            previewTable.innerHTML = `
                <thead><tr>${refHeaders.map(h => `<th style="border:1px solid var(--border-color); background:var(--bg-primary); padding:0.35rem 0.5rem; text-align:left;">${h ? escapeHtml(h) : '-'}</th>`).join('')}</tr></thead>
                <tbody>${previewRows.map(r => `<tr>${refHeaders.map((h, i) => `<td style="border:1px solid var(--border-color); padding:0.35rem 0.5rem;">${escapeHtml(r[i] !== undefined ? r[i] : '')}</td>`).join('')}</tr>`).join('')}</tbody>
            `;
        }

        const modal = document.getElementById('importDefectExcelModal');
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('open');
        }
    }

    function closeImportDefectExcelModal() {
        const modal = document.getElementById('importDefectExcelModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('open');
        }
        window._importExcelSheets = null;
        window._importExcelFloors = null;
    }

    // 구조체여부만 ○/-로 표기된 표는 비구조체/마감재 세부구분이 불가능해 '-'는 비구조체로 간주
    function resolveImportCategory(raw) {
        const v = (raw || '').toString().trim();
        if (!v) return '구조체';
        if (v.includes('비구조체')) return '비구조체';
        if (v.includes('마감재')) return '마감재';
        if (v.includes('구조체')) return '구조체';
        if (v === '○' || v.toLowerCase() === 'o') return '구조체';
        if (v === '-') return '비구조체';
        return '구조체';
    }

    function resolveImportFlag(raw) {
        const v = (raw || '').toString().trim().toLowerCase();
        return v !== '' && !IMPORT_NEGATIVE_FLAG_VALUES.includes(v);
    }

    // 결함 변경 직전 특정 층 키의 되돌리기 스냅샷을 저장 (pushDefectHistory는 항상 현재 층 기준이라
    // 현재 화면에 없는 다른 층으로 가져올 때를 위해 층을 직접 지정해서 저장)
    function pushDefectHistoryForKey(key) {
        if (!defectHistory[key]) defectHistory[key] = { undo: [], redo: [] };
        const h = defectHistory[key];
        h.undo.push(JSON.stringify(state.defects[key] || []));
        if (h.undo.length > 30) h.undo.shift();
        h.redo = [];
    }

    window.confirmImportDefectExcel = function() {
        if (!state.currentBuildingId) {
            window.showToast('가져올 건축물이 선택되지 않았습니다.', 'warning');
            return;
        }
        const sheets = window._importExcelSheets || [];
        if (sheets.length === 0) return;

        const sheetSelects = document.querySelectorAll('.import-defect-sheet-floor-map');
        const floorBySheetName = {};
        sheetSelects.forEach(sel => { floorBySheetName[sel.dataset.sheet] = sel.value; });
        // 층 정보가 아예 없는 건축물은 매칭 UI 자체가 없으므로 모든 시트를 현재 층으로 간주
        const noFloorInfo = (window._importExcelFloors || []).length === 0;

        const mapSelects = document.querySelectorAll('.import-defect-field-map');
        const colIdxByField = {};
        mapSelects.forEach(sel => {
            colIdxByField[sel.dataset.field] = parseInt(sel.value, 10);
        });
        const getCell = (row, field) => {
            const idx = colIdxByField[field];
            if (idx === undefined || idx === -1) return '';
            return (row[idx] !== undefined && row[idx] !== null) ? row[idx].toString().trim() : '';
        };

        let totalImported = 0;
        let floorsTouched = 0;

        sheets.forEach(sheetInfo => {
            const floorCode = noFloorInfo ? state.currentFloor : floorBySheetName[sheetInfo.sheetName];
            if (!floorCode) return; // "(가져오지 않음)"으로 지정된 시트는 건너뜀

            const key = `${state.currentBuildingId}_${floorCode}`;
            if (!state.defects[key]) state.defects[key] = [];
            pushDefectHistoryForKey(key);

            // 기존 결함번호 중 가장 큰 숫자를 이어서 번호 매기기 (엑셀 결함번호 칸이 비어있는 행용)
            let seq = state.defects[key].reduce((max, d) => {
                const n = getDefectSortNo(d);
                return n === Number.MAX_SAFE_INTEGER ? max : Math.max(max, n);
            }, 0);

            // 도면 크기는 현재 화면에 열려있는 층일 때만 실제 이미지 크기를 알 수 있고,
            // 그 외 층은 도면이 로드되어 있지 않으므로 기본 캔버스 크기로 배치한다
            const img = (floorCode === state.currentFloor) ? state.bgImage : null;
            const imgW = img ? (img.naturalWidth || img.width || 1200) : 1200;
            const imgH = img ? (img.naturalHeight || img.height || 700) : 700;
            const marginX = Math.max(80, imgW * 0.06);
            const marginY = Math.max(80, imgH * 0.06);
            const gridCols = 8;
            const stepX = Math.max(60, (imgW - marginX * 2) / gridCols);
            const stepY = Math.max(60, stepX * 0.7);

            let importedThisFloor = 0;
            sheetInfo.rows.forEach((row, i) => {
                const noRaw = getCell(row, 'no');
                const defectTypeRaw = getCell(row, 'defectType');
                const componentRaw = getCell(row, 'component') || '기타';
                const categoryRaw = getCell(row, 'category');
                const locationRaw = getCell(row, 'location');
                const sizeRaw = getCell(row, 'size');
                const causeRaw = getCell(row, 'cause');
                let crackWidthRaw = getCell(row, 'crackWidth');
                let crackLengthRaw = getCell(row, 'crackLength');
                const progressRaw = getCell(row, 'progress');
                const leakRaw = getCell(row, 'leak');

                const category = resolveImportCategory(categoryRaw);
                const defectType = defectTypeRaw || '기타';
                const isGood = defectType === '상태양호';

                // 균열폭/균열길이가 별도 매핑 안 됐고 결함크기 칸이 "0.15/1.5" 형태면 자동 분리
                // (이 앱에서 내보낸 파일을 그대로 다시 가져올 때 호환되도록)
                if (!crackWidthRaw && !crackLengthRaw && defectType === '균열' && sizeRaw) {
                    const m = sizeRaw.match(/^\s*([\d.]+|-)\s*\/\s*([\d.]+|-)\s*$/);
                    if (m) {
                        crackWidthRaw = m[1] === '-' ? '' : m[1];
                        crackLengthRaw = m[2] === '-' ? '' : m[2];
                    }
                }

                seq += 1;
                const seqStr = seq < 10 ? `0${seq}` : `${seq}`;
                const no = noRaw || `NO.${seqStr}`;

                const col = i % gridCols;
                const rowIdx = Math.floor(i / gridCols);
                const boxX = marginX + col * stepX;
                const boxY = marginY + rowIdx * stepY;

                const newDefect = {
                    id: 'pin-' + Date.now() + '-' + floorCode + '-' + i,
                    no,
                    category,
                    component: componentRaw,
                    location: locationRaw || `${floorCode} ${componentRaw}`,
                    defectType,
                    cause: isGood ? '-' : (causeRaw || '건조수축'),
                    size: isGood ? '' : sizeRaw,
                    crackWidth: isGood ? '' : crackWidthRaw,
                    crackLength: isGood ? '' : crackLengthRaw,
                    isProgress: isGood ? false : resolveImportFlag(progressRaw),
                    isLeak: isGood ? false : resolveImportFlag(leakRaw),
                    isCarriedOver: false,
                    surveyRound: getCurrentSurveyRoundKey(),
                    photos: [],
                    inspectorName: window.state.userName || '',
                    x: boxX,
                    y: boxY,
                    targetX: boxX - 35,
                    targetY: boxY + 35
                };
                state.defects[key].push(newDefect);
                importedThisFloor++;
            });

            if (importedThisFloor > 0) {
                totalImported += importedThisFloor;
                floorsTouched++;
            }
        });

        if (totalImported === 0) {
            window.showToast('가져올 시트가 선택되지 않았습니다. 시트별 층 배정을 확인해주세요.', 'warning', 5000);
            return;
        }

        updateUndoRedoButtons();
        saveStateToLocalStorage();
        renderSurveyTable();
        drawCanvas();
        closeImportDefectExcelModal();
        window.showToast(`${floorsTouched}개 층에서 결함 ${totalImported}건을 가져왔습니다. 좌측 목록에서 각 항목을 도면 위 정확한 위치로 드래그해주세요.`, 'success', 6000);
    };

    const btnImportDefectExcel = document.getElementById('btnImportDefectExcel');
    const inputImportDefectExcel = document.getElementById('inputImportDefectExcel');
    if (btnImportDefectExcel && inputImportDefectExcel) {
        btnImportDefectExcel.addEventListener('click', () => inputImportDefectExcel.click());
        inputImportDefectExcel.addEventListener('change', window.handleImportDefectExcelFile);
    }
    const btnCloseImportDefectExcelModal = document.getElementById('btnCloseImportDefectExcelModal');
    if (btnCloseImportDefectExcelModal) btnCloseImportDefectExcelModal.addEventListener('click', closeImportDefectExcelModal);
    const btnCancelImportDefectExcel = document.getElementById('btnCancelImportDefectExcel');
    if (btnCancelImportDefectExcel) btnCancelImportDefectExcel.addEventListener('click', closeImportDefectExcelModal);
    const btnConfirmImportDefectExcel = document.getElementById('btnConfirmImportDefectExcel');
    if (btnConfirmImportDefectExcel) btnConfirmImportDefectExcel.addEventListener('click', window.confirmImportDefectExcel);

    // --- CAD(DXF) 결함 위치 좌표 추출 (1단계: 좌표 추출 미리보기까지만. 도면 자동배치는 다음 단계) ---
    function openDxfImportModal() {
        const modal = document.getElementById('dxfImportModal');
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('open');
        }
    }

    function closeDxfImportModal() {
        const modal = document.getElementById('dxfImportModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('open');
        }
    }

    // DXF의 layer table에 없어도 실제 도형에 쓰인 레이어는 전부 목록에 올리고,
    // 그 레이어에 원(CIRCLE)이 있으면 기본으로 체크해준다 (결함 표시일 가능성이 높으므로)
    function renderDxfLayerList(dxf) {
        const body = document.getElementById('dxfLayerListBody');
        if (!body) return;

        const layersObj = (dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) || {};
        const layerNames = Object.keys(layersObj);
        const circleCountByLayer = {};
        (dxf.entities || []).forEach(en => {
            if (en.type === 'CIRCLE') {
                circleCountByLayer[en.layer] = (circleCountByLayer[en.layer] || 0) + 1;
            }
        });
        Object.keys(circleCountByLayer).forEach(name => {
            if (!layerNames.includes(name)) layerNames.push(name);
        });

        if (layerNames.length === 0) {
            body.innerHTML = '<div style="font-size:0.8rem; color:var(--text-muted);">레이어 정보를 찾을 수 없습니다.</div>';
            return;
        }

        body.innerHTML = layerNames.map(name => {
            const count = circleCountByLayer[name] || 0;
            const checkedAttr = count > 0 ? 'checked' : '';
            return `
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.82rem; cursor:pointer;">
                    <input type="checkbox" class="dxf-layer-check" value="${escapeHtml(name)}" ${checkedAttr}>
                    <span>${escapeHtml(name)}</span>
                    <span style="color:var(--text-muted); font-size:0.75rem;">(원 ${count}개)</span>
                </label>
            `;
        }).join('');
    }

    window.handleDxfImportFile = async function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (typeof DxfParser === 'undefined') {
            window.showToast('DXF 해석 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해주세요.', 'error');
            e.target.value = '';
            return;
        }

        window.showLoading('DXF 파일을 분석하는 중입니다...');
        try {
            const text = await file.text();
            const parser = new DxfParser();
            const dxf = parser.parse(text);
            if (!dxf) throw new Error('DXF 내용을 해석하지 못했습니다.');

            window._dxfParsedDoc = dxf;
            const entityCount = (dxf.entities || []).length;
            const circleCount = (dxf.entities || []).filter(en => en.type === 'CIRCLE').length;

            const summaryEl = document.getElementById('dxfImportSummary');
            if (summaryEl) {
                summaryEl.textContent = `"${file.name}" 분석 완료 — 전체 도형 ${entityCount}개 중 원(CIRCLE) ${circleCount}개 발견. 아래에서 결함 레이어를 확인해주세요.`;
            }
            renderDxfLayerList(dxf);
            const previewTable = document.getElementById('dxfExtractPreviewTable');
            if (previewTable) previewTable.innerHTML = '';
            if (!window._dxfCalibPoints) loadDxfCalibPointsForCurrentFloor();
            renderDxfCalibRows();
            openDxfImportModal();
        } catch (err) {
            console.error('[DXF 가져오기] 파싱 실패:', err);
            window.showToast('DXF 파일을 해석하지 못했습니다: ' + err.message, 'error', 6000);
        } finally {
            window.hideLoading();
            e.target.value = '';
        }
    };

    function nearestDxfTextForPoint(cx, cy, texts) {
        let best = null, bestDist = Infinity;
        texts.forEach(t => {
            const d = Math.hypot(t.x - cx, t.y - cy);
            if (d < bestDist) { bestDist = d; best = t; }
        });
        return best ? { text: best.text, dist: bestDist } : null;
    }

    function renderDxfExtractPreview(rows) {
        const table = document.getElementById('dxfExtractPreviewTable');
        if (!table) return;
        if (rows.length === 0) {
            table.innerHTML = '<tbody><tr><td style="padding:0.8rem; color:var(--text-muted);">추출된 원이 없습니다. 다른 레이어를 선택해보세요.</td></tr></tbody>';
            return;
        }
        table.innerHTML = `
            <thead><tr>
                <th style="border:1px solid var(--border-color); background:var(--bg-primary); padding:0.35rem 0.5rem; text-align:left;">레이어</th>
                <th style="border:1px solid var(--border-color); background:var(--bg-primary); padding:0.35rem 0.5rem; text-align:left;">X</th>
                <th style="border:1px solid var(--border-color); background:var(--bg-primary); padding:0.35rem 0.5rem; text-align:left;">Y</th>
                <th style="border:1px solid var(--border-color); background:var(--bg-primary); padding:0.35rem 0.5rem; text-align:left;">반지름</th>
                <th style="border:1px solid var(--border-color); background:var(--bg-primary); padding:0.35rem 0.5rem; text-align:left;">가까운 텍스트(결함번호 후보)</th>
                <th style="border:1px solid var(--border-color); background:var(--bg-primary); padding:0.35rem 0.5rem; text-align:left;">텍스트까지 거리</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td style="border:1px solid var(--border-color); padding:0.35rem 0.5rem;">${escapeHtml(r.layer)}</td>
                    <td style="border:1px solid var(--border-color); padding:0.35rem 0.5rem;">${r.x.toFixed(2)}</td>
                    <td style="border:1px solid var(--border-color); padding:0.35rem 0.5rem;">${r.y.toFixed(2)}</td>
                    <td style="border:1px solid var(--border-color); padding:0.35rem 0.5rem;">${r.radius !== undefined && r.radius !== null ? r.radius.toFixed(2) : '-'}</td>
                    <td style="border:1px solid var(--border-color); padding:0.35rem 0.5rem;">${r.label ? escapeHtml(r.label) : '<span style="color:var(--text-muted);">(없음)</span>'}</td>
                    <td style="border:1px solid var(--border-color); padding:0.35rem 0.5rem;">${r.labelDist !== null ? r.labelDist.toFixed(2) : '-'}</td>
                </tr>
            `).join('')}</tbody>
        `;
    }

    window.extractDxfCircles = function() {
        const dxf = window._dxfParsedDoc;
        if (!dxf) {
            window.showToast('먼저 DXF 파일을 불러와주세요.', 'warning');
            return;
        }
        const checked = Array.from(document.querySelectorAll('.dxf-layer-check:checked')).map(el => el.value);
        if (checked.length === 0) {
            window.showToast('레이어를 1개 이상 선택해주세요.', 'warning');
            return;
        }

        const circles = (dxf.entities || []).filter(en => en.type === 'CIRCLE' && checked.includes(en.layer));
        const texts = (dxf.entities || [])
            .filter(en => (en.type === 'TEXT' || en.type === 'MTEXT') && en.text)
            .map(en => {
                const p = en.startPoint || en.position || en.insertionPoint || {};
                return { x: p.x || 0, y: p.y || 0, text: (en.text || '').toString() };
            });

        const rows = circles.map(c => {
            const cx = c.center ? c.center.x : 0;
            const cy = c.center ? c.center.y : 0;
            const nearest = nearestDxfTextForPoint(cx, cy, texts);
            return {
                layer: c.layer,
                x: cx,
                y: cy,
                radius: c.radius,
                label: nearest ? nearest.text : '',
                labelDist: nearest ? nearest.dist : null
            };
        });

        window._dxfLastExtractedRows = rows;
        renderDxfExtractPreview(rows);
        window.showToast(
            `🧭 선택한 레이어 ${checked.length}개에서 원(결함 위치 후보) ${rows.length}개를 찾았습니다.`,
            rows.length ? 'success' : 'warning',
            5000
        );
    };

    // --- CAD(DXF) 캘리브레이션: 기준점 2개로 "CAD 좌표 -> 도면 사진 픽셀" 변환식 계산 (2점 유사변환/Helmert 변환) ---
    function computeDxfSimilarityTransform(p1, p2) {
        const dxDX = p2.dxX - p1.dxX;
        const dxDY = p2.dxY - p1.dxY;
        const imgDX = p2.imgX - p1.imgX;
        const imgDY = p2.imgY - p1.imgY;
        const dxLenSq = dxDX * dxDX + dxDY * dxDY;
        if (dxLenSq < 1e-9) return null; // 두 기준점의 CAD 좌표가 사실상 같으면 계산 불가

        // 복소수 나눗셈: (imgDX + i*imgDY) / (dxDX + i*dxDY) = 스케일 * (cos회전 + i*sin회전)
        const a = (imgDX * dxDX + imgDY * dxDY) / dxLenSq;
        const b = (imgDY * dxDX - imgDX * dxDY) / dxLenSq;

        return {
            scale: Math.hypot(a, b),
            transform: (px, py) => {
                const ox = px - p1.dxX;
                const oy = py - p1.dxY;
                return { x: p1.imgX + (a * ox - b * oy), y: p1.imgY + (b * ox + a * oy) };
            }
        };
    }

    function getDxfCalibBuilding() {
        return (window.state.buildings || []).find(b => b.id === window.state.currentBuildingId) || null;
    }

    function loadDxfCalibPointsForCurrentFloor() {
        const bldg = getDxfCalibBuilding();
        const saved = bldg && bldg.dxfCalibration && bldg.dxfCalibration[window.state.currentFloor];
        window._dxfCalibPoints = saved ? [Object.assign({}, saved.p1), Object.assign({}, saved.p2)] : [{}, {}];
    }

    function saveDxfCalibPointsForCurrentFloorIfComplete() {
        const pts = window._dxfCalibPoints || [];
        const p1 = pts[0], p2 = pts[1];
        const complete = p1 && p2 &&
            [p1.dxX, p1.dxY, p1.imgX, p1.imgY, p2.dxX, p2.dxY, p2.imgX, p2.imgY].every(v => v !== undefined && !Number.isNaN(v));
        if (!complete) return;
        const bldg = getDxfCalibBuilding();
        if (!bldg) return;
        if (!bldg.dxfCalibration) bldg.dxfCalibration = {};
        bldg.dxfCalibration[window.state.currentFloor] = { p1: Object.assign({}, p1), p2: Object.assign({}, p2) };
        saveStateToLocalStorage();
    }

    function renderDxfCalibRows() {
        const body = document.getElementById('dxfCalibRows');
        if (!body) return;
        if (!window._dxfCalibPoints) loadDxfCalibPointsForCurrentFloor();
        const pts = window._dxfCalibPoints;

        body.innerHTML = [0, 1].map(i => {
            const p = pts[i] || {};
            const captured = p.imgX !== undefined && p.imgY !== undefined;
            return `
                <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; font-size:0.8rem; border:1px solid var(--border-color); border-radius:8px; padding:0.5rem;">
                    <b>기준점 ${i + 1}</b>
                    CAD X <input type="number" step="any" class="form-control dxf-calib-x" data-idx="${i}" value="${p.dxX !== undefined ? p.dxX : ''}" style="width:100px;">
                    CAD Y <input type="number" step="any" class="form-control dxf-calib-y" data-idx="${i}" value="${p.dxY !== undefined ? p.dxY : ''}" style="width:100px;">
                    <button type="button" class="btn btn-sm btn-outline dxf-calib-pick" data-idx="${i}" style="border-color:#38bdf8; color:#38bdf8;">📍 도면에서 클릭 지정</button>
                    <span style="color:${captured ? '#16a34a' : 'var(--text-muted)'};">${captured ? `✅ 지정됨 (${p.imgX.toFixed(0)}, ${p.imgY.toFixed(0)})` : '아직 미지정'}</span>
                </div>
            `;
        }).join('');

        body.querySelectorAll('.dxf-calib-x').forEach(el => el.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.idx, 10);
            if (!window._dxfCalibPoints[idx]) window._dxfCalibPoints[idx] = {};
            window._dxfCalibPoints[idx].dxX = parseFloat(e.target.value);
            saveDxfCalibPointsForCurrentFloorIfComplete();
        }));
        body.querySelectorAll('.dxf-calib-y').forEach(el => el.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.idx, 10);
            if (!window._dxfCalibPoints[idx]) window._dxfCalibPoints[idx] = {};
            window._dxfCalibPoints[idx].dxY = parseFloat(e.target.value);
            saveDxfCalibPointsForCurrentFloorIfComplete();
        }));
        body.querySelectorAll('.dxf-calib-pick').forEach(el => el.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.dataset.idx, 10);
            startDxfCalibPick(idx);
        }));
    }

    function startDxfCalibPick(idx) {
        if (!state.bgImage) {
            window.showToast('먼저 [도면점검] 탭에서 해당 층 도면 사진을 열어주세요.', 'warning', 5000);
            return;
        }
        closeDxfImportModal();
        window.showToast(`도면 위에서 기준점 ${idx + 1}에 해당하는 지점을 클릭해주세요.`, 'info', 4000);
        window._calibrationCaptureCallback = (imgX, imgY) => {
            if (!window._dxfCalibPoints[idx]) window._dxfCalibPoints[idx] = {};
            window._dxfCalibPoints[idx].imgX = imgX;
            window._dxfCalibPoints[idx].imgY = imgY;
            saveDxfCalibPointsForCurrentFloorIfComplete();
            openDxfImportModal();
            renderDxfCalibRows();
            window.showToast(`기준점 ${idx + 1} 위치가 지정됐습니다.`, 'success');
        };
    }

    // 캘리브레이션(기준점 2개)과 추출된 좌표(rows)가 모두 준비됐는지 확인하고,
    // 준비됐으면 변환함수와 rows를 반환한다. 안 됐으면 이유를 토스트로 알리고 null 반환.
    function getReadyDxfTransformOrWarn() {
        const pts = window._dxfCalibPoints || [];
        const p1 = pts[0], p2 = pts[1];
        const complete = p1 && p2 &&
            [p1.dxX, p1.dxY, p1.imgX, p1.imgY, p2.dxX, p2.dxY, p2.imgX, p2.imgY].every(v => v !== undefined && !Number.isNaN(v));
        if (!complete) {
            window.showToast('기준점 2개(CAD 좌표 입력 + 도면 클릭 지정)를 모두 완료해주세요.', 'warning');
            return null;
        }
        const xf = computeDxfSimilarityTransform(p1, p2);
        if (!xf) {
            window.showToast('기준점 2개의 CAD 좌표가 동일합니다. 서로 다른 위치를 골라주세요.', 'error');
            return null;
        }
        const rows = window._dxfLastExtractedRows || [];
        if (rows.length === 0) {
            window.showToast('먼저 "선택한 레이어에서 좌표 추출"을 눌러 결함 위치 후보를 뽑아주세요.', 'warning');
            return null;
        }
        return { xf, rows };
    }

    window.previewDxfCalibration = function() {
        const ready = getReadyDxfTransformOrWarn();
        if (!ready) return;
        const { xf, rows } = ready;

        window._dxfCalibrationPreviewPoints = rows.map(r => {
            const t = xf.transform(r.x, r.y);
            return { imgX: t.x, imgY: t.y, label: r.label || '' };
        });

        closeDxfImportModal();
        drawCanvas();
        window.showToast(
            `🎯 도면 위에 ${rows.length}개 지점을 임시로 표시했습니다 (아직 결함으로 저장되지 않았습니다). 실제 결함 위치와 맞는지 눈으로 확인해주세요.`,
            'success',
            8000
        );
    };

    // 캘리브레이션으로 변환한 좌표에 실제 결함 핀을 생성한다.
    // 부재명칭/결함종류/원인 등은 CAD 정보만으로는 알 수 없으므로 기본값으로 채우고,
    // 결함번호는 CAD 텍스트(nearest label)를 그대로 사용해 나중에 엑셀표와 번호로 매칭할 수 있게 한다.
    window.createDxfDefectPins = function() {
        if (!state.currentBuildingId) {
            window.showToast('건축물이 선택되지 않았습니다.', 'warning');
            return;
        }
        const ready = getReadyDxfTransformOrWarn();
        if (!ready) return;
        const { xf, rows } = ready;

        const floorCode = state.currentFloor;
        const key = `${state.currentBuildingId}_${floorCode}`;
        if (!state.defects[key]) state.defects[key] = [];
        pushDefectHistoryForKey(key);

        let seq = state.defects[key].reduce((max, d) => {
            const n = getDefectSortNo(d);
            return n === Number.MAX_SAFE_INTEGER ? max : Math.max(max, n);
        }, 0);

        let created = 0;
        rows.forEach((r, i) => {
            const t = xf.transform(r.x, r.y);
            seq += 1;
            const seqStr = seq < 10 ? `0${seq}` : `${seq}`;
            const no = (r.label && r.label.trim()) ? r.label.trim() : `NO.${seqStr}`;

            state.defects[key].push({
                id: 'pin-dxf-' + Date.now() + '-' + floorCode + '-' + i,
                no,
                category: '구조체',
                component: '기타',
                location: `CAD(${r.layer}) 레이어에서 자동 생성 — 부재명칭/결함종류/원인 등 직접 입력 필요`,
                defectType: '기타',
                cause: '건조수축',
                size: '',
                crackWidth: '',
                crackLength: '',
                isProgress: false,
                isLeak: false,
                isCarriedOver: false,
                surveyRound: getCurrentSurveyRoundKey(),
                photos: [],
                inspectorName: window.state.userName || '',
                x: t.x + 35,
                y: t.y - 35,
                targetX: t.x,
                targetY: t.y
            });
            created++;
        });

        window._dxfCalibrationPreviewPoints = null;
        updateUndoRedoButtons();
        saveStateToLocalStorage();
        renderSurveyTable();
        drawCanvas();
        closeDxfImportModal();
        window.showToast(
            `✅ 결함 핀 ${created}개를 정확한 위치에 생성했습니다. 도면에서 각 핀을 클릭해 부재명칭·결함종류·원인 등 세부 정보를 입력해주세요. (실수하셨다면 되돌리기 버튼으로 취소할 수 있습니다)`,
            'success',
            9000
        );
    };

    window.clearDxfCalibration = function() {
        window._dxfCalibPoints = [{}, {}];
        window._dxfCalibrationPreviewPoints = null;
        const bldg = getDxfCalibBuilding();
        if (bldg && bldg.dxfCalibration && bldg.dxfCalibration[window.state.currentFloor]) {
            delete bldg.dxfCalibration[window.state.currentFloor];
            saveStateToLocalStorage();
        }
        renderDxfCalibRows();
        drawCanvas();
        window.showToast('캘리브레이션 기준점과 미리보기를 초기화했습니다.', 'info');
    };

    const btnOpenDxfImport = document.getElementById('btnOpenDxfImport');
    const inputDxfImport = document.getElementById('inputDxfImport');
    if (btnOpenDxfImport && inputDxfImport) {
        btnOpenDxfImport.addEventListener('click', () => {
            loadDxfCalibPointsForCurrentFloor();
            renderDxfCalibRows();
            inputDxfImport.click();
        });
        inputDxfImport.addEventListener('change', window.handleDxfImportFile);
    }
    const btnCloseDxfImportModal = document.getElementById('btnCloseDxfImportModal');
    if (btnCloseDxfImportModal) btnCloseDxfImportModal.addEventListener('click', closeDxfImportModal);
    const btnCloseDxfImportModal2 = document.getElementById('btnCloseDxfImportModal2');
    if (btnCloseDxfImportModal2) btnCloseDxfImportModal2.addEventListener('click', closeDxfImportModal);
    const btnExtractDxfCircles = document.getElementById('btnExtractDxfCircles');
    if (btnExtractDxfCircles) btnExtractDxfCircles.addEventListener('click', window.extractDxfCircles);
    const btnDxfCalibPreview = document.getElementById('btnDxfCalibPreview');
    if (btnDxfCalibPreview) btnDxfCalibPreview.addEventListener('click', window.previewDxfCalibration);
    const btnDxfCalibClear = document.getElementById('btnDxfCalibClear');
    if (btnDxfCalibClear) btnDxfCalibClear.addEventListener('click', window.clearDxfCalibration);
    const btnCreateDxfDefectPins = document.getElementById('btnCreateDxfDefectPins');
    if (btnCreateDxfDefectPins) btnCreateDxfDefectPins.addEventListener('click', window.createDxfDefectPins);

    // 엑셀 시트 이름으로 쓸 수 없는 문자를 제거하고 31자로 자르며, 중복되면 뒤에 번호를 붙인다
    function sanitizeSheetName(name, usedNames) {
        let clean = (name || '시트').replace(/[:\\/?*\[\]]/g, '').trim().slice(0, 31) || '시트';
        let finalName = clean;
        let suffix = 2;
        while (usedNames.has(finalName)) {
            finalName = `${clean.slice(0, 28)}(${suffix})`;
            suffix++;
        }
        usedNames.add(finalName);
        return finalName;
    }

    // 결함표 가져오기 양식(빈 엑셀 템플릿) 다운로드 — 건축물의 실제 층마다 시트를 하나씩 만들어서
    // 각 층 결함을 해당 시트에 나눠 적으면 가져오기 때 시트 이름으로 층이 자동 배정되도록 함.
    // 헤더는 IMPORT_DEFECT_FIELD_DEFS와 항상 일치하도록 그대로 재사용.
    window.downloadImportDefectExcelTemplate = function() {
        if (typeof XLSX === 'undefined') {
            window.showToast('엑셀 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인 후 다시 시도해주세요.', 'error', 5000);
            return;
        }
        const headerRow = IMPORT_DEFECT_FIELD_DEFS.map(f => f.aliases[0]);
        const exampleRows = [
            ['NO.01', '기둥', '구조체', '균열', '(예시) 101동 1F 기둥 C1 하부', '0.15/1.2', '0.15', '1.2', '진행중', '-', '건조수축'],
            ['NO.02', '슬래브', '구조체', '상태양호', '(예시) 101동 1F 슬래브 중앙', '', '', '', '', '', ''],
            ['NO.03', '조적벽', '비구조체', '조적벽체 균열', '(예시) 2F 조적벽', 'W=0.3mm', '', '', '-', '누수중', '부등침하']
        ];
        const colWidths = [10, 14, 14, 18, 30, 14, 10, 10, 10, 10, 18].map(w => ({ wch: w }));

        const bldg = state.currentBuilding;
        const floors = bldg ? window.getBuildingAvailableFloors(bldg) : [];
        const wb = XLSX.utils.book_new();
        const usedNames = new Set();

        if (floors.length > 0) {
            floors.forEach((f, idx) => {
                const aoa = idx === 0 ? [headerRow, ...exampleRows] : [headerRow];
                const ws = XLSX.utils.aoa_to_sheet(aoa);
                ws['!cols'] = colWidths;
                XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(f.floorLabel, usedNames));
            });
        } else {
            const ws = XLSX.utils.aoa_to_sheet([headerRow, ...exampleRows]);
            ws['!cols'] = colWidths;
            XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName('결함목록', usedNames));
        }

        const notes = [
            ['[스마트 건축물 안전점검] 결함표 가져오기 양식 작성 안내'],
            [''],
            [floors.length > 0
                ? "1. 시트가 층별로 나뉘어 있습니다. 각 시트 이름이 곧 층 이름이니, 해당 층의 결함만 그 시트에 적으세요. 쓰지 않는 층 시트는 그냥 비워두거나 삭제해도 됩니다."
                : "1. 건축물의 층 정보가 없어 시트가 하나로 되어 있습니다. '결함목록' 시트 하나에 모두 적으세요."],
            ["2. 각 시트 2~4행(예시 행, 위치 칸에 '(예시)' 표시)은 형식을 보여주기 위한 것입니다. 실제 데이터 입력 전 삭제하세요."],
            ["3. 첫 행(헤더)의 열 이름은 그대로 두는 것을 권장합니다. 이름을 바꿔도 앱에서 가져올 때 직접 매칭할 수 있지만, 그대로 두면 자동으로 인식됩니다."],
            ["4. '결함번호' 칸을 비워두면 앱에서 가져올 때 자동으로 순번(NO.01, NO.02…)을 매깁니다. 기존 번호 체계를 유지하려면 직접 입력하세요."],
            ["5. '구분' 칸은 반드시 '구조체' / '비구조체' / '마감재' 중 하나로 입력하세요. 비워두면 '구조체'로 처리됩니다."],
            ["6. '조사내용'은 결함 종류입니다 (예: 균열, 누수, 백태/유출, 철근노출, 조적벽체 균열 등). 상태가 양호한 항목은 '상태양호'라고 입력하면 결함크기·균열폭·균열길이·결함원인추정 칸은 비워도 자동으로 무시됩니다."],
            ["7. '결함크기'는 자유 텍스트입니다. 균열의 경우 균열폭/균열길이를 별도 칸에 나눠 적거나, 결함크기 칸에 '0.15/1.2'처럼 슬래시로 합쳐 적어도 자동으로 나뉘어 인식됩니다."],
            ["8. '진행여부' / '누수여부'는 해당되면 '진행중' / '누수중'처럼 아무 문자나 입력하고, 해당 없으면 '-' 또는 빈 칸으로 두세요."],
            ["9. 작성이 끝나면 이 파일을 저장한 뒤, 이 화면의 '📥 외부 엑셀 결함표 가져오기' 버튼으로 업로드하세요. 가져오기 화면에서 시트 ↔ 층 배정이 시트 이름으로 자동 추정되며, 다르면 직접 바꿀 수 있습니다."],
            ["10. 엑셀에는 도면 위 위치(좌표) 정보가 없어, 가져온 결함은 각 층 도면 좌측 상단에 임시로 배치됩니다. 가져오기 후 좌측 결함 목록에서 각 항목을 도면 위 정확한 위치로 직접 드래그해주세요."]
        ];
        const ws2 = XLSX.utils.aoa_to_sheet(notes);
        ws2['!cols'] = [{ wch: 100 }];
        XLSX.utils.book_append_sheet(wb, ws2, sanitizeSheetName('작성안내', usedNames));

        const fileLabel = bldg && bldg.name ? bldg.name.replace(/[:\\/?*\[\]]/g, '') : '결함표';
        XLSX.writeFile(wb, `${fileLabel}_가져오기_양식.xlsx`);
    };

    const btnDownloadImportTemplate = document.getElementById('btnDownloadImportTemplate');
    if (btnDownloadImportTemplate) {
        btnDownloadImportTemplate.addEventListener('click', window.downloadImportDefectExcelTemplate);
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

    let auth = null;
    window._justRegistering = false;

    function initFirebaseSync() {
        try {
            if (typeof firebase !== 'undefined') {
                if (!firebase.apps.length) {
                    firebase.initializeApp(firebaseConfig);
                }
                db = firebase.firestore();
                if (firebase.auth) {
                    auth = firebase.auth();
                    auth.onAuthStateChanged(handleAuthStateChange);
                } else {
                    console.warn('Firebase Auth SDK가 로드되지 않았습니다.');
                }
                updateOnlineBadge(true);
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

    // --- 무거운 이미지(도면/사진) 개별 문서 저장 헬퍼 ---
    // Firestore 문서 1개 1MB 한도 대응: 도면/사진은 각자 별도 문서에 저장하고,
    // 회사 메타데이터 문서(safety_app/{companyId})에는 참조(ID)만 남긴다.

    function getPhotoDocId(defectId, index) {
        return `${defectId}_${index}`;
    }

    async function uploadFloorDrawing(buildingId, floorCode, dataUrl) {
        if (!db || !window.state.companyId || !dataUrl) return;
        try {
            await db.collection('safety_app').doc(getCompanyDocId())
                .collection('floorDrawings').doc(`${buildingId}_${floorCode}`)
                .set({ dataUrl });
        } catch (e) {
            console.warn('도면 업로드 실패:', e);
        }
    }

    async function uploadDefectPhotos(defectId, photosArray) {
        if (!Array.isArray(photosArray) || photosArray.length === 0) return [];
        if (!window._photoCache) window._photoCache = {};
        const photoIds = photosArray.map((_, i) => getPhotoDocId(defectId, i));
        photosArray.forEach((url, i) => { window._photoCache[photoIds[i]] = url; });
        if (db && window.state.companyId) {
            const companyPhotos = db.collection('safety_app').doc(getCompanyDocId()).collection('photos');
            await Promise.all(photosArray.map((url, i) =>
                companyPhotos.doc(photoIds[i]).set({ dataUrl: url }).catch(e => console.warn('사진 업로드 실패:', e))
            ));
        }
        return photoIds;
    }

    // 반환값: 삭제 실패 건수. 실패해도 예외를 던지지 않지만, 호출부에서 사용자에게 알릴 수 있도록 건수를 반환한다.
    async function deletePhotosForDefect(defectId, count) {
        if (!db || !window.state.companyId || !count) return 0;
        const companyPhotos = db.collection('safety_app').doc(getCompanyDocId()).collection('photos');
        let failCount = 0;
        const jobs = [];
        for (let i = 0; i < count; i++) {
            const photoDocId = getPhotoDocId(defectId, i);
            jobs.push(companyPhotos.doc(photoDocId).delete().catch(e => {
                failCount++;
                console.warn(`사진 삭제 실패 (${photoDocId}):`, e);
            }));
        }
        await Promise.all(jobs);
        return failCount;
    }

    async function deleteFloorDrawingsForBuilding(bldg) {
        if (!db || !window.state.companyId || !bldg) return 0;
        const floors = (bldg.floorsList && bldg.floorsList.length > 0)
            ? bldg.floorsList.map(f => f.floorCode)
            : Object.keys(bldg.floorDrawings || {});
        const companyDrawings = db.collection('safety_app').doc(getCompanyDocId()).collection('floorDrawings');
        let failCount = 0;
        await Promise.all(floors.map(fc => {
            const drawingDocId = `${bldg.id}_${fc}`;
            return companyDrawings.doc(drawingDocId).delete().catch(e => {
                failCount++;
                console.warn(`도면 삭제 실패 (${drawingDocId}):`, e);
            });
        }));
        return failCount;
    }

    async function hydrateDefectPhotos(defectsMap) {
        if (!db || !window.state.companyId) return defectsMap;
        if (!window._photoCache) window._photoCache = {};
        const companyPhotos = db.collection('safety_app').doc(getCompanyDocId()).collection('photos');
        const result = {};
        for (const [key, arr] of Object.entries(defectsMap || {})) {
            result[key] = await Promise.all((arr || []).map(async d => {
                if (!d.photoIds || d.photoIds.length === 0) {
                    return { ...d, photos: [] };
                }
                const photos = await Promise.all(d.photoIds.map(async pid => {
                    if (window._photoCache[pid]) return window._photoCache[pid];
                    try {
                        const snap = await companyPhotos.doc(pid).get();
                        const url = snap.exists ? snap.data().dataUrl : null;
                        if (url) window._photoCache[pid] = url;
                        return url;
                    } catch (e) {
                        return null;
                    }
                }));
                return { ...d, photos: photos.filter(Boolean) };
            }));
        }
        return result;
    }

    function syncStateToFirebase() {
        if (!db || isRemoteSyncing || !window.state.companyId) return;
        try {
            const docId = getCompanyDocId();

            const sanitizedBuildings = (window.state.buildings || []).map(b => {
                const { floorDrawings, ...rest } = b;
                return rest;
            });

            const sanitizedDefects = {};
            Object.entries(window.state.defects || {}).forEach(([key, arr]) => {
                sanitizedDefects[key] = (arr || []).map(d => {
                    const { photos, ...rest } = d;
                    return { ...rest, photoIds: (photos || []).map((_, i) => getPhotoDocId(d.id, i)) };
                });
            });

            const dataToSync = {
                defects: sanitizedDefects,
                ndtData: window.state.ndtData || {},
                ndtDisplacementGroups: window.state.ndtDisplacementGroups || {},
                grids: window.state.grids || {},
                buildings: sanitizedBuildings,
                lastUsedBuildingId: window.state.currentBuildingId || null,
                styleColors: window.state.styleColors || null,
                styleSizes: window.state.styleSizes || null,
                styleShapes: window.state.styleShapes || null,
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
        if (!db || !window.state.companyId) return;
        if (currentUnsubscribe) {
            try { currentUnsubscribe(); } catch(e) {}
        }
        const docId = getCompanyDocId();
        currentUnsubscribe = db.collection('safety_app').doc(docId).onSnapshot(async (doc) => {
            if (doc && doc.exists) {
                const data = doc.data();
                if (!data) return;
                isRemoteSyncing = true;
                try {
                    let isChanged = false;
                    if (data.buildings && Array.isArray(data.buildings) && data.buildings.length > 0) {
                        // 로컬에 이미 로드된 도면 캐시(floorDrawings)는 유지한 채 메타데이터만 갱신
                        const prevDrawingsById = {};
                        (window.state.buildings || []).forEach(b => { prevDrawingsById[b.id] = b.floorDrawings || {}; });
                        window.state.buildings = data.buildings.map(b => ({
                            ...b,
                            floorDrawings: prevDrawingsById[b.id] || {}
                        }));
                        isChanged = true;
                    }
                    if (data.defects) {
                        window.state.defects = await hydrateDefectPhotos(data.defects);
                        isChanged = true;
                    }
                    if (data.ndtData) {
                        window.state.ndtData = data.ndtData;
                        isChanged = true;
                    }
                    if (data.ndtDisplacementGroups) {
                        window.state.ndtDisplacementGroups = data.ndtDisplacementGroups;
                        isChanged = true;
                    }
                    if (data.grids) {
                        window.state.grids = data.grids;
                        isChanged = true;
                    }
                    if (data.styleColors) {
                        window.state.styleColors = data.styleColors;
                        isChanged = true;
                    }
                    if (data.styleSizes) {
                        window.state.styleSizes = data.styleSizes;
                        isChanged = true;
                    }
                    if (data.styleShapes) {
                        window.state.styleShapes = data.styleShapes;
                        isChanged = true;
                    }

                    if (isChanged) {
                        // 로컬 캐시 갱신 (공용 저장 함수 재사용 — customDefectTypes 등 다른 로컬 설정을 덮어쓰지 않도록)
                        // isRemoteSyncing이 true인 상태라 syncStateToFirebase() 내부 가드에 의해 재동기화는 발생하지 않음
                        if (typeof saveStateToLocalStorage === 'function') saveStateToLocalStorage();

                        // 실시간 UI 자동 업데이트
                        if (typeof renderDashboard === 'function') renderDashboard();
                        if (typeof renderBuildingSelector === 'function') renderBuildingSelector();
                        if (typeof renderSurveyTable === 'function') renderSurveyTable();
                        if (typeof drawCanvas === 'function') drawCanvas();
                        if (typeof drawNdtCanvas === 'function') drawNdtCanvas();
                        if (typeof renderNdtSummaryTable === 'function') renderNdtSummaryTable();
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
    // 🔐 COMPANY AUTH & APPROVAL ENGINE (대표 승인제 회사별 로그인)
    // ==========================================================================

    function getCompanyDocId() {
        return window.state.companyId;
    }

    function generateJoinCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O, 1/I 등 혼동되는 문자 제외
        let code = '';
        for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
        return code;
    }

    async function generateUniqueJoinCode() {
        for (let attempt = 0; attempt < 5; attempt++) {
            const code = generateJoinCode();
            const doc = await db.collection('joinCodes').doc(code).get();
            if (!doc.exists) return code;
        }
        return generateJoinCode() + Date.now().toString(36).slice(-2).toUpperCase();
    }

    function showAuthError(err) {
        const box = document.getElementById('authErrorMsg');
        if (!box) return;
        const map = {
            'auth/email-already-in-use': '이미 가입된 이메일입니다. 로그인을 이용해 주세요.',
            'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
            'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
            'auth/wrong-password': '비밀번호가 올바르지 않습니다.',
            'auth/user-not-found': '가입되지 않은 이메일입니다.',
            'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
            'auth/too-many-requests': '시도 횟수가 많습니다. 잠시 후 다시 시도해 주세요.'
        };
        const code = err && err.code;
        box.textContent = (code && map[code]) ? map[code] : ((err && err.message) || '오류가 발생했습니다. 다시 시도해 주세요.');
        box.style.display = 'block';
    }

    function clearAuthError() {
        const box = document.getElementById('authErrorMsg');
        if (box) { box.style.display = 'none'; box.textContent = ''; }
    }

    function showLoginOverlay() {
        const overlay = document.getElementById('loginOverlay');
        const loginCard = overlay ? overlay.querySelector('.modal-card') : null;
        const pendingCard = document.getElementById('pendingApprovalCard');
        if (overlay) overlay.style.cssText = 'display: flex !important; opacity: 1 !important; pointer-events: auto !important; visibility: visible !important;';
        if (loginCard) loginCard.style.display = 'flex';
        if (pendingCard) pendingCard.style.display = 'none';
        const headerProfile = document.getElementById('headerUserProfileGroup');
        if (headerProfile) headerProfile.style.display = 'none';
        clearAuthError();
    }

    function showPendingApproval(companyName) {
        const overlay = document.getElementById('loginOverlay');
        const loginCard = overlay ? overlay.querySelector('.modal-card') : null;
        const pendingCard = document.getElementById('pendingApprovalCard');
        if (overlay) overlay.style.cssText = 'display: flex !important; opacity: 1 !important; pointer-events: auto !important; visibility: visible !important;';
        if (loginCard) loginCard.style.display = 'none';
        if (pendingCard) pendingCard.style.display = 'block';
        const lbl = document.getElementById('pendingCompanyName');
        if (lbl) lbl.textContent = companyName || '회사';
        const headerProfile = document.getElementById('headerUserProfileGroup');
        if (headerProfile) headerProfile.style.display = 'none';
    }

    function hideAuthOverlay() {
        const overlay = document.getElementById('loginOverlay');
        if (overlay) {
            overlay.style.cssText = 'display: none !important; opacity: 0 !important; pointer-events: none !important; visibility: hidden !important;';
            overlay.classList.remove('open');
        }
    }

    async function enterAppAsUser(profile) {
        window.state.uid = profile.uid;
        window.state.userName = profile.name;
        window.state.companyId = profile.companyId;
        window.state.companyName = profile.companyName;
        window.state.role = profile.role;

        hideAuthOverlay();

        const headerProfile = document.getElementById('headerUserProfileGroup');
        if (headerProfile) headerProfile.style.display = 'flex';
        const lblCompany = document.getElementById('lblUserCompany');
        const lblUser = document.getElementById('lblUserName');
        if (lblCompany) lblCompany.textContent = profile.companyName || '';
        if (lblUser) lblUser.textContent = profile.name || '';
        const inputHomeCompany = document.getElementById('inputHomeCompanyName');
        if (inputHomeCompany) inputHomeCompany.value = profile.companyName || '';

        const btnApproval = document.getElementById('btnOpenMemberApproval');
        if (btnApproval) btnApproval.style.display = (profile.role === 'admin') ? 'inline-flex' : 'none';

        if (profile.role === 'admin' && db) {
            try {
                const companyDoc = await db.collection('companies').doc(profile.companyId).get();
                if (companyDoc.exists) window.state.companyJoinCode = companyDoc.data().joinCode || null;
            } catch (e) { console.warn('회사 코드 조회 실패:', e); }
        }

        if (typeof loadStateFromLocalStorage === 'function') loadStateFromLocalStorage();
        if (typeof listenToRealtimeUpdates === 'function') listenToRealtimeUpdates();
        if (typeof renderDashboard === 'function') renderDashboard();
        window.switchTab('tab-home');
    }

    async function handleAuthStateChange(user) {
        if (!user) {
            if (currentUnsubscribe) { try { currentUnsubscribe(); } catch (e) {} currentUnsubscribe = null; }
            window.state.uid = null;
            window.state.userName = null;
            window.state.companyId = null;
            window.state.companyName = null;
            window.state.role = null;
            showLoginOverlay();
            return;
        }

        if (window._justRegistering) return; // 가입 절차가 직접 화면 전환을 처리함

        try {
            const userDoc = await db.collection('users').doc(user.uid).get();
            if (!userDoc.exists) {
                showAuthError({ message: '계정 정보를 찾을 수 없습니다. 다시 가입해 주세요.' });
                await auth.signOut();
                return;
            }
            const data = userDoc.data();
            const status = await resolveMembershipStatus(user.uid, data.companyId);
            if (status === 'pending') {
                window.state.role = 'pending';
                showPendingApproval(data.companyName);
            } else if (status === 'rejected') {
                showAuthError({ message: '가입 신청이 거절되었습니다. 회사 대표에게 문의해 주세요.' });
                await auth.signOut();
            } else if (status === 'admin' || status === 'member') {
                await enterAppAsUser({ uid: user.uid, name: data.name, companyId: data.companyId, companyName: data.companyName, role: status });
            } else {
                showAuthError({ message: '알 수 없는 계정 상태입니다. 회사 대표에게 문의해 주세요.' });
                await auth.signOut();
            }
        } catch (e) {
            console.error('로그인 상태 확인 오류:', e);
            showAuthError({ message: '로그인 처리 중 오류가 발생했습니다. 인터넷 연결을 확인해 주세요.' });
        }
    }

    // 회사 하위 members/pendingRequests/rejectedRequests 컬렉션만으로 상태를 판단
    // (users/{uid} 문서는 본인만 쓸 수 있어야 하므로, 대표가 팀원 상태를 바꿀 때도
    //  companies/{companyId} 하위 문서만 건드리도록 설계)
    async function resolveMembershipStatus(uid, companyId) {
        if (!companyId) return 'unknown';
        const companyRef = db.collection('companies').doc(companyId);
        const memberDoc = await companyRef.collection('members').doc(uid).get();
        if (memberDoc.exists) return memberDoc.data().role || 'member';
        const pendingDoc = await companyRef.collection('pendingRequests').doc(uid).get();
        if (pendingDoc.exists) return 'pending';
        const rejectedDoc = await companyRef.collection('rejectedRequests').doc(uid).get();
        if (rejectedDoc.exists) return 'rejected';
        return 'unknown';
    }

    window.submitLogin = async function() {
        clearAuthError();
        const email = (document.getElementById('authEmail')?.value || '').trim();
        const password = document.getElementById('authPassword')?.value || '';
        if (!email || !password) { showAuthError({ message: '이메일과 비밀번호를 입력해 주세요.' }); return; }
        window.showLoading('로그인 중입니다...');
        try {
            await auth.signInWithEmailAndPassword(email, password);
        } catch (err) {
            showAuthError(err);
        } finally {
            window.hideLoading();
        }
    };

    window.submitRegisterAdmin = async function() {
        clearAuthError();
        const name = (document.getElementById('authUserName')?.value || '').trim();
        const companyName = (document.getElementById('authCompanyName')?.value || '').trim();
        const email = (document.getElementById('authEmail')?.value || '').trim();
        const password = document.getElementById('authPassword')?.value || '';
        if (!name || !companyName || !email || !password) {
            showAuthError({ message: '이름, 회사명, 이메일, 비밀번호를 모두 입력해 주세요.' });
            return;
        }
        window._justRegistering = true;
        window.showLoading('회사 계정을 생성하는 중입니다...');
        let cred = null;
        try {
            cred = await auth.createUserWithEmailAndPassword(email, password);
            const uid = cred.user.uid;
            const joinCode = await generateUniqueJoinCode();
            const companyRef = db.collection('companies').doc();
            await companyRef.set({
                name: companyName,
                adminUid: uid,
                joinCode: joinCode,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            await db.collection('joinCodes').doc(joinCode).set({
                companyId: companyRef.id, companyName
            });
            await companyRef.collection('members').doc(uid).set({
                name, email, role: 'admin',
                approvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            await db.collection('users').doc(uid).set({
                name, email, companyId: companyRef.id, companyName, role: 'admin'
            });
            await enterAppAsUser({ uid, name, companyId: companyRef.id, companyName, role: 'admin' });
        } catch (err) {
            showAuthError(err);
            if (cred && cred.user) { try { await cred.user.delete(); } catch (e) {} }
        } finally {
            window._justRegistering = false;
            window.hideLoading();
        }
    };

    window.submitRegisterMember = async function() {
        clearAuthError();
        const name = (document.getElementById('authUserName')?.value || '').trim();
        const joinCode = (document.getElementById('authJoinCode')?.value || '').trim().toUpperCase();
        const email = (document.getElementById('authEmail')?.value || '').trim();
        const password = document.getElementById('authPassword')?.value || '';
        if (!name || !joinCode || !email || !password) {
            showAuthError({ message: '이름, 가입 코드, 이메일, 비밀번호를 모두 입력해 주세요.' });
            return;
        }
        window._justRegistering = true;
        window.showLoading('가입 신청 중입니다...');
        let cred = null;
        try {
            const codeDoc = await db.collection('joinCodes').doc(joinCode).get();
            if (!codeDoc.exists) {
                showAuthError({ message: '가입 코드를 확인해 주세요. 일치하는 회사가 없습니다.' });
                return;
            }
            const { companyId, companyName } = codeDoc.data();

            cred = await auth.createUserWithEmailAndPassword(email, password);
            const uid = cred.user.uid;

            await db.collection('companies').doc(companyId).collection('pendingRequests').doc(uid).set({
                name, email, requestedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            await db.collection('users').doc(uid).set({
                name, email, companyId, companyName, role: 'pending'
            });
            showPendingApproval(companyName);
        } catch (err) {
            showAuthError(err);
            if (cred && cred.user) { try { await cred.user.delete(); } catch (e) {} }
        } finally {
            window._justRegistering = false;
            window.hideLoading();
        }
    };

    window.logout = async function() {
        if (!confirm('🔒 정말 로그아웃 하시겠습니까?')) return;
        try { if (auth) await auth.signOut(); } catch (e) {}
        showLoginOverlay();
    };

    // --- 관리자 가입 승인 관리 패널 ---
    window.openMemberApprovalModal = async function() {
        const modal = document.getElementById('memberApprovalModal');
        if (!modal || window.state.role !== 'admin') return;
        const lblCode = document.getElementById('lblCompanyJoinCode');
        if (lblCode) lblCode.textContent = window.state.companyJoinCode || '------';
        modal.style.display = 'flex';
        modal.classList.add('open');
        await renderMemberApprovalLists();
    };

    async function renderMemberApprovalLists() {
        const pendingBox = document.getElementById('pendingRequestsList');
        const membersBox = document.getElementById('approvedMembersList');
        if (!db || !window.state.companyId) return;
        const companyRef = db.collection('companies').doc(window.state.companyId);

        try {
            const pendingSnap = await companyRef.collection('pendingRequests').orderBy('requestedAt', 'desc').get();
            if (pendingBox) {
                if (pendingSnap.empty) {
                    pendingBox.innerHTML = '<div style="font-size:0.82rem; color:#94a3b8; padding:0.6rem; text-align:center; border:1px dashed #cbd5e1; border-radius:6px;">대기중인 신청이 없습니다.</div>';
                } else {
                    pendingBox.innerHTML = pendingSnap.docs.map(docSnap => {
                        const d = docSnap.data();
                        return `
                            <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; border:1px solid #cbd5e1; padding:0.6rem 0.9rem; border-radius:8px; gap:0.6rem; flex-wrap:wrap;">
                                <span style="font-size:0.85rem;"><strong>${d.name || '이름없음'}</strong> <span style="color:#64748b; font-size:0.78rem;">(${d.email || ''})</span></span>
                                <div style="display:flex; gap:0.4rem;">
                                    <button type="button" class="btn btn-sm btn-outline" style="border-color:#059669; color:#059669;" onclick="window.approveMember('${docSnap.id}')"><i class="fa-solid fa-check"></i> 승인</button>
                                    <button type="button" class="btn btn-sm btn-outline" style="border-color:#ef4444; color:#ef4444;" onclick="window.rejectMember('${docSnap.id}')"><i class="fa-solid fa-xmark"></i> 거절</button>
                                </div>
                            </div>`;
                    }).join('');
                }
            }
        } catch (e) {
            console.error('대기 목록 로드 오류:', e);
            if (pendingBox) pendingBox.innerHTML = '<div style="color:#f87171; font-size:0.82rem;">목록을 불러오지 못했습니다.</div>';
        }

        try {
            const membersSnap = await companyRef.collection('members').get();
            if (membersBox) {
                membersBox.innerHTML = membersSnap.docs.map(docSnap => {
                    const d = docSnap.data();
                    const roleLabel = d.role === 'admin' ? '대표' : '팀원';
                    return `
                        <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; border:1px solid #e2e8f0; padding:0.5rem 0.9rem; border-radius:8px;">
                            <span style="font-size:0.85rem;"><strong>${d.name || '이름없음'}</strong> <span style="color:#64748b; font-size:0.78rem;">(${d.email || ''})</span></span>
                            <span class="badge badge-info">${roleLabel}</span>
                        </div>`;
                }).join('');
            }
        } catch (e) {
            console.error('멤버 목록 로드 오류:', e);
        }
    }

    window.approveMember = async function(uid) {
        if (!db || !window.state.companyId) return;
        try {
            const companyRef = db.collection('companies').doc(window.state.companyId);
            const pendingDoc = await companyRef.collection('pendingRequests').doc(uid).get();
            if (!pendingDoc.exists) { window.showToast('이미 처리된 신청입니다.', 'warning'); await renderMemberApprovalLists(); return; }
            const d = pendingDoc.data();
            await companyRef.collection('members').doc(uid).set({
                name: d.name, email: d.email, role: 'member',
                approvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            await companyRef.collection('pendingRequests').doc(uid).delete();
            await renderMemberApprovalLists();
            window.showToast(`'${d.name || '팀원'}'님의 가입을 승인했습니다.`, 'success');
        } catch (e) {
            console.error('승인 처리 오류:', e);
            window.showToast('승인 처리 중 오류가 발생했습니다.', 'error');
        }
    };

    window.rejectMember = async function(uid) {
        if (!db || !window.state.companyId) return;
        if (!confirm('정말 이 가입 신청을 거절하시겠습니까?')) return;
        try {
            const companyRef = db.collection('companies').doc(window.state.companyId);
            const pendingDoc = await companyRef.collection('pendingRequests').doc(uid).get();
            const d = pendingDoc.exists ? pendingDoc.data() : { name: '', email: '' };
            await companyRef.collection('rejectedRequests').doc(uid).set({
                name: d.name || '', email: d.email || '',
                rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            await companyRef.collection('pendingRequests').doc(uid).delete();
            await renderMemberApprovalLists();
            window.showToast('가입 신청을 거절했습니다.', 'info');
        } catch (e) {
            console.error('거절 처리 오류:', e);
            window.showToast('거절 처리 중 오류가 발생했습니다.', 'error');
        }
    };

    function initAuthEvents() {
        const formLogin = document.getElementById('formLogin');
        const btnLogout = document.getElementById('btnLogout');
        const tabLogin = document.getElementById('tabAuthLogin');
        const tabRegister = document.getElementById('tabAuthRegister');
        const btnSubmit = document.getElementById('btnSubmitAuth');
        const regModeGroup = document.getElementById('regModeGroup');
        const regModeAdminBtn = document.getElementById('regModeAdminBtn');
        const regModeMemberBtn = document.getElementById('regModeMemberBtn');
        const groupRegUserName = document.getElementById('groupRegUserName');
        const groupRegCompanyName = document.getElementById('groupRegCompanyName');
        const groupRegJoinCode = document.getElementById('groupRegJoinCode');

        let currentAuthTab = 'login';
        let currentRegMode = 'admin';

        function applyRegModeUI() {
            if (regModeAdminBtn) regModeAdminBtn.classList.toggle('active', currentRegMode === 'admin');
            if (regModeMemberBtn) regModeMemberBtn.classList.toggle('active', currentRegMode === 'member');
            if (groupRegCompanyName) groupRegCompanyName.style.display = (currentRegMode === 'admin') ? 'block' : 'none';
            if (groupRegJoinCode) groupRegJoinCode.style.display = (currentRegMode === 'member') ? 'block' : 'none';
        }

        function applyAuthTabUI() {
            clearAuthError();
            if (currentAuthTab === 'login') {
                if (regModeGroup) regModeGroup.style.display = 'none';
                if (groupRegUserName) groupRegUserName.style.display = 'none';
                if (groupRegCompanyName) groupRegCompanyName.style.display = 'none';
                if (groupRegJoinCode) groupRegJoinCode.style.display = 'none';
                if (btnSubmit) btnSubmit.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> 🚀 로그인 및 점검 시작';
            } else {
                if (regModeGroup) regModeGroup.style.display = 'flex';
                if (groupRegUserName) groupRegUserName.style.display = 'block';
                applyRegModeUI();
                if (btnSubmit) btnSubmit.innerHTML = '<i class="fa-solid fa-user-plus"></i> 🏢 가입하기';
            }
        }

        if (tabLogin && tabRegister) {
            tabLogin.addEventListener('click', () => {
                currentAuthTab = 'login';
                tabLogin.classList.add('active');
                tabLogin.style.background = '#0284c7';
                tabLogin.style.color = '#ffffff';
                tabRegister.classList.remove('active');
                tabRegister.style.background = 'transparent';
                tabRegister.style.color = '#94a3b8';
                applyAuthTabUI();
            });

            tabRegister.addEventListener('click', () => {
                currentAuthTab = 'register';
                tabRegister.classList.add('active');
                tabRegister.style.background = '#0284c7';
                tabRegister.style.color = '#ffffff';
                tabLogin.classList.remove('active');
                tabLogin.style.background = 'transparent';
                tabLogin.style.color = '#94a3b8';
                applyAuthTabUI();
            });
        }

        if (regModeAdminBtn && regModeMemberBtn) {
            regModeAdminBtn.addEventListener('click', () => { currentRegMode = 'admin'; applyRegModeUI(); });
            regModeMemberBtn.addEventListener('click', () => { currentRegMode = 'member'; applyRegModeUI(); });
        }

        applyAuthTabUI();

        async function handleSubmit(e) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            if (currentAuthTab === 'login') {
                await window.submitLogin();
            } else if (currentRegMode === 'admin') {
                await window.submitRegisterAdmin();
            } else {
                await window.submitRegisterMember();
            }
            return false;
        }

        if (formLogin) formLogin.addEventListener('submit', handleSubmit);
        if (btnSubmit) btnSubmit.addEventListener('click', handleSubmit);

        if (btnLogout) btnLogout.addEventListener('click', window.logout);

        const btnOpenApproval = document.getElementById('btnOpenMemberApproval');
        const approvalModal = document.getElementById('memberApprovalModal');
        const btnCloseApproval1 = document.getElementById('btnCloseMemberApprovalModal');
        const btnCloseApproval2 = document.getElementById('btnCloseMemberApprovalModal2');
        const closeApprovalModal = () => {
            if (approvalModal) { approvalModal.style.display = 'none'; approvalModal.classList.remove('open'); }
        };
        if (btnOpenApproval) btnOpenApproval.addEventListener('click', window.openMemberApprovalModal);
        if (btnCloseApproval1) btnCloseApproval1.addEventListener('click', closeApprovalModal);
        if (btnCloseApproval2) btnCloseApproval2.addEventListener('click', closeApprovalModal);

        const btnPendingRecheck = document.getElementById('btnPendingRecheck');
        const btnPendingLogout = document.getElementById('btnPendingLogout');
        if (btnPendingRecheck) {
            btnPendingRecheck.addEventListener('click', async () => {
                if (!auth || !auth.currentUser) return;
                await handleAuthStateChange(auth.currentUser);
                if (window.state.role === 'pending') {
                    window.showToast('아직 승인되지 않았습니다. 잠시 후 다시 확인해 주세요.', 'info');
                }
            });
        }
        if (btnPendingLogout) btnPendingLogout.addEventListener('click', window.logout);

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
                const loginEmail = document.getElementById('authEmail')?.value;
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
                    window.showToast('이메일 주소를 입력해 주세요.', 'warning');
                    return;
                }

                if (typeof firebase !== 'undefined' && firebase.auth) {
                    firebase.auth().sendPasswordResetEmail(email)
                        .then(() => {
                            window.showToast(`'${email}' 주소로 비밀번호 재설정 이메일이 발송되었습니다. 메일함을 확인해 주세요.`, 'success', 4500);
                            closeResetModal();
                        })
                        .catch((err) => {
                            window.showToast(`메일 발송에 실패했습니다: ${err.message || err.code || '알 수 없는 오류'}`, 'error', 5000);
                        });
                } else {
                    window.showToast('인증 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.', 'error');
                }
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
        if (typeof setupNdtModalEvents === 'function') setupNdtModalEvents();
        if (typeof setupNdtDisplacementModalEvents === 'function') setupNdtDisplacementModalEvents();
        if (typeof setupStyleColorModalEvents === 'function') setupStyleColorModalEvents();
        if (typeof setupSurveyColumnModalEvents === 'function') setupSurveyColumnModalEvents();
        if (typeof setupTipShapeEvents === 'function') setupTipShapeEvents();
        showLoginOverlay();
    }

    init();
    window.addEventListener('resize', () => {
        resizeCanvas();
        if (typeof resizeNdtCanvas === 'function') resizeNdtCanvas();
    });
});
