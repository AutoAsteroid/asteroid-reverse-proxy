package main

import (
    "fmt"
    "time"
	"encoding/json"
	"sync"
	"sync/atomic"
	"net/http"
	"log"

	"github.com/gorilla/websocket"
)

// This serves as our middle man to handle multiple concurrent websocket connextions for our applications
// Any one client can request from another connected app, rather than being limited to point to point
// This avoids a P2P mesh where every app needs to make its own WS connection to each other app (N^2)
var (
	// Track WebSocket connections and mutex for safe concurrent access
    wsConns = make(map[string]*websocket.Conn)
    wsMu sync.Mutex

	// Track the state of outbound websocket requests to clients
	id_counter uint64
	pendingRequests	sync.Map

    upgrader = websocket.Upgrader{
        ReadBufferSize:  1024,
        WriteBufferSize: 1024,
        CheckOrigin:     func(r *http.Request) bool { return true },
    }
)

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

		// Intercept and check if this fulfills an outbound request the proxy made
		if ch, found := pendingRequests.Load(envelope.ID); found {
			ch.(chan json.RawMessage) <- envelope.Payload
			continue 
		}

		// Check if this request is meant to be handled internally instead of rerouted
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
func handleInternalRequest(envelope *WSEnvelope) (drop bool) {
	// Any blank return statements will return true, implying to drop the request
	drop = true

    switch envelope.Event {

    case "get_ping":
		// Update the payload and reroute it to the current target
        playerpingMu.RLock()
        pingData := playerPing
        playerpingMu.RUnlock()

        envelope.Event = "ping_response"
        envelope.Payload, _ = json.Marshal(pingData)

		// Explicitly allow this request to reroute back to the requester
		return false

	case "send_server_packet":
		// Handle incoming server packets requests, using envelope.Target for the player name instead of the 
		session, packetName, packetData, err := extractPacketRequest(envelope)
		if err != nil {
			log.Printf("Server packet extraction failed: %v", err)
			return
		}
		if err := WriteServerJSONPacket(session.ServerConn, packetName, packetData); err != nil {
			log.Printf("Server injection failed for %s: %v", envelope.Target, err)
		}

	case "send_client_packet":
		// Handle incoming client packets requests, using envelope.Target for the player name instead of the 
		session, packetName, packetData, err := extractPacketRequest(envelope)
		if err != nil {
			log.Printf("Client packet extraction failed: %v", err)
			return
		}
		if err := WriteClientJSONPacket(session.ClientConn, packetName, packetData); err != nil {
			log.Printf("Client injection failed for %s: %v", envelope.Target, err)
		}
    }
	// This is not an internal event, so it should not be dropped and should be rerouted
	return false 
}

func SendWebSocketEvent(envelope *WSEnvelope) error {
	// Fetch the target client's WebSocket connection from the registry and process it safely
	wsMu.Lock()
	targetConn, online := wsConns[envelope.Target]
	wsMu.Unlock()

	// If the requested websocket hasn't connected to our proxy yet, fail immediately
	if !online {
		return fmt.Errorf("target client '%s' is offline or not registered", envelope.Target)
	}
	envelope.Timestamp = time.Now().UnixMilli()

	// Transmit the JSON payload specifically down the targeted client socket pipe
	if err := targetConn.WriteJSON(envelope); err != nil {
		return fmt.Errorf("failed to transmit event '%s' to '%s': %w", envelope.Event, envelope.Target, err)
	}
	return nil
}

func RequestWS[T any](target string, event string, data interface{}, timeout time.Duration) (*T, error) {
	// Send a unique ID for this request back to the proxy so that we know if
	requestID := fmt.Sprintf("proxy:%d", atomic.AddUint64(&id_counter, 1))

	// Save this request for the websocket client to fulfill with a reply back
	responseChan := make(chan json.RawMessage, 1)
	pendingRequests.Store(requestID, responseChan)
	defer pendingRequests.Delete(requestID)

	payload, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payload for event '%s': %w", event, err)
	}

	// Send our websocket envelope to the target client with our payload and request ID
	envelope := WSEnvelope{ ID: requestID, Event: event, Target: target, Payload: payload }
	if err := SendWebSocketEvent(&envelope); err != nil {
		return nil, err
	}

	// Wait for our response channel to receive its reply back from target client
	select {
	case rawResponse := <-responseChan:
		var payload T
		if err := json.Unmarshal(rawResponse, &payload); err != nil {
			return nil, fmt.Errorf("failed to parse response type: %w", err)
		}
		// The response is already the payload, not WSEnvelope
		return &payload, nil

	case <-time.After(timeout):
		return nil, fmt.Errorf("request '%s' (%s) timed out", event, requestID)
	}
}