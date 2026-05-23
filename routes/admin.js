const { Router } = require('express');
const router = Router();
const authMiddle = require('../middleware/auth.middleware');
const { blockUser, unblockUser } = require('../controllers/dashboard.controller');

router.post('/users/:id/block',   authMiddle, blockUser);
router.post('/users/:id/unblock', authMiddle, unblockUser);

module.exports = router;
