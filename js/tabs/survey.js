/* 탭: 상태조사표 — 표/앨범/통계, 엑셀·한글 내보내기, 외부 엑셀 가져오기 */
window.BSA = window.BSA || { tabs: {}, shared: {} };

window.BSA.tabs['tab-survey'] = {
    id: 'tab-survey',
    title: '상태조사표',
    features: [
        '층별 상태조사표 렌더',
        '현장 사진 앨범',
        '손상 유형 통계 차트',
        '표 컬럼 설정 (정밀/제3종)',
        '엑셀 저장 · 외부 엑셀 가져오기',
        '결함 직접 등록 / 행 클릭 수정'
    ],
    ownerHint: 'app.js SURVEY TABLE & ALBUM + Excel 엔진',
    enter: function () {
        if (typeof window.renderSurveyTable === 'function') window.renderSurveyTable();
    }
};
