# 협업 Git 동기화 규칙

이 프로젝트는 사용자와 회사 직원이 동시에 작업합니다. 사용자가 "동기화해줘" 또는
"sync"라고 요청하면 다음 순서를 자동으로 진행합니다:

## 표준 루틴 (원격 먼저 → 로컬 수정 재적용)

1. `git fetch origin` 후 `git log HEAD..origin/main`으로 **원격에만 있는 커밋** 확인
2. 로컬에 **미커밋 수정**이 있으면 `git stash push -u`로 임시 보관
3. `git pull origin main` — 직원이 push한 변경을 먼저 받음
4. stash가 있었으면 `git stash pop` — 내 수정을 pull 결과 위에 다시 적용
   - 충돌(conflict)이 나면 자동으로 풀지 말고, 충돌 파일/내용을 보여주고 사용자에게 물어봄
5. 변경 파일을 지정해서 `git add` (예: `app.js index.html styles.css js/`, `-A` 금지)
6. 의미 있는 메시지로 `git commit`
7. `git push origin main`

### PowerShell 스크립트

```powershell
.\scripts\git-sync.ps1 -Message "커밋 메시지"
.\scripts\git-sync.ps1 -Message "커밋 메시지" -NoPush   # push만 생략
```

## Cursor 에이전트 동작

- push 직전에 **커밋 요약 + 커밋 메시지**를 보여주고, 사용자가 push까지 명시했을 때만 push
- `git status`만 단독 요청이면 순수 상태 조회만 (동기화 절차 실행 안 함)
- 동기화를 원하면 "동기화해줘" / "sync" / "pull 후 push" 등으로 명시
