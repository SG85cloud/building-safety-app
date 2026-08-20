/* ==========================================================================
   탭 레지스트리 — 화면 전환·헤더 크롬만 담당
   각 탭 기능 목록과 enter() 는 js/tabs/{home|map|survey|ndt}.js
   공통 보고서/로그인: js/shared/report.js, js/shared/auth.js
   기존 구현 본체는 당분간 app.js (DOMContentLoaded) 에 그대로 둡니다.
   ========================================================================== */

window.BSA = window.BSA || { tabs: {}, shared: {} };

window.BSA.applyTabChrome = function (tabId) {
    const isHome = tabId === 'tab-home';
    const headerSelectorGroup = document.getElementById('headerSelectorGroup');
    const headerReportActions = document.getElementById('headerReportActions');
    const navBuildingTabs = document.getElementById('navBuildingTabs');
    const appTitle = document.getElementById('navBuildingName');

    if (headerSelectorGroup) headerSelectorGroup.style.display = isHome ? 'none' : 'flex';
    if (headerReportActions) headerReportActions.style.display = isHome ? 'none' : 'flex';
    if (navBuildingTabs) navBuildingTabs.style.display = isHome ? 'none' : 'flex';
    if (appTitle) appTitle.style.display = isHome ? 'none' : 'inline-flex';
};

window.BSA.enterTab = function (tabId) {
    const tab = window.BSA.tabs[tabId];
    if (tab && typeof tab.enter === 'function') tab.enter();
};
