# MVP 개발 계획 — Obsidian Gesture Control Plugin v0.1

> PRD 기준: Phase 0 (Spike) → Phase 1 (MVP Core v0.1)
> 목표: 제스처 3개로 Obsidian 명령 실행 가능한 플러그인

---

## 프로젝트 구조

```
obsidian-gesture-control/
├── src/
│   ├── main.ts                    # Plugin entry point
│   ├── types.ts                   # 공통 타입 정의
│   ├── camera/
│   │   ├── CameraManager.ts       # 네이티브 카메라 관리 (open + file polling)
│   │   └── native-camera.swift    # macOS AVFoundation 카메라 캡처
│   ├── tracking/
│   │   └── HandTracker.ts         # MediaPipe tasks-vision HandLandmarker
│   ├── gesture/
│   │   ├── GestureClassifier.ts   # 규칙 기반 제스처 분류 (Palm/Fist/ThumbUp)
│   │   └── GestureStabilizer.ts   # dwell/cooldown/연속프레임 안정화
│   ├── action/
│   │   └── ActionRouter.ts        # 제스처 → Obsidian Command 실행
│   └── ui/
│       ├── SettingsTab.ts         # 설정 탭 (매핑 UI)
│       └── StatusDisplay.ts       # 리본 아이콘 + 상태바 표시
├── GestureCamera.app/             # macOS 카메라 앱 번들 (TCC 권한용)
│   └── Contents/
│       ├── Info.plist             # NSCameraUsageDescription, LSUIElement
│       └── MacOS/GestureCamera    # 컴파일된 Swift 바이너리
├── styles.css                     # 플러그인 스타일
├── manifest.json                  # Obsidian 플러그인 매니페스트
├── package.json
├── tsconfig.json
├── esbuild.config.mjs             # 빌드 설정
├── .gitignore
└── README.md
```

---

## 개발 단계

### Step 1: 프로젝트 초기화 ✅
- [x] Obsidian 플러그인 보일러플레이트 세팅
- [x] package.json (obsidian, @mediapipe/tasks-vision, esbuild 등)
- [x] tsconfig.json, esbuild.config.mjs
- [x] manifest.json (id, name, version, minAppVersion)
- [x] .gitignore
- [x] 기본 main.ts (Plugin 클래스 껍데기)

### Step 2: 카메라 제어 (F1) ✅
- [x] CameraManager.ts — **네이티브 Swift AVFoundation** (Electron getUserMedia 불가)
  - start(): GestureCamera.app 실행, 파일 기반 프레임 수신
  - stop(): 네이티브 프로세스 종료, 리소스 해제
  - 에러 처리: 권한 거부, 장치 없음
- [x] 리본 아이콘(hand)으로 On/Off 토글
- [x] 커맨드 등록: "Toggle Gesture Camera"
- [x] 상태바 아이템: 카메라 상태 표시
- **핵심 결정**: Electron 39/Chrome 142에서 getUserMedia 비디오 프레임 전달 불가
  → Swift AVFoundation으로 JPEG 캡처 → /tmp 파일 → 플러그인 폴링 방식 채택

### Step 3: 손 추적 — MediaPipe Hands (F2) ✅
- [x] HandTracker.ts — @mediapipe/tasks-vision HandLandmarker 사용
  - WASM: 로컬 파일(blob URL), 모델: CDN 다운로드
  - 프레임 → 랜드마크 21개 추출
  - FPS 제한 (15fps, requestAnimationFrame 기반)
- [x] 캡처 캔버스 + 오버레이 캔버스로 미리보기/랜드마크 표시
- [x] 손 감지/손실 콜백 (onHandDetected, onHandLost)

### Step 4: 제스처 분류 (F3)
- [ ] GestureClassifier.ts — 랜드마크 → 제스처 분류
  - Open Palm: 모든 손가락 펴짐
  - Fist: 모든 손가락 접힘
  - Thumb Up: 엄지만 펴짐, 나머지 접힘
  - 각 제스처 confidence 점수 산출
- [ ] GestureStabilizer.ts — 안정화
  - dwell: N ms 동안 유지해야 발동
  - cooldown: 발동 후 N ms 동안 재발동 차단
  - 연속 프레임 카운트 (최소 N 프레임)

### Step 5: 액션 라우터 (F4 일부)
- [ ] ActionRouter.ts — 안정화된 제스처 → Obsidian 커맨드 실행
  - app.commands.executeCommandById(commandId)
  - 매핑 데이터는 설정에서 로드
  - 실행 시 상태바/토스트로 피드백

### Step 6: 설정 UI (F4)
- [ ] SettingsTab.ts — Obsidian PluginSettingTab 구현
  - 제스처별 섹션:
    - 활성화 토글
    - 명령 선택 (드롭다운 + 검색)
    - dwell(ms) 슬라이더
    - cooldown(ms) 슬라이더
    - confidence 임계치 슬라이더
  - 글로벌 설정:
    - 카메라 해상도 (640x480 / 320x240)
    - FPS (5 / 10 / 15)
  - Advanced 섹션 (접히는 형태)

