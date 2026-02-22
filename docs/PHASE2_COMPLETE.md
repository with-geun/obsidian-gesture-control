# Phase 2 완료 보고서: 연속 제스처 (줌/커서/클릭/드래그)

> 완료일: 2026-02-22

## 구현 내용 요약

### 양손 Pointing → 줌 (Phase 1)
- 양손 검지만 펴면 연속 모드 즉시 진입
- 빨간 점 + 파란 점: 양 검지 위치를 화면에 표시
- 양 검지 간 거리 변화 → Ctrl+Wheel 이벤트 → Obsidian 줌 인/아웃

### 한 손 → 커서 제어 (Phase 2)
- 한 손 제거 시 남은 손의 검지로 커서 제어
- 빨간 점만 남아 화면 위를 이동
- 두 번째 손 다시 등장 → 줌 모드 복귀

### 엄지 → 클릭/드래그
- 엄지 빠르게 폈다 접기 = 클릭 (mousedown + mouseup)
- 엄지 오래 유지 = 드래그 (mousedown → 이동 → mouseup)

## 최종 아키텍처

```
HandTracker (landmarks every frame, numHands=2)
  → GestureClassifier (Palm/Fist/ThumbUp + Pointing/Pinch)
  → [분기]
    → 양손 Pointing 감지됨?
      → YES: ContinuousGestureProcessor → ContinuousActionDispatcher (DOM events)
        → Phase 1 (zooming): 양 검지 거리 → Ctrl+Wheel zoom
        → Phase 2 (cursor): 한 손 커서 제어
        → 엄지 확장 → click/drag
      → NO: GestureStabilizer → ActionRouter (Obsidian commands)
  → StatusDisplay (ribbon icon + status bar)
```

## 클릭/드래그 분리 로직

### 디바운스 타이밍
| 파라미터 | 값 | 설명 |
|----------|------|------|
| THUMB_DEBOUNCE | 2 프레임 | 엄지 확장 확인 + 클릭 릴리스 확인 |
| DRAG_THRESHOLD | 8 프레임 (~250ms) | 클릭→드래그 전환 기준 |
| DRAG_RELEASE_DEBOUNCE | 6 프레임 | 드래그 릴리스 확인 (더 엄격) |

### 상태 흐름
```
thumb retracted (기본)
  → thumb extended (2프레임 연속) → thumbConfirmed
    → [8프레임 미만에 retract] → 클릭 (mousedown + mouseup 즉시)
    → [8프레임 이상 유지] → 드래그 시작 (mousedown)
      → thumb retracted (6프레임 연속) → 드래그 종료 (mouseup)
```

## 알려진 이슈

### 엄지 감지 불안정
- `isThumbExtended` 규칙 (`tip-MCP 거리 > IP-MCP 거리 * 1.1`)이 손 움직임 중 떨림 발생
- 커서 이동 중 엄지 상태가 깜빡거려 의도하지 않은 클릭/드래그 트리거
- 디바운스로 완화했으나 완전 해결은 아님

### 향후 개선 방향
- 더 robust한 엄지 감지 알고리즘 (관절 각도 기반 등)
- 엄지 대신 다른 트리거 방식 검토 (예: 핀치, 주먹 쥐기)
- 프레임 기반 디바운스 대신 시간 기반(ms) 디바운스 고려

## 기술 세부사항

### 좌표 매핑
- Zone mapping: `[0.12 ~ 0.88]` 범위를 `[0 ~ 1]`로 정규화
- X축 미러링: `1 - rawX` (웹캠 좌우 반전)
- EMA 스무딩: `alpha = 0.15` (설정에서 조정 가능)

### 이벤트 전송
- 1순위: Electron `sendInputEvent` (네이티브 마우스/휠 이벤트)
- 2순위: Synthetic DOM events (폴백)
- 줌: `Ctrl+Wheel` 이벤트 (Obsidian 내장 줌 활용)

## 파일 구조

```
src/
├── main.ts                               # 파이프라인 조립 (연속+이산 분기)
├── types.ts                              # ContinuousSettings, ContinuousGestureEvent
├── gesture/
│   ├── ContinuousGestureProcessor.ts     # 양손 줌 + 한손 커서 + 클릭/드래그
│   ├── GestureClassifier.ts              # Pointing 제스처 추가
│   └── GestureStabilizer.ts              # Pointing/Pinch skip 처리
├── action/
│   ├── ActionRouter.ts                   # 이산 제스처 → Obsidian 커맨드
│   └── ContinuousActionDispatcher.ts     # 연속 제스처 → DOM/Electron 이벤트
└── ui/
    ├── SettingsTab.ts                    # 연속 제스처 설정 섹션 추가
    └── StatusDisplay.ts                  # 연속 모드 상태 표시
```

## 설정 항목 (Phase 2 추가)

| 설정 | 기본값 | 설명 |
|------|--------|------|
| Enable continuous gestures | true | 양손 Pointing → 연속 모드 |
| Cursor smoothing | 0.15 | EMA alpha (낮을수록 부드러움) |
| Zoom sensitivity | 15 | 줌 속도 배율 (5~50) |
