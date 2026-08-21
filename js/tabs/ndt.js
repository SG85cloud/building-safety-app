/* 탭: 비파괴조사 — 부재실측, 강도, 탄산화, 기울기, 부동침하, 부재변위 */
window.BSA = window.BSA || { tabs: {}, shared: {} };

window.BSA.tabs['tab-ndt'] = {
    id: 'tab-ndt',
    title: '비파괴조사',
    features: [
        'NDT 전용 도면 / 층 도면 연동',
        '측정 위치 마킹 (결함위치도와 동일 핀·지시선 스타일)',
        '좌클릭 마퀴 선택 · Ctrl+드래그 추가선택 · 휠클릭 화면이동 · 선택 삭제',
        '조사 항목별 핀·화살표·연결선 크기 설정',
        '부재 실측 · 콘크리트 강도 · 탄산화',
        '외벽 기울기 · 부동침하 · 부재변위',
        '모바일 하단 독: 마킹·크기 토글 시트',
        '측정 결과표 · NDT 엑셀 · 벡터 PDF',
        '모바일: 결과표 횡스크롤 영역에서도 세로 페이지 스크롤'
    ],
    ownerHint: 'app.js NDT FIELD SURVEY ENGINE',
    enter: function () {
        if (typeof window.BSA.shared.bindSurveyNdtTableScrollPassthrough === 'function') {
            window.BSA.shared.bindSurveyNdtTableScrollPassthrough();
        }
        setTimeout(function () {
            if (typeof window.setupNdtCanvas === 'function') window.setupNdtCanvas();
            if (typeof window.resizeNdtCanvas === 'function') window.resizeNdtCanvas();
            if (typeof window.renderNdtSummaryTable === 'function') window.renderNdtSummaryTable();
            if (typeof window.syncBulkStyleSlidersUi === 'function') window.syncBulkStyleSlidersUi();
            if (typeof window.BSA.shared.bindSurveyNdtTableScrollPassthrough === 'function') {
                window.BSA.shared.bindSurveyNdtTableScrollPassthrough();
            }
        }, 50);
        setTimeout(function () {
            if (typeof window.resizeNdtCanvas === 'function') window.resizeNdtCanvas();
            if (typeof window.fitNdtCanvas === 'function') window.fitNdtCanvas();
        }, 220);
    }
};
