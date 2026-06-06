
const { Client, GatewayIntentBits, Events } = require("discord.js");
const commands = require("./commands");
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

// Bot boot up diagnostics and slash command lister
client.on(Events.ClientReady, () => {
    const { username, displayName, createdAt, tag, id } = client.user;
    console.log(`Discord connected: ${username} (${id})`);
    console.log(`Account created: ${createdAt.toLocaleString()}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isCommand()) return;
    if (!interaction.inGuild())
        return interaction.reply("This command only works in a server.");

    const executeCommand = commands.get(interaction.commandName);
    if (!executeCommand) return;
    try {
        await executeCommand(interaction);
    } catch {}
});

// Chat relay between discord to minecraft server listener
client.on(Events.MessageCreate, relay);

// Login in to the bot using our environment variable token!
client.login(process.env.DISCORD_TOKEN);

module.exports = client;