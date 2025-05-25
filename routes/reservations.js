const express = require('express');
const router = express.Router();
const {
  createReservation,
  getReservations,
  getNextAvailable
} = require('../controllers/reservationController');

router.post('/reservations', createReservation);
router.get('/reservations', getReservations);
router.get('/next-available', getNextAvailable);

module.exports = router;