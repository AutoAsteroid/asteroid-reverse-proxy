
const { MessageFlags, EmbedBuilder } = require("discord.js");
const { Client, GatewayIntentBits, Events } = require("discord.js");
const { STAFF_ROLE_ID } = require("../config.json")
const { commands, permissions } = require("./commands");
const relay = require("./relay");

// Load environment variables that includes our discord bot token to load our commands
require("dotenv").config({ quiet: true });

// Closed source, private image generating player list channel
try {
    require("../private/playerlist");
} catch {}

const client = new Client({ 
    presence: { 
        status: "online", 
        activities: [ 
            { name: "Asteroid PvP 🟢", state: "IP: asteroidnetwork.org, Port: 19132" } 
        ] 
    },
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent 
    ],
    waitGuildTimeout: 10000
});

// Bot boot up diagnostics, the chat relay, and the custom discord command listener
client.on(Events.ClientReady, () => {
    const { username, displayName, createdAt, tag, id } = client.user;
    console.log(`Discord connected: ${username} (${id})`);
    console.log(`Account created: ${createdAt.toLocaleString()}`);
});

// Handle incoming discord command interations sent to the discord server
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isCommand()) return;
    if (!interaction.inGuild())
        return interaction.reply("This command only works in a server.");

    const executeCommand = commands.get(interaction.commandName);
    const requiredPermission = commands.get(interaction.commandName);
    if (!executeCommand) return;

    // Authorize that this person has the required permissions to run this
    const isAdmin = interaction.memberPermissions?.has("Administrator") ?? false;
    const isStaff = interaction.member?.roles.cache.has(STAFF_ROLE_ID) ?? false;

    if (requiredPermission === "admin" && !isAdmin) {
        return interaction.reply({
            content: "Only administrators can run this command.",
            flags: MessageFlags.Ephemeral
        });
    }
    if (requiredPermission === "staff" && !isAdmin && !isStaff) {
        return interaction.reply({
            content: "Only staff members can run this command.",
            flags: MessageFlags.Ephemeral
        });
    }
    // Execute the interaction if permissions are authorized
    try {
        await executeCommand(interaction);
    } catch (error) {
        console.error(`Command error (${interaction.commandName}):`, error);
    }
});

// Chat relay between discord to minecraft server listener
client.on(Events.MessageCreate, relay);

// Login in to the bot using our environment variable token!
client.login(process.env.DISCORD_TOKEN);

module.exports = client;