#!/usr/bin/env node
/**
 * ============================================================
 * Crong Trader v1.0.0 - 메인 실행 파일
 * ============================================================
 * 
 * 마스터: 홍아름
 * 작성자: 크롱 🦖
 * 작성일: 2026-02-10
 * 
 * 24/7 자동 스캘핑 트레이딩 봇
 * 
 * ============================================================
 * 실행 방법:
 *   node index.js [시드머니] [사이클분]
 *   예: node index.js 10000 30
 * 
 * ============================================================
 * 전체 플로우:
 * 
 *   [시작] 입력변수 설정 (시드머니, max시간)
 *       ↓
 *   [스캔-1~4] 페어 스캐닝 & LLM 분석 → 최적 페어 1개 선정
 *       ↓
 *   ┌─────── 거래반복1 (max 30분) ───────┐
 *   │ [스캔-5] LLM 매수/익절/손절가 산출   │
 *   │ [관리-1] DB 저장 (거래 전)          │
 *   │ [거래-1] 지정가 매수 (시드 전액)     │
 *   │ [관리-2~3] DB 업데이트 (매수완료)    │
 *   │ [거래-2] 실시간 모니터링 → 익절/손절  │
 *   │ [관리-4~5] DB 업데이트 (매도완료)    │
 *   │ [관리-6] Notion 동기화              │
 *   │ [스캔-6] 데이터 재조회 → 반복        │
 *   └─────────────────────────────────┘
 *       ↓ (30분 경과)
 *   다시 [스캔-1]부터 반복 (24/7)
 * 
 * ============================================================
 */

const readline = require('readline');
const config = require('./config');
const { log, sleep, calculateProfitRate, toMySQLDateTime } = require('./utils');
const upbit = require('./upbit-api');
const db = require('./db');
const notion = require('./notion');
const llm = require('./llm-analyzer');

// ============================================================
// 런타임 설정 (실행 시 오버라이드됨)
// ============================================================
let SEED_MONEY = config.DEFAULT_SEED_MONEY;     // 시드머니
let MAX_CYCLE_TIME = config.DEFAULT_MAX_CYCLE_TIME;  // 사이클 최대 시간
let isRunning = false;  // 봇 실행 상태 플래그

/**
 * ============================================================
 * [시작] 마스터 입력 받기
 * ============================================================
 * 
 * 명령줄 인자로 시드머니와 사이클 시간을 받습니다.
 * 인자가 없으면 config의 기본값을 사용합니다.
 * 
 * @example
 * node index.js 10000 30  // 시드 1만원, 30분 사이클
 * node index.js           // 기본값 사용
 */
async function getInputFromMaster() {
  console.log('\n🦖 Crong Trader v' + config.VERSION);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 명령줄 인자 파싱: node index.js [시드머니] [사이클분]
  const args = process.argv.slice(2);
  SEED_MONEY = args[0] ? parseInt(args[0]) : config.DEFAULT_SEED_MONEY;
  MAX_CYCLE_TIME = args[1] ? parseInt(args[1]) * 60 * 1000 : config.DEFAULT_MAX_CYCLE_TIME;

  log('info', `설정 완료 - 시드머니: ${SEED_MONEY.toLocaleString()}원, 사이클: ${MAX_CYCLE_TIME / 60000}분`);
  return { seedMoney: SEED_MONEY, maxCycleTime: MAX_CYCLE_TIME };
}

/**
 * ============================================================
 * [스캔-1~2] 페어 스캔 및 필터링
 * ============================================================
 * 
 * 1. 업비트의 모든 KRW 마켓(원화 거래) 목록 조회
 * 2. market_event 정보를 기반으로 변동성 높은 페어 필터링
 *    - warning: 투자 경고
 *    - caution: 가격급등락, 거래량급증, 입금량급증
 * 3. 조건에 맞는 페어가 없으면 변동성 5% 이상 페어 선택
 */
