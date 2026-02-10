/**
 * ============================================================
 * Crong Trader v1.0.0 - Upbit REST API 모듈
 * ============================================================
 * 
 * 마스터: 홍아름
 * 작성자: 크롱 🦖
 * 작성일: 2026-02-10
 * 
 * 업비트 REST API를 호출하는 함수들을 모아놓은 파일입니다.
 * 
 * API 종류:
 * - Public API: 인증 없이 호출 가능 (시세 조회 등)
 * - Private API: JWT 토큰 필요 (주문, 잔고 조회 등)
 * 
 * 참고: https://docs.upbit.com/
 * ============================================================
 */

const config = require('./config');
const { createUpbitToken, log } = require('./utils');

const BASE_URL = config.UPBIT.REST_URL;
const ACCESS_KEY = config.UPBIT.ACCESS_KEY;
const SECRET_KEY = config.UPBIT.SECRET_KEY;

// ============================================================
// 공통 요청 함수
// ============================================================

/**
 * Public API GET 요청 (인증 불필요)
 * 
 * 시세 조회, 캔들 데이터 등 인증 없이 접근 가능한 API용
 * 
 * @param {string} endpoint - API 엔드포인트 (예: '/market/all')
 * @param {object} params - 쿼리 파라미터
 * @returns {Promise<object>} API 응답 데이터
 */
async function publicGet(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  
  const res = await fetch(url.toString());
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Upbit API Error: ${res.status} - ${error}`);
  }
  return res.json();
}

/**
 * Private API 요청 (JWT 인증 필요)
 * 
 * 주문, 잔고 조회 등 인증이 필요한 API용
 * 자동으로 JWT 토큰을 생성하여 Authorization 헤더에 포함
 * 
 * @param {string} method - HTTP 메서드 (GET, POST, DELETE)
 * @param {string} endpoint - API 엔드포인트
 * @param {object} params - 요청 파라미터
 * @returns {Promise<object>} API 응답 데이터
 */
async function privateRequest(method, endpoint, params = {}) {
  const query = Object.keys(params).length > 0 ? params : null;
  const token = createUpbitToken(ACCESS_KEY, SECRET_KEY, query);
  
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  
  let url = `${BASE_URL}${endpoint}`;
  
  // GET 요청은 쿼리스트링, POST/DELETE는 body로 전달
  if (method === 'GET' && query) {
    url += '?' + new URLSearchParams(query).toString();
  } else if (method === 'POST' && query) {
    options.body = JSON.stringify(query);
  }
  
  const res = await fetch(url, options);
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Upbit API Error: ${res.status} - ${error}`);
  }
  return res.json();
}

// ============================================================
// 시세 조회 API (Public)
// ============================================================

/**
 * [스캔-1] 마켓(페어) 목록 조회
 * 
 * 업비트에서 거래 가능한 모든 마켓 목록을 조회합니다.
 * KRW 마켓(원화 거래)만 필터링하여 반환합니다.
 * 
 * @returns {Promise<array>} KRW 마켓 목록
 * 
 * @example
 * const markets = await getMarkets();
 * // [{ market: 'KRW-BTC', korean_name: '비트코인', ... }, ...]
 */
async function getMarkets() {
  const markets = await publicGet('/market/all', { isDetails: true });
  // KRW 마켓만 필터링 (원화 거래만)
  return markets.filter(m => m.market.startsWith('KRW-'));
}

/**
 * [스캔-2] 조건에 맞는 페어 필터링
 * 
 * market_event 정보를 기반으로 변동성이 높거나 주의가 필요한 페어를 필터링합니다.
 * - warning: 투자 경고
 * - caution.PRICE_FLUCTUATIONS: 가격 급등락
 * - caution.TRADING_VOLUME_SOARING: 거래량 급증
 * - caution.DEPOSIT_AMOUNT_SOARING: 입금량 급증
 * 
 * @param {array} markets - 마켓 목록
 * @param {number} minVolatility - 최소 변동성 기준 (%)
 * @returns {array} 필터링된 마켓 목록
 */
