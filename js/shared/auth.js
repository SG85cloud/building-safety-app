/* 공통: Firebase 로그인·회사 승인제·실시간 동기화 */
window.BSA = window.BSA || { tabs: {}, shared: {} };

window.BSA.shared.auth = {
    title: '인증·동기화',
    features: [
        '이메일 로그인 / 회원가입 / 비밀번호 재설정',
        '회사 생성·가입코드·승인 대기',
        'Firestore 실시간 동기화',
        '오프라인 로컬(IndexedDB) 저장'
    ],
    ownerHint: 'app.js FIREBASE REALTIME SYNC ENGINE + js/core/state.js IndexedDB'
};
