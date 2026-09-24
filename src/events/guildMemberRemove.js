const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberRemove,
  once: false,
  async execute(member) {
    // Antes se borraban aqui los datos del miembro. Se dejo de hacer al
    // aniadir el recap: si alguien se va en noviembre, borrar su historial
    // dejaria huecos en las estadisticas de los demas (su "duo del año"
    // desapareceria de golpe). La limpieza pasa a ser manual y deliberada.
    //
    // Los datos de quien ya no esta no afectan al sistema de inactividad:
    // ese recorre los miembros actuales del servidor, no la tabla.
    logger.info(`${member.user?.tag ?? member.id} salio del servidor (se conserva su historial)`);
  },
};
