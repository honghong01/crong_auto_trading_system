/**
 * ============================================================
 * Crong Trader v1.0.0 - MySQL Database 모듈
 * ============================================================
 * 
 * 마스터: 홍아름
 * 작성자: 크롱 🦖
 * 작성일: 2026-02-10
 * 
 * 거래 이력을 로컬 MySQL 데이터베이스에 저장/조회하는 함수들입니다.
 * 
 * 테이블 구조 (upbit_trade.trades):
 * - id: 자동 증가 PK
 * - coin_name_ko: 한글 코인명
 * - llm_analysis_buy_price: LLM 분석 매수가
 * - llm_analysis_take_profit: LLM 분석 익절가
 * - llm_analysis_stop_loss: LLM 분석 손절가
 * - order_status: 주문 상태 (거래전, 매수주문발송, 매수완료, 매도완료)
 * - system_version: 시스템 버전
 * - buy_total_amount: 매수 총액
 * - buy_datetime: 매수 일시
 * - buy_unit_price: 매수 단가
 * - sell_total_amount: 매도 총액
 * - sell_datetime: 매도 일시
 * - sell_unit_price: 매도 단가
 * - realized_profit_rate: 실현 수익률 (%)
 * - realized_profit_amount: 실현 수익금 (원)
 * - created_at: 레코드 생성 시간
 * ============================================================
 */

const mysql = require('mysql2/promise');
const config = require('./config');
const { log } = require('./utils');

// 데이터베이스 연결 풀
let pool = null;

/**
 * DB 연결 풀 초기화
 * 
 * 애플리케이션 시작 시 한 번 호출합니다.
 * 연결 풀을 사용하면 매 쿼리마다 연결을 새로 맺지 않아 성능이 향상됩니다.
 * 
 * @returns {Promise<Pool>} MySQL 연결 풀
 */
async function initDB() {
  pool = mysql.createPool({
    ...config.DB,
    waitForConnections: true,  // 연결 대기 허용
    connectionLimit: 10,       // 최대 동시 연결 수
    queueLimit: 0,             // 대기열 무제한
  });
  
  log('info', 'MySQL 연결 풀 초기화 완료');
  return pool;
}

/**
 * DB 연결 풀 가져오기
 * 
 * @returns {Pool} MySQL 연결 풀
 * @throws {Error} 초기화되지 않은 경우
 */
function getPool() {
  if (!pool) {
    throw new Error('DB가 초기화되지 않았습니다. initDB()를 먼저 호출하세요.');
  }
  return pool;
}

/**
 * [관리-1] 거래 시작 - 새 레코드 생성
 * 
 * LLM 분석 결과를 받아 새로운 거래 레코드를 생성합니다.
 * 초기 상태는 '거래전'입니다.
 * 
 * @param {object} data - 거래 데이터
 * @param {string} data.coinNameKo - 한글 코인명
 * @param {number} data.buyPrice - LLM 분석 매수가
 * @param {number} data.takeProfit - LLM 분석 익절가
 * @param {number} data.stopLoss - LLM 분석 손절가
 * @returns {Promise<number>} 생성된 레코드 ID
 */
async function createTrade(data) {
  const sql = `
    INSERT INTO trades (
      coin_name_ko, 
      llm_analysis_buy_price, 
      llm_analysis_take_profit, 
      llm_analysis_stop_loss,
      order_status, 
      system_version
    ) VALUES (?, ?, ?, ?, ?, ?)
  `;
  
  const values = [
    data.coinNameKo,
    data.buyPrice,
    data.takeProfit,
    data.stopLoss,
    '거래전',        // 초기 상태
    config.VERSION,  // 현재 시스템 버전
  ];
  
  const [result] = await getPool().execute(sql, values);
  log('info', `거래 레코드 생성: ID ${result.insertId}`);
  return result.insertId;
}

/**
 * [관리-2] 매수 주문 발송 상태 업데이트
 * 
 * 매수 주문을 Upbit에 발송한 후 상태를 업데이트합니다.
 * 
 * @param {number} tradeId - 거래 레코드 ID
 */
