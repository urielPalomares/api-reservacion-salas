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
  
  console.log('Datos recibidos:', req.body);
  
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
  
  console.log('Horarios convertidos a UTC:', { startUTC, endUTC });
  
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
      console.error('Error en checkCollisions:', err);
      return res.status(500).json({ error: 'Error al verificar colisiones' });
    }

    console.log('Resultado de colisión:', collision);
    
    if (collision) {
      if (collision.canDisplace) {
        displaceReservation(collision.id, collision.timezone, (err) => {
          if (err) {
            console.error('Error al desplazar reserva:', err);
            return res.status(500).json({ error: 'Error al desplazar reserva existente' });
          }
          insertReservation(startUTC, endUTC, priority, resources, timezone, res);
        });
      } else {
        findNextAvailable(startUTC, timezone, (err, nextSlot) => {
          console.log('Próximo slot disponible:', nextSlot);
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
      startTimeUTC: row.startTime,
      endTimeUTC: row.endTime,
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

// Revisar colisiones
function checkCollisions(startTime, endTime, needsProjector, priority, callback) {
  const query = `
    SELECT * FROM reservations 
    WHERE (startTime < ? AND endTime > ?) 
    OR (startTime < ? AND endTime > ?)
    OR (startTime >= ? AND endTime <= ?)
  `;
  
  console.log('Verificando colisiones para:', { startTime, endTime });
  
  db.all(query, [endTime, startTime, endTime, endTime, startTime, endTime], (err, rows) => {
    if (err) {
      console.error('Error en query de colisiones:', err);
      return callback(err);
    }
    
    console.log('Reservas encontradas:', rows.length);
    
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
      
      // Colisión temporal
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
  
  const params = [
    startTime, 
    endTime, 
    priority, 
    resources.projector ? 1 : 0,
    resources.capacity, 
    timezone
  ];
  
  console.log('Insertando reserva con parámetros:', params);
  
  db.run(query, params, function(err) {
    if (err) {
      console.error('Error al insertar reserva:', err);
      return res.status(500).json({ error: 'Error al crear reserva' });
    }
    
    console.log('Reserva creada con ID:', this.lastID);
    
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
      const newEndUTC = moment.utc(newStartUTC).add(duration, 'minutes').format();
      
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

// Buscar próximo espacio disponible
function findNextAvailable(fromTimeUTC, timezone, callback) {
  let currentTime = moment.utc(fromTimeUTC);
  const maxDays = 30;
  let daysChecked = 0;
  
  console.log('Buscando desde:', currentTime.format());
  
  // Avanzar al menos 30 minutos desde el tiempo actual
  currentTime.add(30, 'minutes');
  
  // Redondear al próximo slot de 30 minutos
  const minutes = currentTime.minute();
  if (minutes > 0 && minutes < 30) {
    currentTime.minute(30).second(0);
  } else if (minutes > 30) {
    currentTime.add(1, 'hour').minute(0).second(0);
  }
  
  const checkSlot = () => {
    if (daysChecked > maxDays) {
      return callback(null, null);
    }
    
    // Solo días laborables
    if (!isBusinessDay(currentTime)) {
      currentTime.add(1, 'day').startOf('day').hour(9).minute(0).second(0);
      daysChecked++;
      return checkSlot();
    }
    
    // Verificar horario de oficina
    if (currentTime.hour() >= 17) {
      currentTime.add(1, 'day').startOf('day').hour(9).minute(0).second(0);
      daysChecked++;
      return checkSlot();
    }
    
    if (currentTime.hour() < 9) {
      currentTime.hour(9).minute(0).second(0);
    }
    
    const slotStart = currentTime.format();
    const slotEnd = currentTime.clone().add(1, 'hour').format();
    
    // Verificar que no exceda el horario de oficina
    if (moment.utc(slotEnd).hour() > 17 || 
        (moment.utc(slotEnd).hour() === 17 && moment.utc(slotEnd).minute() > 0)) {
      currentTime.add(1, 'day').startOf('day').hour(9).minute(0).second(0);
      daysChecked++;
      return checkSlot();
    }
    
    // Verificar si el slot está disponible
    db.all(
      `SELECT * FROM reservations 
       WHERE (startTime < ? AND endTime > ?) 
       OR (startTime < ? AND endTime > ?)
       OR (startTime >= ? AND endTime <= ?)`,
      [slotEnd, slotStart, slotEnd, slotEnd, slotStart, slotEnd],
      (err, rows) => {
        if (err) return callback(err);
        
        console.log(`Slot ${slotStart} - ${slotEnd}: ${rows.length} conflictos`);
        
        if (rows.length === 0) {
          // Slot disponible
          const localTime = convertFromUTC(slotStart, timezone);
          console.log('Slot disponible encontrado:', localTime);
          return callback(null, localTime, slotStart);
        }
        
        // Buscar el final de la última reserva conflictiva
        let latestEnd = moment.utc(rows[0].endTime);
        for (const row of rows) {
          const rowEnd = moment.utc(row.endTime);
          if (rowEnd.isAfter(latestEnd)) {
            latestEnd = rowEnd;
          }
        }
        
        // Continuar desde el final de la reserva conflictiva
        currentTime = latestEnd.clone();
        
        // Redondear al próximo slot de 30 minutos
        const mins = currentTime.minute();
        if (mins > 0 && mins < 30) {
          currentTime.minute(30).second(0);
        } else if (mins > 30) {
          currentTime.add(1, 'hour').minute(0).second(0);
        }
        
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