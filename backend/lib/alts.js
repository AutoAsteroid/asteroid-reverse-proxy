
const crypto = require("crypto");
const sharp = require("sharp");
const DisjointSet = require("./dsu");
const UndirectedGraph = require("./graph");

const { db } = require("../src/database");
const { anonymize } = require("../src/utils");

class AltTracker {
    /**
     * Creates a disjoint set and undirected graph to track alternate accounts on the server
     * DSU represents which accounts are linked, and the graph represents HOW they are linked
     */
    constructor() {
        // Could strip this down to just a graph, but the DSU keeps lookups O(1)
        this.dsu = new DisjointSet(); 
        this.graph = new UndirectedGraph();
    }

    /**
     * Unions both x and y together and connects them together in an undirected graph to track
     * exactly how these values are connected to each other once the values cluster together
     * xType and yType should be either: "xuid", "device", or "ip"
     */
    track(x, xType, y, yType) {
        this.dsu.makeSet(x);
        this.dsu.union(x, y);
        this.graph.addEdge(x, xType, y, yType);
    }

    /**
     * Returns true if account elements x and y are linked together, meaning it is an alt
     */
    isLinked(x, y) {
        return this.dsu.find(x) === this.dsu.find(y);
    }
    
    /**
     * Traverses the graph to find how exactly this node is connected to each other
     * @param {string} startNode Start node to traverse the undirected graph from 
     * @returns {string} Nice terminal style tree of how the connections are linked
     */
    trace(startNode) {
        const networkTree = this.graph.traverse(startNode);
        if (!networkTree) return "";

        // Recursively build the graph connection tree in terminal tree layout
        const indicators = { "xuid": "👤", "ip": "🌐", "device": "💻" };
        const formatNode = ({ name, type, connections }, prefix = "") => {
            
            // Normalize values so as to not reveal sensitive information
            if (type === "xuid") name = db.profiles[name].displayName;
            if (type === "ip") name = anonymize(name, "ip", 8);
            if (type === "device") name = anonymize(name, "device", 24);

            let result = `${indicators[type] || "❓"} ${name}\n`;
            const neighbors = connections.filter(child => !child.cycle);

            for (let i = 0; i < neighbors.length; i++) {
                const child = neighbors[i];
                const isLastChild = i === neighbors.length - 1;

                // Pick the correct fork arm based on whether more elements follow
                result += prefix + (isLastChild ? "└── " : "├── ");
                const nextPrefix = prefix + (isLastChild ? "    " : "│   ");

                // Recursively head down the branch of nodes
                result += formatNode(child, nextPrefix);
            }
            return result;
        };

        // Start recursion with an empty string layout for the root node
        return formatNode(networkTree, "");
    }

    /**
     * Traverses the graph to find how this node is connected to each other, outputting an image buffer
     * @param {string} startNode Start node to traverse the undirected graph from 
     * @param {string} username The username to place in the title of the output image buffer
     * @returns {Buffer<ArrayBufferLike>} The generated image buffer of this image
     */
    async traceImage(startNode, username = "Network Trace") {
        // Converts our raw text network trace into PNG image bytes using sharp SVG conversion
        const lines = this.trace(startNode).split("\n");
        const fontSize = 14, lineHeight = 20, padding = 30, topMargin = 40; 
        
        // Calculate the image height and width based on the dimensions of our trace lines
        const imageHeight = Math.max(100, (lines.length * lineHeight) + (padding * 2) + topMargin / 2);
        const longestLine = Math.max(...lines.map(line => line.length));
        const imageWidth = Math.max(500, (longestLine * 8.5) + (padding * 2));

        // Construct our SVG template of our network trace
        const svgLines = lines.map((line) => 
            `<tspan x="${padding}" dy="${lineHeight}">${line}</tspan>`).join("\n");
        const svgTemplate = `
            <svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
                <style>
                    .base {
                        font-family: 'Fira Code', 'DejaVu Sans Mono', Consolas, 'Courier New', 
                                     'Noto Color Emoji', 'Apple Color Emoji', monospace;
                        font-size: ${fontSize}px;
                        line-height: ${lineHeight}px;
                    }
                    .title {
                        fill: #1b77c3;
                        font-weight: bold;
                    }
                    .trace {
                        fill: #d6dbee;
                    }
                    pre { margin: 0; white-space: pre; }
                </style>
                <rect width="100%" height="100%" fill="#11111b" rx="12" />
                <text x="${padding}" y="${padding + 8}" class="base title">
                    📊 Full Network Map Trace: ${username}
                </text>
                <text x="${padding}" y="${padding + topMargin}" class="base trace">
                    <tspan xml:space="preserve">
                        ${svgLines}
                    </tspan>
                </text>
            </svg>
        `;
        // Return the SVG format to a PNG image buffer bytes for sending to discord
        return await sharp(Buffer.from(svgTemplate)).png().toBuffer();
    }
}

const alternates = new AltTracker();

/**
 * Populate our unified AltTracker with all detected alternate accounts
 * AFTER we have already loaded in our profile database
 */
for (const [ xuid, profile ] of Object.entries(db.profiles ?? {})) {
    // Union and connect all ips and device ids to this specific xuid
    for (const id of profile.deviceIDs)
        alternates.track(xuid, "xuid", id, "device");
    for (const ip of profile.addresses)
        alternates.track(xuid, "xuid", ip, "ip");
}

module.exports = alternates;