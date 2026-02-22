# PRD — Obsidian Gesture Control Plugin (Core-first, Pro later via A 방식)

## 0) 한 줄 요약
웹캠 기반 손동작(제스처)을 인식해 Obsidian 명령/단축키/매크로를 실행하는 플러그인.
초기에는 **Core(무료)만** 빠르게 MVP로 출시하고, 이후 수익화 단계에서 **A 방식(Pro 라이선스 + Pro 패키지 설치)**을 추가한다.

---

## 1) 배경 / 문제 정의
- Obsidian 작업 흐름에서 반복적으로 발생하는 "패널 토글 / 이동 / 실행"은 키보드·마우스 전환 비용이 큼.
- 제스처 입력은 'Flow'를 유지할 수 있으나 오탐/미탐·성능·프라이버시·설치 난이도 문제가 있어 **기본 UX가 무너지면 바로 이탈**함.
- 따라서 MVP는 "정확도 높은 최소 기능 + 안정적 UX + 간단한 설치"가 최우선.

---

## 2) 목표 (Goals)

### 제품 목표 (MVP)
1) 설치 후 3분 내 "제스처로 명령 3개 실행 성공"
2) 오탐을 억제(기본 dwell + cooldown)하여 실제 사용 가능 수준 확보
3) 카메라/추론이 켜져도 Obsidian 체감 성능 저하를 최소화

### 장기 목표 (성장)
- Pro(유료)로 확장 가능한 구조 설계 (하지만 MVP에선 구현하지 않음)
- Core는 커뮤니티 플러그인 배포로 유입 확보
- Pro는 "고급 워크플로우/프로파일/안정화/자동화"로 과금

---

## 3) 범위 (Scope)

### 이번 릴리즈(MVP v0.1) 포함: Core only
- 카메라 On/Off
- MediaPipe Hands 기반 손 인식
- 기본 제스처 3~5개 (정확도 높은 것만)
- 제스처 → Obsidian Command 매핑 UI
- 오탐 방지(임계치/hold/dwell/cooldown) 최소 옵션
- 상태 표시(감지/인식/실행)
- 프라이버시 기본값(영상 저장/전송 없음) 명시

### 이번 릴리즈 제외(명시적으로 Later)
- 홈페이지 결제/계정/트라이얼
- 라이선스 키 발급/검증 API
- Pro 패키지 다운로드/설치(A 방식)
- 고급 제스처(양손/시퀀스), 프로파일, 매크로 빌더, 디버그 패널
- 모바일(완전 지원) / 기업용 기능

---

## 4) 사용자 / 페르소나
1) Writer/Researcher: 패널 토글/링크 이동/검색을 반복
2) Builder/Analyst: command 활용도가 높고 자동화 선호
3) Presenter: 발표/녹화 중 손으로 제어(단, 신뢰성이 핵심)

---

## 5) 핵심 사용자 시나리오 (MVP)
- S1: 카메라 켜기 → 손 감지 → "Palm" 제스처로 사이드바 토글
- S2: Thumb Up 제스처로 커맨드 팔레트 열기
- S3: Fist 제스처로 ESC/모달 닫기
- S4: 설정에서 내가 원하는 명령을 골라 제스처에 바인딩
- S5: 오탐이 많으면 dwell/cooldown 조절

---

## 6) 기능 요구사항 — Core (MVP)

### F1. 카메라 제어
- 카메라 On/Off 토글 버튼 (리본 아이콘 + 커맨드 등록)
- 권한 거부/장치 없음 시 친절한 에러 메시지
- 상태바(또는 리본 배지)로 "ON/OFF/손감지/최근 실행" 표시

### F2. 손 추적 (MediaPipe Hands)
- getUserMedia로 프레임 캡처
- MediaPipe Hands로 랜드마크 추출
- MVP는 단일 손 우선(양손은 later)

### F3. 제스처 분류(규칙 기반, 안정 우선)
- MVP 제스처 후보(예시, 구현 난이도/오탐 고려해 최종 3~5개 선택)
  - Open Palm (토글/정지/모드)
  - Fist (취소/ESC)
  - Thumb Up (확인/실행)
  - (옵션) Pinch (선택) — 오탐 가능성 높으면 v0.1 제외
  - (옵션) Swipe L/R — 동적 제스처는 later 권장
- 제스처 이벤트는 confidence 기반 임계치 적용

### F4. 제스처 → Command 매핑 UI
- Obsidian command 목록에서 검색/선택
- 각 제스처마다:
  - 연결된 command
  - dwell(ms) / cooldown(ms)
  - threshold(confidence)
  - enable/disable 토글

### F5. 오탐 방지(최소 안정화)
- 기본값:
  - dwell 300~500ms
  - cooldown 800~1200ms
- 연속 N 프레임 유지 시만 실행
- 동일 제스처 연속 실행 방지

### F6. 프라이버시/보안 기본 정책
- 영상/이미지 저장/업로드 없음 (기본값)
- 로그는 "제스처 이벤트/상태" 수준 (원하면 off)

