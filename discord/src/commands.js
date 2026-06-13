
const { MessageFlags, EmbedBuilder } = require("discord.js");
const { runConsole } = require("./utils.js");
const { requestWS } = require("./websocket.js");
const { buildPlayerList } = require("./utils.js");

const commands = new Map();
const permissions = new Map();

/**
 * Return an embed listing all current players online on the server and some info
 * Information provided via script api from a websocket request
 */
commands.set("players", async (interaction) => {
    const playerList = await buildPlayerList();
    
    if (playerList.embeds.length === 0) {
        return interaction.reply({
            content: "There are currently no players online.",
            flags: MessageFlags.Ephemeral
        });
    }
    await interaction.reply(playerList);
});

/**
 * Run minecraft commands directly to the server in the screen session running it
 * Commands have the highest permission level, able to run /stop or /transfer
 */
commands.set("console", async (interaction) => {
    // Semi colons represent separation between multiple chained commands
    const command = interaction.options.getString("command");
    runConsole(command.replaceAll(";", "\n"), "kitpvp");
    await interaction.reply(`Successfully sent \`${command}\` into console.`);
});

permissions.set("console", "admin");

/**
 * Request the backend's disjoint set to get all the alt accounts of that given user
 * Accounts are considered alts if they share at least one device ID or IP address
 */
commands.set("alts", async (interaction) => {
    const username = interaction.options.getString("username");
    const alts = await requestWS("alternates", "backend", username);
    const altEmbed = new EmbedBuilder()
        .setTitle(`__${username}__`)
        .setDescription(alts.join("\n") || "No alt accounts.")

    await interaction.reply({ embeds: [ altEmbed ] });
});

permissions.set("alts", "staff");

module.exports = { commands, permissions };