
const { MessageFlags, EmbedBuilder } = require("discord.js");
const { exec } = require("child_process");
const { requestWS } = require("./websocket");

/**
 * Sends a command directly into the server console by using a screen session
 * @param {string} command The command to run into the server console
 */
function runConsole(command, screen) {
    const safeCommand = command.replace(/"/g, '\\"');
    const fullCommand = `screen -S ${screen} -X stuff "${safeCommand}\\n"`;
    exec(fullCommand);
}

/**
 * Returns a list of formatted embeds of all the players online the server
 * Each embed has a max of 24 fields, or 24 players shown in each embed
 * Discord has a max of 10 embeds per message, and 30 fields per embed
 */
async function buildPlayerList() {
    // get_players in example.js does not fulfill my actual implementation of it
    const players = await requestWS("get_players", "script_api");
    const playersArray = Object.entries(players);
    
    // Build as many embeds as needed, as discord limits to 30 fields per embed
    const embeds = [];
    const chunkSize = 24;

    const format = (name, info) => {
        const location = info.inSet ? "Set" : info.inPvP ? "PvP" : "Spawn";
        const value = [
            `Device: ${info.device} (${info.input})`,
            `Armor: ${info.armor} (${location})`,
            `Ping: ${info.ping}ms`,
            `Joined: <t:${Math.floor(info.join / 1000)}:R>`
        ].join("\n");
        return { name: `__${name}__`, inline: true, value };
    }

    // Partition our players into chunks of 24 fields max per discord embed
    for (let i = 0; i < playersArray.length; i += chunkSize) {
        const chunk = playersArray.slice(i, i + chunkSize);
        const embed = new EmbedBuilder();

        if (i === 0)
            embed.setTitle(`Online Players (${playersArray.length})`);
        for (const [ name, info ] of chunk)
            embed.addFields(format(name, info));
        embeds.push(embed);
    }
    return { embeds: embeds };
}

module.exports = { runConsole, buildPlayerList };