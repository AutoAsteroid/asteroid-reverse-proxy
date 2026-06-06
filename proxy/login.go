package main

import (
    "time"
	"github.com/sandertv/gophertunnel/minecraft/protocol"
	"github.com/sandertv/gophertunnel/minecraft/protocol/login"
)

// The backend will handle the login packet data, and reply back to us if this login should be allowed to join
// Reasons of failed joins includes not is not limited to: the player is banned, the player is using a VPN, or 
// the player has their IP or device ID registered under another account that is banned

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

var DeviceOSMap = map[protocol.DeviceOS]string{
    1:  "Android",
    2:  "IOS",
    3:  "MacOS",
    4:  "FireOS",
    5:  "GearVR",
    6:  "Hololens",
    7:  "Windows",
    8:  "Windows",
    9:  "Dedicated Server",
    10: "TVOS",
    11: "PlayStation",
    12: "Nintendo Switch",
    13: "Xbox",
    14: "Windows Phone",
    15: "Linux",
}

// The backend will reply with a payload on whether or not this connection should be allowed
type LoginVerdict struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason"`
}

func ForwardLoginToBackend(identity *login.IdentityData, client *login.ClientData, address string) (*LoginVerdict, error) {
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
	// Send to backend server for preprocessing and return the result
	return RequestWS[LoginVerdict]("backend", "login", &loginInfo, 5 * time.Second)
}