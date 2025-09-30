const cloudinary = require('../cloudinaryConfig');  // Importer la configuration Cloudinary
const { db } = require('../firebase');  // Importer Firestore
const admin = require('firebase-admin');

// Fonction pour envoyer une notification FCM à un utilisateur (étudiant/parent)
const sendNotificationToUser = async (fcmToken, title, body) => {
  try {
    if (!fcmToken) {
      throw new Error('Token FCM manquant');
    }

    const message = {
      notification: {
        title: title,
        body: body,
      },
      token: fcmToken,
    };

    await admin.messaging().send(message);
    console.log('Notification envoyée avec succès à l\'utilisateur');
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la notification', error);
  }
};

// Fonction pour envoyer une notification FCM aux administrateurs et au personnel
const sendNotificationToAdminsAndStaff = async () => {
  try {
    // Récupérer les tokens FCM des administrateurs et du personnel
    const staffSnapshot = await db.collection('users')
      .where('role', 'in', ['admin', 'personnel'])
      .get();

    const tokens = [];
    staffSnapshot.forEach(doc => {
      const userData = doc.data();
      if (userData.fcmToken) {
        tokens.push(userData.fcmToken);
      }
    });

    if (tokens.length > 0) {
      const message = {
        notification: {
          title: 'Nouvelle demande de document',
          body: 'Une nouvelle demande de document a été soumise. Veuillez la traiter.',
        },
        tokens: tokens,
      };

      await admin.messaging().sendMulticast(message);
      console.log('Notification envoyée avec succès aux administrateurs et au personnel');
    }
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la notification', error);
  }
};

// Fonction pour soumettre une demande de document
const submitDocumentRequest = async (req, res) => {
  const { documentType, message } = req.body;  // Récupérer `documentType` et `message` de la requête
  const idToken = req.headers.authorization?.split(' ')[1];  // Récupérer le `idToken` depuis le header "Authorization" (Bearer token)

  if (!idToken) {
    return res.status(401).json({ message: 'Token manquant ou invalide' });  // Si le token est manquant, renvoyer une erreur 401
  }

  try {
    // Vérifier le `idToken` Firebase pour authentifier l'utilisateur et récupérer le `uid`
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Récupérer le `uid` de l'utilisateur
    const { uid } = decodedToken;

    // Créer un objet de demande de document avec uniquement le `uid`, `documentType` et `message`
    const newRequest = {
      userId: uid,  // Utiliser le `uid` de l'utilisateur récupéré du `idToken`
      documentType: documentType,  // Type de document demandé
      message: message,  // Message associé à la demande
      status: "En attente",  // Statut initial de la demande
      createdAt: admin.firestore.FieldValue.serverTimestamp(),  // Date de création
      rejectionReason: "",  // Raison du rejet (par défaut vide)
      rejectedOrAccepted: "",  // Le champ pour "rejeter" ou "accepter", initialisé à vide
      fileUrl: ""  // URL du fichier (par défaut vide)
    };

    // Ajouter la demande à la collection "document_requests" dans Firestore
    const docRef = await db.collection('document_requests').add(newRequest);

    // Envoi de la notification aux administrateurs et au personnel
    await sendNotificationToAdminsAndStaff();  // Appel à la fonction qui envoie la notification FCM

    // Répondre avec succès et l'ID de la demande
    res.status(200).json({
      message: "Demande soumise avec succès",
      requestId: docRef.id,  // Retourner l'ID de la demande créée
    });
  } catch (error) {
    console.error("Erreur lors de la soumission de la demande", error);
    res.status(500).json({ message: "Erreur interne du serveur" });
  }
};

