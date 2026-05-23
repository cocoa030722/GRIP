const { supabaseAdmin } = require('../lib/supabase');
const aiAnalyzer = require('../services/aiAnalyzer');

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

// GET /api/security/events  (admin only)
// ?limit=50&before=<id>
async function getEvents(req, res) {
  if (!requireAdmin(req, res)) return;

  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const before = req.query.before ? parseInt(req.query.before, 10) : null;

  let query = supabaseAdmin
    .from('security_events')
    .select('*')
    .order('id', { ascending: false })
    .limit(limit);

  if (before) query = query.lt('id', before);

  const { data: events, error } = await query;
  if (error) return fail(res, 500, 'SERVER_ERROR', '이벤트 목록을 불러올 수 없습니다.');

  return res.status(200).json({
    success: true,
    data: {
      events: events || [],
      next_cursor: events?.length === limit ? events.at(-1)?.id : null,
    },
  });
}

// POST /api/security/ai-analyze  (admin only)
// body: { user_id? }  — 생략 시 전체 대상 자동 선정
async function aiAnalyzeNow(req, res) {
  if (!requireAdmin(req, res)) return;

  if (process.env.DISABLE_AI === 'true')
    return fail(res, 503, 'AI_UNAVAILABLE', 'AI 분석 기능이 비활성화되어 있습니다.');

  if (typeof aiAnalyzer.runOnce !== 'function')
    return fail(res, 503, 'AI_UNAVAILABLE', 'AI 분석 서비스가 준비되지 않았습니다.');

  const targetUserId = req.body?.user_id || null;

  try {
    const result = await aiAnalyzer.runOnce(targetUserId);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return fail(res, 503, 'AI_UNAVAILABLE', 'AI 분석 중 오류가 발생하였습니다.');
  }
}

// GET /api/security/stream  (admin only, SSE)
async function streamEvents(req, res) {
  if (!requireAdmin(req, res)) return;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // 연결 시점의 최대 id를 시작점으로: 이전 이벤트는 전송하지 않음
  let lastId = 0;
  const { data: latest } = await supabaseAdmin
    .from('security_events')
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest?.id) lastId = latest.id;

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const timer = setInterval(async () => {
    const { data: newEvents } = await supabaseAdmin
      .from('security_events')
      .select('*')
      .gt('id', lastId)
      .order('id', { ascending: true });

    if (newEvents?.length) {
      for (const ev of newEvents) send(ev);
      lastId = newEvents.at(-1).id;
    }
  }, 2000);

  req.on('close', () => clearInterval(timer));
}

module.exports = { getEvents, aiAnalyzeNow, streamEvents };
