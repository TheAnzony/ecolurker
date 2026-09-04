const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  MessageFlags,
  ApplicationCommandOptionType,
} = require('discord.js');
const config = require('../config');
const settings = require('../services/settingsService');

/**
 * Lista los comandos disponibles.
 *
 * Se genera recorriendo los comandos realmente cargados en vez de mantener una
 * lista escrita a mano: asi cualquier comando nuevo aparece aqui solo, y ningun
 * cambio de descripcion u opciones puede quedarse desactualizado.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('ayuda')
    .setDescription('Muestra los comandos disponibles y como funciona el bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const dias = settings.getInactiveDays(interaction.guild.id);

    const embed = new EmbedBuilder()
      .setTitle('Comandos de Ecolurker')
      .setColor(0x5865f2)
      .setDescription(
        'El bot marca y desmarca el rol **@Inactivo** por su cuenta, asi que ' +
          'no hace falta ejecutar nada para que funcione.\n\n' +
          `Ahora mismo: se marca a quien lleve **${dias} dias** sin pisar un canal ` +
          `de voz, y se revisa **cada ${config.syncIntervalHours}h**. Quien entra a ` +
          'voz queda desmarcado al instante.\n​'
      );

    const comandos = [...interaction.client.commands.values()]
      .map((c) => c.data.toJSON())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const cmd of comandos) {
      embed.addFields({
        name: `/${cmd.name}`,
        value: `${cmd.description}\n${detallar(cmd)}`.trim(),
      });
    }

    embed.addFields({
      name: '​Panel web',
      value:
        `Lista completa, buscador y evolucion del servidor en ` +
        `\`http://localhost:${config.dashboardPort}\`, en la maquina donde corre el bot.`,
    });

    embed.setFooter({
      text: 'Solo los administradores pueden usar estos comandos.',
    });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

/** Subcomandos si los tiene; si no, sus opciones. */
function detallar(cmd) {
  const opciones = cmd.options ?? [];
  if (opciones.length === 0) return '';

  const subcomandos = opciones.filter((o) => o.type === ApplicationCommandOptionType.Subcommand);

  if (subcomandos.length > 0) {
    return subcomandos
      .map((s) => {
        const params = listarOpciones(s.options);
        return `> \`/${cmd.name} ${s.name}\` — ${s.description}` + (params ? `\n> ${params}` : '');
      })
      .join('\n');
  }

  return `> ${listarOpciones(opciones)}`;
}

/** Los obligatorios en negrita, los opcionales con "?" al final. */
function listarOpciones(opciones) {
  if (!opciones || opciones.length === 0) return '';
  return (
    'Parametros: ' +
    opciones.map((o) => (o.required ? `**${o.name}**` : `${o.name}?`)).join(', ')
  );
}
