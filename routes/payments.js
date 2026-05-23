const { Router } = require('express');
const router = Router();
const authMiddle = require('../middleware/auth.middleware');
const { requestQR, verifyQR, getHistory } = require('../controllers/payments.controller');

router.post('/request', authMiddle, requestQR);
router.post('/verify',  authMiddle, verifyQR);
router.get('/history',  authMiddle, getHistory);

module.exports = router;
