package main

import (
    "fmt"
    "time"
	"encoding/json"
	"sync"
	"net/http"
	"log"

	"github.com/gorilla/websocket"
	"github.com/sandertv/gophertunnel/minecraft/protocol"
	"github.com/sandertv/gophertunnel/minecraft/protocol/login"
)

// This serves as our middle man to handle multiple concurrent websocket connextions for our applications
// Any one client can request from another connected app, rather than being limited to point to point
// This avoids a P2P mesh where every app needs to make its own WS connection to each other app (N^2)

type LoginInfo struct {
	XUID       	string 					`json:"xuid"`
	DisplayName string 					`json:"displayName"`
	Identity   	string 					`json:"identity"`
	TitleID    	string 					`json:"titleId"`
	Address		string					`json:"address"`

	SkinID           string 			`json:"skinId"`
	SelfSignedID     string 			`json:"selfSignedId"`
	PlayFabID        string 			`json:"playFabId"`
	PlatformType     int    			`json:"platformType"`
	MaxViewDistance  int    			`json:"maxViewDistance"`
	MemoryTier       int    			`json:"memoryTier"`
	DeviceModel      string 			`json:"deviceModel"`
	DeviceID         login.DeviceID 	`json:"deviceId"`
	DeviceOS         protocol.DeviceOS 	`json:"deviceOS"`
	DefaultInputMode int    			`json:"defaultInputMode"`
	CurrentInputMode int    			`json:"currentInputMode"`
	ClientRandomID   int64  			`json:"clientRandomId"`
	Platform         string 			`json:"platform"`
}

var (
	// Track WebSocket connections and mutex for safe concurrent access
    wsConns = make(map[string]*websocket.Conn)
    wsMu sync.Mutex

    upgrader = websocket.Upgrader{
        ReadBufferSize:  1024,
        WriteBufferSize: 1024,
        CheckOrigin:     func(r *http.Request) bool { return true },
    }
)

var DeviceOSMap = map[protocol.DeviceOS]string{
    1:  "Android",
    2:  "IOS",
    3:  "MacOS",
    4:  "FireOS",
    5:  "GearVR",
    6:  "Hololens",
    7:  "Windows10",
    8:  "Windows32",
    9:  "Dedicated Server",
    10: "TVOS",
    11: "PlayStation",
    12: "Nintendo Switch",
    13: "Xbox",
    14: "Windows Phone",
    15: "Linux",
}

// Normalized WebSocket message structure to maintain a consistent format for all events sent across the WebSocket bridge
type WSEnvelope struct {
	Event     string          `json:"event"`     			// e.g., "login", "packet_send", "packet_receive"
	Target    string          `json:"target"`    			// e.g., "backend", "script_api", "discord"
	ID        string          `json:"id,omitempty"` 		// ID of the request, used for callbacks if needed
	Timestamp int64           `json:"timestamp"` 			// Unix timestamp tracking when the event was received
	Payload   json.RawMessage `json:"payload"`   			// Keeps data raw/unparsed until it reaches its destination
}