### Step 7: 상태 표시 (F1 + UX)
- [ ] StatusDisplay.ts
  - 리본 아이콘 상태 변화 (OFF → ON → 손감지 → 제스처 실행)
  - 상태바 텍스트: "Gesture: OFF" / "Gesture: Ready" / "✋ Palm → Toggle sidebar"
  - 실행 시 짧은 Notice (Obsidian 빌트인)

### Step 8: 통합 + 에러 핸들링
- [ ] main.ts에서 전체 파이프라인 조립
- [ ] 라이프사이클: onload → 초기화, onunload → 정리
- [ ] 에러 시나리오 처리:
  - 카메라 권한 거부 → 안내 메시지
  - MediaPipe 로딩 실패 → 재시도/안내
  - Obsidian 커맨드 실행 실패 → 무시 + 로그

### Step 9: README + 프라이버시 문구
- [ ] README.md: 설치법, 사용법, 지원 제스처, FAQ
- [ ] 프라이버시 섹션: "모든 처리는 로컬, 영상 저장/전송 없음"

---

## 기술 결정 사항

### 카메라 캡처 방식 (Step 2에서 결정)
- **문제**: Electron 39 / Chrome 142에서 getUserMedia가 스트림은 반환하지만
  비디오 프레임을 전혀 전달하지 않음 (MediaStreamTrackProcessor, ImageCapture,
  video.srcObject, MediaRecorder, MSE 모두 실패)
- **해결**: macOS 네이티브 Swift + AVFoundation으로 카메라 캡처
  - `native-camera.swift` → `GestureCamera.app` 번들로 패키징
  - `open -n -a GestureCamera.app`으로 Launch Services 통해 실행 (TCC 카메라 권한)
  - JPEG 프레임을 `/tmp/gesture-control-frame.jpg`에 atomic write
  - 플러그인에서 `setInterval` + `readFileSync` + mtime 체크로 폴링
  - IPC: status file (`/tmp/gesture-control-status`), PID file (`/tmp/gesture-control-pid`)
- **제한**: macOS only (네이티브 바이너리). Windows/Linux는 추후 별도 구현 필요

### MediaPipe 로딩 전략
- **라이브러리**: `@mediapipe/tasks-vision` (신규 API, `@mediapipe/hands`는 deprecated)
- **WASM**: 로컬 파일 → blob URL로 로딩 (오프라인 동작)
- **모델**: CDN에서 hand_landmarker.task 다운로드 (초회만)
- **Delegate**: CPU (WebGL은 Electron 호환 이슈 가능)

### 제스처 분류 방식
- 규칙 기반 (랜드마크 좌표의 기하학적 관계)
- ML 기반은 Later (TFLite 등)
- 이유: 3개 제스처는 규칙으로 충분하고, 디버깅/튜닝이 쉬움

### 기본값
| 설정 | 기본값 |
|------|--------|
| dwell | 400ms |
| cooldown | 1000ms |
| confidence threshold | 0.7 |
| FPS | 15 |
| 해상도 | 640x480 |
| 최소 연속 프레임 | 3 |

---

## 기본 제스처 매핑 (초기 설정)

| 제스처 | 기본 매핑 | 설명 |
|--------|-----------|------|
| Open Palm ✋ | `app:toggle-left-sidebar` | 사이드바 토글 |
| Thumb Up 👍 | `command-palette:open` | 커맨드 팔레트 열기 |
| Fist ✊ | `app:go-back` | 뒤로가기 (ESC 대용) |

---

## 의존성

```json
{
  "devDependencies": {
    "@types/node": "^16.x",
    "typescript": "^5.x",
    "esbuild": "^0.x",
    "obsidian": "latest",
    "tslib": "^2.x"
  },
  "dependencies": {
    "@mediapipe/tasks-vision": "^0.10.x"
  }
}
```

### 플러그인 배포 시 포함 파일
- `main.js` (빌드 결과)
- `manifest.json`
- `GestureCamera.app/` (macOS 카메라 앱 번들)
- `wasm/vision_wasm_internal.js`, `wasm/vision_wasm_internal.wasm`

---

## 리스크 & 완화

| 리스크 | 완화 | 상태 |
|--------|------|------|
| Electron에서 getUserMedia 비디오 프레임 안 됨 | 네이티브 Swift AVFoundation으로 해결 | ✅ 해결 |
| macOS TCC 카메라 권한 다이얼로그 안 뜸 | .app 번들 + `open -a` 으로 Launch Services 통해 실행 | ✅ 해결 |
| MediaPipe WASM이 Electron에서 안 될 수 있음 | blob URL로 로컬 로딩 + CPU delegate | ✅ 검증 완료 |
| macOS only (네이티브 바이너리) | Windows/Linux는 추후 별도 카메라 캡처 구현 필요 | ⚠️ 인지 |
| Obsidian 업데이트 시 API 변경 | minAppVersion 명시, API 변경 모니터링 | - |
