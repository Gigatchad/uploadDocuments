const axios = require('axios');
const { admin, db } = require('../firebase'); // Assurez-vous que la configuration de Firebase est correcte
const { sendEmail } = require('../services/emailService');

const firebaseAuthUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`;
const firebaseAuthUrlcode = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${process.env.FIREBASE_API_KEY}`; 
// Fonction pour connecter l'admin
const loginAdmin = async (req, res) => {
  const { email, password, fcmToken } = req.body;  // Ajouter fcmToken dans la requête

  try {
    // Authentification via Firebase Authentication REST
    const response = await axios.post(firebaseAuthUrl, {
      email,
      password,
      returnSecureToken: true,  // Obtenir un token
    });

    const idToken = response.data.idToken; // Token Firebase

    // Vérifier les claims du token JWT (rôle admin, email vérifié)
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    // Vérification que l'utilisateur est un admin
    if (decodedToken.role !== 'admin') {
      return res.status(403).json({ message: 'Accès refusé : utilisateur non administrateur' });
    }

    if (!decodedToken.email_verified) {
      return res.status(403).json({ message: 'Accès refusé : email non vérifié' });
    }

    // Enregistrer le token FCM dans Firestore
    await saveFCMToken(decodedToken.uid, fcmToken);  // Enregistrer le token FCM dans Firestore

    // Répondre avec le token et les informations de l'admin
    res.status(200).json({
      message: 'Connexion réussie',
      uid: decodedToken.uid,
      role: decodedToken.role,
      email: decodedToken.email,
      token: idToken, // Inclure le token pour les futures requêtes sécurisées
    });
  } catch (error) {
    console.error('Erreur de connexion:', error);
    res.status(500).json({ message: 'Erreur de connexion. Veuillez réessayer.' });
  }
};

// Fonction pour récupérer le profil d'un utilisateur
const getProfile = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];  // "Bearer <token>"

    if (!token) {
      return res.status(401).json({ message: 'Token manquant' });
    }

    // Vérifier le token avec Firebase Admin SDK
    const decodedToken = await admin.auth().verifyIdToken(token);

    const { email, uid } = decodedToken;

    // Chercher les informations de l'utilisateur dans Firestore
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const userData = userDoc.data();
    const { firstName, lastName } = userData;

    res.status(200).json({
      firstName,
      lastName,
      email
    });
  } catch (error) {
    console.error('Erreur de récupération du profil:', error);
    res.status(500).json({ message: 'Erreur interne du serveur' });
  }
};

// Fonction pour récupérer tous les utilisateurs
const getAllUsers = async (req, res) => {
  try {
    // Récupérer l'ID de l'utilisateur courant à partir du token
    const token = req.headers.authorization?.split(' ')[1];  // "Bearer <token>"
    if (!token) {
      return res.status(401).json({ message: 'Token manquant' });
    }

    // Vérifier le token avec Firebase Admin SDK
    const decodedToken = await admin.auth().verifyIdToken(token);
    const { uid } = decodedToken;

    // Vérifier que l'utilisateur est un admin
    if (decodedToken.role !== 'admin') {
      return res.status(403).json({ message: 'Accès refusé : seul un administrateur peut accéder à cette route' });
    }

    // Récupérer tous les utilisateurs dans Firestore
    const usersSnapshot = await db.collection('users').get();
    const users = [];

    // Ajouter les utilisateurs à la liste, en excluant l'utilisateur courant
    usersSnapshot.forEach(doc => {
      const userData = doc.data();
      if (doc.id !== uid) {  // Ne pas inclure l'utilisateur courant
        users.push({
          uid: doc.id,
          firstName: userData.firstName || "",  // Remplacer undefined par ""
          lastName: userData.lastName || "",    // Remplacer undefined par ""
          email: userData.email || "",          // Remplacer undefined par ""
          role: userData.role || "",            // Remplacer undefined par ""
          promotion: userData.promotion || "",  // Remplacer undefined par ""
          specialty: userData.specialty || "",  // Remplacer undefined par ""
        });
      }
    });

    // Retourner la liste des utilisateurs
    res.status(200).json(users);
  } catch (error) {
    console.error('Erreur de récupération des utilisateurs:', error);
    res.status(500).json({ message: 'Erreur interne du serveur' });
  }
};


