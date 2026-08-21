/* 탭: 결함위치도 — 도면 캔버스, 핀/영역 마킹, 스타일·범례 */
window.BSA = window.BSA || { tabs: {}, shared: {} };

window.BSA.tabs['tab-map'] = {
    id: 'tab-map',
    title: '결함위치도 작성',
    features: [
        '도면 PAN/ZOOM/회전',
        '핀 마킹 / 영역 마킹',
        'Ctrl+드래그·클릭 추가/해제 다중 선택 · 그룹 이동 · 선택 삭제',
        '벡터 PDF 내보내기 (원본 PDF + 마킹 벡터)',
        '결함 상세 모달 (부재·종류·크기·사진)',
        '부재 명칭 대·중·소분류 탭 선택 (모바일 입력 최소화)',
        '탭 전환 시 결함/NDT 드로어 자동 닫기',
        '모바일 우측 레일(핀·영역·드래그·추가) + 하단 액션 바',
        '모바일 현장: 좌 1/3 결함목록 · 우 도면 · 상단 소형 탭/층 툴바',
        '모바일: 전차 미등록·PC 등록도구 숨김',
        '모바일: 길게 눌러 이동 · 드래그 중 돋보기',
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
        // 세로/가로 전환·플렉스 높이 확정 후 한 번 더 맞춤 (380px 잘림·회색 여백 방지)
        setTimeout(function () {
            if (typeof window.resizeCanvas === 'function') window.resizeCanvas();
            if (typeof window.fitToScreen === 'function') window.fitToScreen();
            if (typeof window.drawCanvas === 'function') window.drawCanvas();
        }, 220);
    }
};
