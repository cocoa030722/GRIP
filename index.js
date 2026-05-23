require('dotenv').config();
const express = require('express');
const path = require('path');
const { supabase } = require('./lib/supabase');
const aiAnalyzer = require('./services/aiAnalyzer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/security', require('./routes/security'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/health', async (req, res) => {
  const result = { server: 'ok', db: 'unknown' };

  if (!supabase) {
    result.db = 'not_configured';
  } else {
    try {
      const { error } = await supabase.auth.getSession();
      result.db = error ? 'error' : 'ok';
    } catch {
      result.db = 'error';
    }
  }

  const ok = result.db === 'ok';
  if (ok) {
    res.status(200).json({ success: true, data: result });
  } else {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: '데이터베이스 상태가 비정상입니다.', detail: result } });
  }
});

const server = app.listen(PORT, () => {
  console.log(`GRIP server  → http://localhost:${PORT}`);
  console.log(`Health check → http://localhost:${PORT}/api/health`);
  aiAnalyzer.startAnalysisLoop();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[오류] 포트 ${PORT}가 이미 사용 중입니다.`);
    console.error(`실행 중인 서버를 먼저 종료하거나 PORT 환경변수를 변경하세요.`);
    process.exit(1);
  } else {
    throw err;
  }
});
