const { Events } = require('discord.js');
const repository = require('../db/repository');
const { clearInactiveRole } = require('../services/roleSyncService');
const { handleVoiceStateUpdate } = require('../services/recap/sessionTracker');
const logger = require('../utils/logger');

module.exports = {
  name: Events.VoiceStateUpdate,
  once: false,
  async execute(oldState, newState) {
    // El recap va primero y aislado: es puramente observacional, y un fallo
    // suyo no debe impedir que el bot registre la actividad ni desmarque el
    // rol, que es su funcion principal.
    try {
      handleVoiceStateUpdate(oldState, newState);
    } catch (err) {
      logger.error('Fallo la captura de sesion para el recap:', err.message);
    }

    // Cualquier transicion que implique estar o haber estado en voz cuenta
    // como actividad: entrar, cambiar de canal o salir. Registrar tambien la
    // entrada evita marcar como inactivo a quien lleva horas conectado y aun
    // no ha salido.
    const isVoiceActivity = Boolean(oldState.channelId || newState.channelId);
    if (!isVoiceActivity) return;

    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;

    // Una "sesion" es entrar a voz viniendo de fuera de voz. Cambiar de canal o
    // salir actualiza la fecha de actividad, pero no cuenta como sesion nueva:
    // el contador refleja cuantas veces ha entrado, no cuantos movimientos ha hecho.
    const isJoin = !oldState.channelId && Boolean(newState.channelId);

    const guildId = (newState.guild ?? oldState.guild).id;
    repository.recordVoiceActivity(member.id, guildId, member.displayName, Date.now(), isJoin);

    try {
      await clearInactiveRole(member);
    } catch (err) {
      logger.warn(`Fallo al desmarcar a ${member.user.tag}:`, err.message);
    }
  },
};
