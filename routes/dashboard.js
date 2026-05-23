const { Router } = require('express');
const router = Router();
const authMiddle = require('../middleware/auth.middleware');
const { getStats, getAiAlerts } = require('../controllers/dashboard.controller');

router.get('/stats',     authMiddle, getStats);
router.get('/ai-alerts', authMiddle, getAiAlerts);

module.exports = router;
