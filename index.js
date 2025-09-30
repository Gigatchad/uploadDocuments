require('dotenv').config();  // Charger les variables d'environnement
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const authRoute = require('./routes/authRoute'); // Importer les routes d'authentification
const documentRoutes = require('./routes/documentRoute');
const statisticsRoute = require('./routes/statisticsRoute');
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json()); // Pour lire les données JSON dans les requêtes

// Routes
app.use('/api/auth', authRoute); // Ajoute les routes d'authentification sous /api/auth
app.use('/api/documents', documentRoutes);
app.use('/api', statisticsRoute); 
// Démarrer le serveur
const PORT = process.env.PORT || 5000;  // Utilise la variable d'environnement PORT
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
