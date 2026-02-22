# Phase 5 완료 보고서: Cyberpunk HUD Skeleton Design

> 완료일: 2026-02-22

## 개요

카메라 프리뷰의 hand skeleton 시각화를 사이버펑크/미래지향적 HUD 스타일로 전면 개선.
캔버스 크기에 따른 비례 스케일링 시스템 도입으로 작은 프리뷰에서도 깔끔하게 표시.

## 이전 문제점

- 초록/빨강 원색 → 촌스러운 테크 데모 느낌
- `lineWidth=2`, `radius=4` 고정 → 160px에서 뚱뚱, 480px에서 너무 가늘음
- 손끝/손목/일반 관절 구분 없이 동일한 원과 선

## 구현 내용

### 1. 비례 스케일링 시스템

```
scale = canvasWidth / 320   (기준 너비 320px)
```

| 캔버스 너비 | scale | 뼈 코어 굵기 | 손끝 반지름 | shadowBlur |
|------------|-------|-------------|-----------|------------|
| 160px      | 0.5   | 0.75px      | 1.25px    | 3px        |
| 320px      | 1.0   | 1.5px       | 2.5px     | 6px        |
| 480px      | 1.5   | 2.25px      | 3.75px    | 9px        |

모든 값에 `Math.max()` 하한 적용 → 최소 크기에서도 요소가 사라지지 않음.

### 2. 4-Pass 렌더링 파이프라인

```
Pass 1: Bone Glow   — 넓은 반투명 선 + shadowBlur (네온 안개 언더글로우)
Pass 2: Bone Core   — 가는 밝은 선 (실제 뼈대 와이어), lineCap: "round"
Pass 3: Joint Halo  — 반투명 원 (손끝: 2x 블룸, 손목: 빈 링, 일반: 작은 점)
Pass 4: Joint Core  — 밝은 점 (손끝: 거의 순백, 손목: 중심점, 일반: 미묘한 점)
```

### 3. 컬러 팔레트

**Hand 0 — Icy Blue (차가운 블루)**
| 요소 | 색상 | 용도 |
|------|------|------|
| boneCore | `rgba(195, 220, 255, 0.88)` | 밝은 아이스블루 와이어 |
| boneGlow | `rgba(100, 170, 255, 0.15)` | 푸른 안개 글로우 |
| tipCore | `rgba(240, 248, 255, 1.0)` | 손끝 거의 순백 |
| tipHalo | `rgba(120, 195, 255, 0.30)` | 손끝 시안 블룸 |
| palmCore | `rgba(145, 185, 235, 0.50)` | 팜 브릿지 50% 디밍 |

**Hand 1 — Warm Rose (따뜻한 로즈)**
| 요소 | 색상 | 용도 |
|------|------|------|
| boneCore | `rgba(255, 205, 215, 0.88)` | 밝은 로즈 와이어 |
| boneGlow | `rgba(255, 130, 155, 0.15)` | 로즈 안개 글로우 |
| tipCore | `rgba(255, 248, 250, 1.0)` | 손끝 거의 순백 |
| tipHalo | `rgba(255, 165, 190, 0.30)` | 손끝 핑크 블룸 |
| palmCore | `rgba(235, 165, 180, 0.50)` | 팜 브릿지 50% 디밍 |

### 4. 특수 랜드마크 처리

| 랜드마크 | 처리 | 시각적 효과 |
|---------|------|------------|
| 손끝 (4,8,12,16,20) | 2x 헤일로 + shadowBlur 8*s | 가장 밝고 눈에 띄는 포인트 |
| 손목 (0) | 빈 링(○) + 중심점 | 앵커/원점 마커 |
| 팜 브릿지 ([5,9],[9,13],[13,17]) | 50% 어둡게, 가는 선 | 시각적 계층 분리 |
| 일반 관절 | 작은 헤일로 (shadowBlur 없음) | 배경에 묻히는 미묘한 점 |

### 5. 성능

- shadowBlur 사용: 7회/hand (bone glow 1회 + fingertip 5회 + wrist 1회)
- 일반 관절은 shadowBlur 생략 → 성능 보존
- 총 draw call: ~88/hand, 15fps × 2 hands = ~176 calls/frame
- Canvas 2D API만 사용 (WebGL 불필요)

## 수정 파일

| 파일 | 변경 사항 |
|------|-----------|
| `src/tracking/HandTracker.ts` | `drawLandmarksOnCtx()` 전면 재작성, `HandPalette` 인터페이스 + `PALETTE_COOL`/`PALETTE_WARM` 상수, 스케일 시스템, deprecated `drawLandmarks()` 제거 |

## 디자인 컨셉

Tron 라이트라인, Ghost in the Shell HUD, Iron Man 홀로그램에서 영감.
검은 배경 위에 발광하는 와이어프레임 — 미래지향적이면서 정보 가독성 유지.
두 손은 색온도(차가운 블루 vs 따뜻한 로즈)로 직관적 구분.
