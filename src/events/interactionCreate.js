const { Events, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const repository = require('../db/repository');

/** "/comando subcomando", sin parametros: solo para saber quien uso que y cuando. */
function describeCommand(interaction) {
  let text = `/${interaction.commandName}`;
  try {
    const sub = interaction.options.getSubcommand(false);
    if (sub) text += ` ${sub}`;
  } catch {
    // Comandos sin estructura de subcomandos: no hay nada que aniadir.
  }
  return text;
}

module.exports = {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`Comando desconocido invocado: ${interaction.commandName}`);
      return;
    }

    // Todos los comandos son de administrador. Se comprueba aqui, en un unico
    // sitio, para que cualquier comando que se aniada en el futuro quede
    // protegido sin tener que acordarse.
    //
    // No basta con setDefaultMemberPermissions: eso es solo el permiso POR
    // DEFECTO, y un administrador puede concederselo a otros roles desde
    // Ajustes > Integraciones. Peor aun, si ya existiera una excepcion
    // configurada, cambiar el valor por defecto no la elimina. Esta
    // comprobacion es la que manda de verdad.
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'Estos comandos solo funcionan dentro de un servidor.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      logger.warn(
        `${interaction.user.tag} intento usar /${interaction.commandName} sin ser administrador`
      );
      await interaction.reply({
        content: 'Solo los administradores del servidor pueden usar los comandos de este bot.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    repository.logCommandUsage(interaction.guildId, interaction.user.id, describeCommand(interaction));

    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error(`Error ejecutando /${interaction.commandName}:`, err);
      const payload = {
        content: 'Ocurrio un error al ejecutar el comando.',
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  },
};
