/* 탭: 비파괴조사 — 부재실측, 강도, 탄산화, 기울기, 부동침하, 부재변위 */
window.BSA = window.BSA || { tabs: {}, shared: {} };

window.BSA.tabs['tab-ndt'] = {
    id: 'tab-ndt',
    title: '비파괴조사',
    features: [
        'NDT 전용 도면 / 층 도면 연동',
        '측정 위치 마킹',
        '부재 실측 · 콘크리트 강도 · 탄산화',
        '외벽 기울기 · 부동침하 · 부재변위',
        '측정 결과표 · NDT 엑셀'
    ],
    ownerHint: 'app.js NDT FIELD SURVEY ENGINE',
    enter: function () {
        setTimeout(function () {
            if (typeof window.setupNdtCanvas === 'function') window.setupNdtCanvas();
            if (typeof window.renderNdtSummaryTable === 'function') window.renderNdtSummaryTable();
        }, 50);
    }
};
