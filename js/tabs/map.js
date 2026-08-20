/* 탭: 결함위치도 — 도면 캔버스, 핀/영역 마킹, 스타일·범례 */
window.BSA = window.BSA || { tabs: {}, shared: {} };

window.BSA.tabs['tab-map'] = {
    id: 'tab-map',
    title: '결함위치도 작성',
    features: [
        '도면 PAN/ZOOM/회전',
        '핀 마킹 / 영역 마킹',
        '결함 상세 모달 (부재·종류·크기·사진)',
        '되돌리기·다시실행',
        '스타일(색/크기/모양) · 위치도 범례',
        '점검 차수·부재분류·손상유형 필터'
    ],
    ownerHint: 'app.js DRAWING CANVAS ENGINE + 결함 모달',
    enter: function () {
        setTimeout(function () {
            if (typeof window.resizeCanvas === 'function') window.resizeCanvas();
            if (typeof window.fitToScreen === 'function') window.fitToScreen();
            if (typeof window.drawCanvas === 'function') window.drawCanvas();
        }, 50);
    }
};
