
const { db, saveDB, alternates } = require("./database");
const { formatDuration, sendDiscordWebhook } = require("./utils");

/**
 * Further preprocessing to check if a player is banned or allowed to join the server
 * The proxy uses these responses to determine if the player can dial the server
 */
function processLogin({ xuid, address, deviceId, vpn, titleId, maxViewDistance }) {
    // Operator XUIDs listed in operators.json bypass the ban system for safety
    if (db.operators.includes(xuid))
        return { allowed: true, reason: "Operator" };

    // titleId is missing from legitimate connections in offline mode. Bots seem to still have it
    if (titleId !== "" || maxViewDistance === 0)
        return { allowed: false, reason: "Unauthorized" };
    if (vpn === true) 
        return { allowed: false, reason: "VPN or proxies are not allowed." };

    // Check if the player is currently banned or if their blacklist has expired
    if (xuid in db.blacklist) {
        const entry = db.blacklist[xuid];
        const duration = entry.duration ?? Infinity;

        const formatBanEntry = (entry) => [
            `You are banned: ${entry.name} (${xuid})`,
            `Reason: ${entry.reason}`,
            `Issued By: ${entry.issuer} (${entry.date})`,
            `Duration: ${formatDuration(duration - Date.now())}`
        ].join("\n");

        // Null duration means permanent because infinity cannot JSON serialize
        if (duration === Infinity || duration - Date.now() > 0)
            return { allowed: false, reason: formatBanEntry(entry) };

        // The ban expired, remove it from the blacklist asynchronously
        delete db.blacklist[xuid];
        saveDB("blacklist", db.blacklist);
    }

    // Update our in memory alternate account tracking disjoint set
    alternates.union(xuid, deviceId);
    alternates.union(xuid, address);

    // Cross reference all other banned players for profile "fingerprinting"
    const bannedXUIDs = Object.keys(db.blacklist);
    const idCluster = alternates.getCluster(deviceId);
    const ipCluster = alternates.getCluster(address);

    // Check if this player's address or device match any other banned profiles
    if (bannedXUIDs.some(bannedXUID => idCluster.includes(bannedXUID)))
        return { allowed: false, reason: "You are hardware banned." };
    if (bannedXUIDs.some(bannedXUID => ipCluster.includes(bannedXUID)))
        return { allowed: false, reason: "You are IP banned." };
    
    // Player should be allowed to join after preprocessing
    return { allowed: true, reason: "Success" };
}

/**
 * Adds a player into the blacklist into memory and disk for persistence
 * @param {string} name The player username to be blacklisted
 * @param {string} issuer Arbitrary name for whoever is issuing the blacklist
 * @param {string} reason The reason this person is getting banned
 * @param {number} duration The duration in milliseconds this ban will last
 * @returns {Boolean} Whether or not the ban was successful
 */
function blacklist(name, issuer, reason, duration = null) {
    if (name in db.xuids === false) return false;
    const xuid = db.xuids[name];
    
    // Construct the blacklist object and save it into database/blacklist.json
    const date = new Date().toLocaleString("en-US");
    const unbanDate = duration === null ? null : Date.now() + duration;
    db.blacklist[xuid] = { name, issuer, reason, duration: unbanDate, date };

    // Log the ban to the discord webhook provided in .env for responsiveness
    const discordEmbed = {
        description: [
            `## Banned: __${name}__`,
            `**Reason:** ${reason || "No reason provided."}`,
            `**Issuer:** ${issuer || "Server"}`,
            `**Duration:** ${formatDuration(duration)}`,
        ].join("\n"),
        thumbnail: { url: db.profiles[xuid].icon }
    }
    sendDiscordWebhook(discordEmbed, process.env.LOG_CHANNEL, "c");

    // Should ALWAYS return truthy unless the blacklist failed to save to disk
    return saveDB("blacklist", db.blacklist);
}

function unblacklist(name, issuer, reason) {
    const xuid = db.xuids[name];
    if (xuid in db.blacklist === false) return false;
    else delete db.blacklist[db.xuids[name]];

    // Log the ban to the discord webhook provided in .env for responsiveness
    const discordEmbed = {
        description: [
            `## Unbanned: __${name}__`,
            `**Reason:** ${reason || "No reason provided."}`,
            `**Issuer:** ${issuer || "Server"}`,
        ].join("\n"),
        thumbnail: { url: db.profiles[xuid].icon }
    }
    sendDiscordWebhook(discordEmbed, process.env.LOG_CHANNEL, "a");
    return saveDB("blacklist", db.blacklist);
}


module.exports = { processLogin, blacklist, unblacklist };