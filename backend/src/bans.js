
const { db, saveDB } = require("./database");
const { formatDuration } = require("./utils");

/**
 * Further preprocessing to check if a player is banned or allowed to join the server
 * The proxy uses these responses to determine if the player can dial the server
 */
function processLogin({ xuid, address, deviceId, vpn }) {
    // Operator XUIDs listed in operators.json bypass the ban system for safety
    if (db.operators.includes(xuid))
        return { allowed: true, reason: "Operator" };
    if (vpn === true) 
        return { allowed: false, reason: "VPN or proxies are not allowed." };

    // Check if the player is currently banned or if their blacklist has expired
    if (xuid in db.blacklist) {
        const entry = db.blacklist[xuid];

        const formatBanEntry = (entry) => [
            `You are banned: ${entry.name} (${xuid})`,
            `Reason: ${entry.reason}`,
            `Issued By: ${entry.issuer} (${entry.date})`,
            `Duration: ${formatDuration(entry.duration)}`
        ].join("\n");

        // Null duration means permanent because infinity cannot JSON serialize
        if (entry.duration === null || entry.duration - Date.now() > 0)
            return { allowed: false, reason: formatBanEntry(entry) };

        // The ban expired, remove it from the blacklist asynchronously
        delete db.blacklist[xuid];
        saveDB("blacklist", db.blacklist);
    }
    // Cross reference all other banned players for profile "fingerprinting"
    const bannedXUIDs = Object.keys(db.blacklist);

    // Check if this player's address or device match any other banned profiles
    if (bannedXUIDs.some(xuid => db.profiles[xuid]?.deviceIDs?.includes(deviceId)))
        return { allowed: false, reason: "You are hardware banned." };
    if (bannedXUIDs.some(xuid => db.profiles[xuid]?.addresses?.includes(address)))
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
function blacklist(name, issuer, reason, duration = Infinity) {
    if (name in db.xuids === false) return false;
    const xuid = db.xuids[name];
    
    // Construct the blacklist object and save it into database/blacklist.json
    const date = new Date().toLocaleString("en-US");
    const unbanDate = duration === Infinity ? null : Date.now() + duration;

    db.blacklist[xuid] = { name, issuer, reason, duration: unbanDate, date };
    return saveDB("blacklist", db.blacklist);
}

function unblacklist(name, issuer, reason) {
    if (db.xuids[name] in db.blacklist === false) return false;

    delete db.blacklist[db.xuids[name]];
    return saveDB("blacklist", db.blacklist);
}


module.exports = { processLogin, blacklist, unblacklist };