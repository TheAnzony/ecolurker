const { Events } = require('discord.js');
const repository = require('../db/repository');

module.exports = {
  name: Events.GuildMemberRemove,
  once: false,
  async execute(member) {
    repository.forgetMember(member.id, member.guild.id);
  },
};
