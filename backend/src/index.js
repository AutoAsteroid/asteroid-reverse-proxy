// Load our environment variables and import rest of project files
require("dotenv").config({ quiet: true });

require("./database");
require("./websocket");
require("./http");
require("./requests");
require("./bans");