async function scanPairs() {
  // [스캔-1] 전체 페어 목록 조회
  log('info', '[스캔-1] 페어 목록 조회 중...');
  const markets = await upbit.getMarkets();
  log('info', `총 ${markets.length}개 KRW 페어 조회됨`);

  // [스캔-2] 조건에 맞는 페어 필터링
  log('info', '[스캔-2] 조건에 맞는 페어 필터링 중...');
  let filtered = upbit.filterMarkets(markets);
  
  // 경고/주의 페어가 없으면 변동성 기준으로 폴백
  if (filtered.length === 0) {
    log('warn', '경고/주의 페어 없음. 상위 거래량 페어에서 변동성 체크...');
    const tickers = await upbit.getTicker(markets.slice(0, 30).map(m => m.market));
    filtered = markets.slice(0, 30).filter((m, i) => {
      const ticker = tickers.find(t => t.market === m.market);
      if (!ticker) return false;
      const volatility = Math.abs(ticker.signed_change_rate * 100);
      return volatility >= config.SCAN.MIN_VOLATILITY;
    });
  }

  log('info', `${filtered.length}개 페어 필터링됨`);
  return filtered;
}

/**
 * ============================================================
 * [스캔-3] 페어별 상세 데이터 조회
 * ============================================================
 * 
 * 필터링된 페어들의 상세 시세 데이터를 조회합니다.
 * - 캔들(OHLCV) 데이터: 가격 추세 분석용
 * - 호가 데이터: 매수/매도 압력 분석용
 * - 현재가 데이터: 변동률, 거래량 등
 * 
 * 최대 10개 페어만 분석하여 API 호출 최소화
 */
async function getPairDetails(markets) {
  log('info', '[스캔-3] 페어별 캔들/호가 데이터 조회 중...');
  const details = [];

  // 최대 10개 페어만 분석 (API 부하 방지)
  for (const market of markets.slice(0, 10)) {
    try {
      // 병렬로 데이터 조회 (성능 최적화)
      const [candles, orderbook, ticker] = await Promise.all([
        upbit.getCandles(market.market, config.SCAN.CANDLE_UNIT, config.SCAN.CANDLE_COUNT, config.SCAN.CANDLE_TYPE),
        upbit.getOrderbook(market.market),
        upbit.getTicker(market.market),
      ]);

      details.push({
        market: market.market,           // 마켓 코드 (예: KRW-BTC)
        koreanName: market.korean_name,  // 한글명 (예: 비트코인)
        candles: candles.slice(0, 50),   // LLM 토큰 절약을 위해 50개만
        orderbook,                       // 호가 데이터
        currentPrice: ticker[0].trade_price,           // 현재가
        changeRate: ticker[0].signed_change_rate * 100, // 변동률(%)
        volume24h: ticker[0].acc_trade_price_24h,      // 24시간 거래대금
      });

      await sleep(100);  // Rate limit 방지 (초당 10회 제한)
    } catch (e) {
      log('error', `${market.market} 데이터 조회 실패: ${e.message}`);
    }
  }

  return details;
}

/**
 * ============================================================
 * [스캔-4] LLM으로 최적 페어 선정
 * ============================================================
 * 
 * Claude API를 사용하여 수집된 데이터를 분석하고
 * 30분 내 상승 가능성이 가장 높은 페어 1개를 선정합니다.
 */
async function selectBestPair(pairsData) {
  log('info', '[스캔-4] LLM 분석으로 최적 페어 선정 중...');
  const result = await llm.selectBestPair(pairsData);
  log('success', `선정된 페어: ${result.selectedPair} (${result.koreanName}) - 신뢰도: ${(result.confidence * 100).toFixed(1)}%`);
  return result;
}

/**
 * ============================================================
 * [거래반복1] 메인 거래 루프
 * ============================================================
 * 
 * 선정된 페어로 실제 매매를 수행합니다.
 * 30분(설정 가능) 동안 반복하며:
 * 
 * 1. LLM에게 매수가/익절가/손절가 받기
 * 2. 지정가 매수 주문 → 미체결 시 시장가 전환
 * 3. 실시간 가격 모니터링
 * 4. 익절/손절/시간초과 시 시장가 매도
 * 5. DB & Notion에 기록
 * 6. 다음 거래를 위해 데이터 재조회
 * 
 * @param {object} selectedPair - 선정된 페어 정보
 * @param {object} pairDetail - 페어 상세 데이터
 */
