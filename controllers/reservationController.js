const db = require('../database/db');
const { 
  convertToUTC, 
  convertFromUTC, 
  isBusinessDay, 
  isWithinBusinessHours,
  getDuration,
  ALLOWED_TIMEZONES 
} = require('../utils/timeUtils');
const moment = require('moment-timezone');

// Crear reserva
const createReservation = (req, res) => {
  const { startTime, endTime, priority, resources, timezone } = req.body;
  
  if (!ALLOWED_TIMEZONES.includes(timezone)) {
    return res.status(400).json({ error: 'Zona horaria no válida' });
  }
  
  if (!resources || typeof resources.projector !== 'boolean' || !resources.capacity) {
    return res.status(400).json({ error: 'Recursos inválidos' });
  }
  
  if (resources.capacity > 8) {
    return res.status(400).json({ error: 'La capacidad máxima es de 8 personas' });
  }
  
  const startUTC = convertToUTC(startTime, timezone);
  const endUTC = convertToUTC(endTime, timezone);
  
  if (!isBusinessDay(startUTC)) {
    return res.status(400).json({ error: 'Solo se permiten reservas en días laborables' });
  }
  
  if (!isWithinBusinessHours(startUTC, endUTC)) {
    return res.status(400).json({ error: 'Las reservas deben estar entre 9:00 y 17:00 UTC' });
  }
  
  const duration = getDuration(startUTC, endUTC);
  if (duration < 30 || duration > 120) {
    return res.status(400).json({ error: 'La duración debe ser entre 30 minutos y 2 horas' });
  }
  
  checkCollisions(startUTC, endUTC, resources.projector, priority, (err, collision) => {
    if (err) {
      return res.status(500).json({ error: 'Error al verificar colisiones' });
    }
    
    if (collision) {
      if (collision.canDisplace) {
        displaceReservation(collision.id, collision.timezone, () => {
          insertReservation(startUTC, endUTC, priority, resources, timezone, res);
        });
      } else {
        findNextAvailable(startUTC, timezone, (err, nextSlot) => {
          if (err) {
            return res.status(500).json({ error: 'Error al buscar horario disponible' });
          }
          res.status(409).json({ 
            error: 'Conflicto de horario',
            nextAvailable: nextSlot 
          });
        });
      }
    } else {
      insertReservation(startUTC, endUTC, priority, resources, timezone, res);
    }
  });
};

// Obtener todas las reservas
const getReservations = (req, res) => {
  db.all('SELECT * FROM reservations ORDER BY startTime', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Error al obtener reservas' });
    }
    
    const reservations = rows.map(row => ({
      ...row,
      startTime: convertFromUTC(row.startTime, row.timezone),
      endTime: convertFromUTC(row.endTime, row.timezone),
      projector: Boolean(row.projector)
    }));
    
    res.json(reservations);
  });
};

// Próximo horario disponible
const getNextAvailable = (req, res) => {
  const { startTime, timezone } = req.query;
  
  if (!startTime || !timezone) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos' });
  }
  
  if (!ALLOWED_TIMEZONES.includes(timezone)) {
    return res.status(400).json({ error: 'Zona horaria no válida' });
  }
  
  const startUTC = convertToUTC(startTime, timezone);
  
  findNextAvailable(startUTC, timezone, (err, nextSlot) => {
    if (err) {
      return res.status(500).json({ error: 'Error al buscar horario disponible' });
    }
    
    if (!nextSlot) {
      return res.status(404).json({ error: 'No hay horarios disponibles en los próximos 30 días' });
    }
    
    res.json({ nextAvailable: nextSlot });
  });
};

// Revisar coliciones
function checkCollisions(startTime, endTime, needsProjector, priority, callback) {
  const query = `
    SELECT * FROM reservations 
    WHERE (startTime < ? AND endTime > ?) 
    OR (startTime < ? AND endTime > ?)
    OR (startTime >= ? AND endTime <= ?)
  `;
  
  db.all(query, [endTime, startTime, endTime, endTime, startTime, endTime], (err, rows) => {
    if (err) return callback(err);
    
    if (rows.length === 0) return callback(null, null);
    
    for (const row of rows) {
      // Colisión por proyector
      if (needsProjector && row.projector) {
        const canDisplace = priority === 'high' && row.priority === 'normal';
        return callback(null, { 
          id: row.id, 
          canDisplace,
          timezone: row.timezone 
        });
      }
      
      // Colisión temporal (misma prioridad)
      const canDisplace = priority === 'high' && row.priority === 'normal';
      return callback(null, { 
        id: row.id, 
        canDisplace,
        timezone: row.timezone 
      });
    }
  });
}