function filterMarkets(markets, minVolatility = 5) {
  return markets.filter(m => {
    const event = m.market_event || {};
    const caution = event.caution || {};
    
    // 경고/주의 조건 체크
    const hasWarning = event.warning === true;
    const hasPriceFluctuation = caution.PRICE_FLUCTUATIONS === true;
    const hasVolumesoaring = caution.TRADING_VOLUME_SOARING === true;
    const hasDepositSoaring = caution.DEPOSIT_AMOUNT_SOARING === true;
    
    return hasWarning || hasPriceFluctuation || hasVolumesoaring || hasDepositSoaring;
  });
}

/**
 * [스캔-3] 분봉 캔들 조회
 * 
 * 지정한 분 단위의 캔들(OHLCV) 데이터를 조회합니다.
 * 
 * @param {string} market - 마켓 코드 (예: 'KRW-BTC')
 * @param {number} unit - 분 단위 (1, 3, 5, 15, 30, 60, 240)
 * @param {number} count - 조회 개수 (최대 200)
 * @returns {Promise<array>} 캔들 데이터 배열
 */
async function getCandlesMinutes(market, unit = 1, count = 200) {
  return publicGet(`/candles/minutes/${unit}`, { market, count });
}

/**
 * [스캔-3] 초봉 캔들 조회 (스캘핑용)
 * 
 * 1초 단위 캔들 데이터를 조회합니다.
 * 스캘핑 전략에 최적화된 초단기 데이터 분석에 사용됩니다.
 * 
 * 주의: 최근 3개월 이내 데이터만 조회 가능
 * 
 * @param {string} market - 마켓 코드
 * @param {number} count - 조회 개수
 * @returns {Promise<array>} 초봉 캔들 데이터
 */
async function getCandlesSeconds(market, count = 100) {
  return publicGet('/candles/seconds', { market, count });
}

/**
 * [스캔-3] 캔들 조회 (타입에 따라 분기)
 * 
 * config의 CANDLE_TYPE 설정에 따라 초봉 또는 분봉을 조회합니다.
 * 
 * @param {string} market - 마켓 코드
 * @param {number} unit - 캔들 단위 (분봉용)
 * @param {number} count - 조회 개수
 * @param {string} type - 'seconds' | 'minutes'
 * @returns {Promise<array>} 캔들 데이터
 */
async function getCandles(market, unit = 1, count = 100, type = 'seconds') {
  if (type === 'seconds') {
    return getCandlesSeconds(market, count);
  } else {
    return getCandlesMinutes(market, unit, count);
  }
}

/**
 * 호가 정보 조회
 * 
 * 현재 매수/매도 호가와 잔량 정보를 조회합니다.
 * 
 * @param {string} market - 마켓 코드
 * @returns {Promise<object>} 호가 데이터
 */
async function getOrderbook(market) {
  const data = await publicGet('/orderbook', { markets: market });
  return data[0];
}

/**
 * 현재가 조회
 * 
 * 지정한 마켓의 현재 시세 정보를 조회합니다.
 * 
 * @param {string|array} markets - 마켓 코드 (여러 개 가능)
 * @returns {Promise<array>} 시세 데이터
 */
async function getTicker(markets) {
  const marketStr = Array.isArray(markets) ? markets.join(',') : markets;
  return publicGet('/ticker', { markets: marketStr });
}

// ============================================================
// 거래 API (Private)
// ============================================================

/**
 * 계좌 잔고 전체 조회
 * 
 * @returns {Promise<array>} 보유 자산 목록
 */
async function getBalance() {
  return privateRequest('GET', '/accounts');
}

/**
 * KRW(원화) 잔고만 조회
 * 
 * @returns {Promise<number>} 원화 잔고
 */
async function getKrwBalance() {
  const accounts = await getBalance();
  const krw = accounts.find(a => a.currency === 'KRW');
  return krw ? parseFloat(krw.balance) : 0;
}

