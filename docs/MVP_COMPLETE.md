# MVP v0.1 완료 보고서

> 완료일: 2026-02-22

## 구현 완료 항목

### Step 1: 프로젝트 초기화
- Obsidian 플러그인 보일러플레이트 (package.json, tsconfig, esbuild, manifest.json)

### Step 2: 카메라 제어
- `CameraManager.ts` — macOS 네이티브 Swift AVFoundation 카메라
- `native-camera.swift` → `GestureCamera.app` 번들
- `open -n -a` 방식으로 TCC 카메라 권한 획득
- JPEG 파일 기반 IPC (frame, status, PID)
- 프리뷰 캔버스 + 오버레이 캔버스 (우하단 320x240)

### Step 3: 손 추적
- `HandTracker.ts` — @mediapipe/tasks-vision HandLandmarker
- WASM 로컬 파일 (blob URL), 모델 CDN 다운로드
- 21개 랜드마크 추출, 15fps 제한
- 손 감지/손실 콜백

### Step 4: 제스처 분류
- `GestureClassifier.ts` — 규칙 기반 분류
  - Open Palm: 모든 손가락 펴짐
  - Fist: 모든 손가락 접힘
  - Thumb Up: 엄지만 펴짐
  - 각 제스처 confidence 점수 산출
- `GestureStabilizer.ts` — 안정화
  - dwell: N ms 유지 후 발동 (기본 400ms)
  - cooldown: 발동 후 재발동 차단 (기본 1000ms)
  - 최소 연속 프레임 (기본 3프레임)
  - **release lock**: 발동 후 손을 뗐다가 다시 해야 재발동 (토글 반복 방지)

### Step 5: 액션 라우터
- `ActionRouter.ts` — 안정화된 제스처 → Obsidian 커맨드 실행
  - `app.commands.executeCommandById()`
  - 실행 시 Notice 토스트 피드백 ("Palm → Toggle left sidebar")

### Step 6: 설정 UI
- `SettingsTab.ts` — Obsidian PluginSettingTab
  - 제스처별: 활성화 토글 + FuzzySuggestModal 커맨드 검색
  - 글로벌: confidence/dwell/cooldown 슬라이더
  - 설정 변경 시 즉시 런타임 반영

### Step 7: 상태 표시
- `StatusDisplay.ts` — 리본 아이콘 + 상태바 전담 모듈
  - 리본 아이콘 CSS 상태: off(흐림) → ready(accent) → hand(초록) → fired(노랑)
  - 상태바: "Gesture: OFF" → "Ready" → "Hand detected" → "✋ palm → Toggle left sidebar"
  - 발동 후 2초 뒤 자동 복귀

### Step 8: 통합 + 에러 핸들링
- 에러별 사용자 친화적 메시지 (카메라 권한, 타임아웃, 모델 로딩, 앱 번들 누락)
- `stopPipeline()` 통합 정리 (토글 OFF / 에러 / unload 동일 경로)
- `HandTracker` 중복 init 방어, `onunload`에서 `destroy()` 호출

### Step 9: README
- 설치법, 사용법, 지원 제스처, 설정, 프라이버시, 트러블슈팅

---

## 전체 파이프라인

```
Camera(Swift AVFoundation)
  → /tmp/gesture-control-frame.jpg
  → CameraManager (file polling)
  → HandTracker (MediaPipe HandLandmarker, numHands=2)
  → GestureClassifier (rule-based)
  → [분기]
    → 양손 Pointing → ContinuousGestureProcessor → ContinuousActionDispatcher
    → 이산 제스처 → GestureStabilizer → ActionRouter
      → gesture: 접두사 → SystemActionHandler (메뉴클릭/osascript)
      → Obsidian 커맨드 → app.commands.executeCommandById()
  → StatusDisplay (ribbon icon + status bar + Notice)
```

## 파일 구조

```
src/
├── main.ts                               # Plugin entry, 파이프라인 조립
├── types.ts                              # GestureType, Settings, CUSTOM_ACTIONS
├── camera/
│   └── CameraManager.ts                  # 네이티브 카메라 관리
├── tracking/
│   └── HandTracker.ts                    # MediaPipe 손 추적
├── gesture/
│   ├── GestureClassifier.ts              # 랜드마크 → 제스처 분류
│   ├── GestureStabilizer.ts              # dwell/cooldown/release lock
│   └── ContinuousGestureProcessor.ts     # 양손 줌 + 한손 커서 + 클릭/드래그
├── action/
│   ├── ActionRouter.ts                   # 제스처 → 커맨드/커스텀 액션 실행
│   ├── ContinuousActionDispatcher.ts     # 연속 제스처 → DOM/Electron 이벤트
│   └── SystemActionHandler.ts            # macOS 시스템 액션 (마이크 토글 등)
└── ui/
    ├── SettingsTab.ts                    # 설정 탭 (커스텀 액션 포함)
    └── StatusDisplay.ts                  # 리본/상태바 표시
```

## 기본 제스처 매핑

| 제스처 | 커맨드 | 설명 |
|--------|--------|------|
| Open Palm | `app:toggle-left-sidebar` | 사이드바 토글 |
| Fist | `app:go-back` | 뒤로가기 |
| Thumb Up | `command-palette:open` | 커맨드 팔레트 |

## 배포 파일

- `main.js` — 빌드 결과
- `manifest.json` — 플러그인 메타데이터
- `styles.css` — 리본 아이콘 상태 스타일
- `GestureCamera.app/` — macOS 카메라 앱 번들
- `wasm/` — MediaPipe WASM 파일

---

## Phase 2: 연속 제스처 (완료)

> 상세 문서: `docs/PHASE2_COMPLETE.md`

- **양손 Pointing → 줌**: 양 검지 거리 변화 → Ctrl+Wheel 줌
- **한 손 → 커서 제어**: 검지로 화면 커서 이동
- **엄지 → 클릭/드래그**: 빠르게 = 클릭, 오래 = 드래그
- **새 파일**: `ContinuousGestureProcessor.ts`, `ContinuousActionDispatcher.ts`
- **설정 추가**: 연속 제스처 활성화, 스무딩, 줌 감도

## Phase 3: 커스텀 액션 + 받아쓰기/마이크 (완료)

> 상세 문서: `docs/PHASE3_COMPLETE.md`

- **커스텀 액션 시스템**: `gesture:` 접두사로 시스템 레벨 동작 지원
- **받아쓰기 토글**: System Events로 Edit 메뉴 클릭(시작) / Escape(정지)
- **마이크 제어**: osascript로 macOS 입력 볼륨 제어 (토글/뮤트/언뮤트)
- **자동 설정**: Accessibility 권한 안내 + Dictation 자동 활성화 + 플랫폼 체크
- **설정 UI**: 커맨드 선택 모달에 시스템 액션 섹션 추가
- **새 파일**: `SystemActionHandler.ts`

---

## 다음 단계 후보

- **추가 제스처**: Peace sign, OK sign 등
- **추가 시스템 액션**: 스크린샷, 미디어 재생 제어 등
- **Pro 라이선스**: 라이선스 키 + 추가 패키지 (A 방식)
- **Windows/Linux**: 플랫폼별 카메라 캡처 구현
