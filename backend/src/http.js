
const http = require("http");
const fs = require("fs");
const { exec, spawn } = require("child_process");
const { db, parseJSON, saveDB } = require("./database");

// Load our environment variables and import rest of project files
require("dotenv").config({ quiet: true });
require("./websocket");
require("./requests");
require("./database");

const HTTP_METHODS = new Map();

/**
 * Register a URL endpoint for the HTTP request with the command
 * @param {string} urlHeader The url to link this with
 * @param {string} method The http method request method (POST, GET)
 * @param {function} callback The function to run from the request
 */
function registerHttpUrl(urlHeader, callback) {
    HTTP_METHODS.set(urlHeader, callback);
}

/**
 * Unfortunately, hosting a HTTP server seems to much faster than our websocket system
 * Literally, like 100ms instead of 10s for loading and writing large JSON databases
 */

http.createServer((request, response) => {
    // Make sure these requests are from an authorized endpoint (ourselves)
    if (request.headers["auth"] !== process.env.HTTP_TOKEN) {
        response.writeHead(401, { "Content-Type": "text/plain" });
        return response.end("Unauthorized HTTP authentication request.\n");
    }
    // Parse our url and assure that there is a defined url for the request
    const baseURL = `http://${request.headers.host}`;
    const parsedUrl = new URL(request.url, baseURL);
    const httpCallback = HTTP_METHODS.get(parsedUrl.pathname);

    if (httpCallback === undefined) {
        response.writeHead(404, { "Content-Type": "text/plain" });
        return response.end("HTTP URL is not found or registered.\n");
    }

    // Manage HTTP post requests and forward them to the function
    if (request.method === "POST") {
        let httpBody = ""; 
        request.on("data", chunk => (httpBody += chunk));
        request.on("end", () => { 
            const parsedJSON = parseJSON(httpBody);
            if (parsedJSON !== null) // Pass JSON into the callback
                return httpCallback(request, response, parsedJSON);

            // The passed JSON in the HTTP request failed
            response.writeHead(400, { 'Content-Type': 'text/plain' });
            return response.end("Malformed or broken JSON passed.\n");
        });
    }
    // Fulfill other registered get requests
    if (request.method === "GET") {
        const queryParams = Object.fromEntries(parsedUrl.searchParams);
        return httpCallback(request, response, queryParams);
    }
})
.listen(4000, () => console.log("HTTP server listening on port 4000."));


// Fetch a JSON file saved on the server and return it to the BDS server scripts
registerHttpUrl("/readJSON", (request, response, { file }) => {
    // Verify the file exists in our local memory cache object
    if (!file || db[file] === undefined) {
        response.writeHead(400, { "Content-Type": "text/plain" });
        return response.end("No darabase was found with that file name.\n");
    }

    // Respond back directly from memory instead of reading disk
    response.writeHead(200, { "Content-Type": "application/json" });
    return response.end(JSON.stringify(db[file]));
});

// Write into to a JSON file provided the parameters given by the HTTP request
registerHttpUrl("/writeJSON", (request, response, { file, json }) => {
    // Assure the HTTP request has the correct fields entered in request
    if (!file || typeof file !== "string") {
        response.writeHead(400, { "Content-Type": "text/plain" });
        return response.end("A valid file name must be provided.\n");
    }
    if (!json || typeof json !== "object") {
        response.writeHead(400, { "Content-Type": "text/plain" });
        return response.end("A valid JSON object must be provided.\n");
    }

    // Overwrite the JSON file in the backend file system with the new object
    saveDB(file, json);
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("Successfully written into the provided JSON file.\n");
});

module.exports = { registerHttpUrl };