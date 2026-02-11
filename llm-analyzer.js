/**
 * ============================================================
 * Crong Trader v1.0.0 - LLM Analyzer (Gemini / Claude)
 * ============================================================
 * 
 * 마스터: 홍아름
 * 작성자: 크롱 🦖
 * 작성일: 2026-02-10
 * 
 * LLM API를 사용하여 시장 데이터를 분석하고
 * 매매 결정을 내리는 함수들입니다.
 * 
 * 지원 LLM:
 * - Gemini (기본, 비용 효율적)
 * - Claude (백업, 고성능)
 * 
 * config.js의 LLM.PROVIDER 설정으로 선택 가능
 * ============================================================
 */

const config = require('./config');
const { log } = require('./utils');

// API 엔드포인트
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

/**
 * Gemini API 호출
 * 
 * @param {string} prompt - 사용자 프롬프트
 * @param {string} systemPrompt - 시스템 프롬프트 (AI 역할 정의)
 * @returns {Promise<string>} AI 응답 텍스트
 */
async function askGemini(prompt, systemPrompt = null) {
  const model = config.GEMINI.MODEL;
  const url = `${GEMINI_API}/${model}:generateContent?key=${config.GEMINI.API_KEY}`;

  // Gemini 요청 본문 구성
  const contents = [];
  
  // 시스템 프롬프트가 있으면 먼저 추가
  if (systemPrompt) {
    contents.push({
      role: 'user',
      parts: [{ text: systemPrompt }]
    });
    contents.push({
      role: 'model',
      parts: [{ text: '네, 이해했습니다. 해당 역할로 분석하겠습니다.' }]
    });
  }
  
  // 사용자 프롬프트 추가
  contents.push({
    role: 'user',
    parts: [{ text: prompt }]
  });

  const body = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,  // 응답 잘림 방지를 위해 증가
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Gemini API Error: ${res.status} - ${error}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Claude API 호출
 * 
 * @param {string} prompt - 사용자 프롬프트
 * @param {string} systemPrompt - 시스템 프롬프트 (AI 역할 정의)
 * @returns {Promise<string>} AI 응답 텍스트
 */
async function askClaude(prompt, systemPrompt = null) {
  const messages = [{ role: 'user', content: prompt }];
  
  const body = {
    model: config.CLAUDE.MODEL,
    max_tokens: 2048,
    messages,
  };
  
  if (systemPrompt) {
    body.system = systemPrompt;
  }
  
  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'x-api-key': config.CLAUDE.API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Claude API Error: ${res.status} - ${error}`);
  }
  
  const data = await res.json();
  return data.content[0].text;
}

/**
 * LLM 호출 (Provider에 따라 분기)
 * 
 * config.LLM.PROVIDER 설정에 따라 Gemini 또는 Claude를 호출합니다.
 * 
 * @param {string} prompt - 사용자 프롬프트
 * @param {string} systemPrompt - 시스템 프롬프트
 * @returns {Promise<string>} AI 응답 텍스트
 */
async function askLLM(prompt, systemPrompt = null) {
  const provider = config.LLM.PROVIDER;
  
  if (provider === 'gemini') {
    return askGemini(prompt, systemPrompt);
  } else if (provider === 'claude') {
    return askClaude(prompt, systemPrompt);
  } else {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

/**
 * [스캔-3.5] 데이터 충분성 확인 및 추가 정보 요청
 * 
 * LLM에게 현재 데이터가 분석에 충분한지 확인하고,
 * 부족한 경우 어떤 추가 정보가 필요한지 파악합니다.
 * 
 * @param {array} pairsData - 페어별 시세 데이터
 * @returns {Promise<object>} 충분성 체크 결과 및 추가 필요 정보
 */
async function checkDataSufficiency(pairsData) {
  // 🆕 간소화: 기본 지표(RSI, MACD, 볼린저)는 항상 필요하므로 LLM 호출 생략
  // 직접 필요한 지표 목록 반환
  return {
    isSufficient: false,
    additionalDataNeeded: ['rsi', 'macd', 'bollinger']
  };
}

/**
 * [스캔-3.6] 추가 기술적 지표 계산
 * 
 * LLM이 요청한 추가 지표를 계산하여 데이터에 추가합니다.
 * 
 * @param {array} pairsData - 페어별 시세 데이터
 * @param {array} additionalDataNeeded - 필요한 추가 지표 목록
 * @returns {array} 보강된 페어 데이터
 */
function enrichPairsData(pairsData, additionalDataNeeded) {
  return pairsData.map(pair => {
    const enrichedPair = { ...pair };
    const candles = pair.candles || [];
    const closes = candles.map(c => c.trade_price);

    // RSI 계산 (14기간)
    if (additionalDataNeeded.includes('rsi') && closes.length >= 14) {
      enrichedPair.rsi = calculateRSI(closes, 14);
    }

    // 단순이동평균 (SMA)
    if (additionalDataNeeded.includes('sma') || additionalDataNeeded.includes('ma')) {
      enrichedPair.sma5 = calculateSMA(closes, 5);
      enrichedPair.sma20 = calculateSMA(closes, 20);
    }

    // 볼린저밴드
    if (additionalDataNeeded.includes('bollinger') && closes.length >= 20) {
      enrichedPair.bollinger = calculateBollinger(closes, 20);
    }

    // MACD (12, 26, 9)
    if (additionalDataNeeded.includes('macd') && closes.length >= 26) {
      enrichedPair.macd = calculateMACD(closes);
    }

    return enrichedPair;
  });
}

// RSI 계산 함수
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i - 1] - prices[i]; // 최신이 앞에 있음
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// 단순이동평균 계산
function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  const sum = prices.slice(0, period).reduce((a, b) => a + b, 0);
  return sum / period;
}

// 볼린저밴드 계산
function calculateBollinger(prices, period = 20) {
  const sma = calculateSMA(prices, period);
  if (!sma) return null;
  
  const squaredDiffs = prices.slice(0, period).map(p => Math.pow(p - sma, 2));
  const stdDev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / period);
  
  return {
    upper: sma + (stdDev * 2),
    middle: sma,
    lower: sma - (stdDev * 2),
    bandwidth: ((sma + stdDev * 2) - (sma - stdDev * 2)) / sma * 100
  };
}

// MACD 계산
function calculateMACD(prices) {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  if (!ema12 || !ema26) return null;
  
  const macdLine = ema12 - ema26;
  return { macdLine, ema12, ema26 };
}

// 지수이동평균 계산
function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(-period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = prices.length - period - 1; i >= 0; i--) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}

/**
 * [스캔-4] 최적 페어 선정 (데이터 충분성 확인 포함)
 * 
 * 여러 코인의 데이터를 분석하여 30분 내 상승 가능성이
 * 가장 높은 페어 1개를 선정합니다.
 * 
 * 🆕 변경사항:
 * - LLM에게 데이터 충분성을 먼저 확인
 * - 부족한 데이터는 자동으로 계산하여 보강
 * - 진입 추천이 없으면 null 반환 (거래 스킵용)
 * 
 * @param {array} pairsData - 페어별 시세 데이터
 * @returns {Promise<object|null>} 선정 결과 (추천 없으면 null)
 */
async function selectBestPair(pairsData) {
  // [스캔-3.5] 기본 지표 자동 추가 (LLM 호출 생략)
  log('info', '[스캔-3.5] 기본 지표(RSI, MACD, 볼린저) 계산 중...');
  const sufficiencyCheck = await checkDataSufficiency(pairsData);
  
  // [스캔-3.6] 지표 계산
  let enrichedData = enrichPairsData(pairsData, sufficiencyCheck.additionalDataNeeded);

  // 🆕 데이터 요약 (토큰 절약)
  const summaryData = enrichedData.map(p => ({
    market: p.market,
    name: p.koreanName,
    price: p.currentPrice,
    change: p.changeRate?.toFixed(2) + '%',
    vol24h: (p.volume24h / 1e9).toFixed(1) + 'B',
    rsi: p.rsi?.toFixed(1),
    macd: p.macd?.macdLine?.toFixed(2),
    bbPos: p.bollinger ? ((p.currentPrice - p.bollinger.lower) / (p.bollinger.upper - p.bollinger.lower) * 100).toFixed(0) + '%' : null
  }));

  const systemPrompt = `암호화폐 스캘퍼. 30분 내 상승 가능성 높은 페어 1개 선정. 
⚠️ 중요: 하락 추세(change가 음수이고 MACD 음수)인 코인은 절대 선정하지 마세요!
기회 없으면 noEntry:true. JSON만 응답.`;

  const prompt = `페어 분석 후 JSON 응답 (하락 추세 코인 제외!):
${JSON.stringify(summaryData)}

응답형식: {"noEntry":false,"selectedPair":"KRW-XXX","koreanName":"이름","confidence":0.8,"reason":"이유","expectedReturn":1.5}
또는: {"noEntry":true,"reason":"모든 코인이 하락 추세"}`;

  const response = await askLLM(prompt, systemPrompt);
  
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      
      // 🆕 진입 추천이 없는 경우 null 반환
      if (result.noEntry === true) {
        log('warn', `LLM 판단: 진입 기회 없음 - ${result.reason}`);
        return null;
      }
      
      // 🆕 신뢰도가 너무 낮은 경우도 스킵 (0.5 미만)
      if (result.confidence < 0.5) {
        log('warn', `LLM 판단: 신뢰도 부족 (${(result.confidence * 100).toFixed(1)}%) - ${result.reason}`);
        return null;
      }
      
      return result;
    }
    throw new Error('JSON 형식을 찾을 수 없습니다.');
  } catch (e) {
    log('error', 'LLM 응답 파싱 실패', { response });
    throw e;
  }
}

/**
 * [스캔-5] 매수가, 익절가, 손절가 산출
 * 
 * 선정된 페어의 상세 데이터를 분석하여
 * 구체적인 매매 가격을 산출합니다.
 * 
 * @param {string} market - 마켓 코드
 * @param {string} koreanName - 한글 코인명
 * @param {array} candles - 캔들 데이터
 * @param {object} orderbook - 호가 데이터
 * @param {number} currentPrice - 현재가
 * @returns {Promise<object>} 분석 결과
 */
async function analyzeTradePrices(market, koreanName, candles, orderbook, currentPrice) {
  // 🆕 캔들 데이터 요약 (고가, 저가, 종가만)
  const recentCandles = candles.slice(0, 10).map(c => ({
    h: c.high_price,
    l: c.low_price,
    c: c.trade_price
  }));
  
  // 🆕 호가 요약 (상위 3개씩만)
  const askTop3 = orderbook.orderbook_units?.slice(0, 3).map(u => u.ask_price) || [];
  const bidTop3 = orderbook.orderbook_units?.slice(0, 3).map(u => u.bid_price) || [];

  const systemPrompt = `스캘퍼. 30분 내 매매가(매수/익절/손절) 산출. 수수료 0.05% 고려. JSON만 응답.`;

  const prompt = `${koreanName}(${market}) 현재가:${currentPrice}
캔들(최근10):${JSON.stringify(recentCandles)}
매도호가:${askTop3} 매수호가:${bidTop3}

응답:{"buyPrice":숫자,"takeProfit":숫자,"stopLoss":숫자,"analysis":"요약"}`;

  const response = await askLLM(prompt, systemPrompt);
  
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      log('info', `LLM 분석 결과: 매수 ${result.buyPrice}, 익절 ${result.takeProfit}, 손절 ${result.stopLoss}`);
      return result;
    }
    throw new Error('JSON 형식을 찾을 수 없습니다.');
  } catch (e) {
    log('error', 'LLM 응답 파싱 실패', { response });
    throw e;
  }
}

// ============================================================
// 모듈 내보내기
// ============================================================
module.exports = {
  askLLM,
  askGemini,
  askClaude,
  selectBestPair,
  analyzeTradePrices,
};
