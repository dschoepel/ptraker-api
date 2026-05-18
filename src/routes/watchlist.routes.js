'use strict';

const express = require('express');
const router = express.Router();
const watchlistController = require('../controllers/watchlist.controller');
const { requireAuth } = require('../middleware/auth');

// GET /api/v1/watchlist
router.get('/', requireAuth, watchlistController.getAll);

// GET /api/v1/watchlist/search
router.get('/search', requireAuth, watchlistController.search);

// GET /api/v1/watchlist/:ticker/history
router.get('/:ticker/history', requireAuth, watchlistController.getHistory);

// POST /api/v1/watchlist
router.post('/', requireAuth, watchlistController.add);

// PATCH /api/v1/watchlist/:ticker
router.patch('/:ticker', requireAuth, watchlistController.update);

// DELETE /api/v1/watchlist/:ticker
router.delete('/:ticker', requireAuth, watchlistController.remove);

module.exports = router;
