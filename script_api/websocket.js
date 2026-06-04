
import { world, system } from "@minecraft/server";
import { websocket } from "@minecraft/server-net";

/**
 * Model of how the websocket server is going to work. Each client can communicate with one another:
 * 
 * 
 *                       ┌─────────────────────────────────────────────────────────┐
 *                       │                  GO PROXY CENTRAL HUB                   │
 *                       │                                                         │
 *                       │   Active Connection Registry (wsConns Map):             │
 *                       │   {                                                     │
 *                       │     "backend":     *websocket.Conn,                     │
 *                       │     "discord":     *websocket.Conn,                     │
 *                       │     "script_api":  *websocket.Conn                      │
 *                       │   }                                                     │
 *                       │                                                         │
 *                       └────────▲──────────────────▲───────────────────▲─────────┘
 *                                │                  │                   │
 *                                │                  │                   │ Bi-Directional
 *                                │                  │                   │ JSON Envelopes
 *                                ▼                  ▼                   ▼
 *                       ┌──────────────────┐┌──────────────────┐┌──────────────────┐
 *                       │   Node Backend   ││   Discord Bot    ││    Script API    │
 *                       │                  ││                  ││   (BDS Server)   │
 *                       └──────────────────┘└──────────────────┘└──────────────────┘
 * 
 * 
 */

export class WebSocketClient {
    constructor() {
        // Used to make sure each outbound request has a unique identifier we can use to map to its promise
        this.id_counter = 0;
        this.ws_url = null;
        this.socket = null;
        this.reconnectTimer = null;
        this.client_name = null;
        this.token = "";

        // Map of request IDs to its promise for requests that expect a response
        this.pendingRequests = new Map();
        this.inboundRequests = new Map();
    }

    /**
     * Start a connection to the provided webscoket url to communicate to our other applications
     * @param {string} name Our arbitrary name of the client that is connecting to the proxy
     * @param {string} base_url The websocket url that we are connecting to (proxy in our case)
     * @param {string} token Auth token to connect to the central hub if defined in the proxy
     * @returns {WebSocketClient}
     */
    async connect(name = this.client_name, base_url = this.ws_url, token = this.token) {
        // Save these parameters for later if we try to reconnect without any parameters
        this.client_name = name;
        this.ws_url = base_url;
        this.token = token;

        // Unsubscribe from these listeners if they exist before making a new connection
        if (this.socket) {
            this.socket.afterEvents.message.unsubscribe(this.message);
            this.socket.afterEvents.close.unsubscribe(this.disconnect);
        }
        // Attempt to connect to the websocket, otherwise try again after 5 seconds
        try {
            const endpoint = `${base_url}?client=${name}&token=${token}`;
            this.socket = await websocket.connect(endpoint);
            this.onOpen();
        } catch {
            this.onClose();
        }
        return this;
    }

    onOpen() {
        // Successfully connected to the websocket and clear our any waiting timeouts
        world.sendMessage("§aSuccessfully connected to websocket.");
        if (this.reconnectTimer) system.clearRun(this.reconnectTimer);

        // Bind our event listeners to detect when the websocket closes or gets a message
        this.reconnectTimer = null;
        this.message = this.socket.afterEvents.message.subscribe((data) => this.onMessage(data));
        this.disconnect = this.socket.afterEvents.close.subscribe(() => this.onClose());
    }

    onClose() {
        // Cancel pending promises so they don't hang forever in the background
        for (const [ id, deferred ] of this.pendingRequests.entries()) {
            deferred.reject(new Error("Connection lost. Request canceled."));
            this.pendingRequests.delete(id);
        }

        // Prevent stacking duplicate timers if multiple close/error events fire
        if (this.reconnectTimer === null) {
            this.reconnectTimer = system.runTimeout(() => {
                this.reconnectTimer = null;
                this.connect();
            }, 100);
        }
    }

    /**
     * Send a websocket message to the proxy hub that is then forwarded to the provided target destination
     * @param {string} envelope.event The name of the websocket event so other connections know what is requested 
     * @param {string} envelope.target The destination websocket target that this request is meant for 
     * @param {string} envelope.id The ID of this request. Used for the initial caller to differentiate requests
     * @param {any} envelope.payload The data being sent through the websocket to the proxy hub and then to target
     * @returns {void}
     */
    send(envelope) {
        if (this.isConnected) this.socket.send(JSON.stringify(envelope));
    }

    /**
     * Send an arbitrary websocket request and wait for its response in our onMessage handler event
     * Each request carries its own unique ID so we know which respective promise gets resolved 
     */
    request(event, target, payload = {}) {
        return new Promise((resolve, reject) => {
            // Return nothing if the websocket is currently offline or disconnected
            if (!this.isConnected) return resolve(null);

            const requestId = this.client_name + ":" + this.id_counter++;
            this.pendingRequests.set(requestId, { resolve, reject });

            // Timeout safety guard to avoid hangs for requests that don't fulfill quick enough
            system.runTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    resolve(null);
                }
            }, 100);

            this.send({ event, target, id: requestId, payload });
        });
    }

    // Used for safely parsing envelopes and return null if they are malformed
    static parse(string) {
        try {
            const result = JSON.parse(string);
            return typeof result === "object" ? result : null;
        } catch { 
            return null;
        }
    }

    // Handle any expected websocket requests that our backend is expected to receive 
    async onMessage({ message }) {
        const envelope = WebSocketClient.parse(message);
        const { id, event, target, payload } = envelope ?? {};

        // This is a reply to an outbound request we created. Resolve the promise
        if (id && this.pendingRequests.has(id)) {
            const deferred = this.pendingRequests.get(id);
            this.pendingRequests.delete(id);
            return deferred.resolve(payload);
        }

        // This is an inbound request to our script that needs to be fulfilled
        if (this.inboundRequests.has(event))
            return this.inboundRequests.get(event)(envelope);

        console.log(`Unhandled event: ${event}`);
    }

    get isConnected() {
        return this.socket && this.socket.isOpen;
    }
};

// Connect to the central websocket hub provided a token if needed
const Client = new WebSocketClient();
const TOKEN = "";

world.afterEvents.worldLoad.subscribe(() => {
    Client.connect("script_api", "ws://127.0.0.1:8080/ws", TOKEN);
});

// Expose arbitrary outbound websocket requests to the rest of the program
export function requestWS(event, target, payload = {}) {
    return Client.request(event, target, payload);
}

// Sends a request over the websocket with no expected return value back
export function sendWS(envelope) {
    return Client.send(envelope);
}

export function registerWsRequest(event, callback) {
    Client.inboundRequests.set(event, callback);
}