/* 탭: 상태조사표 — 표/앨범/통계, 엑셀·한글 내보내기, 외부 엑셀 가져오기 */
window.BSA = window.BSA || { tabs: {}, shared: {} };

/**
 * overflow-y:hidden + touch-action:pan-x 인 표에서 세로 제스처를
 * .app-content로 넘긴다. (조사표는 표 자체가 상하·좌우 스크롤이므로 제외)
 */
window.BSA.shared.bindHScrollVerticalPassthrough = function (selector) {
    const nodes = typeof selector === 'string'
        ? document.querySelectorAll(selector)
        : (selector && selector.length !== undefined ? selector : [selector]);
    Array.prototype.forEach.call(nodes, function (el) {
        if (!el || el.dataset.hScrollPass === '1') return;
        el.dataset.hScrollPass = '1';

        let startX = 0;
        let startY = 0;
        let lastY = 0;
        let axis = null; // null | 'v' | 'h' | 'multi'

        el.addEventListener('touchstart', function (e) {
            if (e.touches.length !== 1) {
                axis = 'multi';
                return;
            }
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            lastY = startY;
            axis = null;
        }, { passive: true });

        el.addEventListener('touchmove', function (e) {
            if (axis === 'multi' || e.touches.length !== 1) return;
            const x = e.touches[0].clientX;
            const y = e.touches[0].clientY;
            const dx = x - startX;
            const dy = y - startY;

            if (!axis) {
                if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                axis = Math.abs(dy) >= Math.abs(dx) ? 'v' : 'h';
            }

            if (axis === 'v') {
                e.preventDefault();
                const scroller = document.querySelector('.app-content');
                if (scroller) scroller.scrollTop -= (y - lastY);
            }
            lastY = y;
        }, { passive: false });

        el.addEventListener('touchend', function () { axis = null; }, { passive: true });
        el.addEventListener('touchcancel', function () { axis = null; }, { passive: true });
    });
};

window.BSA.shared.bindSurveyNdtTableScrollPassthrough = function () {
    const bind = window.BSA.shared.bindHScrollVerticalPassthrough;
    if (typeof bind !== 'function') return;
    // 조사표(.table-container)는 CSS로 2축 스크롤 — 여기선 비파괴 결과표만
    bind('#tab-ndt .table-responsive, #tab-ndt .table-container');
};

window.BSA.tabs['tab-survey'] = {
    id: 'tab-survey',
    title: '상태조사표',
    features: [
        '층별 상태조사표 렌더',
        '현장 사진 앨범',
        '손상 유형 통계 차트',
        '표 컬럼 설정 (정밀/제3종)',
        '엑셀 저장 · 외부 엑셀 가져오기',
        '결함 직접 등록 / 행 인라인 수정',
        '모바일: 조사목록 영역 상하·좌우 스크롤 (헤더 sticky)'
    ],
    ownerHint: 'app.js SURVEY TABLE & ALBUM + Excel 엔진',
    enter: function () {
        if (typeof window.renderSurveyTable === 'function') window.renderSurveyTable();
        setTimeout(function () {
            if (typeof window.renderSurveyTable === 'function') window.renderSurveyTable();
        }, 120);
    }
};

document.addEventListener('DOMContentLoaded', function () {
    if (typeof window.BSA.shared.bindSurveyNdtTableScrollPassthrough === 'function') {
        window.BSA.shared.bindSurveyNdtTableScrollPassthrough();
    }
});