---

## 7) UX 요구사항
- 상태가 항상 명확해야 함:
  - 카메라 ON/OFF
  - 손 감지됨/안됨
  - 제스처 인식됨(실행 전/후)
- 설정은 "초보도 1분 내 바인딩" 가능한 단순함
- 고급 옵션은 Advanced 섹션으로 접어두기

---

## 8) 기술 아키텍처(요약)

### 구성 요소
- Video Capture Layer (getUserMedia)
- Hand Tracking Layer (MediaPipe Hands / WASM)
- Gesture Classifier (rules + confidence)
- Action Router (dwell/cooldown/context)
- Settings UI (mapping + tuning)
- Status UI (ribbon/statusbar/toast)

### 성능 원칙
- 기본 FPS 10~15fps 목표(설정으로 조정)
- 해상도 낮춰도 UX 유지(기본 640x480 등)
- 백그라운드/비활성 시 자동 pause (가능하면)

---

## 9) 출시 계획 / 단계별 로드맵

### Phase 0 — Spike (짧게)
- 카메라 프레임 캡처 성공
- MediaPipe Hands 랜드마크 추출 성공
- 제스처 1개만 인식해 콘솔 출력

### Phase 1 — MVP Core v0.1 (이번 목표)
- 제스처 3개(Palm/Fist/ThumbUp) + dwell/cooldown
- 제스처→커맨드 매핑 UI
- 카메라 On/Off + 상태 표시
- 에러 핸들링 + 프라이버시 문구/README
- 커뮤니티 플러그인 배포 준비

### Phase 2 — Core 안정화 v0.2~0.3
- 오탐 개선(알고리즘 튜닝)
- 동적 제스처 일부 추가(조건부)
- 성능 프리셋/자동 pause
- 간단한 디버그(최근 인식된 제스처/확률)

### Phase 3 — Monetization Infra (나중 계획, 이번엔 설계만)
> **여기부터는 "계획상 나중에" 진행. MVP에서는 구현하지 않음.**

- 홈페이지 결제/트라이얼/계정
- License Key 발급
- Core 설정에서 이메일+키 인증
- A 방식 Pro 패키지 설치 버튼/다운로더
- 만료/취소 시 폴백 (Core는 계속 동작, Pro만 잠금)

### Phase 4 — Pro Value (나중 계획)
- 프로파일(모드) 저장/전환
- 2-step confirm (오탐 방지 강화)
- 매크로/워크플로우 체인
- 시퀀스 제스처/양손 제스처
- 디버그 패널(인식 confidence, 이벤트 로그)

---

## 10) Pro 제공 방식(A 방식) — "나중에 구현할 설계"
> 이 섹션은 **PRD에 포함하되, 구현은 Phase 3 이후**로 미룬다.

### 사용자 플로우(예정)
1) 홈페이지에서 결제/트라이얼 시작
2) 이메일로 License Key 발급
3) Obsidian Core 플러그인 설정 → 이메일+키 입력 → Verify
4) 인증 성공 시 "Install Pro Package" 버튼 노출
5) 클릭 시 Pro 패키지 다운로드/설치 → Obsidian reload → Pro 기능 활성

### 기술 플로우(예정)
- Core는 entitlement 확인 및 Pro installer 역할
- Pro는 별도 패키지 형태로 제공:
  - 옵션 A: 별도 Obsidian 플러그인 설치(권장)
  - 옵션 B: Core가 Pro 모듈 zip 다운로드 후 동적 로딩
- 업데이트: Pro 전용 업데이트 채널/버전 체크 제공

---

## 11) 성공 지표(MVP)
- Activation: 설치 후 10분 내 "명령 1회 이상 제스처 실행" 비율
- Quality: 오탐 때문에 기능을 끄는 비율(카메라 off 비율)
- Retention: 7일 내 재사용(카메라 on 이벤트 기준)
- Issue: 카메라/권한/성능 관련 이슈 수

---

## 12) 리스크 & 대응(핵심만)
- 오탐으로 UX 붕괴 → MVP부터 dwell/cooldown 강제, 제스처 최소화
- 성능 저하 → FPS/해상도 제한, 비활성 pause
- 프라이버시 불신 → 로컬 처리/저장·전송 없음 명시, 토글/상태 명확히
- 플랫폼 이슈 → macOS/Windows 우선 안정화, Linux 베타

---

## 13) Claude에게 요청할 개발 지시(핵심)
- MVP는 "Core-only"로 끝낸다.
- 제스처는 안정적인 3개부터(Palm/Fist/ThumbUp)로 시작한다.
- 설정 UI는 "제스처→커맨드 매핑"이 1분 안에 끝나도록 단순하게 만든다.
- A 방식(Pro 라이선스 + Pro 패키지 설치)은 PRD에 설계로만 포함하고, 코드는 나중 Phase에서 구현한다.
- README/프라이버시 문구/에러 UX(권한 거부 등)를 MVP에 포함한다.
