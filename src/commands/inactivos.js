const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { evaluateGuildInactivity } = require('../services/inactivityService');
const { getInactiveDays } = require('../services/settingsService');
const { formatRelativeDays } = require('../utils/time');
const { ensureMembersCached } = require('../utils/members');

const MAX_LISTED = 40;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inactivos')
    .setDescription('Lista los miembros inactivos en canales de voz')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addIntegerOption((option) =>
      option
        .setName('dias')
        .setDescription('Umbral de inactividad en dias. Omitir para usar el configurado en el servidor.')
        .setMinValue(1)
    ),

  async execute(interaction) {
    const days = interaction.options.getInteger('dias') ?? getInactiveDays(interaction.guild.id);

    await interaction.deferReply();

    await ensureMembersCached(interaction.guild);
    const { inactive, active, newMembers, exempt } = evaluateGuildInactivity(
      interaction.guild,
      interaction.options.getInteger('dias')
    );

    if (inactive.length === 0) {
      await interaction.editReply(`No hay miembros inactivos desde hace mas de ${days} dias.`);
      return;
    }

    const lines = inactive.slice(0, MAX_LISTED).map(({ member, lastActivity, source, policy }) => {
      // Marca a quien tiene un plazo propio por su rol, para que no parezca
      // una incoherencia al compararlo con el resto de la lista.
      const custom = policy.roleId ? ` \`${policy.days}d\`` : '';
      const exemptTag = policy.markInactive ? '' : ' _(exento del rol)_';

      if (source === 'never_voice') {
        return `${member} — _sin actividad de voz registrada_${custom}${exemptTag}`;
      }
      return `${member} — ${formatRelativeDays(lastActivity)}${custom}${exemptTag}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`Miembros inactivos (> ${days} dias)`)
      .setDescription(lines.join('\n'))
      .setColor(0xed4245)
      .setFooter({
        text:
          inactive.length > MAX_LISTED
            ? `Mostrando ${MAX_LISTED} de ${inactive.length} resultados`
            : `${inactive.length} resultado(s)`,
      });

    embed.addFields({
      name: 'Resto del servidor',
      value:
        `${active.length} con actividad de voz reciente\n` +
        `${newMembers.length} en periodo de gracia (llevan poco en el servidor)\n` +
        `${exempt.length} exentos (administradores)`,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};
