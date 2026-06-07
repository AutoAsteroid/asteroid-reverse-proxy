
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

/**
 * This function is not complete and only imitates the player swinging
 */
Player.prototype.attack = function() {
    const hitPacket = {
        name: "Animate",
        payload: {
            "ActionType": 1,        
            "EntityRuntimeID": 0, // Unique per session, proxy handles this
            "Data": 0,
            "SwingSource": 5
        }
    };

    // Send the packet out via WebSocket targeting this player's session
    sendWS({ 
        event: "send_client_packet", 
        target: this.name, 
        payload: hitPacket 
    });
};