func listenToClient(clientType string, conn *websocket.Conn) {
	// Close the WebSocket registry and close the connection when the client disconnects
	defer func() {
		log.Printf("Websocket client was disconnected: \"%s\"", clientType)
		wsMu.Lock()
		delete(wsConns, clientType)
		wsMu.Unlock()
		conn.Close()
	}()

	for {
		// Read incoming messages from this WebSocket connection
		_, message, err := conn.ReadMessage()
		if err != nil {
			break
		}
		// Parse the envelope to see where this message is supposed to go
		var envelope WSEnvelope
		if err := json.Unmarshal(message, &envelope); err != nil {
			continue
		}
		// Check if this request is meant to be handled internally or routed
		if ignore := handleInternalRequest(&envelope); ignore {
            continue
        }

		// Forward the raw message to the target client if they are online
		wsMu.Lock()
		targetConn, online := wsConns[envelope.Target]
		wsMu.Unlock()

		if online {
			// Handoff the sender back to the target where it can then know who to respond back to. Example:

			// 1. Discord bot sends:   		{ "event": "get_players",			"target": "script_api" }
			// 2. Go Proxy receives:		{ "event": "get_players", 	  		"target": "script_api" }
			// 3. Go rewrites target: 		payload.Target = clientType = "discord"
			// 4. Forward to script:   		{ "event": "get_players",     		"target": "discord" }
			// 5. Script API receives:  	{ "event": "get_players",       	"target": "discord" }
			// 6. Script API responds:  	{ "event": "get_players_response", 	"target": "discord", "payload": { ... } }
			// 7. Go Proxy receives:    	{ "event": "get_players_response", 	"target": "discord", "payload": { ... } }
			// 8. Go rewrites target:   	payload.Target = clientType = "script_api"
			// 9. Forward back home:		{ "event": "get_players_response", 	"target": "script_api", "payload": { ... } }
			// 10. Discord bot receives: 	{ "event": "get_players_response", 	"target": "script_api", "payload": { ... } }

			// Now the original request knows it got its response back completing a round trip (using a request id)
			envelope.Target = clientType
			envelope.Timestamp = time.Now().UnixMilli()

            fullMessage, err := json.Marshal(envelope)
            if err != nil {
                log.Println("Error marshaling routing envelope context:", err)
                continue
            }
			if err := targetConn.WriteMessage(websocket.TextMessage, fullMessage); err != nil {
				log.Printf("Failed to forward packet to target '%s': %v", envelope.Target, err)
			}
		}
	}
}

// handleInternalRequest checks if an incoming message is meant for the proxy itself.
// Returns true to drop/ignore the packet, or false if it should be rerouted.
func handleInternalRequest(envelope *WSEnvelope) bool {
    switch envelope.Event {

    case "get_ping":
		// Update the payload and reroute it to the current target
        playerpingMu.RLock()
        pingData := playerPing
        playerpingMu.RUnlock()

        envelope.Event = "ping_response"
        envelope.Payload, _ = json.Marshal(pingData)

    case "drop":
        // Drops the websocket request, effectively doing nothing
        return true 
    }

	return false // Pass the payload along to reroute normally
}

func SendWebSocketEvent(target string, event string, data interface{}) error {
	// Fetch the target client's WebSocket connection from the registry and process it safely
	wsMu.Lock()
	targetConn, online := wsConns[target]
	wsMu.Unlock()

	// If the requested websocket hasn't connected to our proxy yet, fail immediately
	if !online {
		return fmt.Errorf("target client '%s' is offline or not registered", target)
	}

	// Marshal our data payload into raw JSON bytes to satisfy json.RawMessage
	payload, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal payload for event '%s': %w", event, err)
	}

	envelope := WSEnvelope{
		Event:     event,
		Target:    target, // Target client will see themselves as the final destination
		Timestamp: time.Now().UnixMilli(),
		Payload:   payload,
	}

	// Transmit the JSON payload specifically down the targeted client's socket pipe
	if err := targetConn.WriteJSON(envelope); err != nil {
		return fmt.Errorf("failed to transmit event '%s' to '%s': %w", event, target, err)
	}
	return nil
}

func ForwardLoginToBackend(identity *login.IdentityData, client *login.ClientData, address string) error {
	// Simplify identity data and client data into a unified JSON structure
	loginInfo := LoginInfo{
		XUID:             identity.XUID,
		DisplayName:      identity.DisplayName,
		Identity:         identity.Identity,
		TitleID:          identity.TitleID,
		Address:          address,
		SkinID:           client.SkinID,
		SelfSignedID:     client.SelfSignedID,
		PlayFabID:        client.PlayFabID,
		PlatformType:     client.PlatformType,
		MaxViewDistance:  client.MaxViewDistance,
		MemoryTier:       client.MemoryTier,
		DeviceModel:      client.DeviceModel,
		DeviceID:         client.DeviceID,
		DeviceOS:         client.DeviceOS,
		DefaultInputMode: client.DefaultInputMode,
		CurrentInputMode: client.CurrentInputMode,
		ClientRandomID:   client.ClientRandomID,
		Platform:		  DeviceOSMap[client.DeviceOS],
	}
	// Send to NodeJS server for preprocessing
	return SendWebSocketEvent("backend", "login", &loginInfo)
}