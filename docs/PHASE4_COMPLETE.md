# Phase 4 완료 보고서: Camera Preview UI 개선

> 완료일: 2026-02-22

## 구현 내용 요약

### 1. Skeleton 모드 (기본)
- 카메라 영상 대신 검은 배경 + hand landmark 뼈대만 표시
- previewCanvas를 숨기고 overlayCanvas만 렌더링
- 카메라 모드로 전환하면 실시간 영상 + 뼈대 오버레이

### 2. 드래그 이동
- 상단 툴바(hover 시 표시)를 마우스로 끌어서 미리보기 위치 변경
- right/bottom 기반에서 left/top 기반으로 자동 전환
- 위치 자동 저장 → 재시작 후 유지

### 3. 크기 변경
- 우하단 리사이즈 핸들로 미리보기 크기 조절
- 4:3 비율 유지, 160~480px 범위 제한
- overlayCanvas도 컨테이너 크기에 맞춰 동적 리사이즈

### 4. 숨기기/보이기
- 툴바 X 버튼 또는 `Toggle Camera Preview` 커맨드로 토글
- hidden 상태에서도 captureCanvas + MediaPipe 계속 동작 (제스처 인식 유지)

### 5. 설정 연동
- Settings에서 Display mode / Preview size / Reset position 설정
- 모든 변경사항 즉시 반영 + 자동 저장

### 6. gestureMappings 병합 수정
- 기존 저장된 데이터에 없는 제스처를 DEFAULT에서 자동 보충
- 3개만 저장되어 있던 기존 사용자도 8개 전체 제스처 표시

## 아키텍처

### 컨테이너 구조

```
container (.gesture-control-preview)
├── toolbar (.gesture-preview-toolbar) — hover 시 표시
│   ├── mode toggle button (📷 ↔ 💀)
│   └── hide button (✕)
├── previewCanvas (.gesture-preview-canvas) — skeleton 모드에서 hidden
├── overlayCanvas (.gesture-preview-overlay) — 항상 표시
└── resize handle (.gesture-preview-resize) — 우하단 모서리
```

### 모드별 동작

| 모드 | previewCanvas | overlayCanvas | captureCanvas | MediaPipe |
|------|--------------|---------------|---------------|-----------|
| camera | visible, 프레임 렌더링 | visible | 항상 동작 | 항상 동작 |
| skeleton | hidden | visible (검은 배경) | 항상 동작 | 항상 동작 |
| hidden | container 숨김 | container 숨김 | 항상 동작 | 항상 동작 |

### 설정 흐름

```
Settings UI / 드래그 / 리사이즈
  → CameraManager 내부 상태 업데이트
  → onSettingsChange 콜백
  → main.ts: settings.preview 업데이트 + saveSettings()
  → data.json 저장

재시작 시:
  loadSettings() → camera.setPreviewSettings(settings.preview)
  → 저장된 위치/크기/모드 복원
```

## 수정 파일

| 파일 | 변경 사항 |
|------|-----------|
| `src/types.ts` | `PreviewMode`, `PreviewSettings`, `DEFAULT_PREVIEW_SETTINGS` 추가, `GestureControlSettings`에 `preview` 필드 |
| `src/camera/CameraManager.ts` | 컨테이너 구조 변경, 드래그/리사이즈/모드 전환, `setPreviewSettings()`, `onSettingsChange` 콜백 |
| `src/main.ts` | `toggle-preview` 커맨드, preview 설정 연동, `loadSettings()` gestureMappings 병합 |
| `src/ui/SettingsTab.ts` | Camera Preview 섹션 (Display mode, Preview size, Reset position) |
| `styles.css` | 미리보기 컨테이너, 툴바, 리사이즈 핸들 스타일 |

## 설정 항목

| 설정 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `preview.mode` | `"camera" \| "skeleton" \| "hidden"` | `"skeleton"` | 미리보기 표시 모드 |
| `preview.width` | number (160~480) | 320 | 미리보기 너비 (px) |
| `preview.x` | number | -1 | 좌측에서 거리 (-1 = 기본 우하단) |
| `preview.y` | number | -1 | 상단에서 거리 (-1 = 기본 우하단) |
