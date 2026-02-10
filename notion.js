/**
 * ============================================================
 * Crong Trader v1.0.0 - Notion API 모듈
 * ============================================================
 * 
 * 마스터: 홍아름
 * 작성자: 크롱 🦖
 * 작성일: 2026-02-10
 * 
 * 거래 기록을 Notion에 동기화하는 함수들입니다.
 * 
 * 구조:
 * - 부모 페이지: 코인거래 이력 (PARENT_PAGE_ID)
 *   └─ 주간 DB: 거래기록 2/10~2/16 (매주 자동 생성)
 *       └─ 개별 거래 레코드
 * 
 * 주간 DB는 필요할 때 자동으로 생성됩니다.
 * ============================================================
 */

const config = require('./config');
const { log, getWeekRange } = require('./utils');

const NOTION_API = 'https://api.notion.com/v1';
const API_KEY = config.NOTION.API_KEY;
const PARENT_PAGE_ID = config.NOTION.PARENT_PAGE_ID;

// 주간 DB ID 캐시 (매번 API 호출 방지)
let weeklyDbCache = {};

/**
 * Notion API 요청 공통 함수
 * 
 * @param {string} method - HTTP 메서드
 * @param {string} endpoint - API 엔드포인트
 * @param {object} body - 요청 본문 (선택)
 * @returns {Promise<object>} API 응답
 */
async function notionRequest(method, endpoint, body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Notion-Version': '2022-06-28',  // Notion API 버전
      'Content-Type': 'application/json',
    },
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const res = await fetch(`${NOTION_API}${endpoint}`, options);
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Notion API Error: ${res.status} - ${error}`);
  }
  return res.json();
}

/**
 * 주간 DB 조회 또는 생성
 * 
 * 현재 주에 해당하는 DB가 있으면 반환하고,
 * 없으면 새로 생성합니다.
 * 
 * @returns {Promise<string>} 주간 DB ID
 * 
 * @example
 * const dbId = await getOrCreateWeeklyDb();
 * // 없으면 "거래기록 2/10~2/16" 형태의 DB 생성
 */
async function getOrCreateWeeklyDb() {
  const week = getWeekRange();
  const dbTitle = `거래기록 ${week.label}`;
  
  // 캐시에 있으면 바로 반환
  if (weeklyDbCache[week.label]) {
    return weeklyDbCache[week.label];
  }
  
  // 부모 페이지의 자식 블록(DB) 조회
  const children = await notionRequest('GET', `/blocks/${PARENT_PAGE_ID}/children`);
  
  // 해당 주의 DB가 있는지 확인
  for (const block of children.results) {
    if (block.type === 'child_database' && block.child_database?.title === dbTitle) {
      weeklyDbCache[week.label] = block.id;
      log('info', `기존 주간 DB 발견: ${dbTitle}`);
      return block.id;
    }
  }
  
  // 없으면 새 DB 생성
  log('info', `새 주간 DB 생성: ${dbTitle}`);
  const newDb = await notionRequest('POST', '/databases', {
    parent: { type: 'page_id', page_id: PARENT_PAGE_ID },
    title: [{ type: 'text', text: { content: dbTitle } }],
    
    // DB 컬럼(속성) 정의
    properties: {
      // 코인명 (제목 컬럼 - 필수)
      '코인명': { title: {} },
      
      // 주문 상태 (선택)
      '주문상태': {
        select: {
          options: [
            { name: '매수완료', color: 'blue' },
            { name: '매도완료', color: 'green' },
            { name: '손절', color: 'red' },
          ],
        },
      },
      
      // 기타 속성들
      '시스템버전': { rich_text: {} },
      '매수금액': { number: { format: 'number' } },
      '매수일시': { date: {} },
      '매수단가': { number: { format: 'number' } },
      '매도금액': { number: { format: 'number' } },
      '매도일시': { date: {} },
      '매도단가': { number: { format: 'number' } },
      '수익률(%)': { number: { format: 'percent' } },
      '수익금(원)': { number: { format: 'number' } },
    },
  });
  
  weeklyDbCache[week.label] = newDb.id;
  return newDb.id;
}

/**
 * [관리-6] Notion에 거래 기록 저장
 * 
 * 거래 완료 후 Notion 주간 DB에 기록을 추가합니다.
 * 
 * @param {object} trade - 거래 데이터
 * @param {string} trade.coinNameKo - 한글 코인명
 * @param {string} trade.orderStatus - 주문 상태
 * @param {string} trade.systemVersion - 시스템 버전
 * @param {number} trade.buyTotalAmount - 매수 총액
 * @param {string} trade.buyDatetime - 매수 일시 (ISO 형식)
 * @param {number} trade.buyUnitPrice - 매수 단가
 * @param {number} trade.sellTotalAmount - 매도 총액
 * @param {string} trade.sellDatetime - 매도 일시 (ISO 형식)
 * @param {number} trade.sellUnitPrice - 매도 단가
 * @param {number} trade.profitRate - 수익률 (%)
 * @param {number} trade.profitAmount - 수익금 (원)
 * @returns {Promise<string>} 생성된 페이지 ID
 */
async function saveTradeToNotion(trade) {
  const dbId = await getOrCreateWeeklyDb();
  
  // Notion 페이지 속성 설정
  const properties = {
    '코인명': {
      title: [{ text: { content: trade.coinNameKo } }],
    },
    '주문상태': {
      select: { name: trade.orderStatus },
    },
    '시스템버전': {
      rich_text: [{ text: { content: trade.systemVersion } }],
    },
    '매수금액': {
      number: trade.buyTotalAmount,
    },
    '매수일시': {
      date: { start: trade.buyDatetime },
    },
    '매수단가': {
      number: trade.buyUnitPrice,
    },
    '매도금액': {
      number: trade.sellTotalAmount,
    },
    '매도일시': {
      date: { start: trade.sellDatetime },
    },
    '매도단가': {
      number: trade.sellUnitPrice,
    },
    '수익률(%)': {
      number: trade.profitRate / 100,  // Notion은 0.01 = 1%로 표시
    },
    '수익금(원)': {
      number: trade.profitAmount,
    },
  };
  
  // 새 페이지(레코드) 생성
  const page = await notionRequest('POST', '/pages', {
    parent: { database_id: dbId },
    properties,
  });
  
  log('success', `Notion 거래 기록 저장 완료: ${trade.coinNameKo}`);
  return page.id;
}

// ============================================================
// 모듈 내보내기
// ============================================================
module.exports = {
  getOrCreateWeeklyDb,
  saveTradeToNotion,
};
