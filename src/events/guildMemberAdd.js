const { Events } = require('discord.js');
const repository = require('../db/repository');

module.exports = {
  name: Events.GuildMemberAdd,
  once: false,
  async execute(member) {
    if (member.user.bot) return;
    repository.recordMemberFirstSeen(member.id, member.guild.id, member.displayName, Date.now());
  },
};