// Fonction pour ajouter un utilisateur
const addUser = async (req, res) => { 
  const { firstName, lastName, email, password, role, promotion, specialty } = req.body;

  try {
    const adminToken = req.headers.authorization.split(' ')[1];
    const decodedToken = await admin.auth().verifyIdToken(adminToken);

    if (decodedToken.role !== 'admin') {
      return res.status(403).send('Accès interdit : seuls les administrateurs peuvent ajouter un utilisateur.');
    }

    // Créer un utilisateur dans Firebase Authentication
    const user = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: `${firstName} ${lastName}`,
      emailVerified: false,
      disabled: false,
    });

    // Si un champ est undefined ou null, on remplace par une chaîne vide
    const userRef = db.collection('users').doc(user.uid);
    await userRef.set({
      firstName: firstName || '',  // Remplacer undefined par une chaîne vide
      lastName: lastName || '',    // Remplacer undefined par une chaîne vide
      email: email || '',          // Remplacer undefined par une chaîne vide
      role: role || '',            // Remplacer undefined par une chaîne vide
      promotion: promotion || '',  // Remplacer undefined par une chaîne vide
      specialty: specialty || '',  // Remplacer undefined par une chaîne vide
      createdAt: admin.firestore.FieldValue.serverTimestamp(), // Timestamp de la création
      status: "inactive",  // Statut initial à "inactive"
    });

    // Envoyer un email à l'utilisateur (avec son email et son mot de passe)
    await sendEmail(email, password);

    res.status(201).send('Utilisateur ajouté avec succès et un email a été envoyé.');
  } catch (error) {
    console.error('Erreur lors de l\'ajout de l\'utilisateur', error);
    res.status(500).send('Une erreur s\'est produite lors de l\'ajout de l\'utilisateur.');
  }
};


// Fonction pour récupérer un utilisateur par son ID
const getUserById = async (req, res) => {
  const userId = req.params.id; // Récupérer l'ID de l'utilisateur depuis l'URL

  try {
    // Vérifier le token de l'administrateur
    const adminToken = req.headers.authorization.split(' ')[1]; // Extraire le token de l'en-tête
    const decodedToken = await admin.auth().verifyIdToken(adminToken);
    
    if (decodedToken.role !== 'admin') {
      return res.status(403).send('Accès interdit : seuls les administrateurs peuvent consulter les utilisateurs.');
    }

    // Récupérer l'utilisateur depuis Firestore avec l'ID
    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).send('Utilisateur non trouvé');
    }

    const userData = userDoc.data();

    // Retourner les informations de l'utilisateur
    res.status(200).json({
      firstName: userData.firstName || "",    // Utilisation des valeurs vides par défaut
      lastName: userData.lastName || "",      // Utilisation des valeurs vides par défaut
      email: userData.email || "",            // Utilisation des valeurs vides par défaut
      role: userData.role || "",              // Utilisation des valeurs vides par défaut
      promotion: userData.promotion || "",    // Utilisation des valeurs vides par défaut
      specialty: userData.specialty || "",    // Utilisation des valeurs vides par défaut
    });

  } catch (error) {
    console.error('Erreur lors de la récupération de l\'utilisateur:', error);
    res.status(500).send('Une erreur s\'est produite lors de la récupération de l\'utilisateur.');
  }
};


