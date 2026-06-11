package main

// A Minecraft Bedrock Edition reverse proxy implemented using the Gophertunnel library.
// This proxy was created by https://github.com/AutoAsteroid/asteroid-reverse-proxy/
// GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o proxy

import (
	"net"
	"log"
	"net/http"
	"os"

	"github.com/caarlos0/env/v10"
	"github.com/joho/godotenv"
	"github.com/sandertv/gophertunnel/minecraft"
	"github.com/sandertv/gophertunnel/minecraft/resource"
)

type Config struct {
    LocalAddr  string `env:"LOCAL_ADDR"`		// This is the address that the proxy will be running on
    RemoteAddr string `env:"REMOTE_ADDR"`		// The address that the proxy will forward players to
    ContentKey string `env:"CONTENT_KEY"`		// Encyption key used for your encrypted resource pack
	WsToken	   string `env:"WS_TOKEN"`			// Required by clients to authorize new ws connections
}

var (
    config Config 
)

func init() {
	// Try to load environment variables from .env file 
    if err := godotenv.Load(); err != nil {
		panic("Failed to load local .env file: " + err.Error())
    }
	// Parse environment variables into the Config struct
    if err := env.Parse(&config); err != nil {
        panic(err)
    }
}

// Reads resource packs from the "resource_packs" directory on disk to be served to clients
// The resource packs in the BDS server are ignored and must be served through the proxy
// Each pack is encrypted with the provided content key in the .env configuration.

func readResourcePacks() []*resource.Pack {
	packs := []*resource.Pack{}
	resourcePacks, err := os.ReadDir("resource_packs")
	if err != nil {
		return packs
	}
	// Iterate through each resource pack and add it to the list of packs to be served
	for _, folder := range resourcePacks {
		if !folder.IsDir() {
			continue
		}
		pack_name := folder.Name()
		pack, err := resource.ReadPath("resource_packs/" + pack_name)
		encrypted := pack.WithContentKey(config.ContentKey)
		if err != nil {
			log.Fatalf("Failed to read resource pack from disk: \"%v\"", pack_name)
		} else {
			log.Printf("Loaded resource pack from disk: \"%v\"", pack_name)
			packs = append(packs, encrypted)
		}
	}
	// List of encrypted resource packs loaded from disk
	return packs
}

func main() {
	log.Println("Starting up gophertunnel reverse proxy and websocket server!")

	// Handle WebSocket endpoint for the in game script API to connect to for proxy communication
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		// Make sure that the websocket connection is only coming from localhost
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		// Only allow localhost connections if no WsToken is provided in the .env file
		if config.WsToken == "" && host != "127.0.0.1" && host != "::1" && host != "localhost" {
			http.Error(w, "WebSocket access is restricted to localhost.", http.StatusUnauthorized)
			return
		}

		clientType := r.URL.Query().Get("client")
		wsAuthToken := r.URL.Query().Get("token")

		// Make sure the request is authorized to connect to our WebSocket hub if provided a token
		if config.WsToken != "" && wsAuthToken != config.WsToken {
			http.Error(w, "WebSocket access unauthorized.", http.StatusUnauthorized)
			return
		}
		
		// Upgrade the HTTP connection to a WebSocket connection
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Println("WebSocket upgrade failed:", err)
			return
		}

		// Figure out WHO is connecting to the websocket (e.g. discord, script_api)
		if clientType == "" {
			log.Println("Rejected anonymous connection (missing client parameter)")
			conn.Close()
			return
		}

		// Register this WebSocket connection into our central registry for other clients
		log.Printf("Successfully registered websocket: \"%s\"", clientType)
		wsMu.Lock()
		wsConns[clientType] = &WebsocketClient{conn: conn}
		wsMu.Unlock()

		// Listen to this WebSocket for incoming messages in a separate goroutine
		go listenToClient(clientType, conn)
	})

	if config.WsToken == "" {
		log.Printf("WebSocket connections are locked to localhost.")
	}

	go func() {
		// Listen and serve the websocket server on port 8080
		log.Printf("WebSocket server listening on port 8080.")
		if err := http.ListenAndServe("0.0.0.0:8080", nil); err != nil {
			log.Fatal(err)
		}
	}()

	// Setup a foreign status provider to mirror the remote target server's status for the proxy
	statusProvider, err := minecraft.NewForeignStatusProvider(config.RemoteAddr)
	if err != nil {
		log.Fatalln("Failed mapping target status engine:", err)
	}
	defer statusProvider.Close()

	// Start the gophertunnel proxy server with our resource packs and status provider
	listener, err := minecraft.ListenConfig{
		StatusProvider:         statusProvider,
		ResourcePacks:          readResourcePacks(), // Load resource packs from disk
		TexturePacksRequired:   true,				 // Enforce packs to be downloaded
		AuthenticationDisabled: false,				 // Enforce online authentication
	}.Listen("raknet", config.LocalAddr)

	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()

	log.Printf("Server Proxy Bounded To: %s", config.LocalAddr)
	log.Printf("Remote Target Routed To: %s", config.RemoteAddr)

	// Main connection acceptance loop for incoming Minecraft client connections to the proxy
	for {
		connection, err := listener.Accept()
		if err != nil {
			log.Printf("Error accepting connection: %s\n", err)
			continue
		}
		// Handle each connection in a separate goroutine for concurrent clients
		go handleConnection(connection.(*minecraft.Conn), listener)
	}
}