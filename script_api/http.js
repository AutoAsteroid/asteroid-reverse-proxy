
import { http, HttpRequest, HttpHeader, HttpRequestMethod } from "@minecraft/server-net";
import { sendWS, requestWS } from "./websocket";

// Token required to be able to send requests to the backend HTTP server
// Should be the same as the token in /backend/.env/HTTP_TOKEN
const AUTH_TOKEN = "";
const HTTP_ADDRESS = "http://localhost:4000/";

/**
 * Makes a simple server-net http get request without throwing errors
 * @param {string} link The url to make the get request to
 * @returns {Object} Response object, will be null on failure
 */
export async function requestUrl(url) {
    try {
        const response = await http.get(url);
        return JSON.parse(response.body);
    } catch { return null; }
}

/**
 * Sends a command directly into the server console via a websocket request
 * @param {string} command The command to run in the server console screen
 */
export async function runConsole(command) {
    sendWS("run_console", "backend", { command });
}

/**
 * Reads a JSON file stored on the backend via http request 
 * @param {string} file The name of the json file (excluding .json)
 * @returns {Object} The object parsed from the JSON file
 */
export async function readJSONFile(file) {
    const requestUrl = "readJSON?file=" + file.replaceAll(" ", "%20");
    const request = new HttpRequest(HTTP_ADDRESS + requestUrl);
    request.method = HttpRequestMethod.Get;
    request.headers = [ 
        new HttpHeader("Content-Type", "application/json"),
        new HttpHeader("auth", AUTH_TOKEN) ];

    // Safely parse the HTTP request return object
    try {
        const response = await http.request(request);
        return JSON.parse(response);
    } catch { return null; }
}

/**
 * Write to a JSON file stored on the backend via http request
 * @param {string} path The name of the json file (excluding .json)
 * @param {Object} json The object to write into the JSON file
 */
export async function writeJSONFile(file, json) {
    const request = new HttpRequest(HTTP_ADDRESS + "writeJSON");
    request.method = HttpRequestMethod.Post;
    request.body = JSON.stringify({ file, json });
    request.headers = [ 
        new HttpHeader("Content-Type", "application/json"),
        new HttpHeader("auth", AUTH_TOKEN) ];

    return await http.request(request)
        .then(() => true)
        .catch(() => false);
}