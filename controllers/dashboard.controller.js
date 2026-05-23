const { supabaseAdmin } = require('../lib/supabase');

function fail(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

function requireAdmin(req, res) {
  if (req.user?.role !== 'admin') {
    fail(res, 403, 'FORBIDDEN', '관리자만 접근할 수 있습니다.');
    return false;
  }
  return true;
}

// GET /api/dashboard/stats  (admin only)
// ?minutes=10
async function getStats(req, res) {
  if (!requireAdmin(req, res)) return;

  const minutes = Math.min(parseInt(req.query.minutes, 10) || 10, 60);
  const now     = Date.now();
  const since   = new Date(now - minutes * 60 * 1000).toISOString();

  const { data: events, error } = await supabaseAdmin
    .from('security_events')
    .select('event_type, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) return fail(res, 500, 'SERVER_ERROR', '통계를 불러올 수 없습니다.');

  // 1분 단위 버킷 집계 (오래된 순 → 최신 순, 차트 X축 기준)
  const buckets = [];
  for (let i = 0; i < minutes; i++) {
    const bucketStart = new Date(now - (minutes - i) * 60 * 1000);
    const bucketEnd   = new Date(bucketStart.getTime() + 60 * 1000);
    const counts = {};

    for (const ev of events || []) {
      const t = new Date(ev.created_at);
      if (t >= bucketStart && t < bucketEnd) {
        counts[ev.event_type] = (counts[ev.event_type] || 0) + 1;
      }
    }

    buckets.push({ minute: bucketStart.toISOString(), counts });
  }

  return res.status(200).json({ success: true, data: { buckets, minutes } });
}

// GET /api/dashboard/ai-alerts  (admin only)
// AI_ALERT 이벤트 중 block_recommendation=true이고 해당 user가 미차단인 것
async function getAiAlerts(req, res) {
  if (!requireAdmin(req, res)) return;

  const { data: events, error } = await supabaseAdmin
    .from('security_events')
    .select('*, user:user_id(id, email, is_blocked)')
    .eq('event_type', 'AI_ALERT')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return fail(res, 500, 'SERVER_ERROR', 'AI 권고 목록을 불러올 수 없습니다.');

  const alerts = (events || []).filter(
    (ev) => ev.detail?.block_recommendation === true && ev.user?.is_blocked === false
  );

  return res.status(200).json({ success: true, data: { alerts } });
}

// POST /api/admin/users/:id/block  (admin only)
async function blockUser(req, res) {
  if (!requireAdmin(req, res)) return;

  const { id } = req.params;
  const reason = req.body?.reason || 'AI 권고로 관리자가 차단하였습니다.';

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, is_blocked')
    .eq('id', id)
    .maybeSingle();

  if (!user) return fail(res, 404, 'NOT_FOUND', '사용자를 찾을 수 없습니다.');
  if (user.is_blocked) return fail(res, 400, 'INVALID_INPUT', '이미 차단된 사용자입니다.');

  const { error } = await supabaseAdmin
    .from('users')
    .update({ is_blocked: true, block_reason: reason, blocked_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return fail(res, 500, 'SERVER_ERROR', '차단 처리에 실패하였습니다.');

  return res.status(200).json({ success: true, data: { message: '사용자가 차단되었습니다.' } });
}

// POST /api/admin/users/:id/unblock  (admin only)
async function unblockUser(req, res) {
  if (!requireAdmin(req, res)) return;

  const { id } = req.params;

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, is_blocked')
    .eq('id', id)
    .maybeSingle();

  if (!user) return fail(res, 404, 'NOT_FOUND', '사용자를 찾을 수 없습니다.');
  if (!user.is_blocked) return fail(res, 400, 'INVALID_INPUT', '차단되지 않은 사용자입니다.');

  const { error } = await supabaseAdmin
    .from('users')
    .update({ is_blocked: false, block_reason: null, blocked_at: null })
    .eq('id', id);

  if (error) return fail(res, 500, 'SERVER_ERROR', '차단 해제에 실패하였습니다.');

  return res.status(200).json({ success: true, data: { message: '차단이 해제되었습니다.' } });
}

module.exports = { getStats, getAiAlerts, blockUser, unblockUser };
