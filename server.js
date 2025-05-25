require('dotenv').config();

const express = require('express');
const cors = require('cors');
const reservationRoutes = require('./routes/reservations');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración de CORS
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
};

// Middlewares
app.use(cors(corsOptions));
app.use(express.json());

// Rutas
app.use('/api', reservationRoutes);
app.get('/', (req, res) => {
  res.json({ message: 'API de Reservas de Sala de Reuniones' });
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});