async function tradingCycle(selectedPair, pairDetail) {
  const market = selectedPair.selectedPair;
  const koreanName = selectedPair.koreanName;

  log('info', `\n${'='.repeat(60)}`);
  log('info', `거래 실행: ${koreanName} (${market})`);
  log('info', `${'='.repeat(60)}\n`);

  // 🆕 [v1.0.2] 단일 거래 실행 (루프는 메인에서 관리)
  try {
      // ========================================
      // [스캔-5] LLM 매매가 분석
      // ========================================
      log('info', '[스캔-5] LLM 매매가 분석 중...');
      const candles = await upbit.getCandles(market, config.SCAN.CANDLE_UNIT, config.SCAN.CANDLE_COUNT, config.SCAN.CANDLE_TYPE);
      const orderbook = await upbit.getOrderbook(market);
      const ticker = await upbit.getTicker(market);
      const currentPrice = ticker[0].trade_price;

      // LLM에게 매수가, 익절가, 손절가 요청
      const tradeAnalysis = await llm.analyzeTradePrices(
        market, koreanName, candles, orderbook, currentPrice
      );

      // ========================================
      // [관리-1] DB에 거래 기록 생성
      // ========================================
      log('info', '[관리-1] DB에 거래 기록 생성...');
      const tradeId = await db.createTrade({
        coinNameKo: koreanName,
        buyPrice: tradeAnalysis.buyPrice,
        takeProfit: tradeAnalysis.takeProfit,
        stopLoss: tradeAnalysis.stopLoss,
      });

      // ========================================
      // [거래-1] 지정가 매수 주문
      // ========================================
      log('info', '[거래-1] 지정가 매수 주문 발송...');
      // 수수료(0.05%)를 고려하여 실제 매수 가능 금액 계산
      const buyVolume = (SEED_MONEY * 0.9995) / tradeAnalysis.buyPrice;
      const buyOrder = await upbit.buyLimit(market, tradeAnalysis.buyPrice, buyVolume);

      // ========================================
      // [관리-2] 매수 주문 발송 상태 업데이트
      // ========================================
      await db.updateBuyOrderSent(tradeId);

      // ========================================
      // [관리-3] 매수 체결 대기
      // ========================================
      log('info', '[관리-3] 매수 체결 대기 중...');
      let buyCompleted = false;
      let orderInfo = null;
      const buyStartTime = Date.now();

      // 주문 타임아웃까지 체결 확인 (기본 1분)
      while (!buyCompleted && Date.now() - buyStartTime < config.TRADE.ORDER_TIMEOUT) {
        orderInfo = await upbit.getOrder(buyOrder.uuid);
        
        // done: 체결 완료, cancel: 취소됨
        if (orderInfo.state === 'done' || orderInfo.state === 'cancel') {
          buyCompleted = orderInfo.state === 'done';
          break;
        }
        
        await sleep(1000);  // 1초 간격 체크
      }

      // 미체결 시 주문 취소 후 시장가 매수로 전환
      if (!buyCompleted) {
        log('warn', '매수 미체결 - 주문 취소 후 시장가 매수...');
        await upbit.cancelOrder(buyOrder.uuid);
        const marketBuyOrder = await upbit.buyMarket(market, SEED_MONEY);
        await sleep(2000);
        orderInfo = await upbit.getOrder(marketBuyOrder.uuid);
      }

      // 실제 체결 정보 추출
      const buyPrice = parseFloat(orderInfo.price) || tradeAnalysis.buyPrice;
      const executedVolume = parseFloat(orderInfo.executed_volume);
      const buyTotalAmount = buyPrice * executedVolume;

      // DB 매수 완료 업데이트
      await db.updateBuyComplete(tradeId, {
        buyTotalAmount,
        buyDatetime: toMySQLDateTime(new Date()),
        buyUnitPrice: buyPrice,
      });

      // ========================================
      // [거래-2] 실시간 모니터링 & 매도
      // ========================================
      log('info', '[거래-2] 실시간 가격 모니터링 중...');
      let sellTriggered = false;
      let sellReason = '';
      const holdStartTime = Date.now();

      // 익절/손절/시간초과까지 모니터링
      while (!sellTriggered) {
        const currentTicker = await upbit.getTicker(market);
        const price = currentTicker[0].trade_price;
        const elapsed = ((Date.now() - holdStartTime) / 60000).toFixed(1);
        const pnl = ((price - buyPrice) / buyPrice * 100).toFixed(2);

        // 실시간 상태 표시 (같은 줄에 덮어쓰기)
        process.stdout.write(`\r💹 현재가: ${price.toLocaleString()}원 | 손익: ${pnl}% | 경과: ${elapsed}분    `);

        // 익절 조건: 현재가 >= 익절가
        if (price >= tradeAnalysis.takeProfit) {
          sellTriggered = true;
          sellReason = '익절';
          log('success', `\n🎯 익절가 도달! ${price.toLocaleString()}원`);
        }
        // 손절 조건: 현재가 <= 손절가
        else if (price <= tradeAnalysis.stopLoss) {
          sellTriggered = true;
          sellReason = '손절';
          log('warn', `\n🚨 손절가 도달! ${price.toLocaleString()}원`);
        }
        // 🆕 [v1.0.3] 시간 초과는 메인 루프에서 관리하므로 여기서 제거

        if (!sellTriggered) {
          await sleep(500);  // 0.5초 간격 체크 (빠른 반응)
        }
      }

      // 시장가 매도 주문
      log('info', '[거래-2] 시장가 매도 주문...');
      const sellOrder = await upbit.sellMarket(market, executedVolume);

      // ========================================
      // [관리-4] 매도 체결 확인
      // ========================================
      log('info', '[관리-4] 매도 체결 확인 중...');
      await sleep(2000);
      let sellOrderInfo = await upbit.getOrder(sellOrder.uuid);

      // 매도 미체결 시 재확인
      if (sellOrderInfo.state !== 'done') {
        log('warn', '매도 미체결 - 재시도...');
        await sleep(3000);
        sellOrderInfo = await upbit.getOrder(sellOrder.uuid);
      }

      // 매도 체결 정보 추출
      const sellPrice = parseFloat(sellOrderInfo.price) || parseFloat(sellOrderInfo.trades?.[0]?.price) || 0;
      const sellTotalAmount = sellPrice * executedVolume;
      const profitAmount = sellTotalAmount - buyTotalAmount;
      const profitRate = calculateProfitRate(buyPrice, sellPrice);

      // ========================================
      // [관리-5] DB 매도 완료 업데이트
      // ========================================
      await db.updateSellComplete(tradeId, {
        sellTotalAmount,
        sellDatetime: toMySQLDateTime(new Date()),
        sellUnitPrice: sellPrice,
        profitRate,
        profitAmount,
      });

      // ========================================
      // [관리-6] Notion에 기록
      // ========================================
      log('info', '[관리-6] Notion에 거래 기록 저장...');
      await notion.saveTradeToNotion({
        coinNameKo: koreanName,
        orderStatus: sellReason === '익절' ? '매도완료' : (sellReason === '손절' ? '손절' : '매도완료'),
        systemVersion: config.VERSION,
        buyTotalAmount,
        buyDatetime: new Date(orderInfo.created_at).toISOString(),
        buyUnitPrice: buyPrice,
        sellTotalAmount,
        sellDatetime: new Date().toISOString(),
        sellUnitPrice: sellPrice,
        profitRate,
        profitAmount,
      });

      // 거래 완료 로그
      log('trade', `\n거래 완료: ${koreanName}`);
      log('trade', `매수: ${buyPrice.toLocaleString()}원 → 매도: ${sellPrice.toLocaleString()}원`);
      log('trade', `수익: ${profitAmount.toLocaleString()}원 (${profitRate.toFixed(2)}%)`);

    // 🆕 [v1.0.2] 거래 결과 반환 (연속 손절 체크용)
    return { result: sellReason, profitRate };

  } catch (error) {
    log('error', `거래 중 오류 발생: ${error.message}`);
    await sleep(5000);  // 오류 시 5초 대기 후 재시도
    return { result: 'error', profitRate: 0 };
  }
}

