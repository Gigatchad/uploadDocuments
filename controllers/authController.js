const axios = require('axios');
const { admin, db } = require('../firebase'); // Assurez-vous que Firebase est correctement configuré
const { sendEmail } = require('../services/emailService');

const firebaseAuthUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`;
const firebaseAuthUrlcode = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${process.env.FIREBASE_API_KEY}`;

// Fonction pour enregistrer le token FCM

const saveFCMToken = async (userId, token) => {
  if (!token) return; 
  try {
    const userRef = db.collection('users').doc(userId);
    await userRef.update({ fcmToken: token });
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement du token FCM', error);
  }
};

// Connexion admin

const loginAdmin = async (req, res) => {
  const { email, password, fcmToken } = req.body;

  try {
    const response = await axios.post(firebaseAuthUrl, { email, password, returnSecureToken: true });
    const idToken = response.data.idToken;
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    if (decodedToken.role !== 'admin') {
      return res.status(403).json({ message: 'Accès refusé : utilisateur non administrateur' });
    }
    if (!decodedToken.email_verified) {
      return res.status(403).json({ message: 'Accès refusé : email non vérifié' });
    }

    await saveFCMToken(decodedToken.uid, fcmToken);

    res.status(200).json({
      message: 'Connexion réussie',
      uid: decodedToken.uid,
      role: decodedToken.role,
      email: decodedToken.email,
      token: idToken,
    });
  } catch (error) {
    console.error('Erreur de connexion admin:', error.response?.data || error.message);
    res.status(500).json({ message: 'Erreur de connexion. Veuillez réessayer.' });
  }
};

// Connexion utilisateur

const loginUser = async (req, res) => {
  const { email, password, fcmToken } = req.body;

  try {
    const response = await axios.post(firebaseAuthUrl, { email, password, returnSecureToken: true });
    const idToken = response.data.idToken;
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    if (!userDoc.exists) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    await saveFCMToken(decodedToken.uid, fcmToken);

    const userData = userDoc.data();
    res.status(200).json({
      message: 'Connexion réussie',
      uid: decodedToken.uid,
      role: userData.role || '',
      email: userData.email || '',
      token: idToken,
    });
  } catch (error) {
    console.error('Erreur de connexion utilisateur:', error.response?.data || error.message);
    res.status(500).json({ message: 'Erreur de connexion. Veuillez réessayer.' });
  }
};


// Récupérer profil utilisateur

const getProfile = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Token manquant' });

    const decodedToken = await admin.auth().verifyIdToken(token);
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    if (!userDoc.exists) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    const userData = userDoc.data();
    res.status(200).json({
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      email: userData.email || '',
    });
  } catch (error) {
    console.error('Erreur récupération profil:', error);
    res.status(500).json({ message: 'Erreur interne du serveur' });
  }
};


// Récupérer tous les utilisateurs

const getAllUsers = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Token manquant' });

    const decodedToken = await admin.auth().verifyIdToken(token);
    if (decodedToken.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' });

    const usersSnapshot = await db.collection('users').get();
    const users = [];
    usersSnapshot.forEach(doc => {
      if (doc.id !== decodedToken.uid) {
        const data = doc.data();
        users.push({
          uid: doc.id,
          firstName: data.firstName || '',
          lastName: data.lastName || '',
          email: data.email || '',
          role: data.role || '',
          promotion: data.promotion || '',
          specialty: data.specialty || '',
        });
      }
    });
    res.status(200).json(users);
  } catch (error) {
    console.error('Erreur récupération utilisateurs:', error);
    res.status(500).json({ message: 'Erreur interne du serveur' });
  }
};


// Ajouter utilisateur