/**
 * [거래-1] 지정가 매수 주문
 * 
 * 지정한 가격에 매수 주문을 넣습니다.
 * 가격이 지정가에 도달해야 체결됩니다.
 * 
 * @param {string} market - 마켓 코드
 * @param {number} price - 매수 희망가
 * @param {number} volume - 매수 수량
 * @returns {Promise<object>} 주문 결과
 */
async function buyLimit(market, price, volume) {
  log('trade', `지정가 매수 주문: ${market} @ ${price}원, 수량: ${volume}`);
  return privateRequest('POST', '/orders', {
    market,
    side: 'bid',        // bid = 매수
    ord_type: 'limit',  // limit = 지정가
    price: price.toString(),
    volume: volume.toString(),
  });
}

/**
 * 시장가 매수 주문 (금액 기준)
 * 
 * 지정한 금액만큼 현재 시장가로 즉시 매수합니다.
 * 
 * @param {string} market - 마켓 코드
 * @param {number} price - 매수 금액 (원)
 * @returns {Promise<object>} 주문 결과
 */
async function buyMarket(market, price) {
  log('trade', `시장가 매수 주문: ${market}, 금액: ${price}원`);
  return privateRequest('POST', '/orders', {
    market,
    side: 'bid',
    ord_type: 'price',  // price = 시장가 매수 (금액 기준)
    price: price.toString(),
  });
}

/**
 * [거래-2] 시장가 매도 주문
 * 
 * 보유한 수량을 현재 시장가로 즉시 매도합니다.
 * 
 * @param {string} market - 마켓 코드
 * @param {number} volume - 매도 수량
 * @returns {Promise<object>} 주문 결과
 */
async function sellMarket(market, volume) {
  log('trade', `시장가 매도 주문: ${market}, 수량: ${volume}`);
  return privateRequest('POST', '/orders', {
    market,
    side: 'ask',        // ask = 매도
    ord_type: 'market', // market = 시장가 매도
    volume: volume.toString(),
  });
}

/**
 * 지정가 매도 주문
 * 
 * @param {string} market - 마켓 코드
 * @param {number} price - 매도 희망가
 * @param {number} volume - 매도 수량
 * @returns {Promise<object>} 주문 결과
 */
async function sellLimit(market, price, volume) {
  log('trade', `지정가 매도 주문: ${market} @ ${price}원, 수량: ${volume}`);
  return privateRequest('POST', '/orders', {
    market,
    side: 'ask',
    ord_type: 'limit',
    price: price.toString(),
    volume: volume.toString(),
  });
}

/**
 * [관리-3,4] 개별 주문 조회
 * 
 * 주문 UUID로 해당 주문의 상태를 조회합니다.
 * state: wait(대기), watch(예약), done(완료), cancel(취소)
 * 
 * @param {string} uuid - 주문 UUID
 * @returns {Promise<object>} 주문 상세 정보
 */
async function getOrder(uuid) {
  return privateRequest('GET', '/order', { uuid });
}

/**
 * 주문 취소
 * 
 * 미체결 주문을 취소합니다.
 * 
 * @param {string} uuid - 주문 UUID
 * @returns {Promise<object>} 취소 결과
 */
async function cancelOrder(uuid) {
  log('trade', `주문 취소: ${uuid}`);
  return privateRequest('DELETE', '/order', { uuid });
}

/**
 * 주문 가능 정보 조회
 * 
 * 해당 마켓에서 주문 가능한 금액/수량 정보를 조회합니다.
 * 
 * @param {string} market - 마켓 코드
 * @returns {Promise<object>} 주문 가능 정보
 */
async function getOrderChance(market) {
  return privateRequest('GET', '/orders/chance', { market });
}

// ============================================================
// 모듈 내보내기
// ============================================================
module.exports = {
  // 시세 조회
  getMarkets,
  filterMarkets,
  getCandles,
  getCandlesMinutes,
  getCandlesSeconds,
  getOrderbook,
  getTicker,
  
  // 거래
  getBalance,
  getKrwBalance,
  buyLimit,
  buyMarket,
  sellMarket,
  sellLimit,
  getOrder,
  cancelOrder,
  getOrderChance,
};
