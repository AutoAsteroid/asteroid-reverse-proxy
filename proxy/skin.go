package main

// skin.go contains all the helper functions for processing incoming raw base64 skin data from player login sequences

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"

	xdraw "golang.org/x/image/draw"
)

// DecodeSkinRGBA converts a raw Bedrock base64 skin string into a standard Go *image.RGBA object
// Minecraft textures are passed as raw uncompressed byte arrays (RGBA) wrapped in base64
func DecodeSkinRGBA(skinBase64 string) (*image.RGBA, error) {
	// Decode the base64 string into raw binary RGBA pixels
	raw, err := base64.StdEncoding.DecodeString(skinBase64)
	if err != nil {
		return nil, err
	}

	// Determine texture dimensions based on byte array length (Width * Height * 4 bytes per pixel)
	var w, h int
	switch len(raw) {
	case 64 * 32 * 4: 		// Legacy Steve/Alex format
		w, h = 64, 32
	case 64 * 64 * 4: 		// Modern standard format
		w, h = 64, 64
	case 128 * 128 * 4: 	// High definition marketplace or imported skins
		w, h = 128, 128
	default:
		return nil, errors.New("unknown skin size: expected 64x32, 64x64, or 128x128 pixels")
	}

	// Create an empty image canvas and copy the raw pixel bytes into it
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	copy(img.Pix, raw)
	return img, nil
}

// Converts a raw decoded base64 skin matrix directly into standard compressed PNG file bytes
func SkinDataToPNG(skinBase64 string) ([]byte, error) {
	img, err := DecodeSkinRGBA(skinBase64)
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Ccrops out the player's head pixels inclduding base layer and outer hat layer
// and scales it up to a clean, high-resolution 128x128 head icon
func ExtractFacePNG(skin *image.RGBA) ([]byte, error) {
	// Multiplier to handle HD skins (64px = 1x, 128px = 2x)
	scale := skin.Bounds().Dx() / 64 

	// Define standard Minecraft texture layout coordinates for heads
	faceRect := image.Rect(8*scale, 8*scale, 16*scale, 16*scale)
	hatRect := image.Rect(40*scale, 8*scale, 48*scale, 16*scale)

	// Create a new RGBA canvas to composite the head layers together (base + hat)
	face := image.NewRGBA(image.Rect(0, 0, 8*scale, 8*scale))
	draw.Draw(face, face.Bounds(), skin, faceRect.Min, draw.Src) // Base had
	draw.Draw(face, face.Bounds(), skin, hatRect.Min, draw.Over) // Hat overlay

	// Create our final scaled up higher resolution face image canvas (128x128 pixels)
	dst := image.NewRGBA(image.Rect(0, 0, 128, 128))
	xdraw.NearestNeighbor.Scale(dst, dst.Bounds(), face, face.Bounds(), draw.Src, nil)

	// Encode our final upscaled face image data to a standard compressed PNG
	var buf bytes.Buffer
	if err := png.Encode(&buf, dst); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Saves a base64 skin to disk as both a full skin and its cropped face PNG to "skins"
func SaveSkin(skinBase64 string, folderName string) error {
	skinRGBA, err := DecodeSkinRGBA(skinBase64)
	if err != nil {
		return err
	}

	// Generate full skin and face PNG byte data into memory buffers
	var skinBuf bytes.Buffer
	if err := png.Encode(&skinBuf, skinRGBA); err != nil {
		return err
	}
	facePNG, err := ExtractFacePNG(skinRGBA)
	if err != nil {
		return err
	}

	// Create target directory for the player's skin assets if it doesn't exist
	targetDir := filepath.Join("skins", folderName)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return err
	}

	// Save the skin files directly to disk inside the named folder
	skinFile := filepath.Join(targetDir, "skin.png")
	if err := os.WriteFile(skinFile, skinBuf.Bytes(), 0644); err != nil {
		return err
	}
	faceFile := filepath.Join(targetDir, "face.png")
	if err := os.WriteFile(faceFile, facePNG, 0644); err != nil {
		return err
	}

	return nil
}