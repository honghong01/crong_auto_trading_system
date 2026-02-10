# 🦖 Crong Trader v1.0.0

> 24/7 자동 스캘핑 트레이딩 봇

**마스터**: 홍아름  
**작성자**: 크롱 🦖  
**작성일**: 2026-02-10

---

## 📋 개요

Crong Trader는 업비트 거래소에서 자동으로 스캘핑 매매를 수행하는 봇입니다.

### 주요 특징

- 🤖 **LLM 기반 분석**: Claude AI를 사용한 시장 분석 및 매매가 산출
- ⚡ **초봉 데이터**: 1초 단위 캔들 분석으로 빠른 시장 반응
- 🔄 **24/7 자동 운영**: 30분 사이클로 지속적 거래
- 📊 **데이터 저장**: MySQL + Notion 이중 기록
- 🛡️ **리스크 관리**: 자동 익절/손절 시스템

---

## 🏗️ 아키텍처

```
[스캔-1~2] 페어 스캐닝 & 필터링
       ↓
[스캔-3~4] 데이터 수집 & LLM 분석 → 최적 페어 선정
       ↓
┌─────── 거래 사이클 (30분) ───────┐
│ [스캔-5] LLM 매수/익절/손절가 산출 │
│ [거래-1] 지정가 매수              │
│ [거래-2] 실시간 모니터링 → 매도    │
│ [관리] DB & Notion 기록          │
└─────────────────────────────────┘
       ↓
    다음 사이클 반복 (24/7)
```

---

## 📁 파일 구조

```
crong-trader/
├── index.js          # 메인 실행 파일
├── config.js         # 설정 (API 키, 파라미터 등)
├── upbit-api.js      # 업비트 REST API 모듈
├── db.js             # MySQL 데이터베이스 모듈
├── notion.js         # Notion API 모듈
├── llm-analyzer.js   # Claude LLM 분석 모듈
├── utils.js          # 유틸리티 함수
├── test-upbit.js     # API 테스트 파일
├── package.json
└── README.md
```

---

## ⚙️ 설치

### 1. 의존성 설치

```bash
cd crong-trader
npm install
```

### 2. 환경변수 설정

`~/.zshenv` 또는 `~/.bashrc`에 추가:

```bash
# Upbit API
export UPBIT_ACCESS_KEY="your_access_key"
export UPBIT_SECRET_KEY="your_secret_key"

# Claude API
export CLAUDE_KEY="your_claude_key"

# Notion API
export NOTION_API_KEY="your_notion_key"

# MySQL
export LOCAL_DB_PASSWORD="your_db_password"
```

### 3. MySQL 테이블 생성

```sql
CREATE DATABASE IF NOT EXISTS upbit_trade;

USE upbit_trade;

CREATE TABLE IF NOT EXISTS trades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    coin_name_ko VARCHAR(50) NOT NULL COMMENT '한글 코인명',
    llm_analysis_buy_price DECIMAL(20, 8) COMMENT 'LLM분석 매수가',
    llm_analysis_take_profit DECIMAL(20, 8) COMMENT 'LLM분석 익절가',
    llm_analysis_stop_loss DECIMAL(20, 8) COMMENT 'LLM분석 손절가',
    order_status VARCHAR(20) DEFAULT 'PENDING' COMMENT '최종 주문상태',
    system_version VARCHAR(20) COMMENT '현재 시스템버전',
    buy_total_amount DECIMAL(20, 8) COMMENT '매수금액',
    buy_datetime DATETIME COMMENT '매수일시',
    buy_unit_price DECIMAL(20, 8) COMMENT '매수단가',
    sell_total_amount DECIMAL(20, 8) COMMENT '매도금액',
    sell_datetime DATETIME COMMENT '매도일시',
    sell_unit_price DECIMAL(20, 8) COMMENT '매도단가',
    realized_profit_rate DECIMAL(10, 4) COMMENT '실현손익률(%)',
    realized_profit_amount DECIMAL(20, 8) COMMENT '실현손익금(원)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🚀 실행

```bash
# 기본 실행 (시드 10만원, 30분 사이클)
node index.js

# 커스텀 설정 (시드 1만원, 30분 사이클)
node index.js 10000 30

# 백그라운드 실행
nohup node index.js 100000 30 > crong.log 2>&1 &
```

---

## ⚠️ 주의사항

1. **실제 자금 투자 전 소액 테스트 필수**
2. **Upbit API 출금 권한 비활성화 권장**
3. **LLM 분석은 참고용이며 손실 가능성 있음**
4. **API 호출 빈도 제한 주의 (초당 10회)**

---

## 📈 버전 히스토리

### v1.0.0 (2026-02-10)
- 최초 버전
- 기본 스캘핑 로직 구현
- LLM 기반 페어 선정 및 매매가 분석
- MySQL + Notion 연동
- 초봉 데이터 지원

---

## 📜 라이선스

MIT License

---

Made with 💚 by 크롱 🦖 for 마스터 홍아름