async function updateBuyOrderSent(tradeId) {
  const sql = `UPDATE trades SET order_status = ? WHERE id = ?`;
  await getPool().execute(sql, ['매수주문발송', tradeId]);
  log('info', `거래 ${tradeId}: 매수주문발송`);
}

/**
 * [관리-3] 매수 완료 업데이트
 * 
 * 매수 주문이 체결된 후 실제 매수 정보를 업데이트합니다.
 * 
 * @param {number} tradeId - 거래 레코드 ID
 * @param {object} data - 매수 완료 데이터
 * @param {number} data.buyTotalAmount - 매수 총액
 * @param {string} data.buyDatetime - 매수 일시 (MySQL DATETIME 형식)
 * @param {number} data.buyUnitPrice - 매수 단가
 */
async function updateBuyComplete(tradeId, data) {
  const sql = `
    UPDATE trades SET 
      order_status = ?,
      buy_total_amount = ?,
      buy_datetime = ?,
      buy_unit_price = ?
    WHERE id = ?
  `;
  
  const values = [
    '매수완료',
    data.buyTotalAmount,
    data.buyDatetime,
    data.buyUnitPrice,
    tradeId,
  ];
  
  await getPool().execute(sql, values);
  log('info', `거래 ${tradeId}: 매수완료 (${data.buyUnitPrice}원)`);
}

/**
 * [관리-5] 매도 완료 업데이트
 * 
 * 매도 주문이 체결된 후 최종 거래 결과를 업데이트합니다.
 * 
 * @param {number} tradeId - 거래 레코드 ID
 * @param {object} data - 매도 완료 데이터
 * @param {number} data.sellTotalAmount - 매도 총액
 * @param {string} data.sellDatetime - 매도 일시
 * @param {number} data.sellUnitPrice - 매도 단가
 * @param {number} data.profitRate - 실현 수익률 (%)
 * @param {number} data.profitAmount - 실현 수익금 (원)
 */
async function updateSellComplete(tradeId, data) {
  const sql = `
    UPDATE trades SET 
      order_status = ?,
      sell_total_amount = ?,
      sell_datetime = ?,
      sell_unit_price = ?,
      realized_profit_rate = ?,
      realized_profit_amount = ?
    WHERE id = ?
  `;
  
  const values = [
    '매도완료',
    data.sellTotalAmount,
    data.sellDatetime,
    data.sellUnitPrice,
    data.profitRate,
    data.profitAmount,
    tradeId,
  ];
  
  await getPool().execute(sql, values);
  log('success', `거래 ${tradeId}: 매도완료 (수익률: ${data.profitRate.toFixed(2)}%)`);
}

/**
 * 거래 조회
 * 
 * @param {number} tradeId - 거래 레코드 ID
 * @returns {Promise<object|null>} 거래 데이터
 */
async function getTrade(tradeId) {
  const sql = `SELECT * FROM trades WHERE id = ?`;
  const [rows] = await getPool().execute(sql, [tradeId]);
  return rows[0] || null;
}

/**
 * 최근 거래 목록 조회
 * 
 * @param {number} limit - 조회 개수
 * @returns {Promise<array>} 거래 목록
 */
async function getRecentTrades(limit = 10) {
  const sql = `SELECT * FROM trades ORDER BY created_at DESC LIMIT ?`;
  const [rows] = await getPool().execute(sql, [limit]);
  return rows;
}

/**
 * DB 연결 종료
 * 
 * 애플리케이션 종료 시 호출하여 연결을 정리합니다.
 */
async function closeDB() {
  if (pool) {
    await pool.end();
    log('info', 'MySQL 연결 종료');
  }
}

// ============================================================
// 모듈 내보내기
// ============================================================
module.exports = {
  initDB,
  getPool,
  createTrade,
  updateBuyOrderSent,
  updateBuyComplete,
  updateSellComplete,
  getTrade,
  getRecentTrades,
  closeDB,
};
