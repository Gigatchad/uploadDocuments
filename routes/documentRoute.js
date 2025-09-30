const express = require('express');
const { submitDocumentRequest,uploadDocumentAndUpdateRequest,updateRequestStatus,getUserRequests,getAllRequests ,searchUserRequests} = require('../controllers/documentController');  // Importer le contrôleur
const router = express.Router();

// Route pour soumettre une demande de document
router.post('/submit', submitDocumentRequest);
router.post('/upload/:requestId', uploadDocumentAndUpdateRequest);
router.put('/updateStatus/:requestId', updateRequestStatus);
router.get('/getRequests', getUserRequests);
router.get('/getAllRequests', getAllRequests);
router.get('/searchRequests', searchUserRequests);
module.exports = router;
