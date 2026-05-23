const R = 6371000; // 지구 반지름 (미터)

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// 두 GPS 좌표 간 거리 반환 (미터, DOUBLE)
function distance(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

module.exports = { distance };
