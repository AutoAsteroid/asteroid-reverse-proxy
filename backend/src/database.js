const fs = require("fs");
const path = require("path");

// Helper to resolve JSON paths in the database/ folder
const getPath = file => path.join(__dirname, "..", "database", file);
const db = {};

/**
 * Reads and cache all JSON files in database/ and store them in memory
 * Assumes all files are explicutly only .json files already 
 */
fs.readdirSync(path.join(__dirname, "..", "database")).forEach(file => {
    if (path.extname(file) !== ".json") return;
    const basename = path.basename(file, ".json");
    const jsonPath = getPath(file);

    const rawData = fs.readFileSync(jsonPath, "utf8");
    db[basename] = JSON.parse(rawData);
});

/**
 * Write our object into a json file saved to disk in database/
 * @param {string} name The name of the JSON file
 * @param {Object} object Object of our database to save
 * @returns {Boolean} Whether or not the save was successful
 */
function saveDB(name, object) {
    try {
        const data = JSON.stringify(object, null, 4);
        const file = getPath(name) + ".json";

        fs.writeFileSync(file, data, "utf8");
        db[name] = object; // Save to memory
        return true;
    } catch { return false }
}

/**
 * Returns a boolean if a string is in valid JSON string format
 * @param {string} string The JSON string that is being validated
 * @returns {Object | null} The JSON or null if the parse fails
 */
function parseJSON(string) {
    try { 
        return JSON.parse(string);
    } catch { return null };
}

module.exports = { db, saveDB, parseJSON };