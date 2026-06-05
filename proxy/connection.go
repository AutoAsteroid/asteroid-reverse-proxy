package main

import (
	"log"
	"net"
	"sync"
	"time"

	"github.com/sandertv/gophertunnel/minecraft"
)

// Connection between the player and the server that will be tracked to alter later
type PlayerSession struct {
	ClientConn *minecraft.Conn 
	ServerConn *minecraft.Conn 
	JoinDate	time.Time
}

var (
	// playerPing maps current connected player latency in milliseconds
    playerPing = make(map[string]int64)
    playerpingMu sync.RWMutex

	// Client connections storing every minecraft connection
	playerSessions = make(map[string]PlayerSession)
	playerSessionsMu sync.RWMutex
)

func handleConnection(clientConn *minecraft.Conn, listener *minecraft.Listener) {
	// SelfSignedID is inconsistent if the same account joins on different devices, so we use a stable UUID instead (xuid causes errors)
	identityData := clientConn.IdentityData()
	clientData := clientConn.ClientData()

	clientData.SelfSignedID = identityData.Identity
	username := identityData.DisplayName
	xuid := identityData.XUID

	ip_address, _, _ := net.SplitHostPort(clientConn.RemoteAddr().String())
	log.Printf("Connection: %s (%s) [%s]", username, xuid, ip_address)

	// Process this login request to the backend and save their skin to disk for chat relay
	if err := ForwardLoginToBackend(&identityData, &clientData, ip_address); err != nil {
		log.Println("Failed forwarding user login sequence payload:", err)
	}
	if err := SaveSkin(clientData.SkinData, identityData.DisplayName); err != nil {
		log.Println("Failed to save skin to disk:", err)
	}

	// go http.Get("http://127.0.0.1:4040/playerlist?user=" + url.QueryEscape(username) + "&id=" + identity.TitleID + "&join")
	// go http.Get("http://127.0.0.1:4040/playerlist?user=" + url.QueryEscape(username) + "&leave")
	// Connect to the backend target server with their login info since our server is in offline mode
	serverConn, err := minecraft.Dialer{
		ClientData:   clientData,   
		IdentityData: identityData, 
		KeepXBLIdentityData: true,
	}.Dial("raknet", config.RemoteAddr)

	if err != nil {
		log.Println("Failed to dial backend target:", err)
		_ = listener.Disconnect(clientConn, "Failed to connect to server. Please try again later.")
		return
	}

	// Establish unified tracking cleanup function to handle player teardowns
	var closeOnce sync.Once
	closeConnection := func() {
		closeOnce.Do(func() {
			log.Printf("Disconnect: %s (%s) [%s]", username, xuid, ip_address)

			playerSessionsMu.Lock()
			delete(playerSessions, username)
			playerSessionsMu.Unlock()

			_ = listener.Disconnect(clientConn, "Disconnected from server.")
			_ = serverConn.Close()
		})
	};
	
	// Ensure the connection is established and the player has spawned in before starting to forward packets
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		if err := clientConn.StartGame(serverConn.GameData()); err != nil {
			log.Println("StartGame sync runtime error:", err)
		}
		wg.Done()
	}()
	go func() {
		if err := serverConn.DoSpawn(); err != nil {
			log.Println("DoSpawn sync runtime error:", err)
		}
		wg.Done()
	}()
	wg.Wait()

	// Register pointers to both the client connection and player connection 
	playerSessionsMu.Lock()
	playerSessions[username] = PlayerSession{
		ClientConn: clientConn,
		ServerConn: serverConn,
		JoinDate:	time.Now(),
	}
	playerSessionsMu.Unlock()

	// Client connection read loop to forward packets from the client to the backend server
	go func() {
		defer closeConnection()
		for {
			pk, err := clientConn.ReadPacket()
			if err != nil {
				return
			}
			if err := serverConn.WritePacket(pk); err != nil {
				return
			}
		}
	}()
	// Server connection read loop to forward packets from the backend server to the client
	go func() {
		defer closeConnection()
		for {
			pk, err := serverConn.ReadPacket()
			if err != nil {
				return
			}
			if err := clientConn.WritePacket(pk); err != nil {
				return
			}
		
			// Update this players ping that can be requested in a websocket call
			playerpingMu.Lock()
			playerPing[username] = clientConn.Latency().Milliseconds() * 2
			playerpingMu.Unlock()
		}
	}()
}