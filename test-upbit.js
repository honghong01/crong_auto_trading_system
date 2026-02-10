#!/usr/bin/env node
/**
 * Upbit API 테스트 파일
 */

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const accessKey = process.env.UPBIT_ACCESS_KEY;
const secretKey = process.env.UPBIT_SECRET_KEY;

console.log('🧪 Upbit API 테스트');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Access Key:', accessKey ? accessKey.slice(0, 8) + '...' : 'NULL');
console.log('Secret Key:', secretKey ? secretKey.slice(0, 8) + '...' : 'NULL');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

async function testBalance() {
  console.log('\n📊 자산 조회 테스트...');
  
  const payload = {
    access_key: accessKey,
    nonce: uuidv4(),
  };
  
  const token = jwt.sign(payload, secretKey);
  
  const res = await fetch('https://api.upbit.com/v1/accounts', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  
  const data = await res.json();
  
  if (data.error) {
    console.log('❌ 오류:', data.error.name);
    return false;
  }
  
  console.log('✅ 자산 조회 성공!');
  data.forEach(asset => {
    const balance = parseFloat(asset.balance);
    if (balance > 0) {
      console.log(`   ${asset.currency}: ${balance.toLocaleString()} (평가: ${asset.avg_buy_price ? Math.round(balance * asset.avg_buy_price).toLocaleString() + '원' : '-'})`);
    }
  });
  
  return true;
}

testBalance().catch(e => console.error('오류:', e.message));
