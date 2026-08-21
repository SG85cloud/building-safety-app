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
        areaFillStyle: 'solid',   // 'solid' | 'hatch' | 'none' — 영역 마킹 채우기
        areaBorderStyle: 'solid', // 'solid' | 'dashed' — 영역 마킹 테두리
        styleColors: null, // 카테고리별 사용자 지정 색상 (미지정 시 DEFAULT_STYLE_COLORS 사용)
        styleSizes: null,  // 카테고리별 사용자 지정 핀/화살표 크기 (미지정 시 DEFAULT_STYLE_SIZES 사용)
        defectLeaderLineScale: 1.0, // 결함위치도: 박스↔화살표 연결선 두께 배율 (박스 테두리 기준)
        floorMapStyleSettings: null, // { 'bldgId_1F': { styleSizes, defectLeaderLineScale } } 층별 핀/화살표/연결선
        styleShapes: null, // 카테고리별 사용자 지정 박스 모양/채우기/번호형식 (미지정 시 DEFAULT_STYLE_SHAPES 사용)
        surveyColumns: null, // 상태조사표 컬럼 순서/이름 커스터마이징 (미지정 시 DEFAULT_SURVEY_COLUMNS 사용)
        surveyColumnsGrade3: null, // 제3종시설물용 상태조사표 컬럼 커스터마이징 (미지정 시 GRADE3_SURVEY_COLUMNS 사용)
        locationMapLegend: null, // 결함위치도 범례 항목 커스터마이징 (미지정 시 스타일 설정 색상 기반 기본 범례 사용)
        locationMapLegendBox: null, // 결함위치도 범례 박스 위치/크기 커스터마이징 {x, y, scale} - x/y는 결함 핀과 동일한 도면 원본 픽셀 좌표(미지정 시 좌하단 기본 위치·크기 사용)
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

// --- 1B. LOCAL IMAGE STORE (IndexedDB) ---
// localStorage는 브라우저당 보통 5~10MB로 용량이 작아서, 도면 사진·결함 사진(base64)을
// 계속 쌓다 보면 압축을 해도 금방 꽉 찬다 ("저장 공간이 가득 찼습니다" 에러의 원인).
// IndexedDB는 보통 수백MB~수GB까지 쓸 수 있으므로, 무거운 이미지 데이터는 여기로 옮기고
// localStorage에는 가벼운 텍스트 데이터만 남긴다.
const LOCAL_IMAGE_DB_NAME = 'building_safety_local_images';
const LOCAL_IMAGE_DB_VERSION = 2; // v2: floorDrawingPdfs (벡터 PDF 원본 보관)
let _localImageDbPromise = null;

function openLocalImageDb() {
    if (_localImageDbPromise) return _localImageDbPromise;
    _localImageDbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.')); return; }
        const req = indexedDB.open(LOCAL_IMAGE_DB_NAME, LOCAL_IMAGE_DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('floorDrawings')) db.createObjectStore('floorDrawings');
            if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
            if (!db.objectStoreNames.contains('floorDrawingPdfs')) db.createObjectStore('floorDrawingPdfs');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return _localImageDbPromise;
}

async function idbSet(storeName, key, value) {
    try {
        const db = await openLocalImageDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(value, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn(`IndexedDB 저장 실패 (${storeName}/${key}):`, e);
        return false;
    }
}

async function idbGet(storeName, key) {
    try {
        const db = await openLocalImageDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.warn(`IndexedDB 조회 실패 (${storeName}/${key}):`, e);
        return null;
    }
}

async function idbDelete(storeName, key) {
    try {
        const db = await openLocalImageDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete(key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn(`IndexedDB 삭제 실패 (${storeName}/${key}):`, e);
        return false;
    }
}

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
window.compressDrawingImage = function(file, maxDim = 2200, quality = 0.88) {
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

// 옥상 / 옥탑 / 옥탑 지붕 — 파일명이 다르면 서로 다른 층으로 인식 (같은 ROOF로 합치지 않음)
window.ROOF_FLOOR_DEFS = [
    { code: 'PH_ROOF', label: '옥탑 지붕층 (PH_ROOF)', rank: 9992 },
    { code: 'PH', label: '옥탑층 (PH)', rank: 9991 },
    { code: 'ROOF', label: '옥상층 (ROOF)', rank: 9990 }
];

window.resolveRoofFloorFromText = function(rawText) {
    const raw = String(rawText || '');
    const c = raw.toUpperCase().trim();
    // 1) 가장 구체적: 옥탑 지붕층
    if (
        c === 'PH_ROOF' ||
        c.includes('PH_ROOF') ||
        (raw.includes('옥탑') && raw.includes('지붕')) ||
        raw.includes('옥탑지붕') ||
        /PH[\s_-]*ROOF|ROOF[\s_-]*PH/.test(c)
    ) {
        return window.ROOF_FLOOR_DEFS[0];
    }
    // 2) 옥탑층 (옥상과 분리)
    if (
        c === 'PH' ||
        raw.includes('옥탑') ||
        c.includes('PENTHOUSE') ||
        /(^|[^A-Z0-9])PH([^A-Z0-9]|$)/.test(c)
    ) {
        return window.ROOF_FLOOR_DEFS[1];
    }
    // 3) 옥상층
    if (c === 'ROOF' || raw.includes('옥상') || c.includes('ROOF')) {
        return window.ROOF_FLOOR_DEFS[2];
    }
    return null;
};

/**
 * Intelligent Floor Parser from File Names (e.g. B2.jpg -> 지하 2층)
 */
window.parseFloorInfoFromFilename = function(fileName) {
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
    const cleanName = nameWithoutExt.toUpperCase();

    // 옥상층 / 옥탑층 / 옥탑 지붕층은 파일명에 따라 각각 다른 층으로 인식
    const roofInfo = window.resolveRoofFloorFromText(nameWithoutExt);
    if (roofInfo) {
        return { rank: roofInfo.rank, floorCode: roofInfo.code, floorLabel: roofInfo.label, matched: true };
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
    list.push('PH');
    list.push('PH_ROOF');
    list.push('EXT');
    window.EXT_DIRECTION_DEFS.forEach(d => list.push(d.code));
    return list;
})();

window.getFloorRankFromCode = function(code) {
    if (!code) return 0;
    const raw = String(code).trim();
    const c = raw.toUpperCase();
    if (c.includes('EXT') || raw.includes('외부')) return 10000;
    const roofInfo = window.resolveRoofFloorFromText(raw);
    if (roofInfo) return roofInfo.rank;
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

