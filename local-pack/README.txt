스마트 건축물 안전점검 — 로컬 실행 패키지
============================================

앱 소스(app.js, index.html 등)는 수정하지 않고, 이 폴더만으로 로컬 HTTP 서버를 띄웁니다.
(PWA·Service Worker·Firebase는 file:// 이 아니라 http://localhost 가 필요합니다.)

실행 방법
---------
1) Windows: local-pack\start.bat 더블클릭
2) PowerShell:
   cd local-pack
   powershell -ExecutionPolicy Bypass -File .\start.ps1

브라우저가 자동으로 http://127.0.0.1:8000/ 을 엽니다.
8000번 포트가 사용 중이면 8001, 8002 … 순으로 빈 포트를 찾습니다.

종료
----
서버 창에서 Ctrl+C

구성
----
start.bat   — 더블클릭 실행
start.ps1   — PowerShell 진입점
serve.ps1   — 정적 파일 서버 (상위 폴더 = 앱 루트)

주의
----
- 인터넷 연결 필요: CDN(FontAwesome, Firebase, pdf.js 등)
- Firebase 로그인/동기화는 그대로 동작 (localhost 허용)
