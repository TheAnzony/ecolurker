const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { evaluateGuildInactivity } = require('../services/inactivityService');
const { getInactiveDays } = require('../services/settingsService');
const { applyAction } = require('../services/moderationService');
const { ensureMembersCached } = require('../utils/members');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('moderar-inactivos')
    .setDescription('Aplica una accion de moderacion a los miembros inactivos en voz')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    // Discord exige que las opciones obligatorias se declaren antes que las opcionales
    .addStringOption((option) =>
      option
        .setName('accion')
        .setDescription('Que hacer con los miembros inactivos')
        .setRequired(true)
        .addChoices(
          { name: 'Asignar rol Inactivo', value: 'rol' },
          { name: 'Enviar aviso por MD', value: 'aviso' },
          { name: 'Expulsar del servidor', value: 'expulsar' }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName('dias')
        .setDescription('Umbral de inactividad en dias. Omitir para usar el configurado en el servidor.')
        .setMinValue(1)
    )
    .addBooleanOption((option) =>
      option
        .setName('confirmar')
        .setDescription('Poner en true para ejecutar de verdad. Por defecto es una simulacion (dry-run).')
    ),

  async execute(interaction) {
    const days = interaction.options.getInteger('dias') ?? getInactiveDays(interaction.guild.id);
    const action = interaction.options.getString('accion', true);
    const confirmed = interaction.options.getBoolean('confirmar') ?? false;

    await interaction.deferReply({ ephemeral: true });

    await ensureMembersCached(interaction.guild);
    const { inactive } = evaluateGuildInactivity(interaction.guild, days);

    if (inactive.length === 0) {
      await interaction.editReply(`No hay miembros inactivos desde hace mas de ${days} dias.`);
      return;
    }

    if (!confirmed) {
      const preview = inactive
        .slice(0, 30)
        .map(({ member }) => `${member}`)
        .join('\n');
      const embed = new EmbedBuilder()
        .setTitle(`Simulacion: ${action} sobre ${inactive.length} miembro(s)`)
        .setDescription(preview || '—')
        .setColor(0xfaa61a)
        .setFooter({ text: 'Ninguna accion fue ejecutada. Repite el comando con confirmar: true para aplicarla.' });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    try {
      const result = await applyAction(action, inactive, interaction.guild);
      const embed = new EmbedBuilder()
        .setTitle(`Accion "${action}" ejecutada`)
        .setColor(0x57f287)
        .addFields(
          { name: 'Exitosos', value: String(result.ok), inline: true },
          { name: 'Fallidos', value: String(result.failed.length), inline: true }
        );
      if (result.failed.length > 0) {
        embed.addFields({
          name: 'IDs con error',
          value: result.failed.slice(0, 20).join(', '),
        });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply(`Error al ejecutar la accion: ${err.message}`);
    }
  },
};
