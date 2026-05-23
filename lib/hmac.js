const crypto = require('crypto');

const SECRET = () => process.env.HMAC_SECRET || '';

// 서명 메시지: qr_id:merchant_id:lat(4f):lng(4f)
// amount/nonce는 merchant_qr_codes 스키마에 컬럼 없으므로 제외
function buildMessage(qrId, merchantId, lat, lng) {
  return `${qrId}:${merchantId}:${Number(lat).toFixed(4)}:${Number(lng).toFixed(4)}`;
}

function sign(qrId, merchantId, lat, lng) {
  const msg = buildMessage(qrId, merchantId, lat, lng);
  return crypto.createHmac('sha256', SECRET()).update(msg).digest('hex');
}

function verify(qrId, merchantId, lat, lng, signature) {
  if (!signature) return false;
  const expected = Buffer.from(sign(qrId, merchantId, lat, lng), 'hex');
  const actual   = Buffer.from(signature, 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = { sign, verify };
