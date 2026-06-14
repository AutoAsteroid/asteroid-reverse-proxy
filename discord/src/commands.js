
const toMilliseconds = require("ms");
const { MessageFlags, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { runConsole } = require("./utils.js");
const { requestWS } = require("./websocket.js");
const { buildPlayerList, formatDuration } = require("./utils.js");

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

permissions.set("console", [ "Administrator" ]);

/**
 * Request the backend's disjoint set to get all the alt accounts of that given user
 * Accounts are considered alts if they share at least one device ID or IP address
 */
commands.set("alts", async (interaction) => {
    const username = interaction.options.getString("username");
    const wantTrace = interaction.options.getBoolean("trace") ?? false;

    await interaction.deferReply();
    const action = wantTrace ? "trace_alts" : "alternates";
    const response = await requestWS(action, "backend", username);
    
    // Send the generated png image of the network trace from the backend
    if (wantTrace) {
        const name = `trace_${username}.png`;
        const trace = new AttachmentBuilder(Buffer.from(response.data), { name });
        return await interaction.editReply({ files: [ trace ] });
    }
    // Send the quick normal embed of alts if trace is disabled 
    const altEmbed = new EmbedBuilder()
        .setTitle(`__${username}__`)
        .setDescription(response.join("\n") || "Account not registered.")

    await interaction.editReply({ embeds: [ altEmbed ] });
});

permissions.set("alts", [ "Staff" ]);

/**
 * Request the backend to fulfill a ban request made from the discord bot
 * No provided duration will mean the ban is permanent (represented as null)
 */
commands.set("ban", async (interaction) => {
    const name = interaction.options.getString("username");
    const durationInput = interaction.options.getString("duration");
    const reason = interaction.options.getString("reason");
    const issuer = interaction.user.username;

    // Null or no provided duration means that this ban is permanent
    const duration = durationInput ? toMilliseconds(durationInput) : null;
    if (duration === undefined) return interaction.reply({
        content: "Please enter a valid ban duration.",
        flags: MessageFlags.Ephemeral
    });

    // Request the backend to handle the actual blacklisting system
    const payload = { name, issuer, reason, duration };
    const status = await requestWS("blacklist", "backend", payload);
    const banEmbed = new EmbedBuilder()
        .setColor(status ? 5635925 : 16733525) // Green or Red
        .setDescription([
            `## Ban ${status ? "Success": "Failed"}: __${name}__`,
            `**Reason:** ${reason || "No reason provided."}`,
            `**Issuer:** ${issuer}`,
            `**Duration:** ${formatDuration(duration)}`,
        ].join("\n"))
        .setTimestamp()
        .setFooter({ text: "Asteroid PvP" });

    await interaction.reply({ embeds: [ banEmbed ] });
});

permissions.set("ban", [ "BanMembers" ]);

/**
 * Request the backend to fulfill an unban request made from the discord bot
 */
commands.set("unban", async (interaction) => {
    const name = interaction.options.getString("username");
    const reason = interaction.options.getString("reason");
    const issuer = interaction.user.username;

    // Request the backend to handle the actual blacklisting system
    const payload = { name, issuer, reason };
    const status = await requestWS("unblacklist", "backend", payload);
    const unbanEmbed = new EmbedBuilder()
        .setColor(status ? 5635925 : 16733525) // Green or Red
        .setDescription([
            `## Unban ${status ? "Success": "Failed"}: __${name}__`,
            `**Reason:** ${reason || "No reason provided."}`,
            `**Issuer:** ${issuer}`,
        ].join("\n"))
        .setTimestamp()
        .setFooter({ text: "Asteroid PvP" });

    await interaction.reply({ embeds: [ unbanEmbed ] });
});

permissions.set("unban", [ "BanMembers" ]);


module.exports = { commands, permissions };