// Fonction pour mettre à jour un utilisateur
const updateUser = async (req, res) => {
  const { firstName, lastName, email, role, promotion, specialty } = req.body;
  const { id } = req.params; // L'ID de l'utilisateur à modifier

  try {
    // Vérification de l'authentification de l'admin via le token
    const adminToken = req.headers.authorization.split(' ')[1]; // Extraire le token de l'en-tête
    const decodedToken = await admin.auth().verifyIdToken(adminToken);

    // Vérifier si l'utilisateur est un administrateur
    if (decodedToken.role !== 'admin') {
      return res.status(403).send('Accès interdit : seuls les administrateurs peuvent modifier un utilisateur.');
    }

    // Vérifier que l'ID de l'utilisateur est valide
    const userRef = db.collection('users').doc(id);

    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).send('Utilisateur non trouvé.');
    }

    // Mettre à jour les informations de l'utilisateur
    await userRef.update({
      firstName: firstName || "", // Remplacer undefined par une chaîne vide
      lastName: lastName || "",   // Remplacer undefined par une chaîne vide
      email: email || "",         // Remplacer undefined par une chaîne vide
      role: role || "",           // Remplacer undefined par une chaîne vide
      promotion: promotion || "", // Remplacer undefined par une chaîne vide
      specialty: specialty || ""  // Remplacer undefined par une chaîne vide
    });

    res.status(200).send('Utilisateur mis à jour avec succès.');
  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'utilisateur', error);
    res.status(500).send('Une erreur s\'est produite lors de la mise à jour de l\'utilisateur.');
  }
};
// Fonction pour supprimer un utilisateur
const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    const adminToken = req.headers.authorization.split(' ')[1];
    const decodedToken = await admin.auth().verifyIdToken(adminToken);

    if (decodedToken.role !== 'admin') {
      return res.status(403).send('Accès interdit : seuls les administrateurs peuvent supprimer un utilisateur.');
    }

    const userRef = db.collection('users').doc(id);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).send('Utilisateur non trouvé.');
    }

    await admin.auth().deleteUser(id);
    await userRef.delete();

    res.status(200).send('Utilisateur supprimé avec succès.');
  } catch (error) {
    console.error('Erreur lors de la suppression de l\'utilisateur', error);
    res.status(500).send('Une erreur s\'est produite lors de la suppression de l\'utilisateur.');
  }
};
const loginUser = async (req, res) => {
  const { email, password, fcmToken } = req.body;  // Ajouter fcmToken dans la requête

  try {
    // Authentification via Firebase Authentication REST
    const response = await axios.post(firebaseAuthUrl, {
      email,
      password,
      returnSecureToken: true,  // Obtenir un token
    });

    const idToken = response.data.idToken; // Token Firebase

    // Vérifier les claims du token JWT (rôle)
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    // Récupérer les données de l'utilisateur dans Firestore
    const userDoc = await admin.firestore().collection('users').doc(decodedToken.uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const userData = userDoc.data();

    // Enregistrer le token FCM de l'utilisateur dans Firestore
    await saveFCMToken(decodedToken.uid, fcmToken);  // Enregistrer le token FCM

    // Retourner les informations de l'utilisateur
    res.status(200).json({
      message: 'Connexion réussie',
      uid: decodedToken.uid,
      role: userData.role,  // Retourner le rôle de l'utilisateur
      email: userData.email,
      token: idToken,        // Inclure le token pour les futures requêtes sécurisées
    });
  } catch (error) {
    console.error('Erreur de connexion:', error);
    res.status(500).json({ message: 'Erreur de connexion. Veuillez réessayer.' });
  }
};
const sendPasswordResetEmail = async (req, res) => {
  const { email } = req.body; // Récupérer l'email de la requête

  try {
    // Envoi du lien de réinitialisation du mot de passe à l'utilisateur via Firebase Auth
    const response = await axios.post(firebaseAuthUrlcode, {
      requestType: "PASSWORD_RESET", // Type de demande : réinitialisation du mot de passe
      email: email,
    });

    res.status(200).json({ message: "Un email de réinitialisation du mot de passe a été envoyé." });
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'email de réinitialisation', error);
    res.status(500).json({ message: "Une erreur est survenue lors de l'envoi de l'email de réinitialisation." });
  }
};

// Fonction pour réinitialiser le mot de passe (via le lien envoyé dans l'email)
const resetPassword = async (req, res) => {
  const { oobCode, newPassword } = req.body; // Récupérer le code d'authentification et le nouveau mot de passe

  try {
    // Réinitialisation du mot de passe de l'utilisateur en utilisant le code d'authentification reçu dans l'email
    const resetPasswordResponse = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${process.env.FIREBASE_API_KEY}`, {
      oobCode,
      newPassword, // Nouveau mot de passe
    });

    // Retourner une réponse réussie
    res.status(200).json({ message: "Mot de passe réinitialisé avec succès." });
  } catch (error) {
    console.error('Erreur lors de la réinitialisation du mot de passe', error);
    res.status(500).json({ message: "Une erreur est survenue lors de la réinitialisation du mot de passe." });
  }
};
const saveFCMToken = async (userId, token) => {
  try {
    const userRef = db.collection('users').doc(userId);  // Utilise l'ID de l'utilisateur pour accéder à son document
    await userRef.update({
      fcmToken: token,  // Enregistre ou met à jour le token FCM dans Firestore
    });
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement du token FCM', error);
  }
};

module.exports = { 
  loginAdmin, 
  getProfile, 
  getAllUsers, 
  addUser, 
  getUserById, 
  updateUser, 
  deleteUser ,
  loginUser ,
  resetPassword,
  sendPasswordResetEmail
};
