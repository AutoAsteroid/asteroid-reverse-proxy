
const crypto = require("crypto");
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
            if (type === "xuid")
                name = "__" + db.profiles[name].displayName + "__";
            if (type === "ip")
                name = anonymize(name, "ip", 8);
            if (type === "device")
                name = anonymize(name, "device", 24);

            let result = `${indicators[type] || "❓"} ${name}\n`;

            for (let i = 0; i < connections.length; i++) {
                const child = connections[i];
                const isLastChild = i === connections.length - 1;

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