# 사주로그 CS Bot - AI 참조 문서

> **프로젝트**: 사주로그 AI 고객상담 봇
> **Git**: https://github.com/shared-cmyk1/saju-cs-bot.git
> **배포**: Vercel

---

## 기술 스택

- **Framework**: Next.js 16.1.6, React 19, TypeScript
- **AI**: Anthropic Claude API
  - `claude-sonnet-4-20250514` (CS 응답 생성)
  - `claude-haiku-4-5-20251001` (카테고리 분류, 학습)
- **DB**: Supabase (PostgreSQL)
- **메시징**: Meta Instagram Graph API, Slack Web API
- **배포**: Vercel Functions (`waitUntil()` 사용)

---

## 프로젝트 구조

```
saju-cs-bot/
├── app/
│   ├── api/
│   │   ├── admin/retry-comments/     # 실패한 댓글 재처리
│   │   ├── health/                   # 헬스체크
│   │   ├── instagram/webhook/        # Meta 웹훅 엔드포인트
│   │   │   └── services/
│   │   │       ├── graphApi.ts       # Instagram Graph API 래퍼
│   │   │       ├── webhookHandler.ts # 이벤트 라우팅
│   │   │       ├── messageService.ts # DM 메시지 처리
│   │   │       ├── commentService.ts # 댓글 처리
│   │   │       └── messageTemplates.ts
│   │   └── slack/interactions/       # Slack 버튼/모달 핸들러
│   ├── lib/
│   │   ├── types/index.ts            # TypeScript 인터페이스
│   │   ├── ai/
│   │   │   ├── csBot.ts              # Claude AI 응답 생성 (핵심)
│   │   │   └── learningService.ts    # 자동 학습 시스템
│   │   ├── supabase/client.ts        # DB 클라이언트
│   │   ├── account/accountResolver.ts # 멀티 계정 설정
│   │   ├── slack/slackClient.ts      # Slack API 연동
│   │   ├── faq/loader.ts             # FAQ 로더
│   │   └── report/
│   │       ├── reportService.ts      # 리포트 상태 머신
│   │       └── reportApiClient.ts    # 리포트 생성 API
│   ├── page.tsx, layout.tsx
│   ├── privacy/page.tsx
│   └── ad-checklist/page.tsx
├── migrations/                       # SQL 마이그레이션 (001-004)
├── supabase-schema.sql               # 메인 스키마
└── .env.example
```

---

## 핵심 기능

### 1. CS Bot (AI 응답)

**파일**: `app/lib/ai/csBot.ts`

- Claude Sonnet + 한국어 FAQ 기반 응답
- 에스컬레이션 트리거 감지 (불만, 주문 문의, 기술 이슈)
- 출력 형식: `{ action: "respond"|"escalate", answer, suggestedAnswer, reasoning }`

### 2. 에스컬레이션 관리

- Instagram DM → 복잡한 질문 → Slack 에스컬레이션
- 팀이 Slack 모달로 응답 → 자동으로 Instagram DM 발송
- 영업시간 인식 (계정별 설정 가능)
- 영업시간 외 메시지 하루 1회 발송

### 3. 자동 학습 시스템

**파일**: `app/lib/ai/learningService.ts`

- 팀 응답에서 Q&A 쌍 자동 캡처
- Claude Haiku로 카테고리 분류
- 같은 카테고리 5개 이상 → Slack에 자동 규칙 제안
- 팀 승인/거부 → 승인된 규칙 저장 후 자동 매칭
- 신뢰도 임계값: 0.85

### 4. 리포트 재발급 (상태 머신)

**파일**: `app/lib/report/reportService.ts`

```
awaiting_service → awaiting_info → confirming → generating → completed
```

- 4가지 상품: CLASSIC, ROMANTIC, SPICYSAJU, REUNION
- AI 기반 사용자 정보 추출 (이름, 성별, 생년월일, 태어난 시)
- 외부 Report API 호출 → PDF 생성
- 세션 타임아웃: 30분

### 5. Instagram 댓글 처리

