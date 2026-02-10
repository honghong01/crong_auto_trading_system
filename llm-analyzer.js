/**
 * ============================================================
 * Crong Trader v1.0.0 - LLM Analyzer (Claude) 모듈
 * ============================================================
 * 
 * 마스터: 홍아름
 * 작성자: 크롱 🦖
 * 작성일: 2026-02-10
 * 
 * Claude API를 사용하여 시장 데이터를 분석하고
 * 매매 결정을 내리는 함수들입니다.
 * 
 * 주요 기능:
 * 1. 최적 페어 선정: 여러 코인 중 가장 유망한 것 선택
 * 2. 매매가 분석: 매수가, 익절가, 손절가 산출
 * 
 * 프롬프트 엔지니어링:
 * - 공격적인 스캘핑 전략 가정
 * - 30분 내 거래 완료 조건
 * - 수수료(0.05%) 고려
 * - JSON 형식 응답 강제
 * ============================================================
 */

const config = require('./config');
const { log } = require('./utils');

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

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
  
  // 시스템 프롬프트가 있으면 AI의 역할/성격 정의
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
 * [스캔-4] 최적 페어 선정
 * 
 * 여러 코인의 데이터를 분석하여 30분 내 상승 가능성이
 * 가장 높은 페어 1개를 선정합니다.
 * 
 * 분석 기준:
 * - RSI (과매수/과매도)
 * - MACD (추세)
 * - 볼린저밴드 (변동성)
 * - 거래량
 * - 호가 스프레드
 * 
 * @param {array} pairsData - 페어별 시세 데이터
 * @returns {Promise<object>} 선정 결과
 * 
 * @example
 * const result = await selectBestPair(pairsData);
 * // {
 * //   selectedPair: 'KRW-BTC',
 * //   koreanName: '비트코인',
 * //   confidence: 0.85,
 * //   reason: '...',
 * //   expectedReturn: 1.5
 * // }
 */
async function selectBestPair(pairsData) {
  // 시스템 프롬프트: AI의 역할 정의
  const systemPrompt = `당신은 공격적인 암호화폐 스캘핑 트레이더입니다.
주어진 데이터를 분석하여 30분 내 상승 가능성이 가장 높은 페어 1개를 선정해야 합니다.
RSI, MACD, 볼린저밴드, 거래량, 호가 스프레드 등을 종합적으로 분석하세요.
응답은 반드시 JSON 형식으로만 해주세요.`;

  // 사용자 프롬프트: 분석할 데이터와 응답 형식 지정
  const prompt = `다음 암호화폐 페어들의 데이터를 분석하고, 30분 내 상승 가능성이 가장 높은 페어 1개를 선정해주세요.

페어 데이터:
${JSON.stringify(pairsData, null, 2)}

다음 JSON 형식으로만 응답해주세요:
{
  "selectedPair": "KRW-XXX",
  "koreanName": "코인명",
  "confidence": 0.0~1.0,
  "reason": "선정 이유",
  "expectedReturn": 예상수익률(%)
}`;

  const response = await askClaude(prompt, systemPrompt);
  
  try {
    // 응답에서 JSON 추출 (마크다운 코드블록 등 처리)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
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
 * 고려 사항:
 * - 초단타(스캘핑) 전략
 * - 업비트 수수료 0.05%
 * - 30분 내 거래 완료 목표
 * - 현재 호가 상황
 * 
 * @param {string} market - 마켓 코드
 * @param {string} koreanName - 한글 코인명
 * @param {array} candles - 캔들 데이터
 * @param {object} orderbook - 호가 데이터
 * @param {number} currentPrice - 현재가
 * @returns {Promise<object>} 분석 결과
 * 
 * @example
 * const result = await analyzeTradePrices('KRW-BTC', '비트코인', candles, orderbook, 50000000);
 * // {
 * //   buyPrice: 49900000,
 * //   takeProfit: 50200000,
 * //   stopLoss: 49700000,
 * //   expectedHoldTime: "15분",
 * //   riskRewardRatio: 1.5,
 * //   analysis: "..."
 * // }
 */
async function analyzeTradePrices(market, koreanName, candles, orderbook, currentPrice) {
  const systemPrompt = `당신은 공격적인 암호화폐 스캘핑 트레이더입니다.
초단타 거래를 위한 매수가, 익절가, 손절가를 산출해야 합니다.
업비트 수수료는 0.05%입니다. 수수료를 고려하여 수익이 나는 가격을 제시하세요.
30분 내 거래가 완료되어야 함을 고려하세요.
응답은 반드시 JSON 형식으로만 해주세요.`;

  const prompt = `다음 ${koreanName}(${market})의 데이터를 분석하고, 스캘핑 매매를 위한 가격을 제시해주세요.

현재가: ${currentPrice}원
수수료: 0.05% (매수/매도 각각)

최근 캔들 데이터 (최신 20개):
${JSON.stringify(candles.slice(0, 20), null, 2)}

호가 데이터:
${JSON.stringify(orderbook, null, 2)}

다음 JSON 형식으로만 응답해주세요:
{
  "buyPrice": 매수 희망가(원),
  "takeProfit": 익절가(원),
  "stopLoss": 손절가(원),
  "expectedHoldTime": "예상 보유 시간",
  "riskRewardRatio": 손익비,
  "analysis": "분석 요약"
}`;

  const response = await askClaude(prompt, systemPrompt);
  
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
  askClaude,
  selectBestPair,
  analyzeTradePrices,
};
