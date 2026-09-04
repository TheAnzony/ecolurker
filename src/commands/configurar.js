const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const repository = require('../db/repository');
const settings = require('../services/settingsService');
const { ensureInactiveRole } = require('../services/roleService');
const { syncGuild } = require('../services/roleSyncService');
const { DEFAULT_RECOVERY } = require('../services/notificationService');
const { evaluateGuildInactivity } = require('../services/inactivityService');
const { ensureMembersCached } = require('../utils/members');

const MAX_MESSAGE_LENGTH = 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('configurar')
    .setDescription('Configura como se trata la inactividad en este servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName('ver').setDescription('Muestra la configuracion actual del servidor')
    )
    .addSubcommand((sub) =>
      sub
        .setName('dias')
        .setDescription('Cambia el tiempo de inactividad general del servidor')
        .addIntegerOption((option) =>
          option
            .setName('dias')
            .setDescription('Dias sin voz tras los que se marca el rol Inactivo')
            .setRequired(true)
            .setMinValue(settings.MIN_DAYS)
            .setMaxValue(settings.MAX_DAYS)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('rol')
        .setDescription('Da un trato especial a un rol concreto')
        .addRoleOption((option) =>
          option.setName('rol').setDescription('Rol al que aplicar la politica').setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName('dias')
            .setDescription('Tiempo de inactividad propio para este rol')
            .setMinValue(settings.MIN_DAYS)
            .setMaxValue(settings.MAX_DAYS)
        )
        .addBooleanOption((option) =>
          option
            .setName('marcar')
            .setDescription('Si se le pone el rol @Inactivo. false = exento (por defecto true)')
        )
        .addBooleanOption((option) =>
          option
            .setName('retirar')
            .setDescription('Si pierde ESTE rol al quedar inactivo (por defecto false)')
        )
        .addStringOption((option) =>
          option
            .setName('mensaje')
            .setDescription('Como recuperar el rol. Se le envia por MD al perderlo.')
            .setMaxLength(MAX_MESSAGE_LENGTH)
        )
        .addBooleanOption((option) =>
          option
            .setName('confirmar')
            .setDescription('Obligatorio para activar "retirar": confirma que se les quitara el rol.')
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('rol-quitar')
        .setDescription('Elimina la politica especial de un rol')
        .addRoleOption((option) =>
          option.setName('rol').setDescription('Rol cuya politica se elimina').setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    if (sub === 'ver') return showConfig(interaction);
    if (sub === 'dias') return setDays(interaction);
    if (sub === 'rol') return setRolePolicy(interaction);
    if (sub === 'rol-quitar') return removeRolePolicy(interaction);
  },
};

async function showConfig(interaction) {
  const guild = interaction.guild;
  const role = await ensureInactiveRole(guild);
  const current = settings.getInactiveDays(guild.id);
  const policies = repository.getRolePolicies(guild.id);

  const embed = new EmbedBuilder()
    .setTitle(`Configuracion de ${guild.name}`)
    .setColor(0x5865f2)
    .addFields(
      {
        name: 'Tiempo de inactividad',
        value: `${current} dias${settings.isCustomised(guild.id) ? '' : ' (valor por defecto)'}`,
      },
      { name: 'Rol de inactividad', value: role ? `${role}` : 'no disponible' },
      { name: 'Revision automatica', value: `cada ${config.syncIntervalHours}h` },
      {
        name: 'Administradores',
        value: 'Exentos automaticamente, no reciben el rol.',
      }
    );

  if (policies.length > 0) {
    const lines = policies.map((policy) => {
      const role = guild.roles.cache.get(policy.roleId);
      const name = role ? `${role}` : `\`${policy.roleId}\` (rol borrado)`;
      const parts = [
        policy.inactiveDays ? `${policy.inactiveDays} dias` : `${current} dias (general)`,
        policy.markInactive ? 'se marca' : 'exento',
        policy.stripRole ? 'pierde el rol' : 'conserva el rol',
      ];
      return `${name} — ${parts.join(' · ')}`;
    });
    embed.addFields({ name: 'Roles con politica propia', value: lines.join('\n') });
  } else {
    embed.addFields({
      name: 'Roles con politica propia',
      value: 'Ninguno. Usa `/configurar rol` para aniadir uno.',
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function setDays(interaction) {
  const days = interaction.options.getInteger('dias', true);

  try {
    settings.setInactiveDays(interaction.guild.id, days);
  } catch (err) {
    await interaction.editReply(err.message);
    return;
  }

  const result = await syncGuild(interaction.guild);

  const embed = new EmbedBuilder()
    .setTitle('Tiempo de inactividad actualizado')
    .setColor(0x57f287)
    .setDescription(`Ahora es de **${days} dias** en **${interaction.guild.name}**.`)
    .setFooter({ text: 'Quien lleve menos de ese tiempo en el servidor queda exento.' });

  if (result) addResultFields(embed, result);

  await interaction.editReply({ embeds: [embed] });
}

async function setRolePolicy(interaction) {
  const guild = interaction.guild;
  const role = interaction.options.getRole('rol', true);

  if (role.id === guild.id) {
    await interaction.editReply('No se puede aplicar una politica a @everyone.');
    return;
  }

  const inactiveRole = await ensureInactiveRole(guild);
  if (inactiveRole && role.id === inactiveRole.id) {
    await interaction.editReply('No se puede aplicar una politica al propio rol de inactividad.');
    return;
  }

  // Al reconfigurar un rol se parte de su politica actual, para poder cambiar
  // una sola opcion sin tener que repetir las demas.
  const existing = repository.getRolePolicies(guild.id).find((p) => p.roleId === role.id);

  const policy = {
    inactiveDays: interaction.options.getInteger('dias') ?? existing?.inactiveDays ?? null,
    markInactive: interaction.options.getBoolean('marcar') ?? existing?.markInactive ?? true,
    stripRole: interaction.options.getBoolean('retirar') ?? existing?.stripRole ?? false,
    recoveryMessage: interaction.options.getString('mensaje') ?? existing?.recoveryMessage ?? null,
  };

  // Retirar un rol que el bot no puede gestionar fallaria en cada pasada
  if (policy.stripRole) {
    const me = guild.members.me ?? (await guild.members.fetchMe());
    if (role.position >= me.roles.highest.position) {
      await interaction.editReply(
        `No puedo retirar ${role} porque esta por encima de mi rol en la jerarquia. ` +
          'Muevelo por debajo en Ajustes > Roles y vuelve a intentarlo.'
      );
      return;
    }
  }

  // Activar "retirar" es la unica opcion con efecto irreversible de un golpe
  // (mucha gente pierde el rol y recibe un MD), asi que exige confirmacion
  // explicita y muestra antes a cuantos afectaria.
  const activatingStrip = policy.stripRole && !existing?.stripRole;
  if (activatingStrip && interaction.options.getBoolean('confirmar') !== true) {
    const affected = await countAffected(guild, role, policy);
    const embed = new EmbedBuilder()
      .setTitle(`Confirmacion necesaria: retirar ${role.name}`)
      .setColor(0xfaa61a)
      .setDescription(
        `Esto retirara **${role.name}** a **${affected} miembro(s)** inactivos y les ` +
          'enviara un mensaje directo explicando por que.\n\n' +
          'Nada se ha guardado todavia. Repite el comando aniadiendo `confirmar:true` ' +
          'para aplicarlo.'
      )
      .addFields({
        name: 'Plazo que se aplicaria',
        value: `${policy.inactiveDays ?? settings.getInactiveDays(guild.id)} dias sin voz`,
      });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  repository.setRolePolicy(guild.id, role.id, policy);

  const embed = new EmbedBuilder()
    .setTitle(`Politica aplicada a ${role.name}`)
    .setColor(0x57f287)
    .addFields(
      {
        name: 'Tiempo de inactividad',
        value: policy.inactiveDays
          ? `${policy.inactiveDays} dias`
          : `${settings.getInactiveDays(guild.id)} dias (el general del servidor)`,
        inline: true,
      },
      {
        name: 'Rol @Inactivo',
        value: policy.markInactive ? 'si se le pone' : 'exento',
        inline: true,
      },
      {
        name: `Retirar ${role.name}`,
        value: policy.stripRole ? 'si, al quedar inactivo' : 'no',
        inline: true,
      }
    );

  if (policy.stripRole) {
    embed.addFields({
      name: 'Aviso por MD al perderlo',
      value: policy.recoveryMessage?.trim() || `_(mensaje por defecto)_ ${DEFAULT_RECOVERY}`,
    });
  }

  const result = await syncGuild(guild);
  if (result) addResultFields(embed, result);

  await interaction.editReply({ embeds: [embed] });
}

async function removeRolePolicy(interaction) {
  const role = interaction.options.getRole('rol', true);
  const deleted = repository.deleteRolePolicy(interaction.guild.id, role.id);

  if (!deleted) {
    await interaction.editReply(`${role} no tenia ninguna politica configurada.`);
    return;
  }

  const result = await syncGuild(interaction.guild);

  const embed = new EmbedBuilder()
    .setTitle('Politica eliminada')
    .setColor(0x57f287)
    .setDescription(`${role} vuelve a tratarse con las reglas generales del servidor.`);

  if (result) addResultFields(embed, result);

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Cuantos miembros perderian el rol si se aplicase esta politica ahora mismo.
 * Solo cuenta a quien tiene el rol y ya esta inactivo bajo el plazo propuesto.
 */
async function countAffected(guild, role, policy) {
  await ensureMembersCached(guild);
  const days = policy.inactiveDays ?? settings.getInactiveDays(guild.id);
  const { inactive } = evaluateGuildInactivity(guild, days);
  return inactive.filter(({ member }) => member.roles.cache.has(role.id)).length;
}

function addResultFields(embed, result) {
  embed.addFields(
    { name: 'Marcados', value: String(result.added), inline: true },
    { name: 'Desmarcados', value: String(result.removed), inline: true },
    { name: 'Roles retirados', value: String(result.stripped), inline: true }
  );
}
