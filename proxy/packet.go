package main

import (
	"encoding/json"
	"fmt"
	"log"
	"reflect"

	"github.com/sandertv/gophertunnel/minecraft"
	"github.com/sandertv/gophertunnel/minecraft/protocol/packet"
)

// The structure of packets should we receive them from websocket requests
type packetPayloadPeek struct {
	PacketName string          `json:"name"`
	Packet     json.RawMessage `json:"payload"`
}

var (
	serverPool = packet.NewServerPool()
	clientPool = packet.NewClientPool()

	// Dynamic lookup maps translating packet names to packet IDs
	serverStringToID = make(map[string]uint32)
	clientStringToID = make(map[string]uint32)
)

// Dynamically load all the packet factory names to their IDs to save the headache of knowing them
// Packets are different for server and clients, but their packet IDs overlap for each
func init() {
	for id, factory := range serverPool {
		if factory != nil {
			name := reflect.TypeOf(factory()).Elem().Name() // Yields "PlayerAction"
			serverStringToID[name] = id
		}
	}
	for id, factory := range clientPool {
		if factory != nil {
			name := reflect.TypeOf(factory()).Elem().Name() // Yields "Animate"
			clientStringToID[name] = id
		}
	}
}

// Gets the current player session for the target player username connected to the proxy
func GetSession(target string) *PlayerSession {
	playerSessionsMu.RLock()
	defer playerSessionsMu.RUnlock()

	session, exists := playerSessions[target]
	if !exists {
		return nil
	}
	return session
}

// Parses the WSEnvelope payload for inbound packets and retrieves the active session pointer
func extractPacketRequest(envelope *WSEnvelope) (*PlayerSession, string, json.RawMessage, error) {
	var peek packetPayloadPeek
	if err := json.Unmarshal(envelope.Payload, &peek); err != nil {
		return nil, "", nil, fmt.Errorf("invalid packet payload structure: %w", err)
	}

	if peek.PacketName == "" {
		return nil, "", nil, fmt.Errorf("missing 'name' inside payload")
	}

	session := GetSession(envelope.Target)
	if session == nil {
		return nil, "", nil, fmt.Errorf("target session '%s' not found", envelope.Target)
	}

	return session, peek.PacketName, peek.Packet, nil
}

// Writes a packet downstream to the minecraft server, conn needs to be a server minecraft connection
func WriteServerJSONPacket(conn *minecraft.Conn, packetName string, payload json.RawMessage) error {
	id, exists := serverStringToID[packetName]
	if !exists {
		return fmt.Errorf("unknown server-bound packet name: %s", packetName)
	}
	return WriteJSONPacket(conn, id, payload, &serverPool)
}

// Writes a packet upstream to the minecraft client, conn needs to be a client minecraft connection
func WriteClientJSONPacket(conn *minecraft.Conn, packetName string, payload json.RawMessage) error {
	id, exists := clientStringToID[packetName]
	if !exists {
		return fmt.Errorf("unknown client-bound packet name: %s", packetName)
	}
	return WriteJSONPacket(conn, id, payload, &clientPool)
}

// Dynamically instantiates a Bedrock packet from the provided packet pool, unmarshals the raw JSON payload into it
// and writes it to the connection. Allowing for packet injection from our other applications
func WriteJSONPacket(conn *minecraft.Conn, packetID uint32, payload json.RawMessage, pool *packet.Pool) error {
	if conn == nil {
		return fmt.Errorf("minecraft connection instance writing packet is nil")
	}

	// Extract the corresponding packet struct for this relative packet ID for client/server pool
	factory, exists := (*pool)[packetID]
	if !exists {
		return fmt.Errorf("packet ID %d does not exist in this protocol direction", packetID)
	}

	// Instantiate a new instance of this packet and fill it with our json payload
	pk := factory()
	if err := json.Unmarshal(payload, pk); err != nil {
		return fmt.Errorf("failed to unmarshal JSON into packet %T: %w", pk, err)
	}

	// Auto fill this connections entity runtime ID if the packet needs it from conn
	entityRuntimeID := reflect.ValueOf(pk).Elem().FieldByName("EntityRuntimeID")
	
	// If the packet struct possesses a modifiable EntityRuntimeID field, auto fill it
	if entityRuntimeID.IsValid() && entityRuntimeID.CanSet() && entityRuntimeID.Uint() == 0  {
		entityRuntimeID.SetUint(conn.GameData().EntityRuntimeID)
	}
	return conn.WritePacket(pk)
}

// Global list of packet names to ignore when logging
var ignoreList = []string{
	"MobEffect",
	"LevelSoundEvent",
	"SetScore",
	"SetTitle",
	"PlayerAuthInput",
	"InventoryContent",
	"InventoryTransaction",
	"CurrentStructureFeature",
	"SetTime",
	"SubChunkRequest",
	"LevelChunk",
	"SubChunk",
}

// Takes a minecraft packet, resolves its name, and dumps into JSON unless ignored
func LogMinecraftPacket(pk packet.Packet, header string) {
	// Use reflection to get the readable name of the struct type
	packet := reflect.TypeOf(pk).Elem().Name()

	// Ignore logging certain packets passed into pk that may flood console
	for _, name := range ignoreList {
		if name == packet {
			return
		}
	}

	// Figure out and distinguish if this is a client or server packet
	direction := "Unknown"
	_, isClient := clientStringToID[packet]
	_, isServer := serverStringToID[packet]

	switch {
	case isClient && isServer:
		direction = "Bidirectional"
	case isClient:
		direction = "Client"
	case isServer:
		direction = "Server"
	}

	// Marshal the struct into a readable indented JSON string and print it
	jsonData, err := json.MarshalIndent(pk, "", "  ")
	if err != nil {
		log.Printf("Failed to marshal %s to JSON: %v", packet, err)
		return
	}
	log.Printf("%s -> %s (ID: %d, Type: %s):\n%s", packet, header, pk.ID(), direction, string(jsonData))
}