
const { MessageFlags, EmbedBuilder } = require("discord.js");
const { sendCommandToScreen } = require("./utils.js");
const { requestWS } = require("./websocket.js");

const commands = new Map();

/**
 * Return an embed listing all current players online on the server and some info
 * Information provided via script api from a websocket request
 */
commands.set("players", async (interaction) => {
    const list = buildPlayerList();
    if (list.embeds.length === 0) return interaction.reply({
        content: "There are currently no players online.",
        flags: MessageFlags.Ephemeral
    });
    await interaction.reply(list);
});

/**
 * Run minecraft commands directly to the server in the screen session running it
 * Commands have the highest permission level, able to run /stop or /transfer
 */
commands.set("console", async (interaction) => {
    // Make sure only members with admin permissions can run this command
    const admin = interaction.memberPermissions.has("Administrator");
    if (!admin) return interaction.reply({
        content: "Only administrators can run this command.",
        flags: MessageFlags.Ephemeral
    });

    // Semi colons represent separation between multiple chained commands
    const command = interaction.options.getString("command");
    sendCommandToScreen("kitpvp", command.replaceAll(";", "\n"));
    await interaction.reply(`Successfully sent \`${command}\` into console.`);
});

module.exports = commands;