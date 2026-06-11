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
	playerSessions = make(map[string]*PlayerSession)
	playerSessionsMu sync.RWMutex
)

func handleConnection(clientConn *minecraft.Conn, listener *minecraft.Listener) {
	identityData := clientConn.IdentityData()
	clientData := clientConn.ClientData()

	// SelfSignedID is inconsistent if the same account joins on different devices, so we use a stable UUID instead
	clientData.SelfSignedID = identityData.Identity
	username := identityData.DisplayName
	xuid := identityData.XUID

	ip_address, _, _ := net.SplitHostPort(clientConn.RemoteAddr().String())
	log.Printf("Connection: %s (%s) [%s]", username, xuid, ip_address)
	
	// Save the player's skin to disk, used for serving images for the chat relay
	if err := SaveSkin(clientData.SkinData, clientData.SkinImageWidth, clientData.SkinImageHeight, username); err != nil {
		log.Println("Failed to save skin to disk:", err)
	}

	// Process this login request to the backend and see if they are allowed to join the server
	status, err := ForwardLoginToBackend(&identityData, &clientData, ip_address)
	if err != nil {
		log.Println("Failed forwarding user login sequence payload:", err)
		_ = listener.Disconnect(clientConn, "Authentication service unavailable.")
		return
	}
	// Act on the verdict returned from your Node.js backend preprocessing
	if !status.Allowed {
		log.Printf("Connection Denied: %s", username)
		_ = listener.Disconnect(clientConn, status.Reason)
		return
	}

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

	// Cleanup and termination logic to clear variables once the player disconnects from the server
	disconnectChan := make(chan struct{})

	var closeOnce sync.Once
	closeConnection := func(reason string) {
		closeOnce.Do(func() {
			log.Printf("Disconnect: %s (%s) [%s]", username, xuid, ip_address)
			close(disconnectChan)

			playerSessionsMu.Lock()
			delete(playerSessions, username)
			playerSessionsMu.Unlock()

			_ = listener.Disconnect(clientConn, reason)
			_ = serverConn.Close()
		})
	};

	// Register pointers to both the client connection and player connection
	playerSessionsMu.Lock()
	playerSessions[username] = &PlayerSession{
		ClientConn: clientConn,
		ServerConn: serverConn,
		JoinDate:	time.Now(),
	}
	playerSessionsMu.Unlock()
	
	// Ensure the connection is established and the player has spawned in before starting to write packets
	if err := clientConn.StartGame(serverConn.GameData()); err != nil {
		log.Println("StartGame sync runtime error:", err)
		closeConnection("Failed to initialize game client.")
		return
	}

	// Once the client container is built and ready, safely trigger the server spawn sequence
	if err := serverConn.DoSpawn(); err != nil {
		log.Println("DoSpawn sync runtime error:", err)
		closeConnection("Server failed to spawn player.")
		return
	}

	// Client connection read loop to forward packets from the client to the backend server
	go func() {
		defer closeConnection("Client to server connection disconncted.")
		for {
			pkBytes, err := clientConn.ReadBytes()
			if err != nil {
				return
			}
			if _, err = serverConn.Write(pkBytes); err != nil {
				return
			}
		}
	}()

	// Server connection read loop to forward packets from the backend server to the client
	go func() {
		defer closeConnection("Server to client connection disconnected.")
		for {
			pkBytes, err := serverConn.ReadBytes()
			if err != nil {
				return
			}
			if _, err = clientConn.Write(pkBytes); err != nil {
				return
			}
		}
	}()

	// Update this player's ping every second that can be requested in a websocket call
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				currentPing := clientConn.Latency().Milliseconds() * 2
				playerpingMu.Lock()
				playerPing[username] = currentPing
				playerpingMu.Unlock()

			case <-disconnectChan:
				return
			}
		}
	}()
}