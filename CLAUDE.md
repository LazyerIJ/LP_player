# LP Player for YouTube Music — Chrome Extension

## Commit Convention

Conventional Commits 형식을 따른다.

```
<type>: <description>
```

### Types
- `feat`: 새 기능 추가
- `fix`: 버그 수정
- `chore`: 설정, 빌드, .gitignore 등 비기능 변경
- `release`: 버전 업 (manifest.json version 변경 시)
- `refactor`: 기능 변경 없는 코드 개선
- `docs`: 문서 변경

### Release 워크플로우

버전 업 & 배포용 zip 생성 시 반드시 아래 순서를 따른다:

1. `manifest.json`의 `version` 필드 업데이트 (semver)
2. zip 생성: `zip -r lp-player-v{VERSION}.zip manifest.json background.js content-script.js player/ popup/ icons/icon16.png icons/icon48.png icons/icon128.png -x "*.DS_Store"`
3. 커밋 메시지: `release: v{VERSION}`

### 버전 규칙 (semver)
- 버그 수정: patch (1.0.0 → 1.0.1)
- 기능 추가: minor (1.0.1 → 1.1.0)
- 대규모 변경: major (1.1.0 → 2.0.0)

## Project Structure

```
manifest.json          — Chrome extension manifest (v3)
background.js          — Service worker: 메시지 릴레이
content-script.js      — YouTube Music DOM에서 재생 상태/큐 추출
player/                — LP 시각화 페이지
  player.html
  player.js
  player.css
  themes.css
popup/                 — 확장프로그램 팝업
  popup.html
  popup.js
icons/                 — 확장프로그램 아이콘
```

## Ko-fi
https://ko-fi.com/lazyer96768
