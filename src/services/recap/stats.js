const db = require('../../db');

/**
 * Estadisticas AGREGADAS del recap: rankings y totales del servidor.
 *
 * Aqui solo va lo general. Lo personal de cada uno (su duo del año, su canal
 * favorito, su racha) es materia del comando /recap, no del panel web.
 *
 * Dos reglas que toda consulta de este archivo debe respetar:
 *
 *   1. DURACION = COALESCE(ended_at, ahora) - started_at - gap_ms
 *      Hay que restar `gap_ms` (el rato que el bot estuvo caido) o se regalan
 *      horas que nadie estuvo observando. El COALESCE incluye a quien esta
 *      conectado AHORA MISMO, para que el panel no espere a que salga.
 *
 *   2. El canal AFK va aparte: solo cuenta para su propia categoria y para el
 *      tiempo total. Todo lo demas filtra `is_afk = 0`.
 */

// MAX(...,0): una duracion nunca puede ser negativa. Protege de un salto de
// reloj del sistema, que podria dejar guardada una sesion que "termina" antes
// de empezar y restaria del ranking.
const DURACION = 'MAX(COALESCE(s.ended_at, @ahora) - s.started_at - s.gap_ms, 0)';

/**
 * Tiempo acumulado en un estado, sumando el tramo en curso.
 *
 * `muted_ms` y compañia solo se actualizan al cambiar de estado o cerrar la
 * sesion. Sin este añadido, quien lleve dos horas muteado ahora mismo saldria
 * con cero hasta que se desmutee, y el panel en vivo enseñaria numeros viejos.
 */
function acumulado(estado) {
  return `(s.${estado}_ms + CASE WHEN s.${estado}_since IS NOT NULL
             THEN @ahora - s.${estado}_since ELSE 0 END)`;
}

/** Rango del año natural, en hora local (TZ del contenedor). */
function rangoDelAnio(anio) {
  return {
    desde: new Date(anio, 0, 1).getTime(),
    hasta: new Date(anio + 1, 0, 1).getTime(),
  };
}

function baseParams(anio) {
  const { desde, hasta } = rangoDelAnio(anio);
  return { ahora: Date.now(), desde, hasta };
}

const FILTRO = 's.guild_id = @guildId AND s.started_at >= @desde AND s.started_at < @hasta';

/** Ranking generico por tiempo acumulado. */
function ranking(guildId, anio, { expresion, soloAfk = false, limite = 10 }) {
  const filtroAfk = soloAfk === null ? '' : `AND s.is_afk = ${soloAfk ? 1 : 0}`;
  return db
    .prepare(
      `SELECT s.user_id AS userId,
              COALESCE(m.display_name, s.user_id) AS nombre,
              SUM(${expresion}) AS ms
       FROM voice_sessions s
       LEFT JOIN members m ON m.user_id = s.user_id AND m.guild_id = s.guild_id
       WHERE ${FILTRO} ${filtroAfk}
       GROUP BY s.user_id
       HAVING ms > 0
       ORDER BY ms DESC
       LIMIT ${limite}`
    )
    .all({ guildId, ...baseParams(anio) });
}

function totales(guildId, anio) {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN s.is_afk = 0 THEN ${DURACION} ELSE 0 END), 0) AS vozMs,
         COALESCE(SUM(CASE WHEN s.is_afk = 1 THEN ${DURACION} ELSE 0 END), 0) AS afkMs,
         COUNT(*) AS sesiones,
         COUNT(DISTINCT s.user_id) AS personas,
         COALESCE(SUM(s.from_restart), 0) AS reanudadas,
         COALESCE(SUM(s.was_estimated), 0) AS estimadas
       FROM voice_sessions s
       WHERE ${FILTRO}`
    )
    .get({ guildId, ...baseParams(anio) });

  // El total del servidor es la suma de ambos: is_afk solo vale 0 o 1, asi que
  // las dos ramas reparten todas las sesiones sin solaparse.
  return { ...row, totalMs: row.vozMs + row.afkMs };
}

function canalesMasUsados(guildId, anio, limite = 8) {
  return db
    .prepare(
      `SELECT s.channel_name AS canal,
              SUM(${DURACION}) AS ms,
              COUNT(DISTINCT s.user_id) AS personas
       FROM voice_sessions s
       WHERE ${FILTRO} AND s.is_afk = 0
       GROUP BY s.channel_id
       HAVING ms > 0
       ORDER BY ms DESC
       LIMIT ${limite}`
    )
    .all({ guildId, ...baseParams(anio) });
}

function sesionesMasLargas(guildId, anio, limite = 5) {
  return db
    .prepare(
      `SELECT COALESCE(m.display_name, s.user_id) AS nombre,
              s.channel_name AS canal,
              s.started_at AS inicio,
              s.was_estimated AS estimada,
              ${DURACION} AS ms
       FROM voice_sessions s
       LEFT JOIN members m ON m.user_id = s.user_id AND m.guild_id = s.guild_id
       WHERE ${FILTRO} AND s.is_afk = 0
       ORDER BY ms DESC
       LIMIT ${limite}`
    )
    .all({ guildId, ...baseParams(anio) });
}

/**
 * Entradas a voz por franja horaria, en hora local.
 *
 * Se cuentan ENTRADAS, no tiempo repartido por horas: una sesion de 5 horas
 * cuenta una vez, en la hora en que empezo. Es lo que responde a "a que hora se
 * conecta la gente", que es la pregunta interesante.
 */
function porFranjaHoraria(guildId, anio) {
  const filas = db
    .prepare(
      `SELECT CAST(strftime('%H', s.started_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hora,
              COUNT(*) AS entradas
       FROM voice_sessions s
       WHERE ${FILTRO} AND s.is_afk = 0 AND s.from_restart = 0
       GROUP BY hora`
    )
    .all({ guildId, ...baseParams(anio) });

  const porHora = new Array(24).fill(0);
  for (const f of filas) porHora[f.hora] = f.entradas;
  return porHora;
}

function porMes(guildId, anio) {
  const filas = db
    .prepare(
      `SELECT CAST(strftime('%m', s.started_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS mes,
              SUM(CASE WHEN s.is_afk = 0 THEN ${DURACION} ELSE 0 END) AS ms
       FROM voice_sessions s
       WHERE ${FILTRO}
       GROUP BY mes`
    )
    .all({ guildId, ...baseParams(anio) });

  const meses = new Array(12).fill(0);
  for (const f of filas) meses[f.mes - 1] = f.ms;
  return meses;
}

/** Todo lo que muestra el panel de recap para un servidor y un año. */
function resumenGeneral(guildId, anio = new Date().getFullYear()) {
  return {
    anio,
    totales: totales(guildId, anio),
    rankings: {
      voz: ranking(guildId, anio, { expresion: DURACION }),
      afk: ranking(guildId, anio, { expresion: DURACION, soloAfk: true }),
      muteado: ranking(guildId, anio, { expresion: acumulado('muted') }),
      ensordecido: ranking(guildId, anio, { expresion: acumulado('deafened') }),
      pantalla: ranking(guildId, anio, { expresion: acumulado('streaming') }),
      camara: ranking(guildId, anio, { expresion: acumulado('video') }),
    },
    canales: canalesMasUsados(guildId, anio),
    sesionesLargas: sesionesMasLargas(guildId, anio),
    franjaHoraria: porFranjaHoraria(guildId, anio),
    porMes: porMes(guildId, anio),
    generadoEn: Date.now(),
  };
}

module.exports = { resumenGeneral };
