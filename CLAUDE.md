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
2. zip 생성 (이전 버전 보관): `zip -r releases/lp-player-v{VERSION}.zip manifest.json background.js content-script.js player/ popup/ icons/icon16.png icons/icon48.png icons/icon128.png -x "*.DS_Store"`
3. `releases/v{VERSION}.md` 릴리즈노트 작성 (배포 확정된 내용만)
4. 커밋 메시지: `release: v{VERSION}` (zip + 릴리즈노트 함께 커밋)
5. git 태그: `git tag v{VERSION}` — 릴리즈 커밋에 태그 부착
6. 배포 신청 후 아래 배포 이력 테이블 업데이트

릴리즈노트와 zip은 반드시 해당 버전에 포함된 변경사항만 반영한다. 이후 작업은 다음 버전에 포함.

### 릴리즈노트 작성법

`releases/v{VERSION}.md` 파일로 작성한다. 형식:

```markdown
# v{VERSION}

**Released: {YYYY-MM-DD}**

## New Features
- 새 기능 목록 (feat 커밋 기반)

## Bug Fixes
- 버그 수정 목록 (fix 커밋 기반)

## Improvements
- 개선사항 목록 (refactor, 성능, UI 개선 등)
```

- 이전 릴리즈 이후의 커밋을 기반으로 작성
- 섹션에 해당 내용이 없으면 섹션 자체를 생략
- 사용자 관점에서 간결하게 작성 (코드 내부 변경은 생략)

### 배포 이력

릴리즈 배포 신청 시 아래 테이블을 업데이트한다. 심사 통과/거절 시에도 상태 갱신.

| 버전 | 배포 신청일 | 상태 | 비고 |
|---|---|---|---|
| v1.0.0 | 2026-03-30 | 게시 완료 | 최초 등록 |
| v1.0.1 | 2026-03-30 | 심사 대기 중 | Wake Lock, 성능 개선, 프로그레스바 수정 |
| v1.1.0 | 2026-03-30 | 배포 준비 | 톤암 트래킹, 시간 추출 개선, 곡 변경 감지 개선 |
| v1.1.1 | 2026-03-30 | 배포 준비 | 트랙리스트 중복 수정 |

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
releases/              — 릴리즈 아카이브 (버전별 릴리즈노트 + zip)
```

## Chrome Web Store 정책 준수

코드 변경 시 Chrome Web Store 개발자 프로그램 정책을 위반하지 않아야 한다:
- 원격 코드 실행 금지 (모든 JS는 zip 안에 포함)
- 불필요한 권한 요청 금지 (최소 권한 원칙)
- 사용자 데이터 수집/전송 금지
- `_`로 시작하는 파일/폴더명 사용 금지

## Links

- Chrome Web Store: https://chromewebstore.google.com/detail/lp-player-for-youtube-mus/ldogpimidicimdbhdpedmibkbgegcloh
- GitHub: https://github.com/LazyerIJ/LP_player
- Ko-fi: https://ko-fi.com/lazyer96768

## Store Description

```
Turn YouTube Music into a beautiful vinyl record player. Watch the record spin, see album art on the label, and control playback with the tonearm — just like a real turntable.

How to use:
1. Play music on YouTube Music (music.youtube.com)
2. Click the LP Player extension icon
3. Click "Open LP Player" — enjoy!

Features:
- Vinyl record animation with album art
- Draggable tonearm to play/pause
- Previous/Next track with record swap animation
- Tonearm tracks playback progress across the record
- Tracklist panel to browse and switch songs
- 4 themes: Dark, Warm, Cafe, Minimal
- Fullscreen support
- Screen stays on during playback

What's new in v1.1.1:
- Previous/Next track buttons with vinyl record swap animation
- Tonearm follows playback progress from outer edge to inner groove
- Fixed duplicate tracks in tracklist
- LP Player resets to idle when YouTube Music is closed
```

## Next Release (v1.2.0 예정)

- (미정)