/**
 * ============================================================
 * 메인 함수
 * ============================================================
 * 
 * 봇의 진입점입니다.
 * 1. DB 초기화
 * 2. 설정 로드
 * 3. 무한 루프로 24/7 실행
 */
async function main() {
  try {
    // DB 연결 초기화
    await db.initDB();
    await getInputFromMaster();

    isRunning = true;
    log('success', '🚀 Crong Trader 시작!');

    // 24/7 무한 루프
    while (isRunning) {
      try {
        // [스캔-1~2] 페어 스캔
        const filteredPairs = await scanPairs();

        if (filteredPairs.length === 0) {
          log('warn', '거래 가능한 페어 없음. 5분 후 재시도...');
          await sleep(5 * 60 * 1000);
          continue;
        }

        // [스캔-3] 상세 데이터 조회
        const pairsData = await getPairDetails(filteredPairs);

        // [스캔-4] 최적 페어 선정
        const bestPair = await selectBestPair(pairsData);

        // 🆕 [변경] 진입 추천 종목이 없으면 거래 실행하지 않고 30분 대기
        if (bestPair === null) {
          log('warn', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          log('warn', '🚫 LLM 판단: 현재 진입할 만한 종목이 없습니다.');
          log('warn', `⏰ 다음 스캔까지 ${MAX_CYCLE_TIME / 60000}분 대기...`);
          log('warn', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          await sleep(MAX_CYCLE_TIME);  // 30분(설정값) 대기 후 재스캔
          continue;
        }

        const pairDetail = pairsData.find(p => p.market === bestPair.selectedPair);

        // 🆕 [v1.0.2] 연속 손절 카운터 및 거래 루프
        let consecutiveLosses = 0;
        const cycleStartTime = Date.now();

        // 30분 사이클 내에서 거래 반복
        while (Date.now() - cycleStartTime < MAX_CYCLE_TIME && isRunning) {
          // [거래반복1] 단일 거래 실행
          const tradeResult = await tradingCycle(bestPair, pairDetail);

          // 거래 결과에 따른 처리
          if (tradeResult.result === '손절') {
            consecutiveLosses++;
            log('warn', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            log('warn', `🔴 연속 손절: ${consecutiveLosses}회`);
            
            // 🆕 [v1.0.2] 2회 연속 손절 시 루프 중지 및 30분 슬립
            if (consecutiveLosses >= 2) {
              log('error', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
              log('error', `🛑 2회 연속 손절 발생! 거래 루프 중지`);
              log('error', `⏰ ${MAX_CYCLE_TIME / 60000}분 슬립 후 새로운 종목 스캔 시작...`);
              log('error', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
              await sleep(MAX_CYCLE_TIME);  // 30분 슬립
              break;  // 거래 루프 탈출 → 새로운 종목 스캔으로
            }
            log('warn', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          } else if (tradeResult.result === '익절') {
            consecutiveLosses = 0;  // 익절 시 연속 손절 카운터 리셋
            log('success', `🟢 익절 성공! 연속 손절 카운터 리셋`);
          } else if (tradeResult.result === '시간초과' || tradeResult.result === 'error') {
            // 시간초과나 에러는 연속 손절로 카운트하지 않음
            break;
          }

          // 다음 거래 전 잠시 대기
          await sleep(1000);
        }

        log('info', '\n다음 사이클 시작...\n');

      } catch (cycleError) {
        log('error', `사이클 오류: ${cycleError.message}`);
        await sleep(60000);  // 1분 대기 후 재시도
      }
    }

  } catch (error) {
    log('error', `치명적 오류: ${error.message}`);
    console.error(error);
  } finally {
    // 종료 시 DB 연결 정리
    await db.closeDB();
    log('info', 'Crong Trader 종료');
  }
}

// ============================================================
// 종료 시그널 처리 (Ctrl+C 등)
// ============================================================
process.on('SIGINT', () => {
  log('info', '\n종료 신호 수신...');
  isRunning = false;
});

process.on('SIGTERM', () => {
  log('info', '\n종료 신호 수신...');
  isRunning = false;
});

// ============================================================
// 실행
// ============================================================
main();
