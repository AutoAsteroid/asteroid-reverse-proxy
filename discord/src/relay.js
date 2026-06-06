
const { unemojify } = require("node-emoji");
const { sendWS } = require("./websocket.js");

// Fallback to config layout tracking variable name consistency
const { RELAY_CHANNEL_ID } = require("../config.json"); 

/**
 * Listen to messages in our channel and format them into tellraw to send to the ingame chat
 * over weksockets, eliminating the need for an ingame bot or tellraw commands in console
 */
function relay({ author, channel, content }) {
    // Only respond to content messages from the target server chat channel
    if (author.bot || channel.id !== RELAY_CHANNEL_ID) return;
    if (!content || /^https?:\/\/\S+$/i.test(content)) return;

    // Slice message content if it gets a bit too long to relay safely
    const text = content.length > 150 ? content.slice(0, 150) + "....." : content;
    const clean = text.replaceAll("\\", "").replaceAll("\"", "\\\"");
    
    // Send message with Minecraft color notation to world.sendMessage()
    const tellraw = `§8[§9Discord§8] §7${author.tag}: §f${unemojify(clean)}`;
    sendWS({ event: "message", target: "script_api", payload: tellraw });
}

module.exports = relay;