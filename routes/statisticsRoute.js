const express = require('express');
const router = express.Router();
const { getStatistics } = require('../controllers/statisticsController');  // Importer le contrôleur des statistiques

// Route pour récupérer les statistiques
router.get('/statistics', getStatistics);

module.exports = router;
