const { supabaseAdmin } = require('../lib/supabase');
const localAI = require('../lib/localAI');

const ABNORMAL_TYPES = ['INVALID_QR', 'REPLAY_QR', 'LOCATION_MISMATCH', 'SQLI_BLOCKED', 'BRUTE_FORCE'];

const SYSTEM_PROMPT = `당신은 결제 보안 시스템의 이상 행동 분석 AI입니다.
반드시 한국어로만 답변하세요.
다음 JSON 스키마만 출력하고 다른 텍스트는 절대 출력하지 마세요:

{
  "risk_level": "HIGH" | "MEDIUM" | "LOW",
  "patterns": ["감지된 패턴 설명 (한국어)"],
  "reason_ko": "관리자를 위한 상세 분석 (한국어, 2~3문장)",
  "block_recommendation": true | false,
  "user_message_ko": "차단 시 사용자에게 보여줄 메시지 (한국어, 1문장)"
}`;

// 조건 A: 최근 5분 내 비정상 이벤트 3회 이상
function meetsConditionA(events) {
  const since = Date.now() - 5 * 60 * 1000;
  const count = events.filter(
    (ev) => ABNORMAL_TYPES.includes(ev.event_type) && new Date(ev.created_at).getTime() >= since
  ).length;
  return count >= 3;
}

// 조건 B: 최근 1시간 내 비정상 이벤트 5회 이상, 각 인접 이벤트 간격이 모두 2분 이상 (의도적 회피 패턴)
function meetsConditionB(events) {
  const since = Date.now() - 60 * 60 * 1000;
  const sorted = events
    .filter((ev) => ABNORMAL_TYPES.includes(ev.event_type) && new Date(ev.created_at).getTime() >= since)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  if (sorted.length < 5) return false;

  for (let i = 1; i < sorted.length; i++) {
    const gap = new Date(sorted[i].created_at) - new Date(sorted[i - 1].created_at);
    if (gap < 2 * 60 * 1000) return false;
  }
  return true;
}

// 분석 대상 user 목록 선정 (is_blocked=false 인 user만)
async function selectTargets() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: events } = await supabaseAdmin
    .from('security_events')
    .select('user_id, event_type, created_at')
    .in('event_type', ABNORMAL_TYPES)
    .gte('created_at', oneHourAgo)
    .not('user_id', 'is', null);

  if (!events?.length) return [];

  // user_id별 그루핑
  const byUser = {};
  for (const ev of events) {
    (byUser[ev.user_id] ??= []).push(ev);
  }

  const candidateIds = Object.keys(byUser).filter(
    (uid) => meetsConditionA(byUser[uid]) || meetsConditionB(byUser[uid])
  );

  if (!candidateIds.length) return [];

  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, email')
    .in('id', candidateIds)
    .eq('is_blocked', false);

  return users || [];
}

// user 한 명을 분석하고 AI_ALERT 이벤트 저장 → alert 객체 반환 (실패 시 null)
async function analyzeUser(user) {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [{ data: secEvents }, { data: txns }] = await Promise.all([
    supabaseAdmin
      .from('security_events')
      .select('event_type, created_at, detail')
      .eq('user_id', user.id)
      .gte('created_at', since24h)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('transactions')
      .select('amount, created_at')
      .or(`consumer_id.eq.${user.id},merchant_id.eq.${user.id}`)
      .gte('created_at', since24h)
      .order('created_at', { ascending: true }),
  ]);

  const eventLines = secEvents?.length
    ? secEvents.map((ev) => `${ev.created_at} ${ev.event_type} ${JSON.stringify(ev.detail || {})}`).join('\n')
    : '(없음)';

  const txnLines = txns?.length
    ? txns.map((tx) => `${tx.created_at} 금액: ${tx.amount}`).join('\n')
    : '(없음)';

  const userPrompt =
    `분석 대상: ${user.email} (user_id: ${user.id})\n` +
    `분석 시각: ${new Date().toISOString()}\n\n` +
    `[최근 security_events]\n${eventLines}\n\n` +
    `[최근 transactions]\n${txnLines}\n\n` +
    `위 데이터를 바탕으로 이 사용자의 위험도를 분석하세요.`;

  // localAI.ask() → JSON object | null (파싱까지 완료된 상태로 반환)
  const result = await localAI.ask(SYSTEM_PROMPT, userPrompt);
  if (!result) return null;

  // 필수 필드 검증: 파싱은 됐지만 스키마 불일치 시 폐기
  if (
    !['HIGH', 'MEDIUM', 'LOW'].includes(result.risk_level) ||
    !Array.isArray(result.patterns) ||
    typeof result.block_recommendation !== 'boolean'
  ) {
    return null;
  }

  const model =
    process.env.OLLAMA_URL
      ? (process.env.OLLAMA_MODEL || 'gemma4')
      : process.env.GEMMA_API_KEY
      ? 'gemma-4'
      : 'unknown';

  await supabaseAdmin.from('security_events').insert({
    event_type: 'AI_ALERT',
    user_id: user.id,
    detail: {
      analyzed_user_id: user.id,
      risk_level: result.risk_level,
      patterns: result.patterns,
      reason_ko: result.reason_ko || '',
      block_recommendation: result.block_recommendation,
      user_message_ko: result.user_message_ko || '',
      model,
    },
  });

  return { user_id: user.id, email: user.email, ...result };
}

// POST /api/security/ai-analyze 에서 직접 호출
// targetUserId 지정 시 해당 user만, null이면 자동 선정
async function runOnce(targetUserId = null) {
  if (process.env.DISABLE_AI === 'true') return { count: 0, alerts: [] };

  let targets;
  if (targetUserId) {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('id', targetUserId)
      .eq('is_blocked', false)
      .maybeSingle();
    targets = user ? [user] : [];
  } else {
    targets = await selectTargets();
  }

  const alerts = [];
  for (const user of targets) {
    const alert = await analyzeUser(user);
    if (alert) alerts.push(alert);
  }

  return { count: targets.length, alerts };
}

// 서버 기동 시 index.js에서 호출
function startAnalysisLoop() {
  if (process.env.DISABLE_AI === 'true') return;

  const intervalMs =
    (parseInt(process.env.AI_ANALYSIS_INTERVAL_MINUTES, 10) || 5) * 60 * 1000;

  setInterval(() => {
    runOnce(null).catch(() => {});
  }, intervalMs);
}

module.exports = { startAnalysisLoop, runOnce };
