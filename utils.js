/**
 * ============================================================
 * Crong Trader v1.0.0 - 유틸리티 함수
 * ============================================================
 * 
 * 마스터: 홍아름
 * 작성자: 크롱 🦖
 * 작성일: 2026-02-10
 * 
 * 공통으로 사용되는 유틸리티 함수들을 모아놓은 파일입니다.
 * - 로깅
 * - JWT 토큰 생성 (Upbit API 인증용)
 * - 수익률 계산
 * - 날짜/시간 처리
 * ============================================================
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

/**
 * 로그 출력 함수
 * 
 * @param {string} level - 로그 레벨 (info, warn, error, success, trade)
 * @param {string} message - 로그 메시지
 * @param {object} data - 추가 데이터 (선택)
 * 
 * @example
 * log('info', '서버 시작');
 * log('trade', '매수 완료', { price: 1000, volume: 10 });
 */
function log(level, message, data = null) {
  const timestamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  
  // 레벨별 이모지 아이콘
  const prefix = {
    info: '📘',
    warn: '⚠️',
    error: '🚨',
    success: '✅',
    trade: '💰',
  }[level] || '📝';

  console.log(`[${timestamp}] ${prefix} ${message}`);
  
  // 추가 데이터가 있으면 JSON으로 출력
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

/**
 * Upbit API용 JWT 토큰 생성
 * 
 * Upbit API는 JWT(JSON Web Token)를 사용하여 인증합니다.
 * Private API 호출 시 이 함수로 생성한 토큰을 Authorization 헤더에 포함해야 합니다.
 * 
 * @param {string} accessKey - Upbit Access Key
 * @param {string} secretKey - Upbit Secret Key
 * @param {object} query - API 요청 파라미터 (선택, 주문 등에 필요)
 * @returns {string} JWT 토큰
 * 
 * @example
 * const token = createUpbitToken(ACCESS_KEY, SECRET_KEY);
 * // Authorization: Bearer {token}
 */
function createUpbitToken(accessKey, secretKey, query = null) {
  const payload = {
    access_key: accessKey,
    nonce: uuidv4(),  // 매 요청마다 고유한 값
  };

  // 쿼리 파라미터가 있으면 해시 추가 (주문 등 POST 요청에 필요)
  if (query) {
    const queryString = new URLSearchParams(query).toString();
    const hash = crypto.createHash('sha512');
    hash.update(queryString, 'utf-8');
    payload.query_hash = hash.digest('hex');
    payload.query_hash_alg = 'SHA512';
  }

  // JWT 토큰 생성 (HS256 알고리즘)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secretKey).update(`${header}.${body}`).digest('base64url');

  return `${header}.${body}.${signature}`;
}

/**
 * 딜레이 함수 (비동기 대기)
 * 
 * @param {number} ms - 대기 시간 (밀리초)
 * @returns {Promise} 
 * 
 * @example
 * await sleep(1000); // 1초 대기
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 변동성 계산
 * 
 * 캔들 데이터에서 (최고가 - 최저가) / 최저가 * 100으로 변동성을 계산합니다.
 * 
 * @param {array} candles - 캔들 데이터 배열
 * @returns {number} 변동성 (%)
 */
function calculateVolatility(candles) {
  if (!candles || candles.length < 2) return 0;
  
  const prices = candles.map(c => c.trade_price);
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  
  if (min === 0) return 0;
  return ((max - min) / min) * 100;
}

/**
 * 수익률 계산 (수수료 포함)
 * 
 * 매수가와 매도가를 기준으로 실제 수익률을 계산합니다.
 * 업비트 수수료(매수/매도 각 0.05%)를 고려합니다.
 * 
 * @param {number} buyPrice - 매수 단가
 * @param {number} sellPrice - 매도 단가
 * @param {number} feeRate - 수수료율 (기본 0.0005 = 0.05%)
 * @returns {number} 수익률 (%)
 * 
 * @example
 * const profit = calculateProfitRate(1000, 1050); // 약 4.9% (수수료 제외 시 5%)
 */
function calculateProfitRate(buyPrice, sellPrice, feeRate = 0.0005) {
  const buyFee = buyPrice * feeRate;   // 매수 수수료
  const sellFee = sellPrice * feeRate; // 매도 수수료
  const profit = sellPrice - buyPrice - buyFee - sellFee;
  return (profit / buyPrice) * 100;
}

/**
 * 주(Week) 범위 계산
 * 
 * Notion에 주간 DB를 생성할 때 사용합니다.
 * 주어진 날짜가 속한 주의 월요일~일요일 범위를 반환합니다.
 * 
 * @param {Date} date - 기준 날짜 (기본: 현재)
 * @returns {object} { start, end, label }
 * 
 * @example
 * const week = getWeekRange();
 * // { start: Date, end: Date, label: '2/10~2/16' }
 */
function getWeekRange(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);  // 월요일로 조정
  
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  
  const format = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  
  return {
    start: monday,
    end: sunday,
    label: `${format(monday)}~${format(sunday)}`,
  };
}

/**
 * ISO datetime을 MySQL DATETIME 형식으로 변환
 * 
 * MySQL DATETIME 컬럼은 'YYYY-MM-DD HH:MM:SS' 형식을 요구합니다.
 * JavaScript Date 또는 ISO 문자열을 MySQL 형식으로 변환합니다.
 * 
 * @param {Date|string} isoString - ISO 형식 날짜 또는 Date 객체
 * @returns {string} MySQL DATETIME 형식 문자열
 * 
 * @example
 * toMySQLDateTime(new Date()); // '2026-02-10 22:30:00'
 */
function toMySQLDateTime(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// ============================================================
// 모듈 내보내기
// ============================================================
module.exports = {
  log,
  createUpbitToken,
  sleep,
  calculateVolatility,
  calculateProfitRate,
  getWeekRange,
  toMySQLDateTime,
};