- 댓글에서 생년월일/성별 추출
- DM으로 미리보기 링크 발송 (Private Reply)
- 공개 댓글 답글

### 6. 멀티 계정 시스템

- 여러 Instagram 계정 지원
- 계정별 Slack 채널, FAQ, 설정
- 계정 설정 캐시: 5분 TTL

---

## DB 테이블

| 테이블 | 용도 |
|--------|------|
| `saju_cs_accounts` | 계정 설정 (Instagram, Slack, 옵션) |
| `saju_cs_conversations` | 고객별 대화 |
| `saju_cs_messages` | 대화 내 메시지 (message_index 순서) |
| `saju_cs_escalations` | 에스컬레이션 대기 질문 |
| `saju_cs_learning_pairs` | 학습 Q&A 쌍 (카테고리, 감정) |
| `saju_cs_auto_rules` | 승인된 자동 응답 규칙 |
| `saju_cs_pending_responses` | 고객별 응답 제안 (승인 전) |
| `saju_cs_report_sessions` | 리포트 생성 세션 |
| `saju_cs_comment_reports` | 댓글 추적 및 미리보기 로그 |

**유니크 제약조건**:
- conversations: (account_id, instagram_user_id)
- auto_rules: (account_id, category)
- messages: (conversation_id, message_index)

---

## API 엔드포인트

```typescript
"POST /api/instagram/webhook"       // Meta 웹훅 (DM + 댓글 이벤트)
"POST /api/slack/interactions"      // Slack 버튼/모달 핸들러
"GET  /api/health"                  // 설정 상태 확인
"POST /api/admin/retry-comments"    // 실패한 댓글 재처리
```

---

## 데이터 플로우

### Instagram DM 처리

```
Instagram User → Meta Webhook → /api/instagram/webhook
  → webhookHandler.ts (이벤트 라우팅)
    → 활성 리포트 세션 확인 → reportService.handleSessionMessage()
    → OR 학습된 규칙 매칭 → postResponseProposal() → Slack
    → OR 에스컬레이션 → postEscalation() → Slack

Slack 팀 응답 → /api/slack/interactions
  → Instagram DM 발송 + DB 저장
  → 학습 쌍 캡처 (fire-and-forget)
```

### 학습 플로우

```
팀 Slack 응답 → Q&A 캡처
  → AI 카테고리 분류
  → 같은 카테고리 5+ → AI 분석
  → Slack에 자동 규칙 제안 (approve/reject)
  → 승인된 규칙 캐시하여 향후 매칭
```

### 리포트 생성 플로우

```
사용자 DM: "리포트 재발급" → 세션 생성
  → Step 1: 상품 유형 질문
  → Step 2: 개인정보 요청 (AI 추출)
  → Step 3: 확인
  → Step 4: Report API 호출 → PDF 생성
  → 링크 발송
```

---

## 캐싱 전략

- **계정 설정**: 5분 TTL
- **자동 규칙**: 2분 TTL
- **무효화**: `invalidateRuleCache(accountId)`

---

## 환경 변수

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Claude AI
ANTHROPIC_API_KEY=

# Instagram (Meta Graph API)
INSTAGRAM_USER_ACCESS_TOKEN=
INSTAGRAM_BUSINESS_ACCOUNT_ID=
WEBHOOK_VERIFY_TOKEN=

# Slack
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_CS_CHANNEL_ID=

# App
NEXT_PUBLIC_APP_URL=

# 리포트 생성 (선택)
SAJU_REPORT_API_URL=
SAJU_REPORT_API_KEY=
```

---

## 개발 가이드

```bash
npm run dev      # 개발 서버 시작
npm run build    # 프로덕션 빌드
npm start        # 프로덕션 서버
```

### 에러 처리 정책

- 모든 엔드포인트 `[ComponentName]` 접두사 로깅
- DM 실패 → Slack 에스컬레이션으로 안전 처리
- AI 실패 → 에스컬레이션 또는 템플릿 응답으로 그레이스풀 디그레이드
- 중복 감지: Instagram message ID (`instagram_mid`) 기반
- Slack & Webhook 요청 서명 검증

---

_Last Updated: 2026년 3월_
