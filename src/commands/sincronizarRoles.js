const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { syncGuild } = require('../services/roleSyncService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sincronizar-roles')
    .setDescription('Fuerza la sincronizacion del rol Inactivo sin esperar al ciclo automatico')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addIntegerOption((option) =>
      option
        .setName('dias')
        .setDescription('Umbral puntual en dias. Omitir para usar el configurado en el servidor.')
        .setMinValue(1)
    ),

  async execute(interaction) {
    const days = interaction.options.getInteger('dias');

    await interaction.deferReply({ ephemeral: true });

    const result = await syncGuild(interaction.guild, days);

    if (!result) {
      await interaction.editReply(
        'No se pudo resolver el rol Inactivo. Revisa que el bot tenga el permiso "Gestionar roles" y que su rol este por encima de @Inactivo.'
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('Sincronizacion completada')
      .setColor(0x57f287)
      .addFields(
        { name: 'Marcados', value: String(result.added), inline: true },
        { name: 'Desmarcados', value: String(result.removed), inline: true },
        { name: 'Roles retirados', value: String(result.stripped), inline: true },
        { name: 'Fallidos', value: String(result.failed), inline: true }
      )
      .setFooter({ text: `Umbral: ${result.days} dias` });

    await interaction.editReply({ embeds: [embed] });
  },
};
