
const { exec } = require("child_process");
const { db, saveDB } = require("./database");
const { registerWsRequest, sendWS } = require("./websocket");
const { processLogin } = require("./bans");

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
 * Process and save a player's login packet and cache their info into profiles.json
 * @param {Object} payload LoginInfo struct sent from websocket from the proxy
 */
registerWsRequest("login", async (envelope) => {
    const { xuid, address, displayName, deviceId } = envelope.payload;
    // console.log("Received login from:", displayName, "(" + address + ")");

    // Keep an array of all device IDs and IPs this player logged in with
    const savedIPs = db.profiles[xuid]?.addresses ?? [];
    const savedIDs = db.profiles[xuid]?.deviceIDs ?? [];

    if (!savedIPs.includes(address)) savedIPs.push(address);
    if (!savedIDs.includes(deviceId)) savedIDs.push(deviceId);

    db.profiles[xuid] = envelope.payload;
    db.profiles[xuid].addresses = savedIPs;
    db.profiles[xuid].deviceIDs = savedIDs;
    db.profiles[xuid].vpn = await isVPN(address);
    db.xuids[displayName] = xuid;

    // Persist these changes into disk if program crashes or restarts
    saveDB("profiles", db.profiles);
    saveDB("xuids", db.xuids);

    // Reply to the proxy if this player should be allowed to join
    envelope.event = "login_response";
    envelope.payload = processLogin(db.profiles[xuid]);
    sendWS(envelope);
});

/**
 * Send a command directly into the BDS server console, allowing for commands such as:
 * /stop, /allowlist, and all other owner level permission commands like op and deop
 */
registerWsRequest("run_console", (envelope) => {
    // Clean command and send into the assumed screen session "kitpvp"
    const safeCommand = envelope.payload.replace(/"/g, '\\"');
    const fullCommand = `screen -S kitpvp -X stuff "${safeCommand}\\n"`;
    exec(fullCommand);
});

/**
 * Return a cached player login packet directly from memory
 * In my use case I use this for my scripts to process logins and bans
 */
registerWsRequest("get_profile", (envelope) => {
    const xuid = db.xuids[envelope.payload];
    envelope.event = "get_profile_response";
    envelope.payload = db.profiles[xuid];
    sendWS(envelope);
});

// Allow script API to access and edit the backend databases
// Without needing to load the entire DB with readJSONFile()
registerWsRequest("get_db_key", (envelope) => {
    const { file, key } = envelope.payload;
    console.log(file, key)

    db[file] ??= {};
    envelope.event = "get_db_key_response";
    envelope.payload = db[file][key];
    console.log(db[file][key])
    console.log(envelope)
    sendWS(envelope);
});

registerWsRequest("set_db_key", (envelope) => {
    const { file, key, object } = envelope.payload;
    db[file] ??= {};
    db[file][key] = object;
    saveDB(file, db[file]);
});