// Fonction pour télécharger le document et mettre à jour la demande
const uploadDocumentAndUpdateRequest = async (req, res) => {
  const { requestId } = req.params;  // Récupérer l'ID de la demande depuis les paramètres de l'URL
  const idToken = req.headers.authorization?.split(' ')[1];  // Récupérer le `idToken` depuis le header "Authorization"
  const file = req.files?.file;  // Récupérer le fichier envoyé par le staff depuis `req.files`

  // Vérification du token et du fichier
  if (!idToken) {
    return res.status(400).json({ message: 'Token manquant' });
  }
  if (!file) {
    return res.status(400).json({ message: 'Fichier manquant' });
  }

  try {
    // Vérifier le `idToken` Firebase pour authentifier le staff
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    const uid = decodedToken.uid;

    // Récupérer les données de l'utilisateur depuis Firestore
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const userData = userDoc.data();

    // Vérifier si le rôle de l'utilisateur est 'personnel'
    if (userData.role !== 'personnel') {
      return res.status(403).json({ message: 'Accès refusé : utilisateur non autorisé' });
    }

    // Télécharger le fichier sur Cloudinary en utilisant le buffer du fichier
    const cloudinaryResponse = await cloudinary.uploader.upload(file.data, {
      folder: 'documents',  // Dossier sur Cloudinary
      resource_type: 'auto',  // Détecter automatiquement le type de fichier (image, vidéo, etc.)
    });

    const fileUrl = cloudinaryResponse.secure_url;

    // Récupérer la demande depuis Firestore
    const requestDoc = await db.collection('document_requests').doc(requestId).get();

    if (!requestDoc.exists) {
      return res.status(404).json({ message: 'Demande non trouvée' });
    }

    // Mettre à jour le statut de la demande et enregistrer l'URL du fichier
    await db.collection('document_requests').doc(requestId).update({
      status: 'Terminé',  // Mettre à jour le statut à "Terminé"
      fileUrl: fileUrl,   // Enregistrer l'URL du fichier téléchargé
    });

    // Récupérer les données de l'utilisateur (étudiant/parent) pour envoyer la notification
    const userDocRef = await db.collection('users').doc(requestDoc.data().userId).get();
    const user = userDocRef.data();

    // Envoi de la notification à l'utilisateur
    const notificationTitle = 'Document téléchargé avec succès';
    const notificationBody = 'Votre demande de document a été traitée et le fichier est maintenant disponible.';
    await sendNotificationToUser(user.fcmToken, notificationTitle, notificationBody);

    // Répondre avec succès
    res.status(200).json({
      message: 'Document téléchargé et demande mise à jour avec succès',
      fileUrl: fileUrl,
    });

  } catch (error) {
    console.error('Erreur lors du téléchargement du fichier et de la mise à jour de la demande', error);
    res.status(500).json({ message: 'Erreur interne du serveur' });
  }
};
const updateRequestStatus = async (req, res) => {
  const { requestId } = req.params;  // Récupérer l'ID de la demande depuis les paramètres de l'URL
  const { rejectedOrAccepted, rejectionReason } = req.body;  // Récupérer le statut et la raison de rejet
  const idToken = req.headers.authorization?.split(' ')[1];  // Récupérer le `idToken` depuis le header "Authorization"

  // Vérification du token
  if (!idToken) {
    return res.status(400).json({ message: 'Token manquant' });
  }

  try {
    // Vérifier le `idToken` Firebase pour authentifier l'utilisateur
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // Récupérer les données de l'utilisateur depuis Firestore
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const userData = userDoc.data();

    // Vérifier si l'utilisateur est admin ou personnel
    if (userData.role !== 'personnel' && userData.role !== 'admin') {
      return res.status(403).json({ message: 'Accès refusé : utilisateur non autorisé' });
    }

    // Récupérer la demande depuis Firestore
    const requestDoc = await db.collection('document_requests').doc(requestId).get();

    if (!requestDoc.exists) {
      return res.status(404).json({ message: 'Demande non trouvée' });
    }

    const requestData = requestDoc.data();

    // Logique de mise à jour en fonction de l'acceptation ou du rejet
    if (rejectedOrAccepted === 'rejected') {
      // Si la demande est rejetée, ajouter la raison du rejet
      await db.collection('document_requests').doc(requestId).update({
        status: 'Rejetée',
        rejectedOrAccepted: 'rejected',
        rejectionReason: rejectionReason || 'Raison non fournie',  // Ajouter la raison du rejet
      });
    } else if (rejectedOrAccepted === 'accepted') {
      // Si la demande est acceptée, mettre à jour le statut
      await db.collection('document_requests').doc(requestId).update({
        status: 'En cours de traitement',
        rejectedOrAccepted: 'accepted',
        rejectionReason: '',  // Clear rejection reason
      });
    }

    // Répondre avec succès
    res.status(200).json({ message: 'Statut de la demande mis à jour avec succès' });
  } catch (error) {
    console.error("Erreur lors de la mise à jour de la demande", error);
    res.status(500).json({ message: "Erreur interne du serveur" });
  }
};
const getUserRequests = async (req, res) => {
  const idToken = req.headers.authorization?.split(' ')[1];  // Récupérer le `idToken` depuis le header "Authorization"

  if (!idToken) {
    return res.status(400).json({ message: 'Token manquant' });  // Vérifier si le token est manquant
  }

  try {
    // Vérifier le `idToken` Firebase pour authentifier l'utilisateur et récupérer le `uid`
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid } = decodedToken;

    // Récupérer les données de l'utilisateur depuis Firestore
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const userData = userDoc.data();

    // Si l'utilisateur est admin ou personnel, retourner toutes les demandes (pas pour cette route, mais dans le cas de l'admin/personnel)
    if (userData.role === 'admin' || userData.role === 'personnel') {
      return res.status(403).json({ message: 'Accès interdit : l\'admin et le personnel ne peuvent pas accéder à cette route' });
    }

    // Si l'utilisateur est étudiant/parent, retourner **seules** ses demandes
    const userRequestsSnapshot = await db.collection('document_requests')
      .where('userId', '==', uid)
      .get();

    const userRequests = [];
    userRequestsSnapshot.forEach(doc => {
      userRequests.push(doc.data());
    });

    return res.status(200).json({
      message: 'Demandes de l\'utilisateur récupérées avec succès',
      requests: userRequests,
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des demandes', error);
    res.status(500).json({ message: 'Erreur interne du serveur' });
  }
};
const getAllRequests = async (req, res) => {
  const idToken = req.headers.authorization?.split(' ')[1];  // Récupérer le `idToken` depuis le header "Authorization"

  if (!idToken) {
    return res.status(400).json({ message: 'Token manquant' });  // Vérifier si le token est manquant
  }

  try {
    // Vérifier le `idToken` Firebase pour authentifier l'utilisateur et récupérer le `uid`
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid } = decodedToken;

    // Récupérer les données de l'utilisateur depuis Firestore
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const userData = userDoc.data();

    // Vérifier si l'utilisateur est admin ou personnel
    if (userData.role !== 'admin' && userData.role !== 'personnel') {
      return res.status(403).json({ message: 'Accès refusé : utilisateur non autorisé' });
    }

    // Si l'utilisateur est admin ou personnel, récupérer toutes les demandes
    const allRequestsSnapshot = await db.collection('document_requests').get();
    const allRequests = [];
    allRequestsSnapshot.forEach(doc => {
      allRequests.push(doc.data());
    });

    return res.status(200).json({
      message: 'Toutes les demandes récupérées avec succès',
      requests: allRequests,
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des demandes', error);
    res.status(500).json({ message: 'Erreur interne du serveur' });
  }
};
const searchUserRequests = async (req, res) => {
  const idToken = req.headers.authorization?.split(' ')[1];  // Récupérer le `idToken` depuis le header "Authorization"
  const { documentType, status } = req.query;  // Récupérer `documentType` et `status` depuis les paramètres de la requête (query params)

  if (!idToken) {
    return res.status(400).json({ message: 'Token manquant' });  // Vérifier si le token est manquant
  }

  try {
    // Vérifier le `idToken` Firebase pour authentifier l'utilisateur et récupérer le `uid`
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid } = decodedToken;

    // Récupérer les données de l'utilisateur depuis Firestore
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const userData = userDoc.data();

    // Si l'utilisateur est admin ou personnel, on peut rechercher toutes les demandes
    if (userData.role === 'admin' || userData.role === 'personnel') {
      let query = db.collection('document_requests');

      // Appliquer les filtres pour le `documentType` et le `status` si fournis
      if (documentType) {
        query = query.where('documentType', '==', documentType);
      }
      if (status) {
        query = query.where('status', '==', status);
      }

      const snapshot = await query.get();
      const requests = [];
      snapshot.forEach(doc => {
        requests.push(doc.data());
      });

      return res.status(200).json({
        message: 'Demandes récupérées avec succès',
        requests: requests,
      });
    }

    // Si l'utilisateur est étudiant/parent, on filtre par `uid` et appliquer la recherche sur documentType et status
    let userRequestsQuery = db.collection('document_requests').where('userId', '==', uid);

    if (documentType) {
      userRequestsQuery = userRequestsQuery.where('documentType', '==', documentType);
    }
    if (status) {
      userRequestsQuery = userRequestsQuery.where('status', '==', status);
    }

    const userRequestsSnapshot = await userRequestsQuery.get();
    const userRequests = [];
    userRequestsSnapshot.forEach(doc => {
      userRequests.push(doc.data());
    });

    return res.status(200).json({
      message: 'Demandes de l\'utilisateur récupérées avec succès',
      requests: userRequests,
    });

  } catch (error) {
    console.error('Erreur lors de la recherche des demandes', error);
    res.status(500).json({ message: 'Erreur interne du serveur' });
  }
};
module.exports = { submitDocumentRequest, uploadDocumentAndUpdateRequest ,updateRequestStatus,getUserRequests,getAllRequests,searchUserRequests};
