
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { db, saveDB } = require("./database");
const { sendWS } = require("./websocket");

/**
 * Sends a message and sound ingame to to all players on the minecraft server 
 * @param {string} message The message to send
 * @param {string} sound The minecraft sound id to play
 */
function messageServer(message, sound) {
    sendWS({ event: "message", target: "script_api", payload: { message, sound } });
}

/**
 * Sends a command directly into the server console via a screen session
 * @param {string} command The command to run in the server console
 */
function runConsole(command, screen) {
    const safeCommand = command.replace(/"/g, '\\"');
    const fullCommand = `screen -S ${screen} -X stuff "${safeCommand}\\n"`;
    exec(fullCommand);
}

/**
 * Convert milliseconds to a formatted duration string in d, h, m, s
 * @param {number} milliseconds Time in milliseconds to convert
 * @returns {string} The formatted time like: 12d 23h 45m 0s
 */
function formatDuration(milliseconds) {
    // Handle infinity and NaN to default to "Forever"
    if (Number.isFinite(milliseconds) === false) return "Forever";

    // Calculate the total days, hours, minutes, and seconds
    const totalSeconds = Math.ceil(Math.max(milliseconds, 0) / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    // Return the formatted millisecond duration
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

/**
 * Checks if an IP address is a VPN and save the result to cache in database/vpns
 * @param {string} address IPv4 string of address to check if is detected as a VPN
 * @returns {boolean} If the address is a VPN from cache or from IPData API
 */
async function isVPN(address) {
    // Return cached calue if this address was processed before to save api calls
    if (address in db.vpns) return db.vpns[address];

    // You can get your own FREE token at https://dashboard.ipdata.co/
    const IPDATA_KEY = process.env.IPDATA_KEY;
    try {
        // Call IPDATA API to check if this address is a VPN
        const url = `https://api.ipdata.co/${address}?api-key=${IPDATA_KEY}`;
        const ipdata = await fetch(url); 
        const ipJSON = await ipdata.json();
        const threat = ipJSON.threat ?? {};

        // Count as a VPN if any threat is true (proxy, tor, etc..)
        db.vpns[address] = Object.values(threat).some(v => v === true);
        saveDB("vpns", db.vpns);
    } catch {}

    return db.vpns[address];
}

/**
 * Attachs the player's head to a discord webhook and returns the private
 * @param {string} username The name of the player that, ideally, just joined the server
 * @returns {Promise<string>} The CDN url that discord created for our image
 */
async function syncIcon(username) {
    // Path to the player's face that was saved to disk by the go proxy
    const facePath = path.join("..", "proxy", "skins", username, "face.png");
    if (!fs.existsSync(facePath)) return null;

    // Build the embed JSON and upload our image to the discord webhook
    const imageBuffer = fs.readFileSync(facePath);
    const formData = new FormData();
    const payload = {
        embeds: [{
            title: username,
            image: { url: `attachment://${username}.png` },
            timestamp: new Date().toISOString()
        }]
    };
    formData.append("payload_json", JSON.stringify(payload));
    formData.append("files[0]", new Blob([imageBuffer]), username + ".png");

    // Send the discord webhook and try to extract the generated CDN link
    const url = process.env.WEBHOOK_URL + "?wait=true";
    const response = await fetch(url, { method: "POST", body: formData });
    if (!response.ok) return null;

    const result = await response.json();
    return result.embeds[0].image.url;
}

module.exports = { messageServer, isVPN, runConsole, formatDuration, syncIcon };