const { Router } = require('express');
const router = Router();
const authMiddle = require('../middleware/auth.middleware');
const { streamEvents, getEvents, aiAnalyzeNow } = require('../controllers/security.controller');

// SSE 먼저 등록 (express가 /stream을 /events 앞에 매칭하도록)
router.get('/stream',     authMiddle, streamEvents);
router.get('/events',     authMiddle, getEvents);
router.post('/ai-analyze', authMiddle, aiAnalyzeNow);

module.exports = router;
