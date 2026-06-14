
const { db, saveDB } = require("./database");
const { registerWsRequest, sendWS } = require("./websocket");
const { processLogin, blacklist, unblacklist } = require("./bans");
const { runConsole, isVPN, messageServer, syncIcon, xuidFromUsername } = require("./utils");

/**
 * Process and save a player's login packet and cache their info into profiles.json
 * Also returns to the proxy if this connection should be authorized to join the game
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
    db.profiles[xuid].icon = await syncIcon(displayName);
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
    // In my use case, I assume my BDS server is in the screen "kitpvp"
    runConsole(envelope.payload, "kitpvp");
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

registerWsRequest("get_ban", (envelope) => {
    const xuid = db.xuids[envelope.payload];
    envelope.event = "get_ban_response";
    envelope.payload = db.blacklist[xuid];
    sendWS(envelope);
});

/**
 * Allow script API to access and edit the backend databases
 * Without needing to load the entire DB with readJSONFile()
 */
registerWsRequest("get_db_key", (envelope) => {
    const { file, key } = envelope.payload;
    db[file] ??= {};
    envelope.event = "get_db_key_response";
    envelope.payload = db[file][key];
    sendWS(envelope);
});

registerWsRequest("set_db_key", (envelope) => {
    const { file, key, object } = envelope.payload;
    db[file] ??= {};
    db[file][key] = object;
    saveDB(file, db[file]);
});

/**
 * Allow other websocket clients to make requests and changes to the blacklist
 * The requesting client will get a boolean representing success or failure
 */
registerWsRequest("blacklist", (envelope) => {
    const { name, issuer, reason, duration } = envelope.payload;
    envelope.event = "blacklist_response";
    envelope.payload = blacklist(name, issuer, reason, duration);
    sendWS(envelope);
});

registerWsRequest("unblacklist", (envelope) => {
    const { name, issuer, reason } = envelope.payload;
    envelope.event = "unblacklist_response";
    envelope.payload = unblacklist(name, issuer, reason);
    sendWS(envelope);
});

/**
 * Return an array of all usernames linked to any given username
 * Accounts are considered linked if they share an IP or device
 */
registerWsRequest("alternates", (envelope) => {
    const alternates = require("../lib/alts");
    const xuid = xuidFromUsername(envelope.payload);
    const links = alternates.dsu.getCluster(xuid);

    // Filter only the usernames that exist in the cluster
    const usernames = links
        .map(id => db.profiles[id]?.displayName)
        .filter(Boolean);

    envelope.event = "alternates_response";
    envelope.payload = usernames;
    sendWS(envelope);
});

registerWsRequest("trace_alts", (envelope) => {
    const alternates = require("../lib/alts");
    const xuid = xuidFromUsername(envelope.payload);

    // Responds with a tree structure of the trace
    envelope.event = "trace_response";
    envelope.payload = alternates.trace(xuid);
    sendWS(envelope);
});