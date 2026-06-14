
class UndirectedGraph {
    /**
     * Basic graph implementation that uses depth first search to traverse it, using a map
     * of nodes with adjacency lists to track edge u to v. Does not need to be connected.
     */
    constructor() {
        this.nodes = new Map();
    }

    /**
     * Connects two undirected elements together in an adjacency list to build the graph
     * @param {string} u Name of first node
     * @param {string} uType Arbitrary identifier of the second node (e.g. IP, Device)
     * @param {string} v Name of second node 
     * @param {string} vType Arbitrary identifier of the second node (e.g. IP, Device)
     * @param {Object} [uData={}] Optional meta data of the first node
     * @param {Object} [vData={}] Optional meta data of the second node
     */
    addEdge(u, uType, v, vType, uData = {}, vData = {}) {
        // Neighbors is an adjacency list of connected nodes
        if (!this.nodes.has(u))
            this.nodes.set(u, { type: uType, data: uData, neighbors: new Set() });
        if (!this.nodes.has(v))
            this.nodes.set(v, { type: vType, data: vData, neighbors: new Set() });

        // Link them together cross referencing their names
        this.nodes.get(u).neighbors.add(v);
        this.nodes.get(v).neighbors.add(u);
    }

    /**
     * Depth first search implementation to get all connected nodes in the graph
     * @param {string} start The name of the node to begin the DFS traversal from
     * @return {NetworkNode} The tree of connections of this graph
     */
    traverse(start) {
        if (!this.nodes.has(start)) return null;

        const visited = new Set();
        const buildNode = (name) => {
            // Visited set to guard against infinite traversal recursion
            visited.add(name);

            const { type, neighbors, data } = this.nodes.get(name);
            const treeNode = new NetworkNode(name, type, data);

            // Recursively build connections to any neighboring nodes
            for (const neighbor of neighbors)
                if (!visited.has(neighbor))
                    treeNode.connect(buildNode(neighbor));

            return treeNode;
        };
        return buildNode(start);
    }
}

class NetworkNode {
    /**
     * Represents a connecting node part of a larger network of other nodes
     * @param {string} name The arbitrary name identifier of the node
     * @param {string} type The type identifier of node this is representing
     * @param {Object} [data={}] Optional meta data of this node
     */
    constructor(name, type, data = {}) {
        this.name = name;
        this.type = type;
        this.data = data;
        this.connections = [];
    }

    /**
     * Add a pre existing network node to the connections of this current node
     * @param {NetworkNode} child Network node to add to the connections
     */
    connect(child) {
        if (child instanceof NetworkNode)
            this.connections.push(child);
    }

    /**
     * Lazily construct and add a network node to the connections of this node
     */
    add(name, type, data = {}) {
        this.connect(new NetworkNode(name, type, data));
    }
}

module.exports = UndirectedGraph;