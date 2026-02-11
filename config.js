/**
 * ============================================================
 * Crong Trader v1.0.0 - 설정 파일
 * ============================================================
 * 
 * 마스터: 홍아름
 * 작성자: 크롱 🦖
 * 작성일: 2026-02-10
 * 
 * 이 파일은 트레이딩 봇의 모든 설정값을 관리합니다.
 * 환경변수를 통해 민감한 정보(API 키 등)를 안전하게 관리합니다.
 * ============================================================
 */

module.exports = {
  // ========================================
  // 시스템 버전
  // ========================================
  VERSION: '1.0.3',

  // ========================================
  // 기본 설정 (실행 시 마스터 입력으로 오버라이드 가능)
  // ========================================
  DEFAULT_SEED_MONEY: 100000,           // 기본 시드머니 (원)
  DEFAULT_MAX_CYCLE_TIME: 30 * 60 * 1000,  // 기본 30분 (밀리초)

  // ========================================
  // Upbit API 설정
  // ========================================
  // 환경변수: UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY
  // 발급: https://upbit.com/mypage/open_api_management
  UPBIT: {
    REST_URL: 'https://api.upbit.com/v1',      // REST API 기본 URL
    WS_URL: 'wss://api.upbit.com/websocket/v1', // WebSocket URL (향후 실시간 기능용)
    ACCESS_KEY: process.env.UPBIT_ACCESS_KEY,   // API 접근 키
    SECRET_KEY: process.env.UPBIT_SECRET_KEY,   // API 비밀 키
  },

  // ========================================
  // MySQL (Local DB) 설정
  // ========================================
  // 거래 이력을 로컬 MySQL에 저장
  // 환경변수: LOCAL_DB_PASSWORD
  DB: {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: 'upbit_trade',  // 데이터베이스명 (미리 생성 필요)
  },

  // ========================================
  // Notion API 설정
  // ========================================
  // 거래 기록을 Notion에 동기화
  // 환경변수: NOTION_API_KEY
  NOTION: {
    API_KEY: process.env.NOTION_API_KEY,
    PARENT_PAGE_ID: '2fb95e5a-e1d2-80c0-9e79-e6a6fa156e6f',  // 거래 기록 저장할 부모 페이지 ID
  },

  // ========================================
  // LLM 설정 (Gemini / Claude 선택 가능)
  // ========================================
  // LLM을 통한 시장 분석 및 매매가 산출
  // 현재 사용: Gemini (비용 효율적)
  LLM: {
    PROVIDER: 'gemini',  // 'gemini' 또는 'claude'
  },

  // Gemini API 설정
  // 환경변수: GEMINI_KEY
  GEMINI: {
    API_KEY: process.env.GEMINI_KEY,
    MODEL: 'gemini-3-flash-preview',  // Gemini 3 Flash Preview (2026년 최신)
  },

  // Claude API 설정 (백업용)
  // 환경변수: CLAUDE_KEY
  CLAUDE: {
    API_KEY: process.env.CLAUDE_KEY,
    MODEL: 'claude-opus-4-5-20251101',
  },

  // ========================================
  // 스캔 조건 (스캘핑 최적화)
  // ========================================
  SCAN: {
    MIN_VOLATILITY: 5,      // 변동성 기준 (%) - 이 이상 변동성 있는 페어만 필터링
    CANDLE_COUNT: 200,      // 캔들 조회 개수 (초봉 200개 = 약 3~6분)
    CANDLE_UNIT: 1,         // 캔들 단위 (분봉용, 초봉은 무시됨)
    CANDLE_TYPE: 'seconds', // 캔들 타입 ('seconds' | 'minutes')
  },

  // ========================================
  // 거래 설정
  // ========================================
  TRADE: {
    FEE_RATE: 0.0005,       // 업비트 수수료율 (0.05%)
    ORDER_TIMEOUT: 60000,   // 주문 체결 대기 시간 (밀리초) - 초과 시 시장가 전환
  },

  // ========================================
  // 로깅
  // ========================================
  LOG_LEVEL: 'info',  // 로그 레벨 (debug | info | warn | error)
};
