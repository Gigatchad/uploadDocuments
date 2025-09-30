const { db } = require('../firebase');  // Importer Firestore
const admin = require('firebase-admin');

// Fonction pour récupérer les statistiques
const getStatistics = async (req, res) => {
  try {
    // Total Documents : Récupérer tous les documents
    const totalDocumentsSnapshot = await db.collection('document_requests').get();
    const totalDocuments = totalDocumentsSnapshot.size;

    // Processed Documents : Documents où le statut est "Terminé"
    const processedDocumentsSnapshot = await db.collection('document_requests').where('status', '==', 'Terminé').get();
    const processedDocuments = processedDocumentsSnapshot.size;

    // Rejected Documents : Documents où le statut est "Rejeté"
    const rejectedDocumentsSnapshot = await db.collection('document_requests').where('status', '==', 'Rejeté').get();
    const rejectedDocuments = rejectedDocumentsSnapshot.size;

    // Pending Documents : Documents où le statut est "En attente"
    const pendingDocumentsSnapshot = await db.collection('document_requests').where('status', '==', 'En attente').get();
    const pendingDocuments = pendingDocumentsSnapshot.size;

    // Total Requests : Nombre total de demandes
    const totalRequestsSnapshot = await db.collection('document_requests').get();
    const totalRequests = totalRequestsSnapshot.size;

    // Processed Requests : Demandes avec statut "Terminé"
    const processedRequestsSnapshot = await db.collection('document_requests').where('status', '==', 'Terminé').get();
    const processedRequests = processedRequestsSnapshot.size;

    // Pending Requests : Demandes avec statut "En attente"
    const pendingRequestsSnapshot = await db.collection('document_requests').where('status', '==', 'En attente').get();
    const pendingRequests = pendingRequestsSnapshot.size;

    // Organiser les statistiques dans un objet
    const statistics = {
      totalDocuments,
      processedDocuments,
      rejectedDocuments,
      pendingDocuments,
      totalRequests,
      processedRequests,
      pendingRequests,
    };

    // Répondre avec les statistiques
    res.status(200).json({
      message: 'Statistiques récupérées avec succès',
      statistics,
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques', error);
    res.status(500).json({ message: 'Erreur interne du serveur' });
  }
};

module.exports = { getStatistics };
