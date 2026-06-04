
const { exec } = require("child_process");
const { db, saveDB } = require("./database");
const { registerWsRequest } = require("./websocket");

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
registerWsRequest("login", ({ payload }) => {
    const { xuid, address, displayName, deviceId } = payload;
    // console.log("Received login from:", displayName, "(" + address + ")");

    // Keep an array of all device IDs and IPs this player logged in with
    const savedIPs = db.profiles[xuid]?.addresses ?? [];
    const savedIDs = db.profiles[xuid]?.deviceIDs ?? [];

    if (!savedIPs.includes(address)) savedIPs.push(address);
    if (!savedIDs.includes(deviceId)) savedIDs.push(deviceId);

    db.profiles[xuid] = payload;
    db.profiles[xuid].addresses = savedIPs;
    db.profiles[xuid].deviceIDs = savedIDs;
    db.profiles[xuid].vpn = isVPN(address);
    db.xuids[displayName] = xuid;

    // Persist these changes into disk if program crashes or restarts
    saveDB("profiles", db.profiles);
    saveDB("xuids", db.xuids);
});

/**
 * Send a command directly into the BDS server console, allowing for commands such as:
 * /stop, /allowlist, and all other owner level permission commands like op and deop
 */
registerWsRequest("run_console", ({ payload: { command } }) => {
    // Clean command and send into the assumed screen session "kitpvp"
    const safeCommand = command.replace(/"/g, '\\"');
    const fullCommand = `screen -S kitpvp -X stuff "${safeCommand}\\n"`;
    exec(fullCommand);
});