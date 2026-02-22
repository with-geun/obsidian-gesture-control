# Phase 3 완료 보고서: 커스텀 액션 + 마이크/받아쓰기

> 완료일: 2026-02-22

## 구현 내용 요약

### 1. 커스텀 액션 시스템
- `gesture:` 접두사를 가진 commandId → `SystemActionHandler`로 라우팅
- 기존 Obsidian 커맨드와 공존 (접두사 없으면 기존 방식)
- 설정 UI에서 커스텀 액션과 Obsidian 커맨드를 하나의 목록에서 선택

### 2. macOS 받아쓰기 (Dictation Toggle)
- **시작**: AppleScript System Events로 Edit > "받아쓰기 시작" 메뉴 항목 클릭
- **정지**: Escape 키 전송 (`key code 53`)
- 제스처 한 번 → 시작, 다시 한 번 → 정지

### 3. macOS 마이크 볼륨 제어
- `osascript`로 시스템 입력 볼륨 제어 (TCC 마이크 권한 불필요)
- 뮤트 전 볼륨 기억 → 언뮤트 시 복원
- Toggle / Mute / Unmute 3가지 액션

### 4. 자동 설정 + 권한 안내
- **Accessibility 권한 체크**: 최초 받아쓰기 시도 시 System Events 접근 가능 여부 확인
  - 없으면 Notice + System Settings Accessibility 페이지 자동 오픈
  - 사용자가 권한 허용 후 다시 제스처하면 정상 동작
- **Dictation 자동 활성화**: `defaults write com.apple.HIToolbox AppleDictationAutoEnable -int 1`
  - 안 켜져 있으면 자동으로 켜고 Notice 안내
- **메뉴 항목 미발견 시**: Keyboard 설정 페이지 자동 오픈 + 안내
- **플랫폼 체크**: macOS 아닌 환경에서 실행 시 안내 Notice

## 아키텍처

### 액션 라우팅 분기

```
ActionRouter.execute(gesture)
  → mapping.commandId 확인
  → [분기]
    → "gesture:*" 접두사 → SystemActionHandler.execute()
      → gesture:dictation-toggle → 메뉴 클릭(시작) / Escape(정지)
      → gesture:mic-toggle → osascript 볼륨 제어
      → gesture:mic-mute → 볼륨 0
      → gesture:mic-unmute → 이전 볼륨 복원
    → 그 외 → app.commands.executeCommandById() (Obsidian 커맨드)
```

### 받아쓰기 첫 실행 플로우

```
1. Accessibility 권한 체크 (System Events 접근)
   → 실패: Notice + Settings 페이지 오픈 → 사용자 허용 후 재시도
   → 성공: 계속

2. Dictation 활성화 확인
   → 꺼져있으면: defaults write로 자동 활성화 + Notice

3. 메뉴 클릭으로 받아쓰기 시작
   → 메뉴 항목 없으면: Notice + Keyboard 설정 페이지 오픈
```

## 수정 파일

| 파일 | 변경 사항 |
|------|-----------|
| `src/types.ts` | `CUSTOM_ACTIONS` 배열, `CUSTOM_ACTION_PREFIX` 상수 추가 |
| `src/action/SystemActionHandler.ts` | **신규** — 시스템 액션 핸들러 (받아쓰기, 마이크 제어) |
| `src/action/ActionRouter.ts` | `gesture:` 접두사 분기, async execute, `getCommandName` public |
| `src/ui/SettingsTab.ts` | `CommandSuggestModal`에 커스텀 액션 통합, macOS 표시 |
| `src/main.ts` | async execute 대응, 커맨드명 해석 통합 |

## 커스텀 액션 목록

| Action ID | 이름 | 동작 |
|-----------|------|------|
| `gesture:dictation-toggle` | Dictation (macOS) | 받아쓰기 시작/정지 토글 |
| `gesture:mic-toggle` | Mic Toggle (macOS) | 입력 볼륨 0 ↔ 이전 값 |
| `gesture:mic-mute` | Mic Mute (macOS) | 입력 볼륨 → 0 |
| `gesture:mic-unmute` | Mic Unmute (macOS) | 입력 볼륨 → 이전 값 복원 |

## 일반 사용자용 안전장치

| 상황 | 처리 |
|------|------|
| macOS가 아닌 환경 | "This action is only available on macOS" Notice |
| Accessibility 권한 없음 | Notice + Privacy 설정 페이지 자동 오픈 |
| Dictation 비활성화 | defaults write로 자동 활성화 + 수동 안내 Notice |
| 메뉴에 받아쓰기 항목 없음 | Notice + Keyboard 설정 페이지 자동 오픈 |
| 알 수 없는 커스텀 액션 ID | console.warn + false 반환 |

## 기술 노트

### 받아쓰기 트리거 방식 비교 (시도한 것들)

| 방식 | 결과 |
|------|------|
| osascript `key code 63` (Fn 두 번) | 실패 — 가상 Fn 이벤트는 dictation 감지 안 됨 |
| osascript `key code 59` (Control 두 번) | 실패 — 가상 키 이벤트는 "두 번 누르기" 감지 안 됨 |
| Electron `Menu.getApplicationMenu()` | 실패 — macOS가 추가한 메뉴 항목은 Electron API에 안 보임 |
| CGEvent Swift 바이너리 | 미검증 — 별도 바이너리 필요, 권한 문제 |
| **System Events 메뉴 클릭** | **성공** — AppleScript로 프로세스 메뉴 직접 클릭 |

### 받아쓰기 정지 방식
- 메뉴 재클릭은 받아쓰기 중 불안정 → **Escape 키**(`key code 53`)로 확실하게 정지

### macOS 메뉴 항목 다국어 처리
- `"Dictation"` (EN) 또는 `"받아쓰기"` (KR) 문자열 포함 여부로 검색
- 전체 메뉴바를 순회하므로 메뉴 위치에 의존하지 않음
