const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

const DEFAULT_RECOVERY =
  'Conectate a cualquier canal de voz del servidor y habla con un administrador para recuperarlo.';

/**
 * Avisa por MD a un miembro de que ha perdido un rol por inactividad,
 * explicando el motivo y como recuperarlo.
 *
 * Nunca lanza: un MD rechazado (el usuario tiene los MDs cerrados, o no comparte
 * servidores) no debe romper la sincronizacion ni revertir la retirada del rol.
 */
async function notifyRoleStripped(member, role, policy) {
  const embed = new EmbedBuilder()
    .setTitle(`Has perdido el rol ${role.name}`)
    .setColor(0xfaa61a)
    .setDescription(
      `En **${member.guild.name}** se te ha retirado el rol **${role.name}** ` +
        `por llevar mas de **${policy.days} dias** sin actividad en los canales de voz.`
    )
    .addFields({
      name: 'Como recuperarlo',
      value: policy.recoveryMessage?.trim() || DEFAULT_RECOVERY,
    })
    .setFooter({ text: 'Mensaje automatico. No hace falta responder.' });

  try {
    await member.send({ embeds: [embed] });
    return true;
  } catch (err) {
    logger.warn(`No se pudo avisar por MD a ${member.user.tag}:`, err.message);
    return false;
  }
}

module.exports = { notifyRoleStripped, DEFAULT_RECOVERY };