const addUser = async (req, res) => {
  const { firstName, lastName, email, password, role, promotion, specialty } = req.body;

  try {
    const adminToken = req.headers.authorization?.split(' ')[1];
    const decodedToken = await admin.auth().verifyIdToken(adminToken);
    if (decodedToken.role !== 'admin') return res.status(403).send('Accès interdit');

    const user = await admin.auth().createUser({
      email,
      password,
      displayName: `${firstName} ${lastName}`,
      emailVerified: false,
    });

    await db.collection('users').doc(user.uid).set({
      firstName: firstName || '',
      lastName: lastName || '',
      email: email || '',
      role: role || '',
      promotion: promotion || '',
      specialty: specialty || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'inactive',
    });

    await sendEmail(email, password);
    res.status(201).send('Utilisateur ajouté avec succès et email envoyé.');
  } catch (error) {
    console.error('Erreur ajout utilisateur:', error);
    res.status(500).send('Erreur lors de l\'ajout de l\'utilisateur.');
  }
};


// Récupérer utilisateur par ID

const getUserById = async (req, res) => {
  try {
    const adminToken = req.headers.authorization?.split(' ')[1];
    const decodedToken = await admin.auth().verifyIdToken(adminToken);
    if (decodedToken.role !== 'admin') return res.status(403).send('Accès interdit');

    const userDoc = await db.collection('users').doc(req.params.id).get();
    if (!userDoc.exists) return res.status(404).send('Utilisateur non trouvé');

    const userData = userDoc.data();
    res.status(200).json({
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      email: userData.email || '',
      role: userData.role || '',
      promotion: userData.promotion || '',
      specialty: userData.specialty || '',
    });
  } catch (error) {
    console.error('Erreur getUserById:', error);
    res.status(500).send('Erreur serveur');
  }
};


// Mettre à jour utilisateur

const updateUser = async (req, res) => {
  try {
    const adminToken = req.headers.authorization?.split(' ')[1];
    const decodedToken = await admin.auth().verifyIdToken(adminToken);
    if (decodedToken.role !== 'admin') return res.status(403).send('Accès interdit');

    const userRef = db.collection('users').doc(req.params.id);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).send('Utilisateur non trouvé');

    await userRef.update({
      firstName: req.body.firstName || '',
      lastName: req.body.lastName || '',
      email: req.body.email || '',
      role: req.body.role || '',
      promotion: req.body.promotion || '',
      specialty: req.body.specialty || '',
    });

    res.status(200).send('Utilisateur mis à jour avec succès');
  } catch (error) {
    console.error('Erreur updateUser:', error);
    res.status(500).send('Erreur serveur');
  }
};


// Supprimer utilisateur

const deleteUser = async (req, res) => {
  try {
    const adminToken = req.headers.authorization?.split(' ')[1];
    const decodedToken = await admin.auth().verifyIdToken(adminToken);
    if (decodedToken.role !== 'admin') return res.status(403).send('Accès interdit');

    const userRef = db.collection('users').doc(req.params.id);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).send('Utilisateur non trouvé');

    await admin.auth().deleteUser(req.params.id);
    await userRef.delete();
    res.status(200).send('Utilisateur supprimé avec succès');
  } catch (error) {
    console.error('Erreur deleteUser:', error);
    res.status(500).send('Erreur serveur');
  }
};


// Envoi email réinitialisation mot de passe

const sendPasswordResetEmail = async (req, res) => {
  try {
    const { email } = req.body;
    await axios.post(firebaseAuthUrlcode, { requestType: "PASSWORD_RESET", email });
    res.status(200).json({ message: "Email de réinitialisation envoyé." });
  } catch (error) {
    console.error('Erreur sendPasswordResetEmail:', error);
    res.status(500).json({ message: "Erreur lors de l'envoi de l'email." });
  }
};

// Réinitialisation mot de passe via le lien
const resetPassword = async (req, res) => {
  try {
    const { oobCode, newPassword } = req.body;
    await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${process.env.FIREBASE_API_KEY}`, {
      oobCode,
      newPassword
    });
    res.status(200).json({ message: "Mot de passe réinitialisé avec succès." });
  } catch (error) {
    console.error('Erreur resetPassword:', error);
    res.status(500).json({ message: "Erreur lors de la réinitialisation du mot de passe." });
  }
};


module.exports = {
  loginAdmin,
  loginUser,
  getProfile,
  getAllUsers,
  addUser,
  getUserById,
  updateUser,
  deleteUser,
  sendPasswordResetEmail,
  resetPassword
};
