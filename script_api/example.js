
import { world, system } from "@minecraft/server";
import { registerWsRequest, sendWS, requestWS } from "./websocket";
import { readJSONFile, writeJSONFile } from "./http";

/**
 * Fulfill an inbound ws request made to script_api, e.g.:
 * discord -> proxy -> script -> proxy -> discord
 */
registerWsRequest("get_players", (envelope) => {
    const players = world.getPlayers();
    const names = players.map(player => player.name);
    const payload = { players: names, online: names.length };

    envelope.event = "get_players_response";
    envelope.payload = payload;
    sendWS(envelope);
});

registerWsRequest("message", (envelope) => {
    world.sendMessage(envelope.payload);
});

/**
 * Read a file in the backend JSON data base and write back to it
 * This uses plain http because websockets seem to struggle here
 */
world.afterEvents.worldLoad.subscribe(async () => {
    const xuids = await readJSONFile("xuids");
    const blacklist = await readJSONFile("blacklist");
    const xuid = xuids["AutoAsteroid"];

    // JSON data bases are OK for smaller applications (<10MB)
    delete blacklist[xuid];
    writeJSONFile("blacklist", blacklist);
});

/**
 * Set player ping values to a scoreboard provided by the proxy
 */
system.runInterval(async () => {
    const scoreboard = 
        world.scoreboard.getObjective("ping") ??
        world.scoreboard.addObjective("ping");
        
    const ping = await requestWS("get_ping", "script_api");

    for (const player of world.getPlayers()) {
        scoreboard.setScore(player, ping[player.name]);
    }
}, 20);