function insertReservation(startTime, endTime, priority, resources, timezone, res) {
  const query = `
    INSERT INTO reservations (startTime, endTime, priority, projector, capacity, timezone)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  
  db.run(query, [
    startTime, 
    endTime, 
    priority, 
    resources.projector ? 1 : 0,
    resources.capacity, 
    timezone
  ], function(err) {
    if (err) {
      console.error('Error al insertar reserva:', err);
      return res.status(500).json({ error: 'Error al crear reserva' });
    }
    
    res.status(201).json({ 
      id: this.lastID, 
      message: 'Reserva creada exitosamente',
      reservation: {
        id: this.lastID,
        startTime: convertFromUTC(startTime, timezone),
        endTime: convertFromUTC(endTime, timezone),
        priority,
        resources,
        timezone
      }
    });
  });
}

// Desplazar reserva
function displaceReservation(reservationId, originalTimezone, callback) {
  db.get('SELECT * FROM reservations WHERE id = ?', [reservationId], (err, row) => {
    if (err) return callback(err);
    if (!row) return callback(new Error('Reserva no encontrada'));
    
    const duration = getDuration(row.startTime, row.endTime);
    
    findNextAvailable(row.endTime, row.timezone, (err, nextSlot) => {
      if (err) return callback(err);
      
      if (!nextSlot) {
        console.error('No se pudo encontrar un horario alternativo para la reserva desplazada');
        return callback(new Error('No hay horarios disponibles para reubicar la reserva'));
      }
      
      const newStartUTC = convertToUTC(nextSlot, row.timezone);
      const newEndUTC = moment(newStartUTC).add(duration, 'minutes').format();
      
      // Actualizar reserva con nuevo horario
      db.run(
        'UPDATE reservations SET startTime = ?, endTime = ? WHERE id = ?',
        [newStartUTC, newEndUTC, reservationId],
        (err) => {
          if (err) return callback(err);
          console.log(`Reserva ${reservationId} reubicada a ${nextSlot}`);
          callback();
        }
      );
    });
  });
}

// Buscar proximo espacio
function findNextAvailable(fromTimeUTC, timezone, callback) {
  let currentTime = moment.utc(fromTimeUTC);
  const maxDays = 30;
  let daysChecked = 0;
  
  const checkSlot = () => {
    if (daysChecked > maxDays) {
      return callback(null, null);
    }
    
    if (!isBusinessDay(currentTime)) {
      currentTime.add(1, 'day').startOf('day').hour(9).minute(0).second(0);
      daysChecked++;
      return checkSlot();
    }
    
    if (currentTime.hour() >= 17 || currentTime.hour() < 9) {
      if (currentTime.hour() >= 17) {
        currentTime.add(1, 'day');
      }
      currentTime.hour(9).minute(0).second(0);
      
      if (!isBusinessDay(currentTime)) {
        return checkSlot();
      }
      daysChecked++;
    }
    
    const slotStart = currentTime.format();
    const slotEnd = currentTime.clone().add(1, 'hour').format();
    
    // Verificar si el slot está disponible
    db.all(
      `SELECT * FROM reservations 
       WHERE (startTime < ? AND endTime > ?) 
       OR (startTime < ? AND endTime > ?)
       OR (startTime >= ? AND endTime <= ?)`,
      [slotEnd, slotStart, slotEnd, slotEnd, slotStart, slotEnd],
      (err, rows) => {
        if (err) return callback(err);
        
        if (rows.length === 0) {
          return callback(null, convertFromUTC(slotStart, timezone));
        }
        
        // Siguiente slot de 30 minutos
        // currentTime.add(30, 'minutes');
        checkSlot();
      }
    );
  };
  
  checkSlot();
}

module.exports = {
  createReservation,
  getReservations,
  getNextAvailable
};