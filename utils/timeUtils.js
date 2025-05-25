const moment = require('moment-timezone');
const ALLOWED_TIMEZONES = process.env.ALLOWED_TIMEZONES?.split(',') || 
  ['America/New_York', 'Asia/Tokyo', 'America/Mexico_City'];
const BUSINESS_START_HOUR = parseInt(process.env.BUSINESS_START_HOUR) || 9;
const BUSINESS_END_HOUR = parseInt(process.env.BUSINESS_END_HOUR) || 17;
const MIN_DURATION_MINUTES = parseInt(process.env.MIN_DURATION_MINUTES) || 30;
const MAX_DURATION_MINUTES = parseInt(process.env.MAX_DURATION_MINUTES) || 120;

// Convierte una fecha/hora de una zona horaria específica a UTC
function convertToUTC(dateTime, timezone) {
  return moment.tz(dateTime, timezone).utc().format();
}

// Convierte una fecha/hora de UTC a una zona horaria específica
function convertFromUTC(dateTime, timezone) {
  return moment.utc(dateTime).tz(timezone).format();
}

// Verifica si una fecha es día laboral (lunes a viernes)
function isBusinessDay(date) {
  const day = moment(date).day();
  return day >= 1 && day <= 5; // Lunes (1) a Viernes (5)
}

// Verifica si un rango de tiempo está dentro del horario de oficina (9:00-17:00 UTC)
function isWithinBusinessHours(startTime, endTime) {
  const start = moment.utc(startTime);
  const end = moment.utc(endTime);
  
  // Verifica que sea el mismo día
  if (!start.isSame(end, 'day')) {
    return false;
  }
  
  const startHour = start.hour();
  const endHour = end.hour();
  const endMinute = end.minute();
  
  // Verifica hora de inicio
  if (startHour < BUSINESS_START_HOUR || startHour >= BUSINESS_END_HOUR) {
    return false;
  }
  
  // Verifica hora de fin
  if (endHour > BUSINESS_END_HOUR || (endHour === BUSINESS_END_HOUR && endMinute > 0)) {
    return false;
  }
  
  return true;
}

// Calcula la duración en minutos entre dos fechas/horas
function getDuration(startTime, endTime) {
  return moment(endTime).diff(moment(startTime), 'minutes');
}

// Valida si una zona horaria está permitida
function isValidTimezone(timezone) {
  return ALLOWED_TIMEZONES.includes(timezone);
}

// Valida si la duración de una reserva está dentro de los límites permitidos
function isValidDuration(durationMinutes) {
  return durationMinutes >= MIN_DURATION_MINUTES && durationMinutes <= MAX_DURATION_MINUTES;
}

// Formatea una fecha/hora para mostrar al usuario
function formatDateTime(dateTime, timezone) {
  return moment.tz(dateTime, timezone).format('YYYY-MM-DD HH:mm');
}

// Obtiene el próximo día laboral a partir de una fecha
function getNextBusinessDay(date) {
  let nextDay = moment(date);
  
  // Si es fin de semana, avanzar al lunes
  while (!isBusinessDay(nextDay)) {
    nextDay.add(1, 'day');
  }
  
  // Establecer hora de inicio del día laboral
  nextDay.utc().startOf('day').hour(BUSINESS_START_HOUR);
  
  return nextDay;
}


module.exports = {
  convertToUTC,
  convertFromUTC,
  isBusinessDay,
  isWithinBusinessHours,
  getDuration,
  isValidTimezone,
  isValidDuration,
  formatDateTime,
  getNextBusinessDay,
  ALLOWED_TIMEZONES,
  BUSINESS_START_HOUR,
  BUSINESS_END_HOUR,
  MIN_DURATION_MINUTES,
  MAX_DURATION_MINUTES
};