# GRIP 보안 시연 시나리오 가이드

## 공통 사전 준비

1. 서버 실행: `npm run dev` (포트 3000)
2. 브라우저 두 탭 준비
   - 탭 A: `http://localhost:3000` (로그인 화면)
   - 탭 B: `http://localhost:3000/dashboard.html` (관리자 대시보드)
3. 대시보드에 관리자 계정으로 로그인 후 **실시간 보안 이벤트** 피드 확인

---

## 시나리오 2 — SQL Injection 탐지

### 목적
로그인 폼 입력값에 SQL 메타 문자가 포함되면 `SQLI_BLOCKED` 이벤트가 기록되고 대시보드에 즉시 표시되는지 확인.

### 순서

#### ① 로그아웃 상태 만들기
- 탭 A(`http://localhost:3000`)에서 우상단 **로그아웃** 버튼 클릭
- 로그인/회원가입 탭이 있는 인증 패널이 표시되면 준비 완료

#### ② 대시보드 준비 (탭 B)
- `http://localhost:3000/dashboard.html` 열기
- **실시간 보안 이벤트** 섹션과 **SQLI** 필터 버튼 확인
- 피드 필터를 **SQLI** 또는 **전체**로 설정

#### ③ SQL Injection 입력
탭 A의 로그인 폼에 아래 값 입력:

| 필드 | 입력값 | 설명 |
|------|--------|------|
| 이메일 | `' OR '1'='1` | 싱글쿼트 + OR 절 |
| 비밀번호 | `anything` | 임의 값 |

또는 이메일 필드에 다음 중 하나 입력:
```
admin'--
' UNION SELECT 1,2,3--
"; DROP TABLE users;--
```

**로그인** 버튼 클릭.

#### ④ 예상 결과 확인

| 위치 | 확인 항목 |
|------|-----------|
| 탭 A 화면 | 에러 메시지: `SQL Injection 패턴이 감지되었습니다.` |
| 탭 A 네트워크(F12 > Network) | POST `/api/auth/login` → 응답 `401`, body: `{ "success": false, "error": { "code": "SQLI_DETECTED", ... } }` |
| 탭 B 대시보드 | 이벤트 피드에 `SQLI_BLOCKED` 항목 신규 추가 (실시간 SSE) |
| 탭 B 이벤트 통계 차트 | SQLI 막대 1 증가 |

#### ⑤ 캡처 포인트
1. 로그인 폼에 페이로드 입력한 화면
2. 탭 A의 에러 메시지 표시 화면
3. 탭 B 대시보드의 이벤트 피드에 `SQLI_BLOCKED` 카드 등장 화면
4. 브라우저 DevTools Network 탭 — 401 응답 body

### 탐지 로직 근거
`middleware/sqliDetect.middleware.js` — 패턴:
```
/('|"|;|--|#|\/\*|\*\/|UNION|SELECT|DROP|INSERT|UPDATE)/i
```
이메일 또는 비밀번호 필드에서 위 패턴 매칭 시 즉시 차단 후 `security_events` 테이블에 `SQLI_BLOCKED` 기록.

---

## 시나리오 3 — Brute Force 공격 탐지 (attacks.py)

### 목적
`attacks.py`로 동일 계정에 반복 로그인 시도 → `BRUTE_FORCE`(IP rate limit) 이벤트가 대시보드에 표시되는지 확인.

> **주의:** `rateLimit.middleware.js`는 개발 환경(`NODE_ENV !== 'production'`)에서 `localhost(127.0.0.1, ::1)`를 rate limit 제외 처리합니다.  
> 실제 이벤트를 발생시키려면 아래 두 방법 중 하나를 선택하세요.

### 방법 A — 프로덕션 모드로 서버 실행 (권장)
```bash
NODE_ENV=production npm start
```
이 상태에서 `attacks.py`를 실행하면 localhost도 rate limit 적용됨.

### 방법 B — 미들웨어 임시 우회 (개발 모드 유지 시)
`middleware/rateLimit.middleware.js` 24번 줄 조건을 임시 주석 처리:
```js
// if (process.env.NODE_ENV !== 'production' && LOCALHOST_IPS.has(ip)) return next();
```
시연 후 반드시 원복.

---

### 순서

#### ① 서버 실행 확인
```bash
NODE_ENV=production npm start
```
또는 방법 B 적용 후 `npm run dev`

#### ② 대시보드 준비 (탭 B)
- `http://localhost:3000/dashboard.html` 접속
- 이벤트 피드 필터를 **브루트포스** 또는 **전체**로 설정

#### ③ attacks.py 실행
```bash
python attacks.py
```

스크립트 동작:
1. `victi_<타임스탬프>@test.kr` 계정을 자동 생성
2. 틀린 비밀번호(`wrong0` ~ `wrong29`)로 30회 연속 로그인 시도 (0.1초 간격)

터미널 출력 예시:
```
#1: 401
#2: 401
...
#10: 401
#11: 429   ← rate limit 초과 시작
#12: 429
...
#30: 429
```

#### ④ 예상 결과 확인

| 위치 | 확인 항목 |
|------|-----------|
| 터미널 | 11번째 요청부터 `429` 상태코드 반환 |
| 탭 B 대시보드 | 이벤트 피드에 `BRUTE_FORCE` 카드 등장 (분당 10회 초과 시마다 기록) |
| 탭 B 이벤트 통계 차트 | 브루트포스 막대 증가 |

**이벤트 카드에 표시되는 정보:**
- 이벤트 타입: `BRUTE_FORCE`
- IP 주소
- detail: `{ "message": "로그인 N회 차단", "count": N }`

#### ⑤ 계정 잠금 확인 (추가 시연)
5회 연속 실패 시 해당 계정은 30분 잠금(`ACCOUNT_LOCKED`) 처리됨.  
공격 이후 정상 계정으로 해당 이메일 로그인 시도하면 잠금 메시지 확인 가능.

#### ⑥ 캡처 포인트
1. `attacks.py` 실행 중 터미널 — `401` → `429` 전환 구간
2. 탭 B 대시보드 이벤트 피드에 `BRUTE_FORCE` 카드 등장 화면
3. 탭 B 이벤트 통계 차트의 브루트포스 막대 증가 화면
4. (선택) 잠긴 계정으로 로그인 시도 시 `ACCOUNT_LOCKED` 에러 화면

### 탐지 로직 근거
`middleware/rateLimit.middleware.js` — 슬라이딩 윈도우 (60초, IP당 최대 10회).  
10회 초과 시 즉시 429 반환 + `security_events` 테이블에 `BRUTE_FORCE` 기록.

---

## 대시보드 이벤트 피드 SSE 동작 원리

- 서버가 `/api/security/events/stream` (SSE)로 신규 이벤트를 실시간 푸시
- 대시보드 JS가 `EventSource`로 수신 → 피드 상단에 카드 삽입
- 별도 새로고침 불필요 — 공격 즉시 화면에 반영됨
